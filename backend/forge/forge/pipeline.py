"""Forge job pipeline (stage 0): request -> parse -> mount -> CAD -> checks -> parts -> render -> guide.

    python3 -m forge.pipeline "SO-101 s baterkou" --job /tmp/job [--no-render] [--publish]

The "brain" decides; the pipeline only runs tools and records every step in <job>/job.json (the log
the /lab/ page replays and, later, the SSE stream). Stage 0 uses ScriptedBrain: its CAD source
(designs/so101_flashlight.py) was written by Claude and goes through run_cad like LLM output would.
An LLMBrain (OpenRouter) will implement the same five methods; no LLM is called here.

Everything except the render step is deterministic (no clock, fixed sampling seeds), so
tests/test_pipeline.py can compare a fresh run with the committed outputs.
"""
import argparse
import json
import math
import os
import re
import shutil
import socket
import subprocess
import sys
import time

import mujoco
import numpy as np
import trimesh

from . import checks, sim
from .sandbox import run_cad

HERE = os.path.dirname(os.path.abspath(__file__))
FORGE = os.path.dirname(HERE)
ROOT = os.path.abspath(os.path.join(FORGE, "..", ".."))
MOUNTS = os.path.join(HERE, "mounts", "so101.json")
CATALOG = os.path.join(HERE, "parts", "catalog.json")
DESIGN = os.path.join(FORGE, "designs", "so101_flashlight.py")
TEMPLATES = os.path.join(FORGE, "templates")
SLUG = "so101-flashlight"
STEPS = [
    ("parse", "Parse request", "Rozbor zadání"),
    ("mount", "Pick mount point", "Výběr místa uchycení"),
    ("cad", "CAD in sandbox", "CAD v sandboxu"),
    ("checks", "Checks", "Kontroly"),
    ("parts", "Parts and power", "Díly a napájení"),
    ("render", "Renders", "Vizualizace"),
    ("guide", "Guide draft", "Koncept návodu"),
]
PUBLISH = {
    "renders": os.path.join(ROOT, "img", "forge", SLUG),
    "guide_cs": os.path.join(ROOT, "tools", "content", "forge-flashlight.cs.html"),
    "guide_en": os.path.join(ROOT, "tools", "content", "forge-flashlight.en.html"),
    "lab": os.path.join(ROOT, "lab", "forge", SLUG, "job.json"),
    "bom": os.path.join(ROOT, "data", "components", "extensions", f"{SLUG}.json"),
    "example": os.path.join(FORGE, "examples", SLUG),
}


# --------------------------------------------------------------------------- brain
class ScriptedBrain:
    """Stage-0 brain: deterministic rules + a CAD source written by Claude (no API calls)."""
    name = "scripted-stage0"
    note = "Claude-authored build123d source and rules, run through the same run_cad tool an LLM will use; no LLM call."

    def parse(self, request):
        t = request.lower()
        robot = "so101" if re.search(r"so-?\s?101", t) else None
        light = bool(re.search(r"baterk|svítiln|svetl|světl|flashlight|torch|\blight\b|\bled\b", t))
        if not robot or not light:
            raise ValueError("stage 0 understands only 'SO-101 + flashlight' requests")
        return {"robot": robot, "accessory": "flashlight", "language": "cs" if re.search(r"[áčďéěíňóřšťúůýž]| s ", t) else "en",
                "requirements": {"moves_with": "gripper", "aim": "jaw tips (gripperframe site)", "led": "common 10 mm white LED",
                                 "power": "low voltage only (no mains, no LiPo)", "mass_max_g": 15, "min_wall_mm": checks.MIN_WALL_MM}}

    def choose_mount(self, spec, lib):
        ranked = []
        for it in lib["interfaces"]:
            score, why = 0, []
            if it["body"] == "gripper":
                score += 2
                why.append("rotates with the gripper, so the light follows the jaws")
            if it["kind"] == "screw_face":
                score += 2
                why.append("existing screw holes (wrist-camera mount pair)")
            if it["kind"] == "flat_face_no_holes":
                why.append("no holes: tape only")
            if it["kind"] == "clamp":
                why.append("does not follow wrist roll")
            ranked.append({"id": it["id"], "score": score, "why": why})
        ranked.sort(key=lambda r: -r["score"])
        return ranked[0]["id"], ranked

    def params(self, spec, mount, tcp_mm):
        holes = mount["holes"]
        p = {"led_d": 10.0, "led_clear": 0.25, "flange_d": 11.4, "flange_h": 1.5, "wall": 1.8, "sleeve_len": 14.0,
             "tilt_deg": 25.0, "toe_deg": 0.0, "plate_t": 3.0, "hole_pitch": mount["hole_pitch_mm"]["design_value"],
             "hole_mid_x": round((holes[0]["center"][0] + holes[1]["center"][0]) / 2, 2), "hole_z": holes[0]["center"][2],
             "face_y": mount["plane"]["point"][1], "hole_d": 3.4, "slot_extra": mount["hole_pitch_mm"]["uncertainty"],
             "sleeve_x": -28.0, "sleeve_z": -24.0}
        # aim: tilt the sleeve (towards -y) so its axis passes the TCP site in the y-z plane; the toe (towards +x)
        # stays 0 so the sleeve's back end stays inside the jaw outline (x > -35 mm)
        od = p["led_d"] + p["led_clear"] + 2 * p["wall"]
        cy = p["face_y"] + p["plate_t"] + od / 2 - 1.0
        p["tilt_deg"] = round(math.degrees(math.atan2(cy - tcp_mm[1], p["sleeve_z"] - tcp_mm[2])), 0)
        return p

    def write_cad(self, params):
        with open(DESIGN, encoding="utf-8") as f:
            src = f.read()
        line = "PARAMS = " + json.dumps(params)
        out, n = re.subn(r"^PARAMS = \{.*\}$", lambda m: line, src, count=1, flags=re.M)
        if n != 1:
            raise RuntimeError("PARAMS line not found in the design source")
        return out

    def pick_led(self, spec, catalog, led_d):
        fits = [c for c in catalog["leds"] if abs(c["pick"]["diameter_mm"] - led_d) < 0.01 and c["pick"]["colour"] == "white"
                and any(s["recommend"] for s in c["sources"])]
        if not fits:
            raise ValueError("no LED in the catalogue fits")
        return fits[0]


# --------------------------------------------------------------------------- helpers
class Log:
    def __init__(self, job_dir, request, brain):
        self.path = os.path.join(job_dir, "job.json")
        self.job = {"version": 1, "request": request, "brain": {"name": brain.name, "note": brain.note},
                    "steps": [{"id": i, "title": t, "title_cs": c, "status": "pending"} for i, t, c in STEPS], "summary": {}}
        self.t0 = {}
        self.save()

    def step(self, sid):
        return next(s for s in self.job["steps"] if s["id"] == sid)

    def start(self, sid):
        self.t0[sid] = time.monotonic()
        self.step(sid)["status"] = "running"
        self.save()

    def done(self, sid, status="ok", **kw):
        s = self.step(sid)
        s.update(status=status, **kw)
        s["elapsed_s"] = round(time.monotonic() - self.t0.get(sid, time.monotonic()), 1)
        self.save()

    def save(self):
        with open(self.path, "w", encoding="utf-8") as f:
            json.dump(self.job, f, indent=1, ensure_ascii=False)
            f.write("\n")


def site_mm(model, name):
    m = mujoco.MjModel.from_xml_path(model)
    s = m.site(name)
    return [round(float(v) * 1000.0, 3) for v in s.pos]


def rot(tilt, toe):
    a, b = math.radians(-tilt), math.radians(-toe)
    rx = np.array([[1, 0, 0], [0, math.cos(a), -math.sin(a)], [0, math.sin(a), math.cos(a)]])
    ry = np.array([[math.cos(b), 0, math.sin(b)], [0, 1, 0], [-math.sin(b), 0, math.cos(b)]])
    return ry @ rx


def led_mesh(params, meta, out_stl):
    """Simple LED body for renders and the mass/torque model: collar, cylinder, dome (gripper frame, mm)."""
    L, r = params["sleeve_len"], params["led_d"] / 2
    collar = trimesh.creation.cylinder(radius=params["flange_d"] / 2 - 0.2, height=1.0, sections=48)
    collar.apply_translation([0, 0, L / 2 - params["flange_h"] + 0.5])
    body = trimesh.creation.cylinder(radius=r, height=8.6, sections=48)
    body.apply_translation([0, 0, L / 2 - params["flange_h"] - 4.3])
    dome = trimesh.creation.icosphere(subdivisions=3, radius=r)
    dome.apply_translation([0, 0, L / 2 - params["flange_h"] - 8.6])
    led = trimesh.util.concatenate([collar, body, dome])
    T = np.eye(4)
    T[:3, :3] = rot(params["tilt_deg"], params["toe_deg"])
    T[:3, 3] = meta["sleeve_center"]
    led.apply_transform(T)
    led.export(out_stl)
    tip = (T @ np.array([0, 0, L / 2 - params["flange_h"] - 8.6 - r, 1]))[:3]
    return [round(float(v), 2) for v in tip]


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def world_mm(model_xml, pose, body, local_mm):
    m = mujoco.MjModel.from_xml_path(model_xml)
    d = mujoco.MjData(m)
    for j, v in pose.items():
        d.qpos[m.jnt_qposadr[m.joint(j).id]] = v
    mujoco.mj_kinematics(m, d)
    b = m.body(body).id
    R, t = d.xmat[b].reshape(3, 3), d.xpos[b]
    out = []
    for p in local_mm:
        w = R @ (np.asarray(p, float) / 1000.0) + t
        out.append([round(float(v) * 1000.0, 1) for v in w])
    dirs = [[round(float(v), 4) for v in R[:, 1]]]
    return out, dirs


def render_spec(model_xml, meta, led_tip, params, coll):
    J = ["shoulder_pan", "shoulder_lift", "elbow_flex", "wrist_flex", "wrist_roll", "gripper"]
    zero = {j: 0.0 for j in J}
    work = {"shoulder_pan": 0.0, "shoulder_lift": -0.35, "elbow_flex": 0.55, "wrist_flex": 1.15, "wrist_roll": 0.0, "gripper": 0.45}
    holes = meta["screw_holes"]
    (h1, h2), (ydir,) = world_mm(model_xml, zero, "gripper", [[holes[0][0], holes[0][1] + params["plate_t"], holes[0][2]],
                                                             [holes[1][0], holes[1][1] + params["plate_t"], holes[1][2]]])
    P = {"wrist": "wrist:wrist_roll_pitch_so101_v2", "s5": "wrist:sts3215_03a_no_horn_v1", "jaw": "gripper:wrist_roll_follower_so101_v1",
         "s6": "gripper:sts3215_03a_v1", "mjaw": "moving_jaw_so101_v1:moving_jaw_so101_v1", "cam": "camera_mount:wrist_roll_follower_so101_camera_mount",
         "fore": "lower_arm:under_arm_so101_v1", "wrHolder": "lower_arm:motor_holder_so101_wrist_v1", "s4": "lower_arm:sts3215_03a_v1"}
    grip = [P["wrist"], P["s5"], P["jaw"], P["s6"], P["mjaw"]]
    arm_all = ["base:base_so101_v2", "base:base_motor_holder_so101_v1", "base:sts3215_03a_v1", "base:waveshare_mounting_plate_so101_v2",
               "shoulder:sts3215_03a_v1", "shoulder:motor_holder_so101_base_v1", "shoulder:rotation_pitch_so101_v1",
               "upper_arm:sts3215_03a_v1", "upper_arm:upper_arm_so101_v1", P["fore"], P["wrHolder"], P["s4"]] + grip + [P["cam"]]
    beam = {"body": "gripper", "apex": led_tip, "dir": meta["led_axis_dir"], "len": 70.0, "half": 25.0}
    pose6 = lambda p: [p[j] for j in J[1:]]  # renderStep pose order: shoulder, upper_arm, lower_arm, wrist, gripper, jaw
    pz = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0]
    pw = [work["shoulder_pan"], work["shoulder_lift"], work["elbow_flex"], work["wrist_flex"], work["wrist_roll"], work["gripper"]]
    # look from the +y side of the gripper (where the holder sits), 40° round towards the jaw tips
    az = round(math.degrees(math.atan2(ydir[0], -ydir[1]))) - 40
    cam = {"az": az, "el": 26}
    return {
        "setup": {"cameraMount": True, "shift": {"camera_mount": [0, params["plate_t"] / 1000.0, 0]}},
        "parts": [{"key": "forge:holder", "body": "gripper", "stl": "part.stl"}, {"key": "forge:led", "body": "gripper", "stl": "led.stl", "kind": "led"}],
        "steps": [
            {"id": "01-part", **cam, "pose": pz, "solo": ["forge:holder"], "frame": ["forge:holder"], "zoom": 1.15, "hot": ["forge:holder"], "ground": False},
            {"id": "02-holder", **cam, "pose": pz, "frame": grip + [P["cam"]], "zoom": 0.9, "done": grip,
             "add": [{"part": "forge:holder", "dir": ydir, "dist": 0.03}], "screws": [{"label": "2× M3", "at": [{"mm": h1}, {"mm": h2}]}]},
            {"id": "03-camera", **cam, "pose": pz, "frame": grip + [P["cam"]], "zoom": 0.9, "done": grip + ["forge:holder"],
             "add": [{"part": P["cam"], "dir": ydir, "dist": 0.035}], "screws": [{"label": "2× M3 +3 mm", "at": [{"mm": h1}, {"mm": h2}]}]},
            {"id": "04-led", **cam, "pose": pz, "frame": grip + [P["cam"]], "zoom": 0.9, "done": grip + [P["cam"], "forge:holder", "forge:led"],
             "hot": ["forge:holder"], "cones": [beam]},
            {"id": "05-arm", "az": az + 10, "el": 18, "pose": pw, "frame": arm_all, "zoom": 0.7, "done": arm_all + ["forge:holder", "forge:led"],
             "hot": ["forge:holder"], "cones": [beam]},
        ],
        "poses": {"zero": zero, "work": work},
    }


def run_render(job_dir):
    port = free_port()
    srv = subprocess.Popen([sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1"], cwd=ROOT,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(50):
            try:
                socket.create_connection(("127.0.0.1", port), timeout=0.2).close()
                break
            except OSError:
                time.sleep(0.1)
        env = dict(os.environ, BASE=f"http://127.0.0.1:{port}")
        r = subprocess.run(["node", os.path.join(ROOT, "tools", "render-kit", "forge-render.mjs"), job_dir], cwd=ROOT, env=env,
                           capture_output=True, text=True, timeout=900)
        if r.returncode != 0:
            raise RuntimeError("render failed: " + (r.stderr or r.stdout)[-2000:])
        return r.stdout
    finally:
        srv.terminate()
        srv.wait()


def fmt(v, nd=1, lang="en"):
    s = f"{v:.{nd}f}"
    return s.replace(".", ",") if lang == "cs" else s


def fill(template, values):
    def sub(m):
        k = m.group(1)
        if k not in values:
            raise KeyError(f"template placeholder {{{{{k}}}}} has no value")
        return str(values[k])
    out = re.sub(r"\{\{([a-z0-9_]+)\}\}", sub, template)
    return out


# --------------------------------------------------------------------------- pipeline
def run_job(request, job_dir, render=True, brain=None, sweep_grid=None):
    brain = brain or ScriptedBrain()
    os.makedirs(job_dir, exist_ok=True)
    log = Log(job_dir, request, brain)
    J = log.job

    # 1 parse
    log.start("parse")
    spec = brain.parse(request)
    log.done("parse", summary=f"robot {spec['robot']}, accessory {spec['accessory']}", data=spec)

    # 2 mount
    log.start("mount")
    with open(MOUNTS, encoding="utf-8") as f:
        lib = json.load(f)
    mount_id, ranked = brain.choose_mount(spec, lib)
    mount = next(i for i in lib["interfaces"] if i["id"] == mount_id)
    tcp = site_mm(os.path.join(sim.MODEL_DIR, "so101.xml"), "gripperframe")
    params = brain.params(spec, mount, tcp)
    log.done("mount", summary=f"{mount_id}: 2× M3 holes, pitch {mount['hole_pitch_mm']['design_value']} ± {mount['hole_pitch_mm']['uncertainty']} mm (ověřit na tisku)",
             data={"chosen": mount_id, "ranked": ranked, "holes": mount["holes"], "verify": mount["verify"], "tcp_gripper_mm": tcp, "params": params})

    # 3 cad
    log.start("cad")
    src = brain.write_cad(params)
    res = run_cad(src, job_dir)
    if not res["ok"]:
        log.done("cad", status="fail", summary=f"run_cad failed at {res['stage']}", data={"errors": res["errors"]})
        raise RuntimeError(f"run_cad failed: {res['stage']}: {res['errors']}")
    rep = res["report"]
    meta = rep["meta"]
    log.done("cad", summary=f"STEP + STL, {rep['size_mm'][0]:.1f}×{rep['size_mm'][1]:.1f}×{rep['size_mm'][2]:.1f} mm, {rep['mass_print_g']} g PLA, watertight {rep['watertight']}",
             data={"report": {k: v for k, v in rep.items() if k != "meta"}, "source_lines": src.count("\n") + 1,
                   "sandbox": {"stage": res["stage"], "elapsed_s": res["elapsed_s"]}},
             artifacts=["design.py", "part.step", "part.stl", "report.json"])

    # 4 checks
    log.start("checks")
    with open(CATALOG, encoding="utf-8") as f:
        catalog = json.load(f)
    led = brain.pick_led(spec, catalog, params["led_d"])
    led_tip = led_mesh(params, meta, os.path.join(job_dir, "led.stl"))
    pr = checks.printability(os.path.join(job_dir, "part.stl"), rep, meta["print_build_dir"])
    extra = {"part_print_g": rep["mass_print_g"], "led_g": led["pick"]["mass_g_est"], "resistor_heatshrink_g": 0.4, "cable_on_gripper_g": 2.0}
    added_g = round(sum(extra.values()), 2)
    led_c = np.asarray(meta["sleeve_center"])
    com = (np.asarray(rep["center_of_mass_mm"]) * rep["mass_print_g"] + led_c * (added_g - rep["mass_print_g"])) / added_g
    shift = {"camera_mount": [0, params["plate_t"], 0]}
    model_xml = sim.model_with_part(os.path.join(job_dir, "part.stl"), "gripper", added_g / 1000.0, com.tolist(),
                                    os.path.join(job_dir, "model_with_part.xml"), shift)
    base_xml = sim.model_with_part(os.path.join(job_dir, "part.stl"), "gripper", 1e-9, com.tolist(),
                                   os.path.join(job_dir, "model_base.xml"), shift)
    fit = sim.static_fit(model_xml, os.path.join(job_dir, "part.stl"), seat_values=(params["face_y"], params["face_y"] + params["plate_t"]))
    coll = sim.collision_sweep(model_xml, part_stl=os.path.join(job_dir, "part.stl"), grid=sweep_grid)
    torque = sim.torque_check(base_xml, model_xml, {"total": added_g, **extra}, {"C018 12 V (30 kg·cm)": 2.94, "C001 7.4 V (16.5 kg·cm at 6 V)": 1.62},
                              "Static gravity torque, max over a pose grid, MuJoCo model masses (the model includes the wrist camera mount, 12 g). "
                              "Added mass sits ≈40 mm from the wrist-roll axis; dynamic loads (fast moves) not included.")
    chk = {"printability": pr, "static_fit": fit, "collision": coll, "torque": torque, "added_mass_g": added_g,
           "added_mass_com_gripper_mm": [round(float(v), 2) for v in com]}
    with open(os.path.join(job_dir, "checks.json"), "w", encoding="utf-8") as f:
        json.dump(chk, f, indent=1, ensure_ascii=False)
    wf = next(r for r in torque["rows"] if r["joint"] == "wrist_flex")
    ok = pr["ok"] and not fit["interference"] and added_g <= spec["requirements"]["mass_max_g"]
    log.done("checks", status="ok" if ok else "warn",
             summary=(f"wall {pr['min_wall_mm']} mm ≥ {pr['min_wall_required_mm']}; +{added_g} g; wrist_flex static +{wf['delta_pct']} %; "
                      f"sweep {coll['poses_checked']} poses: {'no collision' if coll['collision_free'] else 'contact only where the robot itself is within ' + str(coll['collisions_only_where_robot_clearance_below_mm']) + ' mm'}"),
             data={"printability": {k: pr[k] for k in ("min_wall_mm", "wall_ok", "overhang_area_mm2_over_45deg", "watertight", "ok")},
                   "static_fit": {"min_mm": fit["min_mm"], "interference": fit["interference"]},
                   "collision": {k: coll[k] for k in ("poses", "poses_checked", "poses_excluded_robot_self_contact", "collision_free",
                                                      "collisions_only_where_robot_clearance_below_mm")} | {"exact_min_mm": coll["exact"]["min_mm"], "hull_min_mm": coll["hull"]["min_mm"],
                                                                                                          "exact_poses_penetrating": coll["exact"]["poses_penetrating"]},
                   "torque_wrist_flex": wf, "added_mass_g": added_g},
             artifacts=["checks.json", "model_with_part.xml"])

    # 5 parts + power
    log.start("parts")
    elec = checks.electrical({"name": led["name"], **led["pick"]})
    picks = [led] + catalog["others"]
    used_suppliers = sorted({s["supplier"] for c in picks for s in c["sources"]})
    bom = {
        "$comment": "BOM delta for the SO-101 flashlight extension (forge stage 0). Same component/source structure as data/components/so101.json; not part of the purchase plan. Generated by backend/forge (pipeline --publish).",
        "meta": {"robot": "so101", "extension": SLUG, "generated": catalog["checked"], "status_legend": {
            "verified": "seen on the source page on the checked date", "unverified": "not seen; inferred or page silent", "estimate": "our assumption"},
            "affiliate_links": False, "draft": True, "label_cs": "komunitní návrh – ověřeno pouze v simulaci", "label": "community design – verified in simulation only"},
        "suppliers": {k: catalog["suppliers"][k] for k in used_suppliers},
        "delta": {"base_config": "any", "lines": [
            {"component": led["id"], "qty": 1, "source": "conrad"},
            {"component": "so101.ext.flashlight.resistor", "qty": 1, "source": "electrokit"},
            {"component": "so101.ext.flashlight.usb_cable", "qty": 1, "source": "none"},
            {"component": "so101.ext.flashlight.screws", "qty": 1, "source": "none"},
            {"component": "so101.ext.flashlight.holder", "qty": 1, "source": "self"}],
            "print_grams": rep["mass_print_g"], "added_mass_g": added_g},
        "components": picks,
        "power": {"recommended": elec["recommended"]["id"], "resistor_ohm": elec["recommended"]["circuit"]["r_ohm"],
                  "current_ma": elec["recommended"]["circuit"]["i_ma"], "alternative": elec["alternative"]["id"]},
    }
    with open(os.path.join(job_dir, "bom_delta.json"), "w", encoding="utf-8") as f:
        json.dump(bom, f, indent=1, ensure_ascii=False)
        f.write("\n")
    with open(os.path.join(job_dir, "electrical.json"), "w", encoding="utf-8") as f:
        json.dump(elec, f, indent=1, ensure_ascii=False)
    c = elec["recommended"]["circuit"]
    log.done("parts", summary=f"{led['name']}; USB 5 V + {c['r_ohm']:.0f} Ω → {c['i_ma']['typ']} mA (max {c['i_ma']['max']} mA)",
             data={"led": {"id": led["id"], "name": led["name"], "source": led["sources"][0]["url"], "checked": led["sources"][0]["checked"]},
                   "power": bom["power"], "never": elec["never"]}, artifacts=["bom_delta.json", "electrical.json"])

    # 6 render
    rs = render_spec(model_xml, meta, led_tip, params, coll)
    with open(os.path.join(job_dir, "render_spec.json"), "w", encoding="utf-8") as f:
        json.dump(rs, f, indent=1)
    log.start("render")
    if render:
        out = run_render(job_dir)
        with open(os.path.join(job_dir, "renders", "index.json")) as f:
            files = json.load(f)
        log.done("render", summary=f"{len(rs['steps'])} views × 1200/600 px webp + jpg", data={"views": [s["id"] for s in rs["steps"]], "log": out.strip().splitlines()},
                 artifacts=[f for f in files])
    else:
        log.done("render", status="skipped", summary="skipped (--no-render)", data={"views": [s["id"] for s in rs["steps"]]})

    # 7 guide
    log.start("guide")
    vals = guide_values(spec, mount, params, rep, pr, fit, coll, torque, elec, led, added_g, bom)
    for lang in ("cs", "en"):
        with open(os.path.join(TEMPLATES, f"guide.{lang}.html"), encoding="utf-8") as f:
            html = fill(f.read(), vals[lang])
        with open(os.path.join(job_dir, f"guide.{lang}.html"), "w", encoding="utf-8") as f:
            f.write(html)
    log.done("guide", summary="Rozšíření: baterka na SO-101 (CZ + EN), draft, komunitní návrh – ověřeno pouze v simulaci",
             artifacts=["guide.cs.html", "guide.en.html"])
    J["summary"] = {"ok": True, "part_mass_print_g": rep["mass_print_g"], "added_mass_g": added_g, "min_wall_mm": pr["min_wall_mm"],
                    "collision_free": coll["collision_free"], "collision_exact_min_mm": coll["exact"]["min_mm"],
                    "collisions_only_where_robot_clearance_below_mm": coll["collisions_only_where_robot_clearance_below_mm"],
                    "led": led["name"], "power": elec["recommended"]["name"], "resistor_ohm": c["r_ohm"], "current_ma_typ": c["i_ma"]["typ"],
                    "verify_on_print": vals["en"]["verify_list_plain"].split(" | ")}
    log.save()
    return J


def guide_values(spec, mount, params, rep, pr, fit, coll, torque, elec, led, added_g, bom):
    c = elec["recommended"]["circuit"]
    wf = next(r for r in torque["rows"] if r["joint"] == "wrist_flex")
    wr = next(r for r in torque["rows"] if r["joint"] == "shoulder_lift")
    contact = coll["collisions_only_where_robot_clearance_below_mm"]
    verify_en = [f"hole pitch {params['hole_pitch']} ± {params['slot_extra']} mm and Ø3.2 mm (measured on decimated sim meshes)",
                 f"LED fit: bore {params['led_d'] + params['led_clear']:.2f} mm, collar seat {params['flange_d']} mm",
                 "screw length with the camera mount sandwiched (+3 mm)",
                 f"thinnest wall {pr['min_wall_mm']} mm at the LED collar seat",
                 "cable service loop over the full wrist roll",
                 "clearance to the base in fully folded poses" if contact else "clearance in the folded rest pose"]
    verify_cs = [f"rozteč otvorů {fmt(params['hole_pitch'], 1, 'cs')} ± {fmt(params['slot_extra'], 1, 'cs')} mm a Ø3,2 mm (změřeno na zjednodušených meshích ze simulace)",
                 f"usazení LED: otvor {fmt(params['led_d'] + params['led_clear'], 2, 'cs')} mm, lůžko límce {fmt(params['flange_d'], 1, 'cs')} mm",
                 "délka šroubů, když je pod držákem kamery destička (+3 mm)",
                 f"nejtenčí stěna {fmt(pr['min_wall_mm'], 2, 'cs')} mm u lůžka límce LED",
                 "smyčka kabelu přes celý rozsah rotace zápěstí",
                 "vůle k základně v úplně složených polohách" if contact else "vůle ve složené klidové poloze"]
    common = {
        "mass": rep["mass_print_g"], "added": added_g, "wall": pr["min_wall_mm"], "poses": coll["poses_checked"], "poses_all": coll["poses"],
        "excluded": coll["poses_excluded_robot_self_contact"], "r": f"{c['r_ohm']:.0f}", "i_typ": c["i_ma"]["typ"], "i_max": c["i_ma"]["max"],
        "i_min": c["i_ma"]["min"], "p_r": c["p_resistor_mw_max"], "tilt": f"{params['tilt_deg']:.0f}", "pitch": params["hole_pitch"],
        "slot": params["slot_extra"], "bore": f"{params['led_d'] + params['led_clear']:.2f}", "flange": params["flange_d"],
        "wf_delta": wf["delta_nm"], "wf_pct": wf["delta_pct"], "wf_with": wf["max_static_nm_with"], "wf_stall": wf["pct_of_stall_with"]["C001 7.4 V (16.5 kg·cm at 6 V)"],
        "sl_pct": wr["delta_pct"], "led_name": led["name"], "led_url": led["sources"][0]["url"], "led_checked": led["sources"][0]["checked"],
        "res_url": bom["components"][1]["sources"][0]["url"], "contact": contact if contact is not None else 0,
        "exact_pen": coll["exact"]["poses_penetrating"], "fit_min": fit["min_mm"], "size_x": f"{rep['size_mm'][0]:.0f}",
        "size_y": f"{rep['size_mm'][1]:.0f}", "size_z": f"{rep['size_mm'][2]:.0f}", "img": "{root}img/forge/" + SLUG + "/",
    }
    en = dict(common)
    cs = {k: (fmt(v, 2 if isinstance(v, float) and abs(v) < 10 else 1, "cs") if isinstance(v, float) else v) for k, v in common.items()}
    cs["r"], cs["tilt"], cs["bore"] = common["r"], common["tilt"], fmt(params["led_d"] + params["led_clear"], 2, "cs")
    cs["pitch"], cs["slot"] = fmt(params["hole_pitch"], 1, "cs"), fmt(params["slot_extra"], 1, "cs")
    en["pitch"], en["slot"] = fmt(params["hole_pitch"], 1), fmt(params["slot_extra"], 1)
    en["wf_delta"], cs["wf_delta"] = fmt(wf["delta_nm"], 4), fmt(wf["delta_nm"], 4, "cs")
    en["wf_pct"], cs["wf_pct"] = fmt(wf["delta_pct"], 1), fmt(wf["delta_pct"], 1, "cs")
    en["sl_pct"], cs["sl_pct"] = fmt(wr["delta_pct"], 1), fmt(wr["delta_pct"], 1, "cs")
    en["wf_with"], cs["wf_with"] = fmt(wf["max_static_nm_with"], 3), fmt(wf["max_static_nm_with"], 3, "cs")
    en["collision_sentence"] = (f"In {coll['poses_checked']} reachable poses the holder never touches another link. "
                                if coll["collision_free"] else
                                f"Across {coll['poses_checked']} poses the holder touches the base or the driver-board plate in {coll['exact']['poses_penetrating']} fully folded poses, all of them poses where the arm's own jaw is already within {contact} mm of the base. Keep the folded rest pose a few degrees open or check it on the real arm. ")
    cs["collision_sentence"] = (f"V {coll['poses_checked']} dosažitelných polohách se držák nedotkne žádného jiného článku. "
                                if coll["collision_free"] else
                                f"Ze {coll['poses_checked']} poloh se držák v {coll['exact']['poses_penetrating']} úplně složených polohách dotkne základny nebo desky s elektronikou; ve všech je už samotná čelist robota do {fmt(contact, 1, 'cs')} mm od základny. Klidovou polohu nechte o pár stupňů otevřenější nebo ji ověřte na skutečném rameni. ")
    en["verify_list"] = "".join(f"<li>{v}</li>" for v in verify_en)
    cs["verify_list"] = "".join(f"<li>{v}</li>" for v in verify_cs)
    en["verify_list_plain"] = " | ".join(verify_en)
    cs["verify_list_plain"] = " | ".join(verify_cs)
    return {"cs": cs, "en": en}


def publish(job_dir, scratch=None):
    """Copy a finished job into the site (draft pages, images, lab replay, BOM delta, example files)."""
    with open(os.path.join(job_dir, "job.json"), encoding="utf-8") as f:
        J = json.load(f)
    os.makedirs(PUBLISH["renders"], exist_ok=True)
    rdir = os.path.join(job_dir, "renders")
    if os.path.isdir(rdir):
        for f in sorted(os.listdir(rdir)):
            if f.endswith((".webp", ".jpg")):
                shutil.copyfile(os.path.join(rdir, f), os.path.join(PUBLISH["renders"], f))
    shutil.copyfile(os.path.join(job_dir, "guide.cs.html"), PUBLISH["guide_cs"])
    shutil.copyfile(os.path.join(job_dir, "guide.en.html"), PUBLISH["guide_en"])
    os.makedirs(os.path.dirname(PUBLISH["lab"]), exist_ok=True)
    lab = {k: v for k, v in J.items()}
    lab["images"] = "img/forge/" + SLUG + "/"
    with open(PUBLISH["lab"], "w", encoding="utf-8") as f:
        json.dump(lab, f, indent=1, ensure_ascii=False)
        f.write("\n")
    os.makedirs(os.path.dirname(PUBLISH["bom"]), exist_ok=True)
    shutil.copyfile(os.path.join(job_dir, "bom_delta.json"), PUBLISH["bom"])
    os.makedirs(PUBLISH["example"], exist_ok=True)
    for f in ("design.py", "part.step", "part.stl", "led.stl", "report.json", "checks.json", "electrical.json", "render_spec.json"):
        shutil.copyfile(os.path.join(job_dir, f), os.path.join(PUBLISH["example"], f))
    if scratch:
        os.makedirs(scratch, exist_ok=True)
        for f in os.listdir(job_dir):
            src = os.path.join(job_dir, f)
            if os.path.isfile(src):
                shutil.copyfile(src, os.path.join(scratch, f))
        if os.path.isdir(rdir):
            shutil.copytree(rdir, os.path.join(scratch, "renders"), dirs_exist_ok=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("request")
    ap.add_argument("--job", required=True)
    ap.add_argument("--no-render", action="store_true")
    ap.add_argument("--publish", action="store_true")
    ap.add_argument("--scratch")
    a = ap.parse_args()
    J = run_job(a.request, a.job, render=not a.no_render)
    print(json.dumps(J["summary"], indent=1, ensure_ascii=False))
    if a.publish:
        publish(a.job, a.scratch)
        print("published")


if __name__ == "__main__":
    main()
