#!/usr/bin/env python3
"""Run a pretrained LeRobot policy against the virtual SO-101 and write down what the arm did.

Starts the virtual arm with two virtual cameras, calibrates it with the real lerobot-calibrate
(the runner's --auto-hand moves the arm, this script presses ENTER), runs `lerobot-rollout` for a few
seconds with the policy on the CPU, records the joint angles and the cube position from the runner's
/status, saves camera snapshots and prints a short summary. Unmodified LeRobot (0.6.1 tested).

  pip install "lerobot[feetech,dataset]==0.6.1" pyzmq        # + PyTorch for your machine
  python3 tools/sil/policy_trial.py --out /tmp/trial \
      --policy samarth-shukla6/act-svla-so101-pickplace --duration 20

The default policy and camera names (up, side; 640x480; joint units -100..100) match
samarth-shukla6/act-svla-so101-pickplace (Apache-2.0), trained on lerobot/svla_so101_pickplace.
Downloading it from the Hub needs network access (about 210 MB); no token for public models.
Exit code 0 = the run completed (it says nothing about whether the task was solved).
"""
import argparse
import json
import os
import pty
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_REVISION = ""        # commit of samarth-shukla6/act-svla-so101-pickplace we tested


def status(ctl):
    with urllib.request.urlopen(f"http://127.0.0.1:{ctl}/status", timeout=5) as r:
        return json.load(r)


def wait_for(pred, timeout, what):
    t0 = time.time()
    while time.time() - t0 < timeout:
        if pred():
            return
        time.sleep(0.1)
    raise TimeoutError(f"timed out waiting for {what}")


def calibrate(args, env, log_path, rtext):
    """lerobot-calibrate on a pseudo-terminal, as in a real shell (LeRobot waits for ENTER with select() +
    readline()). The runner's --auto-hand moves the arm; we press ENTER at the two prompts."""
    cal_log = open(log_path, "w")
    master, slave = pty.openpty()
    cal = subprocess.Popen(["lerobot-calibrate", "--robot.type=so101_follower", f"--robot.port={args.port}", "--robot.id=sil_follower"],
                           stdin=slave, stdout=slave, stderr=slave, env=env, close_fds=True)
    os.close(slave)
    seen = []                                             # raw chunks: input() prompts end without a newline

    def pump():
        while True:
            try:
                chunk = os.read(master, 4096)
            except OSError:
                return
            if not chunk:
                return
            seen.append(chunk.decode("utf8", "replace")); cal_log.write(seen[-1]); cal_log.flush()
    threading.Thread(target=pump, daemon=True).start()
    try:
        wait_for(lambda: "middle of its range" in "".join(seen) or cal.poll() is not None, 120, "the calibration prompt")
        if cal.poll() is not None:
            return False
        time.sleep(1)                                     # as a person would
        os.write(master, b"\n")
        mark = len(rtext())
        wait_for(lambda: "follower: sweep done" in rtext()[mark:] or cal.poll() is not None, 180, "the calibration sweep")
        os.write(master, b"\n")
        return cal.wait(60) == 0
    finally:
        if cal.poll() is None:
            cal.kill()
        os.close(master)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", required=True, help="output folder (logs, trace.json, snapshots, summary.md)")
    ap.add_argument("--policy", default="samarth-shukla6/act-svla-so101-pickplace", help="Hub repo id or local folder")
    ap.add_argument("--revision", default=DEFAULT_REVISION, help="Hub commit to pin (empty = latest); ignored for a local folder")
    ap.add_argument("--cameras", default="up,side", help="NAME[=VIEW] list; names must match the policy's image features")
    ap.add_argument("--size", default="640x480")
    ap.add_argument("--duration", type=float, default=20)
    ap.add_argument("--task", default="Pick up the cube and place it in the bowl")
    ap.add_argument("--use-degrees", default="false", help="joint units the policy was trained with (false = -100..100)")
    ap.add_argument("--ctl-port", type=int, default=8765)
    ap.add_argument("--camera-port", type=int, default=5555)
    ap.add_argument("--port", default="/tmp/so101-follower")
    args = ap.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ, HF_HUB_DISABLE_TELEMETRY="1", HF_LEROBOT_HOME=str(out / "lerobot-home"))
    cams = [c.strip() for c in args.cameras.split(",") if c.strip()]
    w, h = (int(x) for x in args.size.split("x"))
    node = shutil.which("node") or sys.exit("node not found")

    runner_log = open(out / "runner.log", "w")
    cam_args = sum((["--camera", c] for c in cams), [])
    runner = subprocess.Popen([node, str(ROOT / "tools/sil/so101-virtual.mjs"), "--auto-hand", "--follower-port", args.port,
                               "--ctl-port", str(args.ctl_port), "--camera-port", str(args.camera_port), "--camera-size", args.size, *cam_args],
                              stdin=subprocess.DEVNULL, stdout=runner_log, stderr=subprocess.STDOUT)
    rtext = lambda: (out / "runner.log").read_text()
    try:
        wait_for(lambda: "control:" in rtext(), 60, "the virtual arm")
        wait_for(lambda: status(args.ctl_port).get("cameras", {}).get("frames", 0) >= 2, 60, "the first camera frames")

        # 1. calibrate (the runner moves the arm; we press ENTER twice like a person would)
        t_cal = time.time()
        for attempt in (1, 2):
            if calibrate(args, env, out / f"calibrate-{attempt}.log", rtext):
                break
            print(f"lerobot-calibrate attempt {attempt} failed (see calibrate-{attempt}.log)")
        else:
            raise RuntimeError("lerobot-calibrate failed twice")
        print(f"calibrated in {time.time() - t_cal:.0f} s")

        # 2. rollout, with a trace of what the arm and the cube did
        cam_cfg = ", ".join(f"{c.split('=')[0]}: {{type: zmq, server_address: 127.0.0.1, port: {args.camera_port}, camera_name: {c.split('=')[0]}, width: {w}, height: {h}, fps: 30}}" for c in cams)
        local = Path(args.policy).exists()
        resolved = "local folder"
        if not local:
            try:
                from huggingface_hub import HfApi
                resolved = HfApi().model_info(args.policy, revision=args.revision or None).sha
            except Exception as e:                        # offline etc.: lerobot-rollout will say more
                resolved = f"unknown ({type(e).__name__})"
        print(f"policy {args.policy} at revision {resolved}")
        rev = [f"--policy.pretrained_revision={args.revision}"] if args.revision and not local else []
        cmd = ["lerobot-rollout", "--strategy.type=base", f"--policy.path={args.policy}", *rev, "--policy.device=cpu",
               "--robot.type=so101_follower", f"--robot.port={args.port}", "--robot.id=sil_follower", f"--robot.use_degrees={args.use_degrees}",
               f"--robot.cameras={{ {cam_cfg} }}", f"--task={args.task}", f"--duration={args.duration:g}", "--play_sounds=false"]
        (out / "command.txt").write_text(" ".join(f"'{a}'" if " " in a else a for a in cmd) + "\n")
        trace, stop = [], threading.Event()

        def sample():
            snap_at = [0.25, 0.5, 0.75, 0.999]
            started = None
            while not stop.is_set():
                try:
                    s = status(args.ctl_port)
                except OSError:
                    time.sleep(0.2); continue
                torque = sum(x["torque"] for x in s["follower"]["servos"])
                trace.append({"wall": time.time(), "t": s["t"], "q": s["follower"]["q"], "torque": torque, "cube": s["cube"], "tip": s.get("tip"), "subscribers": s.get("cameras", {}).get("subscribers")})
                if torque and started is None:
                    started = time.time()
                if started and snap_at and time.time() - started >= snap_at[0] * args.duration:
                    k = int(snap_at.pop(0) * 100)
                    for c in cams:
                        n = c.split("=")[0]
                        try:
                            with urllib.request.urlopen(f"http://127.0.0.1:{args.ctl_port}/camera/{n}.png", timeout=5) as r:
                                (out / f"snap-{n}-{k:02d}.png").write_bytes(r.read())
                        except OSError:
                            pass
                time.sleep(0.25)
        th = threading.Thread(target=sample, daemon=True)
        th.start()
        t0 = time.time()
        with open(out / "rollout.log", "w") as lg:
            rc = subprocess.call(cmd, stdout=lg, stderr=subprocess.STDOUT, env=env)
        wall = time.time() - t0
        stop.set(); th.join(2)
        (out / "trace.json").write_text(json.dumps(trace))

        # 3. summary
        log = (out / "rollout.log").read_text()
        active = [x for x in trace if x["torque"]]
        lines = [f"# Policy trial: {args.policy}", "", f"- revision: {resolved}", f"- lerobot-rollout exit code: {rc}, wall time {wall:.0f} s (duration {args.duration:g} s)",
                 f"- cameras: {', '.join(cams)} {args.size}; ZMQ subscribers seen: {max((x['subscribers'] or 0) for x in trace) if trace else 0}"]
        slow = [float(x) for x in re.findall(r"running slower \(([\d.]+) Hz\)", log)]
        if slow:
            lines.append(f"- control loop below 30 Hz in {len(slow)} warnings (lowest {min(slow):.1f} Hz): CPU inference")
        if active:
            names = ["shoulder_pan", "shoulder_lift", "elbow_flex", "wrist_flex", "wrist_roll", "gripper"]
            lines += ["", "| joint | min (rad) | max (rad) | travelled (rad) |", "|---|---:|---:|---:|"]
            for j, n in enumerate(names):
                v = [x["q"][j] for x in active]
                path = sum(abs(a - b) for a, b in zip(v, v[1:]))
                lines.append(f"| {n} | {min(v):.2f} | {max(v):.2f} | {path:.2f} |")
            c0, c1 = active[0]["cube"], active[-1]["cube"]
            moved = sum((a - b) ** 2 for a, b in zip(c0, c1)) ** 0.5
            near = [(sum((a - b) ** 2 for a, b in zip(x["tip"], x["cube"])) ** 0.5, x) for x in active if x.get("tip")]
            if near:
                dmin, xmin = min(near, key=lambda p: p[0])
                lines += ["", f"- gripper came within {dmin * 100:.1f} cm of the cube (gripper frame at {[round(v, 3) for v in xmin['tip']]}, "
                              f"{xmin['wall'] - active[0]['wall']:.0f} s into the run); at the start it was {near[0][0] * 100:.1f} cm away"]
                z = [x["tip"][2] for x in active if x.get("tip")]
                lines.append(f"- gripper height above the table: {min(z) * 100:.1f} to {max(z) * 100:.1f} cm")
            lines += ["", f"- cube moved {moved * 100:.1f} cm (start {[round(x, 3) for x in c0]}, end {[round(x, 3) for x in c1]})",
                      f"- torque on for {active[-1]['wall'] - active[0]['wall']:.0f} s"]
        else:
            lines.append("- the arm never had torque on: the policy did not start (see rollout.log)")
        (out / "summary.md").write_text("\n".join(lines) + "\n")
        print("\n".join(lines))
        return 0 if rc == 0 else 1
    finally:
        runner.terminate()
        try:
            runner.wait(5)
        except subprocess.TimeoutExpired:
            runner.kill()


if __name__ == "__main__":
    sys.exit(main())
