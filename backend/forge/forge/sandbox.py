"""run_cad: the one tool the CAD brain (later an LLM) uses to turn build123d source into geometry.

    run_cad(source, job_dir) -> {"ok", "stage", "errors", "report", "files", "stdout", "elapsed_s"}

Layers (each one alone should stop the malicious-input tests in tests/test_sandbox.py):
  1. static AST allowlist (policy.py) in this process: rejected source never runs
  2. separate process (`python -I forge/_child.py <job>`), fresh session, empty environment,
     cwd = job dir; rlimits: address space, CPU seconds, file size, open files, no core dumps
  3. own network namespace (os.unshare(CLONE_NEWNET); as non-root with CLONE_NEWUSER): no
     interfaces except a down loopback, so no network at all. If the namespace cannot be created
     run_cad refuses to run (fail closed) unless allow_no_netns=True is passed (tests only print a
     warning then).
  4. when started as root: setgid/setuid nobody before exec. The work dir stays root-owned with mode
     0733 (nobody may create files in it but not list it); the launcher needs no CAP_CHOWN /
     CAP_DAC_OVERRIDE for that. Leftover processes of uid nobody are killed before and after a run.
  5. in the child: policy re-check, audit hook (no sockets/subprocess/exec/ctypes/writes outside the
     job dir), minimal builtins, import allowlist
  6. wall-clock timeout: the whole process group is SIGKILLed
On the VPS the worker itself runs in a locked-down container (README.md, "Worker isolation"):
this module is the inner fence, not the only one.

FORGE_CAD_REQUIRE_DROP=1 (forge-cad): refuse to run unless the launcher is root, so the child really
drops to uid nobody (the container sees nothing but its own /tmp and the socket directory).

FORGE_NETNS=external (set only in the forge-cad container, which has `network_mode: none`): Docker's
default seccomp profile does not let an unprivileged process create namespaces, so layer 3 is then
provided by the container. run_cad still tries the unshare, and before every run checks that the
process sees no network interface except loopback (/proc/net/dev); if it sees one it refuses to run.
"""
import json
import os
import resource
import shutil
import signal
import subprocess
import sys
import tempfile
import time

from . import policy
from .geometry import geometry_report

HERE = os.path.dirname(os.path.abspath(__file__))
CHILD = os.path.join(HERE, "_child.py")
NOBODY = 65534
DEFAULTS = {"timeout_s": 90, "mem_mb": 2048, "fsize_mb": 64, "nofile": 64}


def _preexec(mem_mb, cpu_s, fsize_mb, nofile, netns_required):
    def fn():
        os.setsid()
        mb = 1024 * 1024
        resource.setrlimit(resource.RLIMIT_AS, (mem_mb * mb, mem_mb * mb))
        resource.setrlimit(resource.RLIMIT_CPU, (cpu_s, cpu_s + 1))
        resource.setrlimit(resource.RLIMIT_FSIZE, (fsize_mb * mb, fsize_mb * mb))
        resource.setrlimit(resource.RLIMIT_NOFILE, (nofile, nofile))
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        try:
            if os.geteuid() == 0:
                os.unshare(os.CLONE_NEWNET)
            else:
                os.unshare(os.CLONE_NEWUSER | os.CLONE_NEWNET)
        except (OSError, AttributeError):
            if netns_required:
                os._exit(97)
        if os.geteuid() == 0:
            os.setgroups([])
            os.setgid(NOBODY)
            os.setuid(NOBODY)
    return fn


def netns_available():
    """True if this host lets us create a network namespace (checked in a throwaway child)."""
    try:
        r = subprocess.run([sys.executable, "-I", "-c", "import os,sys\n"
                            "f=os.CLONE_NEWNET if os.geteuid()==0 else os.CLONE_NEWUSER|os.CLONE_NEWNET\n"
                            "os.unshare(f)"], capture_output=True, timeout=10)
        return r.returncode == 0
    except Exception:
        return False


def only_loopback(dev_file="/proc/net/dev"):
    """True if the only network interface this process can see is loopback (or there is none)."""
    try:
        with open(dev_file, encoding="ascii", errors="replace") as f:
            lines = f.read().splitlines()[2:]
    except OSError:
        return False
    names = {ln.split(":", 1)[0].strip() for ln in lines if ":" in ln}
    return names <= {"lo"}


def run_cad(source, job_dir, timeout_s=None, mem_mb=None, allow_no_netns=False, density_g_cm3=1.24, report=True):
    """report=False (forge-cad launcher): skip the trimesh geometry report and return the child's info as res["child"];
    the worker computes the report itself, so the privileged launcher never parses the child's output files."""
    t0 = time.monotonic()
    if os.environ.get("FORGE_CAD_REQUIRE_DROP") == "1" and os.geteuid() != 0:
        return {"ok": False, "stage": "isolation", "errors": ["FORGE_CAD_REQUIRE_DROP=1 but the launcher is not root (cannot drop to nobody)"],
                "report": None, "files": {}, "stdout": "", "elapsed_s": 0.0}
    if os.environ.get("FORGE_NETNS") == "external":
        if not only_loopback():
            return {"ok": False, "stage": "isolation", "errors": ["FORGE_NETNS=external but a network interface is visible (refusing to run)"],
                    "report": None, "files": {}, "stdout": "", "elapsed_s": 0.0}
        allow_no_netns = True
    timeout_s = timeout_s or DEFAULTS["timeout_s"]
    mem_mb = mem_mb or DEFAULTS["mem_mb"]
    res = {"ok": False, "stage": "policy", "errors": [], "report": None, "files": {}, "stdout": "", "elapsed_s": 0.0}
    errs = policy.check_source(source)
    if errs:
        res["errors"] = errs
        res["elapsed_s"] = round(time.monotonic() - t0, 3)
        return res
    os.makedirs(job_dir, exist_ok=True)
    job_dir = os.path.realpath(job_dir)
    for f in ("design.py", "part.step", "part.stl", "child.json", "report.json"):
        if os.path.exists(os.path.join(job_dir, f)):
            os.remove(os.path.join(job_dir, f))
    with open(os.path.join(job_dir, "design.py"), "w", encoding="utf-8") as f:
        f.write(source)
    # the child works in a fresh private directory (the only place it may write); results are
    # copied back to job_dir afterwards
    work = tempfile.mkdtemp(prefix="forge-cad-", dir=os.environ.get("FORGE_SANDBOX_TMP") or None)
    try:
        return _run(source, job_dir, work, timeout_s, mem_mb, allow_no_netns, density_g_cm3, res, t0, report)
    finally:
        kill_uid(NOBODY, clean=work)
        shutil.rmtree(work, ignore_errors=True)


def _run(source, job_dir, work, timeout_s, mem_mb, allow_no_netns, density_g_cm3, res, t0, report=True):
    with open(os.path.join(work, "design.py"), "w", encoding="utf-8") as f:
        f.write(source)
    if os.geteuid() == 0:
        kill_uid(NOBODY)
        os.chmod(work, 0o733)
    netns_required = not allow_no_netns
    env = {"PATH": "/usr/bin:/bin", "HOME": work, "TMPDIR": work, "LANG": "C.UTF-8", "OMP_NUM_THREADS": "1",
           "OPENBLAS_NUM_THREADS": "1", "MPLBACKEND": "Agg"}
    proc = subprocess.Popen(
        [sys.executable, "-I", CHILD, work], cwd=work, env=env,
        stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        preexec_fn=_preexec(mem_mb, int(timeout_s) + 2, DEFAULTS["fsize_mb"], DEFAULTS["nofile"], netns_required),
        close_fds=True)
    try:
        out, _ = proc.communicate(timeout=timeout_s)
        timed_out = False
    except subprocess.TimeoutExpired:
        timed_out = True
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        except PermissionError:
            # forge-cad: the launcher has no CAP_KILL and the child is uid nobody: kill it as nobody
            kill_uid(NOBODY)
        out, _ = proc.communicate()
    res["stdout"] = (out or b"")[-8000:].decode("utf-8", "replace")
    res["elapsed_s"] = round(time.monotonic() - t0, 3)
    for f in ("child.json", "part.step", "part.stl"):
        src_f = os.path.join(work, f)
        if os.path.isfile(src_f) and not os.path.islink(src_f):
            shutil.copyfile(src_f, os.path.join(job_dir, f))
    child_json = os.path.join(job_dir, "child.json")
    child = None
    if os.path.exists(child_json) and os.path.getsize(child_json) < 256 * 1024:
        try:
            with open(child_json) as f:
                child = json.load(f)
        except ValueError:
            child = None
    if timed_out:
        res.update(stage="timeout", errors=[f"killed after {timeout_s} s wall clock"])
        return res
    if proc.returncode == 97:
        res.update(stage="isolation", errors=["could not create a network namespace (refusing to run)"])
        return res
    if proc.returncode < 0:
        sig = -proc.returncode
        name = signal.Signals(sig).name if sig in signal.Signals._value2member_map_ else str(sig)
        res.update(stage="killed", errors=[f"child killed by {name} (CPU/memory limit)"])
        return res
    if not child:
        res.update(stage="exec", errors=[f"child exited {proc.returncode} without a result"] + res["stdout"].splitlines()[-5:])
        return res
    if not child.get("ok"):
        res.update(stage=child.get("stage", "exec"), errors=child.get("errors", []))
        return res
    step, stl = os.path.join(job_dir, "part.step"), os.path.join(job_dir, "part.stl")
    if not (os.path.exists(step) and os.path.exists(stl)):
        res.update(stage="export", errors=["STEP/STL missing"])
        return res
    res["files"] = {"step": step, "stl": stl, "design": os.path.join(job_dir, "design.py")}
    if not report:
        res.update(ok=True, stage="done", child=child)
        return res
    try:
        res["report"] = geometry_report(stl, child, density_g_cm3=density_g_cm3)
    except Exception as e:  # noqa: BLE001
        res.update(stage="report", errors=[f"report failed: {type(e).__name__}: {e}"])
        return res
    with open(os.path.join(job_dir, "report.json"), "w") as f:
        json.dump(res["report"], f, indent=1)
    res["files"]["report"] = os.path.join(job_dir, "report.json")
    res.update(ok=True, stage="done")
    return res


def kill_uid(uid, clean=None):
    """SIGKILL every process of `uid` (strays a sandbox child may have left) and, if `clean` is given, delete what
    that uid left inside that directory (its own subdirectories, which root without DAC override cannot remove).
    Root only; a helper drops to `uid`, so kill(-1) reaches exactly that uid's processes (no CAP_KILL needed)."""
    if os.geteuid() != 0 or os.environ.get("FORGE_CAD_REQUIRE_DROP") != "1":
        return  # only inside the forge-cad container (on a shared dev host this would hit unrelated processes)
    # root owns `clean` (mode 0733: nobody may not list it), so the names are listed here, before the drop
    leftovers = []
    if clean:
        try:
            leftovers = [os.path.join(clean, n) for n in os.listdir(clean)]
        except OSError:
            leftovers = []
    pid = os.fork()
    if pid == 0:
        try:
            os.setgroups([])
            os.setgid(uid)
            os.setuid(uid)
            os.kill(-1, signal.SIGKILL)
        except OSError:
            pass
        for p in leftovers:
            if os.path.isdir(p) and not os.path.islink(p):
                shutil.rmtree(p, ignore_errors=True)
        os._exit(0)
    os.waitpid(pid, 0)


def cleanup(job_dir):
    shutil.rmtree(job_dir, ignore_errors=True)
