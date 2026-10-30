"""Forge eval runner (Python side). Started by backend/forge/eval/run.mjs, normally inside the forge-worker
container on the VPS. Runs each task through the real agent loop (OpenRouter, run_cad over the CAD socket,
MuJoCo checks), grades it and prints fixed status lines plus one JSON report line (prefix "REPORT ").

    python3 -m eval.runner --model <openrouter id> [--light <id>] [--tasks a,b] --yes

Guards: refuses without --yes, refuses when CI is set, needs OPENROUTER_API_KEY (from the container env; never
printed). Spend goes into the same daily ledger as user jobs, so FORGE_DAILY_USD caps the eval too; the
runner stops before a task when the day's spend has reached the cap. Prompts and keys are never printed.
"""
import argparse
import json
import os
import secrets
import sys
import time

from forge.agent import Agent
from forge.budget import Ledger
from forge.cad_service import CadClient, LocalCad
from forge.llm import OpenRouterClient
from forge.worker import config

from .graders import grade

HERE = os.path.dirname(os.path.abspath(__file__))


def load_tasks(path=None):
    with open(path or os.path.join(HERE, "tasks.json"), encoding="utf-8") as f:
        return json.load(f)["tasks"]


def run_task(task, cfg, llm, cad, jobs_dir):
    jid = secrets.token_hex(16)
    d = os.path.join(jobs_dir, jid)
    os.makedirs(d)
    open(os.path.join(d, "eval"), "w").close()  # marker: not a user job (the api never indexes it: no meta.json)
    with open(os.path.join(d, "request.json"), "w", encoding="utf-8") as f:
        json.dump({"id": jid, "request": task["request"], "lang": task.get("lang", "en")}, f)
    t0 = time.monotonic()
    status = Agent(cfg, llm, cad, Ledger(jobs_dir)).run(jid, d)
    state = json.load(open(os.path.join(d, "state.json"), encoding="utf-8"))
    g = grade(task, os.path.join(d, "out"), status)
    return {"task": task["id"], "job": jid[:8], "status": status, "pass": g["pass"], "checks": g["checks"],
            "cad_calls": state.get("cad_calls"), "llm_calls": state.get("llm_calls"), "tokens": state.get("tokens"),
            "cost_usd": state.get("cost_usd"), "elapsed_s": round(time.monotonic() - t0, 1)}


def summarize(model, rows):
    n = len(rows)
    return {"model": model, "tasks": n, "passed": sum(r["pass"] for r in rows),
            "pass_rate": round(sum(r["pass"] for r in rows) / n, 3) if n else 0.0,
            "cad_calls_avg": round(sum(r["cad_calls"] or 0 for r in rows) / n, 2) if n else 0.0,
            "tokens": sum(r["tokens"] or 0 for r in rows), "cost_usd": round(sum(r["cost_usd"] or 0 for r in rows), 4), "results": rows}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--light")
    ap.add_argument("--tasks")
    ap.add_argument("--yes", action="store_true")
    a = ap.parse_args(argv)
    if os.environ.get("CI"):
        print("eval: refused (CI)")
        return 2
    if not a.yes:
        print("eval: refused (pass --yes: this spends real money)")
        return 2
    if not os.environ.get("OPENROUTER_API_KEY", "").strip():
        print("eval: refused (no key)")
        return 2
    env = dict(os.environ, FORGE_MODEL=a.model, **({"FORGE_MODEL_LIGHT": a.light} if a.light else {}))
    cfg = config(env)
    jobs = cfg["jobs_dir"]
    llm = OpenRouterClient.from_env(cfg["prices"])
    cad = CadClient(cfg["cad_socket"]) if cfg["cad_socket"] else LocalCad(jobs)
    tasks = load_tasks()
    if a.tasks:
        want = set(a.tasks.split(","))
        tasks = [t for t in tasks if t["id"] in want]
    ledger = Ledger(jobs)
    rows = []
    for t in tasks:
        if ledger.read()["usd"] >= cfg["daily_usd"]:
            print("eval: stopped (daily budget cap reached)")
            break
        r = run_task(t, cfg, llm, cad, jobs)
        rows.append(r)
        print(f"eval: task {t['id']} {'pass' if r['pass'] else 'fail'} ({r['status']})", flush=True)
    rep = summarize(cfg["model"], rows)
    os.makedirs(os.path.join(jobs, "eval-reports"), exist_ok=True)
    with open(os.path.join(jobs, "eval-reports", time.strftime("%Y%m%dT%H%M%SZ", time.gmtime()) + ".json"), "w") as f:
        json.dump(rep, f, indent=1)
    print("REPORT " + json.dumps(rep), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
