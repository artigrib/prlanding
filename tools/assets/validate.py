"""Validate converted objects with MuJoCo (python, same 3.x line as the browser build).

Per object (sim/so101/objects/<id>/):
  1. the MJCF compiles on its own; body mass matches <id>.json; GLB within budget
  2. drop test on the SO-101 table (same box, friction and timestep as sim/so101/model/scene.xml), from 3 cm
     in 3 orientations, 3 s each: no NaN/instability warnings, no explosion (speed < 4 m/s), no deep
     penetration (contact depth < 4 mm in the last second), comes to rest (< 2 cm/s) on the table
Whole library:
  3. all objects injected together into the real sim/so101/model/scene.xml (same rules as library.js:
     <asset> before <worldbody>, bodies at the end of the last worldbody, keyframes extended) compile and settle.

Usage: python -I tools/assets/validate.py [--objects sim/so101/objects] [--report validate-report.json] [ids...]
"""
import argparse
import json
import re
import shutil
import sys
import tempfile
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import OBJECTS_DIR, SCENE_XML, load_policy, status, write_json  # noqa: E402

TABLE = ('<geom name="table" type="box" size="0.40 0.32 0.015" pos="0.14 0 -0.015" '
         'friction="0.8 0.005 0.0001"/>')
ORIENT = {"upright": "1 0 0 0", "tilt_x35": "0.9537 0.3007 0 0", "side_y90": "0.7071 0 0.7071 0"}


def split_mjcf(text):
    a = re.search(r"<asset>(.*?)</asset>", text, re.S)
    b = re.search(r"<worldbody>(.*)</worldbody>", text, re.S)
    if not a or not b:
        raise ValueError("object MJCF must have one <asset> and one <worldbody>")
    return a.group(1).strip(), b.group(1).strip()


def place(body_xml, pos, quat="1 0 0 0"):
    return re.sub(r'(<body\b[^>]*?)\spos="[^"]*"', rf'\1 pos="{pos}" quat="{quat}"', body_xml, count=1)


def inject(scene, objs):
    """Python twin of injectObjects() in sim/so101/src/objects/library.js. objs: [(asset, body, qpos7)]."""
    if not objs:
        return scene
    assets = "\n".join(f"<asset>{a}</asset>" for a, _, _ in objs)
    bodies = "\n".join(b for _, b, _ in objs)
    i = scene.find("<worldbody")
    j = scene.rfind("</worldbody>")
    if i < 0 or j < 0:
        raise ValueError("scene has no worldbody")
    scene = scene[:j] + bodies + "\n" + scene[j:]
    scene = scene[:i] + assets + "\n" + scene[i:]
    extra_q = " ".join(" ".join(str(x) for x in q) for _, _, q in objs)
    extra_v = " ".join("0 0 0 0 0 0" for _ in objs)

    def key(m):
        tag = m.group(0)
        tag = re.sub(r'\bqpos="([^"]*)"', lambda k: f'qpos="{k.group(1).strip()} {extra_q}"', tag)
        tag = re.sub(r'\bqvel="([^"]*)"', lambda k: f'qvel="{k.group(1).strip()} {extra_v}"', tag)
        return tag
    return re.sub(r"<key\b[^>]*>", key, scene)


def _sim_drop(mujoco, xml, body, seconds=3.0):
    m = mujoco.MjModel.from_xml_string(xml)
    d = mujoco.MjData(m)
    b = mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_BODY, body)
    n = int(seconds / m.opt.timestep)
    vmax, pen, settle_t, start = 0.0, 0.0, None, None
    for k in range(n):
        mujoco.mj_step(m, d)
        if start is None:
            start = d.xpos[b].copy()
        if not np.all(np.isfinite(d.qpos)):
            return {"error": "NaN state"}
        v = float(np.linalg.norm(d.cvel[b][3:]))
        vmax = max(vmax, v)
        if k * m.opt.timestep > seconds - 1.0:
            for c in range(d.ncon):
                pen = max(pen, -float(d.contact[c].dist))
        if v < 0.02 and settle_t is None and k * m.opt.timestep > 0.1:
            settle_t = k * m.opt.timestep
        elif v >= 0.02:
            settle_t = None
    warn = {int(i): int(d.warning[i].number) for i in range(len(d.warning)) if d.warning[i].number}
    return {"vmax": vmax, "v_end": float(np.linalg.norm(d.cvel[b][3:])), "w_end": float(np.linalg.norm(d.cvel[b][:3])),
            "pen": pen, "z_end": float(d.xpos[b][2]), "xy_shift": float(np.linalg.norm(d.xpos[b][:2] - start[:2])),
            "settle_s": settle_t, "warnings": warn, "mass": float(m.body_mass[b])}


def validate_object(obj_dir, policy=None):
    import mujoco
    policy = policy or load_policy()
    obj_dir = Path(obj_dir)
    oid = obj_dir.name
    errors = []
    meta = json.loads((obj_dir / f"{oid}.json").read_text(encoding="utf-8"))
    text = (obj_dir / f"{oid}.xml").read_text(encoding="utf-8")
    glb = obj_dir / f"{oid}.glb"
    if not glb.is_file() or glb.stat().st_size > policy["budget"]["glb_max_bytes"]:
        errors.append("GLB missing or over budget")
    try:
        m = mujoco.MjModel.from_xml_string(text)
        b = mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_BODY, meta["body"])
        if b < 0:
            errors.append("body name mismatch")
        elif abs(m.body_mass[b] - meta["mass_kg"]) > 0.01 * meta["mass_kg"] + 1e-6:
            errors.append("mass mismatch")
    except Exception as e:  # compile error text comes from MuJoCo, not from the asset
        return {"id": oid, "ok": False, "errors": [f"MJCF does not compile: {str(e).splitlines()[0][:120]}"]}
    asset, body = split_mjcf(text)
    drops, worst = {}, None
    for name, quat in ORIENT.items():
        z = 0.03 + max(meta["size_m"]) * (0.5 if name != "upright" else 0)
        xml = (f'<mujoco><option timestep="0.004"/><asset>{asset}</asset><worldbody>'
               f'<geom type="plane" size="2 2 0.1" pos="0 0 -0.75"/>{TABLE}'
               f'{place(body, f"0.15 0 {z:.4f}", quat)}</worldbody></mujoco>')
        r = _sim_drop(mujoco, xml, meta["body"])
        drops[name] = r
        if "error" in r:
            errors.append(f"{name}: {r['error']}")
            continue
        if r["warnings"]:
            errors.append(f"{name}: MuJoCo warnings {r['warnings']}")
        if r["vmax"] > 4.0:
            errors.append(f"{name}: exploded (v={r['vmax']:.1f} m/s)")
        if r["pen"] > 0.004:
            errors.append(f"{name}: penetration {r['pen'] * 1000:.1f} mm")
        if r["v_end"] > 0.02 or r["w_end"] > 0.5:
            errors.append(f"{name}: not at rest after 3 s")
        if r["z_end"] < -0.01 or r["xy_shift"] > 0.25:
            errors.append(f"{name}: left the table")
        s = r["settle_s"] if r["settle_s"] is not None else 99
        worst = s if worst is None else max(worst, s)
    return {"id": oid, "ok": not errors, "errors": errors,
            "drop": {"settle_s": round(worst, 2) if worst is not None else None,
                     "max_penetration_mm": round(max((r.get("pen", 0) for r in drops.values()), default=0) * 1000, 2)},
            "detail": drops}


TABLE_XY = ((-0.22, 0.50), (-0.27, 0.27))          # usable table top (scene.xml table minus a margin)
KEEP_OUT = (((0.0, 0.0), 0.12), ((0.20, 0.15), 0.07), ((0.25, -0.11), 0.03))  # robot base, bowl, cube


def table_spots(footprints):
    """Greedy packing of objects (footprint radius r) onto the table, away from the robot, bowl and cube.
    Returns a list of batches; each batch is [(index, x, y)] that fits on the table at once."""
    def find(r, cur):
        for x in np.arange(TABLE_XY[0][0] + r, TABLE_XY[0][1] - r + 1e-9, 0.01):
            for y in np.arange(TABLE_XY[1][0] + r, TABLE_XY[1][1] - r + 1e-9, 0.01):
                if any(np.hypot(x - c[0], y - c[1]) < rad + r for c, rad in KEEP_OUT):
                    continue
                if any(np.hypot(x - px, y - py) < r + footprints[k] + 0.015 for k, px, py in cur):
                    continue
                return round(float(x), 3), round(float(y), 3)
        return None

    batches, cur = [], []
    for i in sorted(range(len(footprints)), key=lambda i: -footprints[i]):
        spot = find(footprints[i], cur)
        if spot is None and cur:
            batches.append(cur)
            cur = []
            spot = find(footprints[i], cur)
        if spot is None:
            raise ValueError("object larger than the table")
        cur.append((i, *spot))
    if cur:
        batches.append(cur)
    return batches


def validate_scene(ids, objects_dir, seconds=3.0):
    """All objects in the real SO-101 scene (catches name clashes, keyframe sizes, robot/bowl contacts).
    Objects are packed onto the table; if they do not all fit, several scenes are checked."""
    import mujoco
    model_dir = SCENE_XML.parent
    od = Path(objects_dir)
    metas = [json.loads((od / i / f"{i}.json").read_text(encoding="utf-8")) for i in ids]
    foot = [0.5 * float(np.hypot(m["size_m"][0], m["size_m"][1])) for m in metas]
    speeds, info = {}, []
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td) / "model"
        shutil.copytree(model_dir, tmp)
        for batch in table_spots(foot):
            objs = []
            for i, x, y in batch:
                a, b = split_mjcf((od / ids[i] / f"{ids[i]}.xml").read_text(encoding="utf-8"))
                pos = (x, y, 0.003)
                objs.append((a, place(b, " ".join(map(str, pos))), (*pos, 1, 0, 0, 0)))
            (tmp / "scene_objects.xml").write_text(inject(SCENE_XML.read_text(encoding="utf-8"), objs), encoding="utf-8")
            m = mujoco.MjModel.from_xml_path(str(tmp / "scene_objects.xml"))
            d = mujoco.MjData(m)
            mujoco.mj_resetDataKeyframe(m, d, 0)
            for _ in range(int(seconds / m.opt.timestep)):
                mujoco.mj_step(m, d)
            if not np.all(np.isfinite(d.qpos)):
                return {"ok": False, "error": "NaN in combined scene"}
            for i, _, _ in batch:
                b = mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_BODY, f"obj_{ids[i]}")
                speeds[ids[i]] = float(np.linalg.norm(d.cvel[b][3:]))
            info.append({"objects": len(batch), "nq": int(m.nq)})
    ok = all(v < 0.05 for v in speeds.values())
    return {"ok": ok, "scenes": info, "speeds": speeds, "slow": sorted(k for k, v in speeds.items() if v >= 0.05)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("ids", nargs="*")
    ap.add_argument("--objects", default=str(OBJECTS_DIR))
    ap.add_argument("--report", default="validate-report.json")
    a = ap.parse_args()
    od = Path(a.objects)
    ids = a.ids or sorted(p.name for p in od.iterdir() if p.is_dir() and (p / f"{p.name}.xml").is_file())
    res = [validate_object(od / i) for i in ids]
    scene = validate_scene(ids, od) if ids else {"ok": True}
    write_json(a.report, {"objects": [{k: v for k, v in r.items() if k != "detail"} for r in res], "scene": scene})
    bad = sum(not r["ok"] for r in res)
    status(f"validate: {len(res) - bad}/{len(res)} objects pass drop test; combined scene {'ok' if scene['ok'] else 'FAILED'}")
    return 1 if bad or not scene["ok"] else 0


if __name__ == "__main__":
    sys.exit(main())
