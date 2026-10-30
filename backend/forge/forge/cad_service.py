"""run_cad over a unix socket: the forge-cad container runs the server, the forge-worker the client.

Why: the worker needs network (OpenRouter only); the CAD sandbox must have none. Docker's default
seccomp profile blocks the unprivileged network namespace that sandbox.run_cad would create, so on the
VPS the CAD step runs in its own container with `network_mode: none` (FORGE_NETNS=external) and the
worker sends it source code over a unix socket on the shared /jobs volume.

    python3 -m forge.cad_service serve            # forge-cad container
    CadClient(socket_path).run(job_id, n, source) # forge-worker

Protocol: one JSON line per connection each way. Request {"job": <32 hex>, "iter": 1..99, "source": str}.
The server writes into <jobs>/<job>/cad/<iter>/ only and answers with run_cad's result dict.
"""
import json
import os
import re
import socket
import sys
import time

from .sandbox import run_cad

JOB_RE = re.compile(r"^[0-9a-f]{32}$")
MAX_REQ = 256 * 1024


def cad_dir(jobs_dir, job_id, n):
    return os.path.join(jobs_dir, job_id, "cad", f"{int(n):02d}")


def handle(req, jobs_dir):
    job, n, src = req.get("job"), req.get("iter"), req.get("source")
    if not (isinstance(job, str) and JOB_RE.match(job)):
        return {"ok": False, "stage": "request", "errors": ["bad job id"]}
    if not (isinstance(n, int) and 1 <= n <= 99) or not isinstance(src, str):
        return {"ok": False, "stage": "request", "errors": ["bad request"]}
    if not os.path.isdir(os.path.join(jobs_dir, job)):
        return {"ok": False, "stage": "request", "errors": ["unknown job"]}
    out = cad_dir(jobs_dir, job, n)
    os.makedirs(out, exist_ok=True)
    return run_cad(src, out)


def _recv_line(conn, limit):
    buf = b""
    while b"\n" not in buf:
        chunk = conn.recv(65536)
        if not chunk:
            break
        buf += chunk
        if len(buf) > limit:
            raise ValueError("request too large")
    return buf.split(b"\n", 1)[0]


def serve(sock_path, jobs_dir):
    os.makedirs(os.path.dirname(sock_path), mode=0o700, exist_ok=True)
    if os.path.exists(sock_path):
        os.remove(sock_path)
    srv = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    old = os.umask(0o177)
    srv.bind(sock_path)
    os.umask(old)
    srv.listen(4)
    print(json.dumps({"msg": "forge-cad listening"}), flush=True)
    while True:
        conn, _ = srv.accept()
        with conn:
            conn.settimeout(30)
            try:
                req = json.loads(_recv_line(conn, MAX_REQ))
                conn.settimeout(None)
                res = handle(req if isinstance(req, dict) else {}, jobs_dir)
            except Exception as e:  # noqa: BLE001
                res = {"ok": False, "stage": "request", "errors": [type(e).__name__]}
            try:
                conn.sendall(json.dumps(res).encode() + b"\n")
            except OSError:
                pass


class CadClient:
    def __init__(self, sock_path, timeout_s=150):
        self.sock_path, self.timeout_s = sock_path, timeout_s

    def run(self, job_id, n, source, jobs_dir=None):
        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        s.settimeout(self.timeout_s)
        try:
            s.connect(self.sock_path)
            s.sendall(json.dumps({"job": job_id, "iter": n, "source": source}).encode() + b"\n")
            line = _recv_line(s, 4 * 1024 * 1024)
            return json.loads(line)
        except (OSError, ValueError) as e:
            return {"ok": False, "stage": "service", "errors": [f"CAD service unavailable ({type(e).__name__})"], "report": None, "files": {}}
        finally:
            s.close()


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
    jobs = os.environ.get("FORGE_JOBS_DIR", "/jobs")
    sock = os.environ.get("FORGE_CAD_SOCKET", os.path.join(jobs, ".cad", "cad.sock"))
    while not os.path.isdir(jobs):
        time.sleep(2)
    serve(sock, jobs)


if __name__ == "__main__":
    main()
