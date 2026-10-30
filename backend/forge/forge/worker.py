"""forge-worker: takes queued jobs from the shared /jobs volume and runs the agent, one job at a time.

    python3 -m forge.worker            # in the forge-worker container

Configuration (environment only; nothing here can be changed by a job or a model):
    OPENROUTER_API_KEY     required; without it the worker idles (the deploy does not start it at all)
    FORGE_MODEL            main CAD model (default anthropic/claude-opus-5.5, the owner's pick per CADGenBench)
    FORGE_MODEL_LIGHT      parsing / guide text (default anthropic/claude-haiku-4.5)
    FORGE_DAILY_USD (5)    FORGE_JOB_USD (1.5)   FORGE_JOB_TOKENS (600000)   FORGE_MAX_TURNS (24)
    FORGE_MAX_CAD (12)     FORGE_JOB_TIMEOUT_S (900)   FORGE_MAX_OUT_TOKENS (8000)
    FORGE_PRICE_IN/OUT (15/75 USD per M tokens; used only when OpenRouter returns no cost, and for the
    pre-call reserve)   FORGE_PRICE_LIGHT_IN/OUT (1/5)
    FORGE_SWEEP (quick|full)   FORGE_RENDER (0|1)   FORGE_CAD_SOCKET (unset = in-process sandbox)
    FORGE_JOBS_DIR (/jobs)     FORGE_RETENTION_DAYS (14)
Logs: fixed lines only (job id prefix, status); never request text, never keys.
"""
import glob
import ipaddress
import json
import os
import re
import shutil
import socket
import sys
import threading
import time

from .agent import Agent
from .budget import Ledger
from .cad_service import CadClient, LocalCad
from .llm import OpenRouterClient

ID_RE = re.compile(r"^[0-9a-f]{32}$")


def _f(env, k, d):
    try:
        return float(env.get(k, d))
    except ValueError:
        return float(d)


def config(env=None):
    env = os.environ if env is None else env
    model = env.get("FORGE_MODEL") or "anthropic/claude-opus-5.5"
    light = env.get("FORGE_MODEL_LIGHT") or "anthropic/claude-haiku-4.5"
    main_p = (_f(env, "FORGE_PRICE_IN", 15), _f(env, "FORGE_PRICE_OUT", 75))
    light_p = (_f(env, "FORGE_PRICE_LIGHT_IN", 1), _f(env, "FORGE_PRICE_LIGHT_OUT", 5))
    return {
        "jobs_dir": env.get("FORGE_JOBS_DIR", "/jobs"),
        "model": model, "model_light": light,
        "prices": {model: main_p, light: light_p} if model != light else {model: main_p},
        "default_price": main_p,
        "daily_usd": _f(env, "FORGE_DAILY_USD", 5), "job_usd": _f(env, "FORGE_JOB_USD", 1.5),
        "job_tokens": int(_f(env, "FORGE_JOB_TOKENS", 600000)), "max_turns": int(_f(env, "FORGE_MAX_TURNS", 24)),
        "max_cad_calls": int(_f(env, "FORGE_MAX_CAD", 12)), "max_llm_calls": int(_f(env, "FORGE_MAX_TURNS", 24)) + 4,
        "max_calls_per_turn": 4, "job_timeout_s": _f(env, "FORGE_JOB_TIMEOUT_S", 900),
        "max_out_tokens": int(_f(env, "FORGE_MAX_OUT_TOKENS", 8000)),
        "sweep": env.get("FORGE_SWEEP", "quick"), "render": env.get("FORGE_RENDER") == "1",
        "cad_socket": env.get("FORGE_CAD_SOCKET") or None,
        "retention_days": _f(env, "FORGE_RETENTION_DAYS", 14),
    }


def log(**kw):
    print(json.dumps(kw), flush=True)


def claim(jobs_dir):
    """Oldest queued job -> moved atomically to <jobs>/<id>/request.json. Returns the id or None."""
    q = sorted(glob.glob(os.path.join(jobs_dir, "queue", "*.json")), key=lambda p: (os.path.getmtime(p), p))
    for p in q:
        jid = os.path.basename(p)[:-5]
        if not ID_RE.match(jid) or not os.path.isdir(os.path.join(jobs_dir, jid)):
            continue
        try:
            os.rename(p, os.path.join(jobs_dir, jid, "request.json"))
        except OSError:
            continue
        return jid
    return None


def cleanup(jobs_dir, days):
    cut = time.time() - days * 86400
    for d in glob.glob(os.path.join(jobs_dir, "*")):
        name = os.path.basename(d)
        if ID_RE.match(name) and os.path.isdir(d) and os.path.getmtime(d) < cut:
            shutil.rmtree(d, ignore_errors=True)
    for p in glob.glob(os.path.join(jobs_dir, "spend", "*.json")):
        if os.path.getmtime(p) < time.time() - 400 * 86400:
            os.remove(p)


def egress_guard(cad_socket, host="openrouter.ai", port=443):
    """Process-wide network fence for the worker (audit hook, also covers any library in this process):
    DNS lookups only for `host`, TCP connects only to addresses that lookup returned (port 443), unix
    sockets only to the CAD socket. Code-level, not network-level: see README "Worker egress"."""
    allowed_ips = set()
    real_getaddrinfo = socket.getaddrinfo

    def hook(event, args):
        if event == "socket.getaddrinfo":
            h, p = args[0], args[1]
            if isinstance(h, bytes):
                h = h.decode("ascii", "replace")
            if h != host or p not in (port, str(port), "https"):
                raise PermissionError("egress: lookup not allowed")
        elif event == "socket.connect":
            sock, addr = args
            if sock.family == socket.AF_UNIX:
                if addr != cad_socket:
                    raise PermissionError("egress: unix socket not allowed")
                return
            ip, p = addr[0], addr[1]
            if p != port or ip not in allowed_ips:
                raise PermissionError("egress: destination not allowed")
        elif event in ("socket.bind", "socket.sendto", "socket.sendmsg") and args and getattr(args[0], "family", None) != socket.AF_UNIX:
            raise PermissionError("egress: not allowed")

    def resolving_getaddrinfo(h, p, *a, **k):
        res = real_getaddrinfo(h, p, *a, **k)
        for r in res:
            try:
                allowed_ips.add(str(ipaddress.ip_address(r[4][0])))
            except ValueError:
                pass
        return res

    socket.getaddrinfo = resolving_getaddrinfo
    sys.addaudithook(hook)


def heartbeat(jobs_dir, every_s=20):
    """Liveness for the api (it refuses new jobs when the file is older than 2 minutes), also during a job."""
    def loop():
        while True:
            try:
                tmp = os.path.join(jobs_dir, ".worker.heartbeat.tmp")
                with open(tmp, "w") as f:
                    f.write(str(int(time.time())))
                os.replace(tmp, os.path.join(jobs_dir, "worker.heartbeat"))
            except OSError:
                pass
            time.sleep(every_s)
    threading.Thread(target=loop, daemon=True).start()


def run_one(cfg, llm, cad, jid):
    agent = Agent(cfg, llm, cad, Ledger(cfg["jobs_dir"]))
    return agent.run(jid, os.path.join(cfg["jobs_dir"], jid))


def main():
    os.umask(0o007)  # files shared with the api through the group (api uid 1000, worker uid 1002, gid 1000)
    cfg = config()
    jobs = cfg["jobs_dir"]
    if not os.environ.get("OPENROUTER_API_KEY", "").strip():
        log(msg="forge-worker: no OpenRouter key configured, idle")
        while True:
            time.sleep(3600)
    llm = OpenRouterClient.from_env(cfg["prices"])  # removes the key from os.environ
    cad = CadClient(cfg["cad_socket"]) if cfg["cad_socket"] else LocalCad(jobs)
    os.makedirs(os.path.join(jobs, "queue"), exist_ok=True)
    if os.environ.get("FORGE_EGRESS_GUARD", "1") == "1":
        egress_guard(cfg["cad_socket"])
    heartbeat(jobs)
    log(msg="forge-worker ready", model=cfg["model"], cad="socket" if cfg["cad_socket"] else "local", sweep=cfg["sweep"])
    last_clean = 0.0
    while True:
        try:
            if time.time() - last_clean > 3600:
                cleanup(jobs, cfg["retention_days"])
                last_clean = time.time()
            jid = claim(jobs)
            if jid:
                log(msg="job start", job=jid[:8])
                status = run_one(cfg, llm, cad, jid)
                log(msg="job end", job=jid[:8], status=status)
                continue
        except Exception as e:  # noqa: BLE001  the loop never dies on one bad job
            log(msg="worker error", error=type(e).__name__)
        time.sleep(2)


if __name__ == "__main__":
    sys.exit(main())
