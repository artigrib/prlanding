#!/usr/bin/env python3
"""Convert SO-101 simulator demonstrations into a LeRobot v2.1 dataset (joints only, no videos).

Input: demo JSON files downloaded from the simulator (printedrobotics.cz/sim/so101, "Teach by
demonstration" -> download; format printedrobotics.cz/so101-sim-demo@1). One file = one episode, or, for a
conveyor mission whose demo carries per-item segments, one episode per item (--whole keeps one per file).
Demos with environment frames (frames[].env, conveyor missions) also get observation.environment_state
(18 float32, see ENV_NAMES).
SIL replays (tools/sil/replay.mjs: replay-NNN.json next to images/NNN/<camera>/frame_KKKKKK.png) also get one
observation.images.<camera> feature per rendered camera (dtype image: the PNG bytes inside the Parquet). Items whose
outcome changed in the replay are left out unless --keep-diverged; --no-images exports without the images.
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
`python -m lerobot.scripts.convert_dataset_v21_to_v30 --repo-id=user/so101-sim-demos` (the module path in
LeRobot 0.6.1).
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
    "waste_hand": "Sort the waste into bins by material",
    "waste_teach": "Sort the waste into bins by material",
    "waste_line": "Sort the waste into bins by material",
}
IMAGE_PREFIX = "observation.images."
CAM_RE = __import__("re").compile(r"^[A-Za-z0-9_.-]+$")
# observation.environment_state (sim/so101/src/policy/episodes.js ENV_NAMES): target item, then next item
ENV_KEY = "observation.environment_state"
ENV_CLASSES = ["paper", "plastic", "glass", "metal"]
ENV_NAMES = [k + "." + n for k in ("target", "next") for n in ["x", "y", "z", "yaw_sin", "yaw_cos"] + ENV_CLASSES]
ENV_DIM = len(ENV_NAMES)
OUTCOMES = ["sorted", "wrong", "dropped", "missed"]
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


def _num(x, lo, hi):
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x) and lo <= x <= hi


def env_vector(e):
    """One frames[].env object -> 18 floats (an absent item is all zeros). Raises ValueError when malformed."""
    if not isinstance(e, dict) or not _num(e.get("belt"), -0.2, 0.2) or "target" not in e or "next" not in e:
        raise ValueError("bad env frames")
    out = [0.0] * ENV_DIM
    for k, s in enumerate((e["target"], e["next"])):
        if s is None:
            continue
        p = s.get("pos") if isinstance(s, dict) else None
        if (not isinstance(s.get("item"), str) or s.get("class") not in ENV_CLASSES or not isinstance(p, list)
                or len(p) != 3 or not all(_num(x, -2, 2) for x in p) or not _num(s.get("yaw"), -10, 10)):
            raise ValueError("bad env frames")
        o = 9 * k
        out[o:o + 5] = [float(p[0]), float(p[1]), float(p[2]), math.sin(s["yaw"]), math.cos(s["yaw"])]
        out[o + 5 + ENV_CLASSES.index(s["class"])] = 1.0
    return out


def parse_segments(segs, n):
    if not isinstance(segs, list):
        raise ValueError("bad segments")
    out = []
    for s in segs:
        if (not isinstance(s, dict) or s.get("class") not in ENV_CLASSES or s.get("outcome") not in OUTCOMES
                or not isinstance(s.get("from"), int) or not isinstance(s.get("to"), int)
                or s["from"] < 0 or s["to"] > n - 1 or s["to"] - s["from"] + 1 < 5):
            raise ValueError("bad segments")
        out.append({"item": s.get("item"), "class": s["class"], "outcome": s["outcome"], "bin": s.get("bin"),
                    "from": s["from"], "to": s["to"]})
    return out


OLD_ACTION_LAG = 1 / 60   # sim/so101/src/policy/episodes.js OLD_ACTION_LAG


def action_lag(recorder):
    """Seconds to add to read the command in force from a time on (0 for recorder 3, one 60 Hz frame for 1, 2, absent)."""
    ok = isinstance(recorder, (int, float)) and not isinstance(recorder, bool) and math.isfinite(recorder) and recorder == int(recorder)
    return 0.0 if ok and recorder >= 3 else OLD_ACTION_LAG


def align_actions(T, A, lag):
    """Row i = A linearly interpolated at T[i] + lag (episodes.js alignActions: the same arithmetic)."""
    if not lag:
        return [list(r) for r in A]
    n, k, out = len(T), 0, []
    for i in range(n):
        t = T[i] + lag
        while k < n - 2 and T[k + 1] <= t:
            k += 1
        k2 = min(n - 1, k + 1); span = T[k2] - T[k]
        f = max(0.0, min(1.0, (t - T[k]) / span)) if span > 0 else 0.0
        out.append([a + (b - a) * f for a, b in zip(A[k], A[k2])])
    return out


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
    t, state, action, env_raw, prev = [], [], [], [], -math.inf
    for f in frames:
        ts = f.get("timestamp")
        if not isinstance(ts, (int, float)) or not math.isfinite(ts) or ts < 0 or ts < prev:
            raise ValueError("bad timestamp")
        if not is_row(f.get("observation.state")) or not is_row(f.get("action")):
            raise ValueError("bad frame row")
        prev = ts
        t.append(float(ts)); state.append([float(x) for x in f["observation.state"]]); action.append([float(x) for x in f["action"]])
        env_raw.append(f.get("env", None) if "env" in f else ...)
    pr = j.get("printedrobotics") or {}
    mission = pr.get("mission")
    # LeRobot's order: action at t = the command applied from t on. Recorder 3 stores that; recorders 1 and 2 stored the
    # command of the frame that ended at t, read here one frame later (sim/so101/src/policy/episodes.js actionLag)
    action = align_actions(t, action, action_lag(pr.get("recorder")))
    name = task or MISSION_TASKS.get(mission) or (eps[0].get("task") or "").strip() or "SO-101 simulator demonstration"
    env = segments = None
    if any(e is not ... for e in env_raw):   # env on every frame or on none
        if any(e is ... for e in env_raw):
            raise ValueError("bad env frames")
        env = [env_vector(e) for e in env_raw]
        if pr.get("segments") is not None:
            segments = parse_segments(pr["segments"], len(frames))
    elif pr.get("segments") is not None:
        raise ValueError("segments without env frames")
    images = None
    rp = pr.get("replay") if isinstance(pr.get("replay"), dict) else None
    if rp and isinstance(rp.get("cameras"), list) and rp["cameras"]:
        names = [c.get("name") if isinstance(c, dict) else None for c in rp["cameras"]]
        sums = (rp.get("images") or {}).get("sums")
        w, h = rp.get("width"), rp.get("height")
        ok = (all(isinstance(c, str) and CAM_RE.match(c) for c in names) and len(set(names)) == len(names)
              and isinstance(w, int) and isinstance(h, int) and 16 <= w <= 1920 and 16 <= h <= 1080 and isinstance(sums, dict)
              and all(isinstance(sums.get(c), list) and len(sums[c]) == len(frames)
                      and all(isinstance(r, list) and len(r) == 13 and all(_num(x, -1e300, 1e300) for x in r) for r in sums[c]) for c in names))
        if not ok:
            raise ValueError("bad replay cameras")
        images = {"names": names, "width": w, "height": h, "sums": sums, "dir": (rp.get("images") or {}).get("dir"),
                  "items": rp.get("items") if isinstance(rp.get("items"), list) else []}
    return {"task": name[:500], "t": t, "state": state, "action": action, "env": env, "segments": segments, "item": None,
            "images": images, "fidx": list(range(len(t)))}


def split_demo(ep, per_item=True, keep_diverged=False):
    """One episode per item segment (when the demo has them), else the whole demo. SIL replay: an item that ended
    differently than in the recording is left out (keep_diverged keeps it, labelled with the replay's outcome)."""
    if not per_item or not ep["segments"]:
        return [ep]
    im = ep.get("images")
    diverged = set() if not im or keep_diverged else {
        x.get("item") for x in im["items"] if isinstance(x, dict) and x.get("recorded") != x.get("replay")}
    out = []
    for s in ep["segments"]:
        if s["item"] in diverged:
            continue
        sl = slice(s["from"], s["to"] + 1)
        out.append({"task": ep["task"], "t": ep["t"][sl], "state": ep["state"][sl], "action": ep["action"][sl],
                    "env": ep["env"][sl] if ep["env"] is not None else None, "segments": None, "images": im, "fidx": ep["fidx"][sl], "demo": ep.get("demo"),
                    "item": {"item": s["item"], "class": s["class"], "outcome": s["outcome"], "bin": s["bin"]}})
    return out


def resample(ep, fps=FPS):
    """Exact fps grid (LeRobot checks timestamps against frame_index / fps), linear interpolation."""
    T = ep["t"]; t0 = T[0]
    n = int(math.floor((T[-1] - t0) * fps + 1e-6)) + 1
    k, st, ac, en, fx = 0, [], [], ([] if ep.get("env") else None), []
    for i in range(n):
        t = t0 + i / fps
        while k < len(T) - 2 and T[k + 1] <= t:
            k += 1
        k2 = min(len(T) - 1, k + 1); span = T[k2] - T[k]
        f = max(0.0, min(1.0, (t - T[k]) / span)) if span > 0 else 0.0
        st.append([a + (b - a) * f for a, b in zip(ep["state"][k], ep["state"][k2])])
        ac.append([a + (b - a) * f for a, b in zip(ep["action"][k], ep["action"][k2])])
        if en is not None:   # nearest recorded frame: a one-hot or a change of target is not blended
            en.append(list(ep["env"][k if f < 0.5 else k2]))
        fx.append(ep["fidx"][k if f < 0.5 else k2] if ep.get("fidx") else (k if f < 0.5 else k2))   # nearest camera frame
    return {"task": ep["task"], "n": n, "state": st, "action": ac, "env": en, "item": ep.get("item"),
            "images": ep.get("images"), "fidx": fx, "demo": ep.get("demo")}


def stats(rows):
    n, d = len(rows), len(rows[0])
    mean = [sum(r[j] for r in rows) / n for j in range(d)]
    std = [math.sqrt(sum((r[j] - mean[j]) ** 2 for r in rows) / n) for j in range(d)]
    return {"min": [min(r[j] for r in rows) for j in range(d)], "max": [max(r[j] for r in rows) for j in range(d)],
            "mean": mean, "std": std, "count": [n]}


def image_stats(rows):
    """Per-channel stats in 0-1 from per-frame sums [min rgb, max rgb, sum rgb, sum^2 rgb, pixels] (replay.mjs imageSums)."""
    mn, mx, s, q, px = [255.0] * 3, [0.0] * 3, [0.0] * 3, [0.0] * 3, 0
    for r in rows:
        for c in range(3):
            mn[c] = min(mn[c], r[c]); mx[c] = max(mx[c], r[3 + c]); s[c] += r[6 + c]; q[c] += r[9 + c]
        px += r[12]
    mean = [v / px for v in s]
    std = [math.sqrt(max(0.0, q[c] / px - mean[c] * mean[c])) for c in range(3)]
    return {"min": [v / 255 for v in mn], "max": [v / 255 for v in mx], "mean": [v / 255 for v in mean],
            "std": [v / 255 for v in std], "count": [len(rows)]}


def nest3(st):
    return {k: ([[[float(x)]] for x in v] if k != "count" else v) for k, v in st.items()}


def merge_stats(lst):
    tot = sum(s["count"][0] for s in lst); d = len(lst[0]["mean"])
    mean = [sum(s["mean"][j] * s["count"][0] for s in lst) / tot for j in range(d)]
    var = [sum((s["std"][j] ** 2 + (s["mean"][j] - mean[j]) ** 2) * s["count"][0] for s in lst) / tot for j in range(d)]
    return {"min": [min(s["min"][j] for s in lst) for j in range(d)], "max": [max(s["max"][j] for s in lst) for j in range(d)],
            "mean": mean, "std": [math.sqrt(v) for v in var], "count": [tot]}


def features(env=False, images=None):
    vec = lambda: {"dtype": "float32", "shape": [6], "names": list(NAMES)}
    one = lambda dt: {"dtype": dt, "shape": [1], "names": None}
    out = {"action": vec(), "observation.state": vec()}
    if env:
        out[ENV_KEY] = {"dtype": "float32", "shape": [ENV_DIM], "names": list(ENV_NAMES)}
    for c in (images or {}).get("names", []):
        out[IMAGE_PREFIX + c] = {"dtype": "image", "shape": [images["height"], images["width"], 3], "names": ["height", "width", "channels"]}
    out.update({"timestamp": one("float32"), "frame_index": one("int64"),
                "episode_index": one("int64"), "index": one("int64"), "task_index": one("int64")})
    return out


def schema(env=False, cams=()):
    hf = dict(HF_FEATURES)
    cols = [("action", pa.list_(pa.float32())), ("observation.state", pa.list_(pa.float32()))]
    head = {"action": HF_FEATURES["action"], "observation.state": HF_FEATURES["observation.state"]}
    if env:
        cols.append((ENV_KEY, pa.list_(pa.float32())))
        head[ENV_KEY] = {"feature": {"dtype": "float32", "_type": "Value"}, "length": ENV_DIM, "_type": "Sequence"}
    for c in cams:   # HF datasets' Image: struct<bytes: binary, path: string>
        cols.append((IMAGE_PREFIX + c, pa.struct([("bytes", pa.binary()), ("path", pa.string())])))
        head[IMAGE_PREFIX + c] = {"_type": "Image"}
    hf = {**head, **{k: v for k, v in HF_FEATURES.items() if k not in ("action", "observation.state")}}
    cols += [("timestamp", pa.float32()), ("frame_index", pa.int64()), ("episode_index", pa.int64()),
             ("index", pa.int64()), ("task_index", pa.int64())]
    return pa.schema(cols, metadata={"huggingface": json.dumps({"info": {"features": hf}})})


def card(repo_id, license_, n_ep, n_fr, tasks, env=False, items=(), images=None):
    names = ", ".join("`%s`" % n for n in NAMES)
    lic = "CC BY 4.0" if license_ == "cc-by-4.0" else license_
    env_line = item_line = cam_line = ""
    if images:
        cam_line = ("\n- " + ", ".join("`%s%s`" % (IMAGE_PREFIX, c) for c in images["names"])
                    + " (%d×%d RGB, PNG): virtual cameras rendered by\n" % (images["width"], images["height"])
                    + "  the SIL runner's software rasteriser while it replayed the recorded actions (tools/sil/replay.mjs). Flat-shaded\n"
                    "  geometry, items as collision hulls in one colour per material, no textures, shadows or noise: not photographs.\n"
                    "  `observation.state` and the item state are the replay's, so they match the images; `action` is the recording's.")
    if env:
        env_line = (f"\n- `{ENV_KEY}` ({ENV_DIM} float32, simulator ground truth, no camera): the target item (in the jaws, else the most\n"
                    "  downstream item on the belt) and the next item on the belt, each `x, y, z` (centre of mass, m, world frame),\n"
                    f"  `yaw_sin, yaw_cos` and a class one-hot ({', '.join(ENV_CLASSES)}); an absent item is all zeros.\n"
                    "  A real `so101_follower` has no such sensor: a policy trained on it runs only in the simulator.")
    counts = {}
    for it in items:
        if it:
            counts[it["outcome"]] = counts.get(it["outcome"], 0) + 1
    if counts:
        item_line = ("\n- One episode per waste item, cut at the mission's events (approach → 0.5 s after the release, or the miss):\n  "
                     + ", ".join("%d %s" % (v, k) for k, v in counts.items()) + ".")
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

- **Source: simulation.** Not recorded on real hardware; {"rendered camera images, joint positions" if images else "no camera streams, joint positions only"}{" plus the simulator's item state" if env else ""}.
- Format: [LeRobot](https://github.com/huggingface/lerobot) dataset {CODEBASE_VERSION}, robot_type `{ROBOT_TYPE}`, {FPS} fps,
  {n_ep} episode(s), {n_fr} frames.
- `observation.state` and `action`: {names}.
  Joints in degrees (0 = the simulator's zero pose), gripper 0–100 % open.
  These follow LeRobot's SO-101 naming and degree mode, but the zero offsets of a calibrated real arm differ.
  `action` at a frame is the position target applied from that frame's time to the next frame (LeRobot's order: state first, then the command).
- Tasks: {", ".join('"%s"' % t for t in tasks)}.{env_line}{cam_line}{item_line}
- Licence: {lic}.

Made with the free SO-101 simulator by [printedrobotics.cz](https://printedrobotics.cz/?lang=en).
"""


def convert(demos, out, repo_id=None, task=None, license_="cc-by-4.0", per_item=True, image_roots=None,
            keep_diverged=False, images=True, env_state=True):
    """image_roots[i]: folder that demos[i]'s printedrobotics.replay.images.dir is relative to (SIL replays).
    env_state=False leaves observation.environment_state out (cameras + joints only: also runs on a real arm)."""
    eps = []
    for di, j in enumerate(demos):
        ep = parse_demo(j, task); ep["demo"] = di
        if not env_state:
            ep["env"] = None
        eps += [resample(x) for x in split_demo(ep, per_item, keep_diverged)]
    if not eps:
        raise ValueError("no demonstrations")
    env = eps[0]["env"] is not None
    if any((ep["env"] is not None) != env for ep in eps):
        raise ValueError("mixed demos: only some have environment state (conveyor missions); export them separately")
    key = lambda im: "%s@%dx%d" % (",".join(im["names"]), im["width"], im["height"]) if im else ""
    im = eps[0]["images"] if images else None
    if images and any(key(ep["images"]) != key(im) for ep in eps):
        raise ValueError("mixed demos: different cameras or image sizes; export them separately")
    cams = im["names"] if im else []

    def png(ep, cam, k):
        rel = ep["images"]["dir"]
        if not isinstance(rel, str) or not __import__("re").match(r"^images/\d{3}$", rel) or image_roots is None:
            raise ValueError("bad image path in the replay")
        with open(os.path.join(image_roots[ep["demo"]], rel, cam, "frame_%06d.png" % k), "rb") as fh:
            return fh.read()
    SCHEMA = schema(env, cams)
    tasks, task_idx, episodes, ep_stats, index = [], {}, [], [], 0
    for e, ep in enumerate(eps):
        if ep["task"] not in task_idx:
            task_idx[ep["task"]] = len(tasks); tasks.append(ep["task"])
        ti, n = task_idx[ep["task"]], ep["n"]
        ts = [f32(i / FPS) for i in range(n)]
        st = [[f32(x) for x in r] for r in ep["state"]]
        ac = [[f32(x) for x in r] for r in ep["action"]]
        fi = list(range(n)); gi = [index + i for i in fi]
        cols = {"action": ac, "observation.state": st}
        if env:
            en = [[f32(x) for x in r] for r in ep["env"]]
            cols[ENV_KEY] = en
        for c in cams:
            cols[IMAGE_PREFIX + c] = [{"bytes": png(ep, c, k), "path": None} for k in ep["fidx"]]
        cols.update({"timestamp": ts, "frame_index": fi, "episode_index": [e] * n, "index": gi, "task_index": [ti] * n})
        table = pa.table(cols, schema=SCHEMA)
        p = os.path.join(out, "data", "chunk-%03d" % (e // CHUNK), "episode_%06d.parquet" % e)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        pq.write_table(table, p)
        episodes.append({"episode_index": e, "tasks": [ep["task"]], "length": n})
        col = lambda v: [[x] for x in v]
        st_env = {ENV_KEY: stats(en)} if env else {}
        for c in cams:
            st_env[IMAGE_PREFIX + c] = image_stats([ep["images"]["sums"][c][k] for k in ep["fidx"]])
        ep_stats.append({"episode_index": e, "stats": {
            "action": stats(ac), "observation.state": stats(st), **st_env, "timestamp": stats(col(ts)),
            "frame_index": stats(col(fi)), "episode_index": stats(col([e] * n)), "index": stats(col(gi)),
            "task_index": stats(col([ti] * n))}})
        index += n
    E = len(eps)
    info = {
        "codebase_version": CODEBASE_VERSION, "robot_type": ROBOT_TYPE,
        "total_episodes": E, "total_frames": index, "total_tasks": len(tasks), "total_videos": 0,
        "total_chunks": (E - 1) // CHUNK + 1, "chunks_size": CHUNK, "fps": FPS, "splits": {"train": "0:%d" % E},
        "data_path": "data/chunk-{episode_chunk:03d}/episode_{episode_index:06d}.parquet", "video_path": None,
        "features": features(env, im), "source": "simulation", "license": license_,
    }
    agg = {k: merge_stats([s["stats"][k] for s in ep_stats]) for k in ep_stats[0]["stats"]}
    nested = lambda st: {k: (nest3(v) if k.startswith(IMAGE_PREFIX) else v) for k, v in st.items()}
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
    wjsonl("episodes_stats.jsonl", [{"episode_index": r["episode_index"], "stats": nested(r["stats"])} for r in ep_stats])
    wjson("stats.json", nested(agg))
    with open(os.path.join(out, "README.md"), "w", encoding="utf-8") as fh:
        fh.write(card(repo_id, license_, E, index, tasks, env, [ep["item"] for ep in eps], im))
    return info


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("demos", nargs="+", help="demo JSON files from the simulator (one episode each)")
    ap.add_argument("-o", "--out", required=True, help="output folder (created; must be empty or missing)")
    ap.add_argument("--repo-id", help="name shown in the dataset card, e.g. user/so101-sim-demos")
    ap.add_argument("--task", help="task instruction for all episodes (default: from the mission)")
    ap.add_argument("--license", default="cc-by-4.0", help="dataset licence id (default cc-by-4.0)")
    ap.add_argument("--whole", action="store_true", help="one episode per file even when a demo has per-item segments")
    ap.add_argument("--keep-diverged", action="store_true", help="SIL replays: keep items whose outcome changed in the replay")
    ap.add_argument("--no-images", action="store_true", help="SIL replays: export without the camera images")
    ap.add_argument("--no-env-state", action="store_true",
                    help="leave observation.environment_state out (cameras + joints only, as on a real arm)")
    a = ap.parse_args(argv)
    if os.path.isdir(a.out) and os.listdir(a.out):
        ap.error("output folder is not empty: %s" % a.out)
    demos = []
    for p in a.demos:
        with open(p, encoding="utf-8") as fh:
            demos.append(json.load(fh))
    roots = [os.path.dirname(os.path.abspath(p)) for p in a.demos]   # a replay's images/NNN sit next to its JSON
    info = convert(demos, a.out, a.repo_id, a.task, a.license, per_item=not a.whole, image_roots=roots,
                   keep_diverged=a.keep_diverged, images=not a.no_images, env_state=not a.no_env_state)
    print("wrote %s: %d episode(s), %d frames" % (a.out, info["total_episodes"], info["total_frames"]))


if __name__ == "__main__":
    sys.exit(main())
