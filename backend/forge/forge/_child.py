"""Sandbox child: runs ONE design.py from a job directory and exports STEP + STL.

Started by sandbox.run_cad() as `python -I _child.py <job_dir>` in a fresh process that already has
resource limits, its own session, no network namespace and (when started as root) uid nobody.
Layers inside the process (on top of the static policy in the parent):
  1. the policy is checked again here (policy.py loaded by path, stdlib only)
  2. build123d / math are imported BEFORE an audit hook is installed; afterwards the hook refuses
     sockets, subprocesses, exec/fork, ctypes, file writes outside the job directory and any
     further compile/exec
  3. the source runs with a minimal builtins table and an __import__ that only returns
     build123d / math
The contract for the design source: assign the final solid to `result` (build123d Part/Solid/
Compound); optionally a JSON-serialisable dict `meta` (named points, parameters).
Output: <job>/part.step, <job>/part.stl, <job>/child.json.
"""
import builtins
import json
import os
import sys

JOB = os.path.realpath(sys.argv[1])
HERE = os.path.dirname(os.path.realpath(__file__))
OUT = os.path.join(JOB, "child.json")


def done(obj, code=0):
    with open(OUT, "w") as f:
        json.dump(obj, f)
    sys.stdout.flush()
    os._exit(code)


sys.path.insert(0, HERE)
import policy  # noqa: E402  (stdlib-only module next to this file)

sys.path.pop(0)
with open(os.path.join(JOB, "design.py"), encoding="utf-8") as f:
    SRC = f.read()
violations = policy.check_source(SRC)
if violations:
    done({"ok": False, "stage": "policy", "errors": violations}, 3)

import math  # noqa: E402

import build123d  # noqa: E402  (heavy native import before the hook)
from build123d import export_step, export_stl  # noqa: E402

_state = {"execs": 0}
_BLOCK = ("socket.", "subprocess.", "os.system", "os.exec", "os.posix_spawn", "os.spawn", "os.fork",
          "os.forkpty", "ctypes.", "pty.", "os.kill", "os.killpg", "os.putenv", "os.unsetenv",
          "os.chmod", "os.chown", "os.remove", "os.rename", "os.rmdir", "os.unlink", "os.symlink",
          "os.link", "os.truncate", "shutil.", "urllib.", "http.", "ftplib.", "smtplib.", "webbrowser.",
          "sys.setrecursionlimit", "object.__getattr__", "function.__new__",
          "code.__new__", "marshal.", "pickle.", "winreg.", "msvcrt.", "resource.setrlimit",
          "os.setuid", "os.setgid", "os.unshare", "os.setns", "mmap.")
_WRITE_FLAGS = os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_APPEND | os.O_TRUNC


def _inside_job(path):
    try:
        p = os.path.realpath(os.fsdecode(path))
    except Exception:
        return False
    return p == JOB or p.startswith(JOB + os.sep)


# reads: the interpreter and its libraries, the work dir, a few device/proc files; nothing else
# (no /etc, no /home, no other job directories)
_READ_OK = tuple(sorted({os.path.realpath(p) + os.sep for p in sys.path if p and os.path.isdir(p)} |
                        {os.path.realpath(sys.prefix) + os.sep, os.path.realpath(sys.base_prefix) + os.sep,
                         "/usr/lib/", "/usr/lib64/", "/usr/share/", "/usr/local/lib/", "/lib/", "/lib64/"}))
_READ_FILES = {"/dev/null", "/dev/urandom", "/proc/self/maps", "/proc/meminfo", "/proc/cpuinfo", "/sys/devices/system/cpu/online"}


def _readable(path):
    try:
        p = os.path.realpath(os.fsdecode(path))
    except Exception:
        return False
    return _inside_job(p) or p in _READ_FILES or (p + os.sep).startswith(_READ_OK) or p.startswith(_READ_OK)


def _hook(event, args):
    if event.startswith(_BLOCK):
        raise PermissionError(f"sandbox: {event} is not allowed")
    if event in ("compile", "exec"):
        # exactly one exec (the user's code object, compiled before the hook went in)
        if event == "exec" and _state["execs"] == 0:
            _state["execs"] = 1
            return
        if event == "compile" and _state["execs"] == 0:
            return
        raise PermissionError(f"sandbox: {event} is not allowed")
    if event == "open":
        path, mode, flags = (list(args) + [None, None, None])[:3]
        if isinstance(path, int):
            return
        writing = (isinstance(mode, str) and any(c in mode for c in "wax+")) or \
                  (isinstance(flags, int) and flags & _WRITE_FLAGS)
        if writing and not _inside_job(path):
            raise PermissionError("sandbox: writing outside the job directory")
        if not writing and not _readable(path):
            raise PermissionError("sandbox: reading outside the allowed paths")


ALLOWED = {"build123d", "math"}


def _import(name, globals=None, locals=None, fromlist=(), level=0):
    if level != 0 or name not in ALLOWED:
        raise ImportError(f"sandbox: import of {name!r} is not allowed")
    return builtins.__import__(name, globals, locals, fromlist, level)


SAFE = {k: getattr(builtins, k) for k in (
    "abs", "all", "any", "bool", "dict", "enumerate", "filter", "float", "int", "len", "list", "map",
    "max", "min", "range", "reversed", "round", "set", "frozenset", "sorted", "str", "sum", "tuple",
    "zip", "print", "isinstance", "pow", "divmod", "repr", "ValueError", "TypeError", "Exception",
    "RuntimeError", "ArithmeticError", "ZeroDivisionError", "KeyError", "IndexError", "AssertionError",
    "True", "False", "None")}
SAFE["__import__"] = _import

code = compile(SRC, "design.py", "exec")
sys.addaudithook(_hook)
g = {"__builtins__": SAFE, "__name__": "design"}
try:
    exec(code, g)
except MemoryError:
    done({"ok": False, "stage": "exec", "errors": ["MemoryError: memory limit reached"]}, 4)
except BaseException as e:  # noqa: BLE001  report any failure of the design code
    done({"ok": False, "stage": "exec", "errors": [f"{type(e).__name__}: {str(e)[:500]}"]}, 4)

result = g.get("result")
if not isinstance(result, (build123d.Part, build123d.Solid, build123d.Compound)):
    done({"ok": False, "stage": "exec", "errors": ["design must assign a build123d Part/Solid/Compound to `result`"]}, 5)
meta = g.get("meta", {})
try:
    meta_json = json.dumps(meta)
    if len(meta_json) > 32768 or not isinstance(meta, dict):
        raise ValueError("meta must be a dict, < 32 KB as JSON")
except (TypeError, ValueError) as e:
    done({"ok": False, "stage": "exec", "errors": [f"meta: {e}"]}, 5)

try:
    solids = result.solids()
    bb = result.bounding_box()
    info = {
        "ok": True, "stage": "export",
        "occ_volume_mm3": float(result.volume),
        "occ_area_mm2": float(result.area),
        "n_solids": len(solids),
        "occ_valid": bool(result.is_valid() if callable(result.is_valid) else result.is_valid),
        "occ_bbox_mm": [[bb.min.X, bb.min.Y, bb.min.Z], [bb.max.X, bb.max.Y, bb.max.Z]],
        "meta": json.loads(meta_json),
        "build123d": build123d.__version__ if hasattr(build123d, "__version__") else "?",
    }
    export_step(result, os.path.join(JOB, "part.step"))
    export_stl(result, os.path.join(JOB, "part.stl"), tolerance=0.01, angular_tolerance=0.1)
except BaseException as e:  # noqa: BLE001
    done({"ok": False, "stage": "export", "errors": [f"{type(e).__name__}: {str(e)[:500]}"]}, 6)
done(info, 0)
