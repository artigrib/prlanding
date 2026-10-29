#!/usr/bin/env python3
"""Convert SO-101 simulator demonstrations into a LeRobot v2.1 dataset (joints only, no videos).

Input: demo JSON files downloaded from the simulator (printedrobotics.cz/sim/so101, "Teach by
demonstration" -> download; format printedrobotics.cz/so101-sim-demo@1). One file = one episode.
Output: the same layout as the in-browser exporter (sim/so101/src/export/lerobot.js):

  OUT/meta/info.json, tasks.jsonl, episodes.jsonl, episodes_stats.jsonl, stats.json
  OUT/data/chunk-000/episode_000000.parquet ...
  OUT/README.md   (dataset card: license cc-by-4.0 by default, source: simulation)

Usage:
  pip install pyarrow
  python3 tools/hf/demos_to_lerobot.py demo1.json demo2.json -o so101-sim-demos \
      [--repo-id user/so101-sim-demos] [--task "Move the cube into the bowl"] [--license cc-by-4.0]

Then, e.g.:  huggingface-cli upload user/so101-sim-demos so101-sim-demos --repo-type dataset
Recent LeRobot releases (>= 0.4) read format v3.0; convert with their script
`python -m lerobot.datasets.v30.convert_dataset_v21_to_v30 --repo-id=user/so101-sim-demos`.
See docs/lerobot-export.md.
"""
import argparse
import json
import math
import os
import sys

import pyarrow as pa
import pyarrow.parquet as pq

FPS = 30
CODEBASE_VERSION = "v2.1"
ROBOT_TYPE = "so101_follower"
JOINTS = ["shoulder_pan", "shoulder_lift", "elbow_flex", "wrist_flex", "wrist_roll", "gripper"]
NAMES = [j + ".pos" for j in JOINTS]
CHUNK = 1000
MAX_FRAMES = 200 * FPS
DEMO_FORMAT = "printedrobotics.cz/so101-sim-demo@1"
MISSION_TASKS = {
    "bowl": "Move the cube into the bowl",
    "stack": "Build a tower",
    "sort": "Sort the colours",
    "ball": "Push the ball into the goal",
    "trace": "Trace the star",
}
HF_FEATURES = {
    "action": {"feature": {"dtype": "float32", "_type": "Value"}, "length": 6, "_type": "Sequence"},
    "observation.state": {"feature": {"dtype": "float32", "_type": "Value"}, "length": 6, "_type": "Sequence"},
    "timestamp": {"dtype": "float32", "_type": "Value"},
    "frame_index": {"dtype": "int64", "_type": "Value"},
    "episode_index": {"dtype": "int64", "_type": "Value"},
    "index": {"dtype": "int64", "_type": "Value"},
    "task_index": {"dtype": "int64", "_type": "Value"},
}


def f32(x):
    import struct
    return struct.unpack("f", struct.pack("f", x))[0]


def is_row(v):
    return isinstance(v, list) and len(v) == 6 and all(
        isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x) for x in v)


def parse_demo(j, task=None):
    if not isinstance(j, dict):
        raise ValueError("not a demo: expected an object")
    if j.get("format") and j["format"] != DEMO_FORMAT:
        raise ValueError("unknown demo format: %s" % j["format"])
    if j.get("fps") != FPS:
        raise ValueError("demo fps must be %d" % FPS)
    eps = j.get("episodes")
    if not isinstance(eps, list) or not eps or not isinstance(eps[0].get("frames"), list):
        raise ValueError("not a demo: no episodes[0].frames")
    frames = eps[0]["frames"]
    if len(frames) < 2 or len(frames) > MAX_FRAMES:
        raise ValueError("demo too short or too long")
    t, state, action, prev = [], [], [], -math.inf
    for f in frames:
        ts = f.get("timestamp")
        if not isinstance(ts, (int, float)) or not math.isfinite(ts) or ts < 0 or ts < prev:
            raise ValueError("bad timestamp")
        if not is_row(f.get("observation.state")) or not is_row(f.get("action")):
            raise ValueError("bad frame row")
        prev = ts
        t.append(float(ts)); state.append([float(x) for x in f["observation.state"]]); action.append([float(x) for x in f["action"]])
    mission = (j.get("printedrobotics") or {}).get("mission")
    name = task or MISSION_TASKS.get(mission) or (eps[0].get("task") or "").strip() or "SO-101 simulator demonstration"
    return {"task": name[:500], "t": t, "state": state, "action": action}


def resample(ep, fps=FPS):
    """Exact fps grid (LeRobot checks timestamps against frame_index / fps), linear interpolation."""
    T = ep["t"]; t0 = T[0]
    n = int(math.floor((T[-1] - t0) * fps + 1e-6)) + 1
    k, st, ac = 0, [], []
    for i in range(n):
        t = t0 + i / fps
        while k < len(T) - 2 and T[k + 1] <= t:
            k += 1
        k2 = min(len(T) - 1, k + 1); span = T[k2] - T[k]
        f = max(0.0, min(1.0, (t - T[k]) / span)) if span > 0 else 0.0
        st.append([a + (b - a) * f for a, b in zip(ep["state"][k], ep["state"][k2])])
        ac.append([a + (b - a) * f for a, b in zip(ep["action"][k], ep["action"][k2])])
    return {"task": ep["task"], "n": n, "state": st, "action": ac}


def stats(rows):
    n, d = len(rows), len(rows[0])
    mean = [sum(r[j] for r in rows) / n for j in range(d)]
    std = [math.sqrt(sum((r[j] - mean[j]) ** 2 for r in rows) / n) for j in range(d)]
    return {"min": [min(r[j] for r in rows) for j in range(d)], "max": [max(r[j] for r in rows) for j in range(d)],
            "mean": mean, "std": std, "count": [n]}


def merge_stats(lst):
    tot = sum(s["count"][0] for s in lst); d = len(lst[0]["mean"])
    mean = [sum(s["mean"][j] * s["count"][0] for s in lst) / tot for j in range(d)]
    var = [sum((s["std"][j] ** 2 + (s["mean"][j] - mean[j]) ** 2) * s["count"][0] for s in lst) / tot for j in range(d)]
    return {"min": [min(s["min"][j] for s in lst) for j in range(d)], "max": [max(s["max"][j] for s in lst) for j in range(d)],
            "mean": mean, "std": [math.sqrt(v) for v in var], "count": [tot]}


def features():
    vec = lambda: {"dtype": "float32", "shape": [6], "names": list(NAMES)}
    one = lambda dt: {"dtype": dt, "shape": [1], "names": None}
    return {"action": vec(), "observation.state": vec(), "timestamp": one("float32"), "frame_index": one("int64"),
            "episode_index": one("int64"), "index": one("int64"), "task_index": one("int64")}


SCHEMA = pa.schema([
    ("action", pa.list_(pa.float32())), ("observation.state", pa.list_(pa.float32())),
    ("timestamp", pa.float32()), ("frame_index", pa.int64()), ("episode_index", pa.int64()),
    ("index", pa.int64()), ("task_index", pa.int64()),
], metadata={"huggingface": json.dumps({"info": {"features": HF_FEATURES}})})


def card(repo_id, license_, n_ep, n_fr, tasks):
    names = ", ".join("`%s`" % n for n in NAMES)
    lic = "CC BY 4.0" if license_ == "cc-by-4.0" else license_
    return f"""---
license: {license_}
task_categories:
- robotics
tags:
- LeRobot
- so101
- simulation
- mujoco
- printedrobotics
source: simulation
configs:
- config_name: default
  data_files: data/*/*.parquet
---

# {repo_id or 'SO-101 simulator demonstrations'}

Teleoperated demonstrations of the **SO-101** robot arm recorded in the browser simulator at
[printedrobotics.cz/sim/so101](https://printedrobotics.cz/sim/so101/?lang=en)
(MuJoCo physics, robot model from MuJoCo Menagerie / The Robot Studio, Apache-2.0).

- **Source: simulation.** Not recorded on real hardware; no camera streams, joint positions only.
- Format: [LeRobot](https://github.com/huggingface/lerobot) dataset {CODEBASE_VERSION}, robot_type `{ROBOT_TYPE}`, {FPS} fps,
  {n_ep} episode(s), {n_fr} frames.
- `observation.state` and `action`: {names}.
  Joints in degrees (0 = the simulator's zero pose), gripper 0–100 % open.
  These follow LeRobot's SO-101 naming and degree mode, but the zero offsets of a calibrated real arm differ.
- Tasks: {", ".join('"%s"' % t for t in tasks)}.
- Licence: {lic}.

Made with the free SO-101 simulator by [printedrobotics.cz](https://printedrobotics.cz/?lang=en).
"""


def convert(demos, out, repo_id=None, task=None, license_="cc-by-4.0"):
    eps = [resample(parse_demo(j, task)) for j in demos]
    if not eps:
        raise ValueError("no demonstrations")
    tasks, task_idx, episodes, ep_stats, index = [], {}, [], [], 0
    for e, ep in enumerate(eps):
        if ep["task"] not in task_idx:
            task_idx[ep["task"]] = len(tasks); tasks.append(ep["task"])
        ti, n = task_idx[ep["task"]], ep["n"]
        ts = [f32(i / FPS) for i in range(n)]
        st = [[f32(x) for x in r] for r in ep["state"]]
        ac = [[f32(x) for x in r] for r in ep["action"]]
        fi = list(range(n)); gi = [index + i for i in fi]
        table = pa.table({"action": ac, "observation.state": st, "timestamp": ts, "frame_index": fi,
                          "episode_index": [e] * n, "index": gi, "task_index": [ti] * n}, schema=SCHEMA)
        p = os.path.join(out, "data", "chunk-%03d" % (e // CHUNK), "episode_%06d.parquet" % e)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        pq.write_table(table, p)
        episodes.append({"episode_index": e, "tasks": [ep["task"]], "length": n})
        col = lambda v: [[x] for x in v]
        ep_stats.append({"episode_index": e, "stats": {
            "action": stats(ac), "observation.state": stats(st), "timestamp": stats(col(ts)),
            "frame_index": stats(col(fi)), "episode_index": stats(col([e] * n)), "index": stats(col(gi)),
            "task_index": stats(col([ti] * n))}})
        index += n
    E = len(eps)
    info = {
        "codebase_version": CODEBASE_VERSION, "robot_type": ROBOT_TYPE,
        "total_episodes": E, "total_frames": index, "total_tasks": len(tasks), "total_videos": 0,
        "total_chunks": (E - 1) // CHUNK + 1, "chunks_size": CHUNK, "fps": FPS, "splits": {"train": "0:%d" % E},
        "data_path": "data/chunk-{episode_chunk:03d}/episode_{episode_index:06d}.parquet", "video_path": None,
        "features": features(), "source": "simulation", "license": license_,
    }
    agg = {k: merge_stats([s["stats"][k] for s in ep_stats]) for k in ep_stats[0]["stats"]}
    os.makedirs(os.path.join(out, "meta"), exist_ok=True)

    def wjson(name, obj):
        with open(os.path.join(out, "meta", name), "w", encoding="utf-8") as fh:
            json.dump(obj, fh, indent=4, ensure_ascii=False); fh.write("\n")

    def wjsonl(name, rows):
        with open(os.path.join(out, "meta", name), "w", encoding="utf-8") as fh:
            for r in rows:
                fh.write(json.dumps(r, ensure_ascii=False, separators=(",", ":")) + "\n")

    wjson("info.json", info)
    wjsonl("tasks.jsonl", [{"task_index": i, "task": t} for i, t in enumerate(tasks)])
    wjsonl("episodes.jsonl", episodes)
    wjsonl("episodes_stats.jsonl", ep_stats)
    wjson("stats.json", agg)
    with open(os.path.join(out, "README.md"), "w", encoding="utf-8") as fh:
        fh.write(card(repo_id, license_, E, index, tasks))
    return info


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("demos", nargs="+", help="demo JSON files from the simulator (one episode each)")
    ap.add_argument("-o", "--out", required=True, help="output folder (created; must be empty or missing)")
    ap.add_argument("--repo-id", help="name shown in the dataset card, e.g. user/so101-sim-demos")
    ap.add_argument("--task", help="task instruction for all episodes (default: from the mission)")
    ap.add_argument("--license", default="cc-by-4.0", help="dataset licence id (default cc-by-4.0)")
    a = ap.parse_args(argv)
    if os.path.isdir(a.out) and os.listdir(a.out):
        ap.error("output folder is not empty: %s" % a.out)
    demos = []
    for p in a.demos:
        with open(p, encoding="utf-8") as fh:
            demos.append(json.load(fh))
    info = convert(demos, a.out, a.repo_id, a.task, a.license)
    print("wrote %s: %d episode(s), %d frames" % (a.out, info["total_episodes"], info["total_frames"]))


if __name__ == "__main__":
    sys.exit(main())
