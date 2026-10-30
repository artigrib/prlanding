"""run_cad over a unix socket: the forge-cad container runs the server, the forge-worker the client.

Why: the worker needs network (OpenRouter only); the CAD sandbox must have none, and it must not be able to
touch job data. On the VPS the CAD step runs in its own container:
  * `network_mode: none` (FORGE_NETNS=external: run_cad checks that only loopback is visible),
  * it mounts ONLY the socket directory (volume forge_cad_sock at /sock). It does not mount the job volume,
    so it cannot see other jobs, the queue, the spend ledger or anything of the api,
  * the server runs as root with only CAP_CHOWN/SETUID/SETGID (no DAC override) and every run's child drops
    to uid nobody (FORGE_CAD_REQUIRE_DROP=1); the child can write only its private temporary work dir.
The server sends results back over the socket (STEP/STL bytes, base64, size-capped, plus the geometry report
it computed). The worker validates them (file signatures, sizes, report types) and writes them under fixed
names into <jobs>/<job>/cad/<NN>/ itself.

    python3 -m forge.cad_service serve            # forge-cad container
    CadClient(socket_path).run(job_id, n, source, jobs_dir)   # forge-worker

Protocol: one JSON line per connection each way. Request {"source": str}.
"""
import base64
import json
import math
import os
import re
import shutil
import socket
import sys
import tempfile
import time

from .sandbox import run_cad

JOB_RE = re.compile(r"^[0-9a-f]{32}$")
MAX_REQ = 256 * 1024
MAX_FILE = 24 * 1024 * 1024
MAX_RESP = 2 * 1024 * 1024 + 2 * (MAX_FILE * 4 // 3 + 16)


def cad_dir(jobs_dir, job_id, n):
    return os.path.join(jobs_dir, job_id, "cad", f"{int(n):02d}")


def handle(req):
    """Server side: run one source in a fresh private directory; return the result with the files inline."""
    src = req.get("source")
    if not isinstance(src, str):
        return {"ok": False, "stage": "request", "errors": ["bad request"]}
    run = tempfile.mkdtemp(prefix="forge-run-")
    try:
        res = run_cad(src, run)
        files = {}
        if res.get("ok"):
            for name in ("part.step", "part.stl"):
                p = os.path.join(run, name)
                if not os.path.isfile(p) or os.path.islink(p) or os.path.getsize(p) > MAX_FILE:
                    return {"ok": False, "stage": "export", "errors": [f"{name} missing or larger than {MAX_FILE // 2**20} MB"]}
                with open(p, "rb") as f:
                    files[name] = base64.b64encode(f.read()).decode("ascii")
        out = {k: res.get(k) for k in ("ok", "stage", "errors", "report", "elapsed_s")}
        out["stdout"] = str(res.get("stdout") or "")[-4000:]
        out["files_b64"] = files
        return out
    finally:
        shutil.rmtree(run, ignore_errors=True)


def _recv_line(conn, limit):
    buf = b""
    while b"\n" not in buf:
        chunk = conn.recv(1 << 20)
        if not chunk:
            break
        buf += chunk
        if len(buf) > limit:
            raise ValueError("message too large")
    return buf.split(b"\n", 1)[0]


def serve(sock_path, sock_gid=None):
    d = os.path.dirname(sock_path)
    os.makedirs(d, exist_ok=True)
    if os.path.exists(sock_path):
        os.remove(sock_path)
    srv = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    old = os.umask(0o177)
    srv.bind(sock_path)
    os.umask(old)
    if sock_gid is not None:
        # the worker (another uid) connects through its group; the sandbox child (nobody) cannot
        os.chown(d, -1, sock_gid)
        os.chmod(d, 0o750)
        os.chown(sock_path, -1, sock_gid)
        os.chmod(sock_path, 0o660)
    srv.listen(4)
    print(json.dumps({"msg": "forge-cad listening"}), flush=True)
    while True:
        conn, _ = srv.accept()
        with conn:
            conn.settimeout(30)
            try:
                req = json.loads(_recv_line(conn, MAX_REQ))
                conn.settimeout(None)
                res = handle(req if isinstance(req, dict) else {})
            except Exception as e:  # noqa: BLE001
                res = {"ok": False, "stage": "request", "errors": [type(e).__name__]}
            try:
                conn.sendall(json.dumps(res).encode() + b"\n")
            except OSError:
                pass


# ---------------------------------------------------------------------------- worker side
def _stl_ok(b):
    if len(b) >= 84:
        n = int.from_bytes(b[80:84], "little")
        if len(b) == 84 + 50 * n and n > 0:
            return True
    return b[:5].lower() == b"solid" and b"endsolid" in b[-4096:]


def _num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def validate(res):
    """Worker-side checks of what came back from the CAD container. Returns (files dict, report) or raises ValueError."""
    files = res.get("files_b64")
    if not isinstance(files, dict) or set(files) != {"part.step", "part.stl"}:
        raise ValueError("unexpected file set")
    data = {}
    for name, b64 in files.items():
        if not isinstance(b64, str) or len(b64) > MAX_FILE * 4 // 3 + 16:
            raise ValueError(f"{name}: too large")
        data[name] = base64.b64decode(b64, validate=True)
    if not data["part.step"].lstrip()[:13] == b"ISO-10303-21;":
        raise ValueError("part.step is not a STEP file")
    if not _stl_ok(data["part.stl"]):
        raise ValueError("part.stl is not an STL file")
    rep = res.get("report")
    if not isinstance(rep, dict) or len(json.dumps(rep)) > 256 * 1024:
        raise ValueError("bad report")
    size = rep.get("size_mm")
    if not (isinstance(size, list) and len(size) == 3 and all(_num(v) and 0 <= v < 5000 for v in size)):
        raise ValueError("bad report: size_mm")
    for k in ("mass_print_g", "volume_mm3"):
        if k in rep and not _num(rep[k]):
            raise ValueError(f"bad report: {k}")
    if not isinstance(rep.get("meta", {}), dict):
        raise ValueError("bad report: meta")
    return data, rep


class CadClient:
    def __init__(self, sock_path, timeout_s=150):
        self.sock_path, self.timeout_s = sock_path, timeout_s

    def run(self, job_id, n, source, jobs_dir):
        if not JOB_RE.match(job_id):
            return {"ok": False, "stage": "request", "errors": ["bad job id"]}
        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        s.settimeout(self.timeout_s)
        try:
            s.connect(self.sock_path)
            s.sendall(json.dumps({"source": source}).encode() + b"\n")
            res = json.loads(_recv_line(s, MAX_RESP))
        except (OSError, ValueError) as e:
            return {"ok": False, "stage": "service", "errors": [f"CAD service unavailable ({type(e).__name__})"], "report": None, "files": {}}
        finally:
            s.close()
        if not isinstance(res, dict):
            return {"ok": False, "stage": "service", "errors": ["bad response"]}
        if not res.get("ok"):
            return {"ok": False, "stage": str(res.get("stage"))[:20], "errors": [str(e)[:600] for e in (res.get("errors") or [])][:8],
                    "stdout": str(res.get("stdout") or "")[-1500:]}
        try:
            data, rep = validate(res)
        except (ValueError, TypeError) as e:
            return {"ok": False, "stage": "validate", "errors": [f"result rejected by the worker: {e}"]}
        d = cad_dir(jobs_dir, job_id, n)
        os.makedirs(d, exist_ok=True)
        for name, b in data.items():
            with open(os.path.join(d, name), "wb") as f:
                f.write(b)
        with open(os.path.join(d, "design.py"), "w", encoding="utf-8") as f:
            f.write(source)
        with open(os.path.join(d, "report.json"), "w") as f:
            json.dump(rep, f, indent=1)
        return {"ok": True, "stage": "done", "errors": [], "report": rep, "stdout": str(res.get("stdout") or "")[-1500:],
                "files": {"step": os.path.join(d, "part.step"), "stl": os.path.join(d, "part.stl")}}


class LocalCad:
    """In-process sandbox (development, tests): needs a host that allows network namespaces."""

    def __init__(self, jobs_dir):
        self.jobs_dir = jobs_dir

    def run(self, job_id, n, source, jobs_dir=None):
        out = cad_dir(jobs_dir or self.jobs_dir, job_id, n)
        os.makedirs(out, exist_ok=True)
        return run_cad(source, out)


def main():
    if len(sys.argv) < 2 or sys.argv[1] != "serve":
        print("usage: python3 -m forge.cad_service serve", file=sys.stderr)
        sys.exit(2)
    sock = os.environ.get("FORGE_CAD_SOCKET", "/sock/cad.sock")
    gid = os.environ.get("FORGE_CAD_SOCK_GID")
    serve(sock, int(gid) if gid and gid.isdigit() else None)


if __name__ == "__main__":
    main()
