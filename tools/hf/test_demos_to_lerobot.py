#!/usr/bin/env python3
"""Cross-check: tools/hf/demos_to_lerobot.py and the node exporter (sim/so101/src/export/lerobot.js, via
tools/sil/lib/dataset.mjs) write the same LeRobot v2.1 dataset from the same SIL replay folder, camera images
included (Parquet columns read back with pyarrow and compared value by value, PNG bytes included).

  pip install pyarrow
  python -I tools/hf/test_demos_to_lerobot.py

Needs node (>= 22) on PATH. The replay folder is synthetic (small PNGs written here), shaped like the output of
tools/sil/replay.mjs; tools/sil/test/conveyor.test.mjs covers a real replay.
"""
import json
import math
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
import demos_to_lerobot as d2l  # noqa: E402

import pyarrow.parquet as pq  # noqa: E402

W, H, CAMS = 20, 16, ["up", "wrist"]


def png(rgb, w, h):
    raw = b"".join(b"\x00" + bytes(rgb[3 * w * y:3 * w * (y + 1)]) for y in range(h))
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


def sums(rgb):
    out = []
    for f in (min, max):
        out += [f(rgb[c::3]) for c in range(3)]
    out += [sum(rgb[c::3]) for c in range(3)] + [sum(v * v for v in rgb[c::3]) for c in range(3)]
    return out + [len(rgb) // 3]


def item(name, cls, y):
    return {"item": name, "class": cls, "pos": [0.24, y, 0.03], "yaw": 0.3}


def make_replay(folder, tag="000", n=40, recorder=None):
    """A replay of 40 frames: a sorted cup (frames 0-19), a socket whose outcome changed in the replay (20-39)."""
    frames, sm = [], {c: [] for c in CAMS}
    os.makedirs(os.path.join(folder, "images", tag, "up")); os.makedirs(os.path.join(folder, "images", tag, "wrist"))
    for k in range(n):
        q = [10 * math.sin(k / 7 + j) for j in range(5)] + [50 + 40 * math.sin(k / 5)]
        env = {"belt": 0.02, "target": item("cup_paper1", "paper", -0.1 + 0.001 * k) if k < 20 else item("socket_s1", "metal", 0.01 * k - 0.3),
               "next": item("socket_s1", "metal", -0.25) if k < 20 else None}
        frames.append({"frame_index": k, "timestamp": k / 30, "observation.state": [round(x, 2) for x in q],
                       "action": [round(x + 0.5, 2) for x in q], "env": env})
        for ci, c in enumerate(CAMS):
            rgb = [(7 * k + 13 * i + 50 * ci) % 256 for i in range(W * H * 3)]
            with open(os.path.join(folder, "images", tag, c, "frame_%06d.png" % k), "wb") as fh:
                fh.write(png(rgb, W, H))
            sm[c].append(sums(rgb))
    segs = [{"item": "cup_paper1", "class": "paper", "outcome": "sorted", "bin": "bin_paper", "from": 0, "to": 19, "grasp": 5, "release": 15},
            {"item": "socket_s1", "class": "metal", "outcome": "dropped", "bin": None, "from": 20, "to": 39, "grasp": 24, "release": 30}]
    demo = {
        "format": "printedrobotics.cz/so101-sim-demo@1", "robot_type": "so101_follower", "fps": 30,
        "printedrobotics": {
            "mission": "waste_teach", "segments": segs, **({"recorder": recorder} if recorder is not None else {}),
            "replay": {"format": "printedrobotics.cz/so101-sil-replay@1", "width": W, "height": H,
                       "cameras": [{"name": c, "preset": c} for c in CAMS],
                       "items": [{"item": "cup_paper1", "recorded": "sorted", "replay": "sorted"},
                                 {"item": "socket_s1", "recorded": "sorted", "replay": "dropped"}],
                       "images": {"dir": "images/" + tag, "sums": sm}}},
        "episodes": [{"episode_index": 0, "task": "Třídění", "length": n, "frames": frames}],
    }
    with open(os.path.join(folder, "replay-%s.json" % tag), "w") as fh:
        json.dump(demo, fh)
    return demo


NODE = shutil.which("node")


def node_export(folder, out, **opts):
    js = ("import { writeImageDataset } from %s; const [d, o, j] = process.argv.slice(1);"
          "await writeImageDataset(d, o, JSON.parse(j));") % json.dumps("file://" + os.path.join(ROOT, "tools/sil/lib/dataset.mjs"))
    subprocess.run([NODE, "--input-type=module", "-e", js, folder, out, json.dumps(opts)], check=True,
                   stderr=subprocess.DEVNULL)


def close(a, b):
    if isinstance(a, list):
        assert len(a) == len(b)
        return max([close(x, y) for x, y in zip(a, b)] or [0])
    if isinstance(a, dict):
        assert a.keys() == b.keys(), (a.keys(), b.keys())
        return max([close(a[k], b[k]) for k in a] or [0])
    return abs(a - b)


@unittest.skipIf(NODE is None, "needs node")
class SameDataset(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.rep = os.path.join(self.tmp, "rep")
        os.makedirs(self.rep)
        self.demo = make_replay(self.rep)

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def both(self, keep=False, env=True):
        a, b = os.path.join(self.tmp, "node"), os.path.join(self.tmp, "py")
        shutil.rmtree(a, ignore_errors=True); shutil.rmtree(b, ignore_errors=True)
        node_export(self.rep, a, keepDiverged=keep, envState=env)
        d2l.convert([self.demo], b, image_roots=[self.rep], keep_diverged=keep, env_state=env)
        return a, b

    def compare(self, a, b):
        for f in ("meta/info.json",):
            self.assertEqual(json.load(open(os.path.join(a, f))), json.load(open(os.path.join(b, f))))
        for f in ("meta/tasks.jsonl", "meta/episodes.jsonl"):
            self.assertEqual([json.loads(x) for x in open(os.path.join(a, f))], [json.loads(x) for x in open(os.path.join(b, f))])
        self.assertEqual(open(os.path.join(a, "README.md")).read(), open(os.path.join(b, "README.md")).read())
        sa = [json.loads(x) for x in open(os.path.join(a, "meta/episodes_stats.jsonl"))]
        sb = [json.loads(x) for x in open(os.path.join(b, "meta/episodes_stats.jsonl"))]
        self.assertLess(close(sa, sb), 1e-9)
        self.assertLess(close(json.load(open(os.path.join(a, "meta/stats.json"))), json.load(open(os.path.join(b, "meta/stats.json")))), 1e-9)
        info = json.load(open(os.path.join(a, "meta/info.json")))
        for e in range(info["total_episodes"]):
            p = "data/chunk-000/episode_%06d.parquet" % e
            A, B = pq.read_table(os.path.join(a, p)), pq.read_table(os.path.join(b, p))
            self.assertEqual(A.schema.names, B.schema.names)
            self.assertEqual(A.to_pylist(), B.to_pylist())
            self.assertEqual(json.loads(A.schema.metadata[b"huggingface"]), json.loads(B.schema.metadata[b"huggingface"]))
        return info

    def test_images_env_and_diverged_items(self):
        a, b = self.both()
        info = self.compare(a, b)
        self.assertEqual(info["total_episodes"], 1, "the socket ended differently in the replay: left out")
        for c in CAMS:
            self.assertEqual(info["features"]["observation.images." + c], {"dtype": "image", "shape": [H, W, 3], "names": ["height", "width", "channels"]})
        rows = pq.read_table(os.path.join(a, "data/chunk-000/episode_000000.parquet")).to_pylist()
        self.assertEqual(len(rows), 20)
        with open(os.path.join(self.rep, "images/000/wrist/frame_000007.png"), "rb") as fh:
            self.assertEqual(rows[7]["observation.images.wrist"]["bytes"], fh.read())
        self.assertEqual(len(rows[0]["observation.environment_state"]), 18)
        st = json.load(open(os.path.join(a, "meta/stats.json")))["observation.images.up"]
        self.assertEqual([len(st["mean"]), len(st["mean"][0]), len(st["mean"][0][0])], [3, 1, 1])

    def test_keep_diverged_and_no_env_state(self):
        a, b = self.both(keep=True, env=False)
        info = self.compare(a, b)
        self.assertEqual(info["total_episodes"], 2)
        self.assertNotIn("observation.environment_state", info["features"])
        eps = [json.loads(x) for x in open(os.path.join(a, "meta/episodes.jsonl"))]
        self.assertEqual([e["length"] for e in eps], [20, 20])

    def test_action_order_by_recorder(self):
        """Recorder 3 actions export as stored; older ones (here: no recorder field) one 60 Hz frame later, in both."""
        src = [f["action"] for f in self.demo["episodes"][0]["frames"]]
        a, b = self.both(keep=True)
        self.compare(a, b)
        old = pq.read_table(os.path.join(a, "data/chunk-000/episode_000000.parquet")).to_pylist()
        self.assertGreater(abs(old[3]["action"][0] - src[3][0]), 0.01)
        mid = [x + (y - x) * 0.5 for x, y in zip(src[3], src[4])]   # frames 1/30 s apart: halfway to the next one
        self.assertLess(close(old[3]["action"], mid), 1e-4)
        shutil.rmtree(self.rep); os.makedirs(self.rep)
        self.demo = make_replay(self.rep, recorder=3)
        a, b = self.both(keep=True)
        self.compare(a, b)
        new = pq.read_table(os.path.join(a, "data/chunk-000/episode_000000.parquet")).to_pylist()
        self.assertLess(close([r["action"] for r in new], src[:20]), 1e-4)


class ActionLag(unittest.TestCase):
    def test_lag(self):
        self.assertEqual(d2l.action_lag(3), 0.0)
        self.assertEqual(d2l.action_lag(3.0), 0.0)
        for r in (None, 1, 2, "3", 2.5, True):
            self.assertEqual(d2l.action_lag(r), 1 / 60)


if __name__ == "__main__":
    unittest.main()
