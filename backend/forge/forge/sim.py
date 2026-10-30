"""MuJoCo checks for an add-on part: collision sweep over the joint range and static servo torque.

The part (STL in the attach body's frame, mm) is added as a body to a COPY of sim/so101/model/so101.xml
(the site's model is never modified). Collision distances use mj_geomDistance between the part and
every geom of the other moving links (visual meshes and collision primitives). MuJoCo measures mesh
distances on convex hulls, so the sweep is conservative (hull of a sleeve-on-a-plate part is bigger
than the part). Poses where the hull distance is below the margin are re-checked on the real meshes
with trimesh (part surface samples -> other link's visual mesh; other mesh vertices inside the part).
"""
import itertools
import math
import os
import re

import mujoco
import numpy as np
import trimesh

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
MODEL_DIR = os.path.join(ROOT, "sim/so101/model")
G = 9.81
SOLID_TYPES = {int(t) for t in (mujoco.mjtGeom.mjGEOM_MESH, mujoco.mjtGeom.mjGEOM_BOX, mujoco.mjtGeom.mjGEOM_CYLINDER,
                                mujoco.mjtGeom.mjGEOM_CAPSULE, mujoco.mjtGeom.mjGEOM_SPHERE)}
MESH = int(mujoco.mjtGeom.mjGEOM_MESH)
CONTACT_MM = 0.2  # closer than this on the real meshes counts as a collision (surfaces cross or touch)


def model_with_part(stl_path, attach_body, added_mass_kg, com_mm, out_xml, shift_bodies=None):
    """Write a copy of so101.xml with the part as body `forge_part` under `attach_body`.
    shift_bodies: {"camera_mount": [0, 3, 0]} moves a body (mm) that the part is sandwiched under."""
    with open(os.path.join(MODEL_DIR, "so101.xml"), encoding="utf-8") as f:
        xml = f.read()
    xml = xml.replace('meshdir="assets"', f'meshdir="{os.path.join(MODEL_DIR, "assets")}"', 1)
    xml = xml.replace("</asset>", f'  <mesh name="forge_part" file="{os.path.abspath(stl_path)}" scale="0.001 0.001 0.001"/>\n  </asset>', 1)
    com = " ".join(f"{v / 1000.0:.6f}" for v in com_mm)
    body = (f'<body name="forge_part">\n'
            f'  <inertial pos="{com}" mass="{added_mass_kg:.6f}" diaginertia="2e-7 2e-7 2e-7"/>\n'
            f'  <geom name="forge_part" type="mesh" mesh="forge_part" contype="0" conaffinity="0" group="1" rgba="0.91 0.27 0.12 1"/>\n'
            f'</body>\n')
    for bn, off in (shift_bodies or {}).items():
        mm = re.search(rf'<body name="{re.escape(bn)}"( pos="[^"]*")?>', xml)
        if not mm or mm.group(1):
            raise ValueError(f"cannot shift body {bn}")
        xml = xml.replace(mm.group(0), f'<body name="{bn}" pos="{off[0] / 1000:.4f} {off[1] / 1000:.4f} {off[2] / 1000:.4f}">', 1)
    m = re.search(rf'<body name="{re.escape(attach_body)}"[^>]*>', xml)
    if not m:
        raise ValueError(f"body {attach_body} not in model")
    # insert after the joint line(s) of the attach body: right after its opening tag is fine for MJCF
    xml = xml[:m.end()] + "\n" + body + xml[m.end():]
    with open(out_xml, "w", encoding="utf-8") as f:
        f.write(xml)
    return out_xml


def _ancestors(m, b):
    out = set()
    while b > 0:
        out.add(b)
        b = m.body_parentid[b]
    return out


def _welded_group(m, b):
    """Bodies rigidly attached to b (no joint in between), including b."""
    root = b
    while root > 0 and m.body_jntnum[root] == 0:
        root = m.body_parentid[root]
    return {i for i in range(m.nbody) if _weld_root(m, i) == root}


def _weld_root(m, b):
    while b > 0 and m.body_jntnum[b] == 0:
        b = m.body_parentid[b]
    return b


def joint_grid(m, spec):
    names, values = [], []
    for jn, n in spec.items():
        j = m.joint(jn)
        lo, hi = j.range
        names.append(jn)
        values.append(np.linspace(lo, hi, n))
    return names, values


def collision_sweep(xml, part_geom="forge_part", grid=None, margin_mm=2.0, refine=12, part_stl=None):
    """Sweep the joint grid. A pose counts only if the robot itself is clear there: the hulls of the
    part's own link group (gripper + camera mount) must not touch any non-adjacent link (poses where the
    folded arm runs into its own base are excluded, the real arm cannot reach them either). In the
    remaining poses the part's hull distance to every other link (adjacent links included: moving jaw,
    wrist) is recorded; the closest poses are re-checked on the real meshes."""
    m = mujoco.MjModel.from_xml_path(xml)
    d = mujoco.MjData(m)
    pg = m.geom(part_geom).id
    pb = m.geom_bodyid[pg]
    same = _welded_group(m, pb)
    root = _weld_root(m, pb)
    adjacent = {int(m.body_parentid[root])} | {i for i in range(m.nbody) if m.body_parentid[i] in same and i not in same}
    vis = [g for g in range(m.ngeom) if int(m.geom_type[g]) == MESH and int(m.geom_group[g]) == 2]
    others = [g for g in vis if m.geom_bodyid[g] not in same]
    own = [g for g in vis if m.geom_bodyid[g] in same]
    own_vs = [g for g in others if m.geom_bodyid[g] not in adjacent]
    grid = grid or {"shoulder_lift": 5, "elbow_flex": 5, "wrist_flex": 11, "wrist_roll": 9, "gripper": 4}
    names, values = joint_grid(m, grid)
    qadr = [m.jnt_qposadr[m.joint(n).id] for n in names]
    fromto = np.zeros(6)
    per_body = {}
    worst = []
    n_pose = excluded = 0
    for combo in itertools.product(*values):
        d.qpos[:] = 0
        for a, v in zip(qadr, combo):
            d.qpos[a] = v
        mujoco.mj_kinematics(m, d)
        n_pose += 1
        own_min = min(mujoco.mj_geomDistance(m, d, a, b, 0.05, fromto) for a in own for b in own_vs)
        if own_min < 0:
            excluded += 1
            continue
        pose_min = (1e9, None)
        for g in others:
            dist = mujoco.mj_geomDistance(m, d, pg, g, 0.05, fromto)
            bname = m.body(m.geom_bodyid[g]).name
            if bname not in per_body or dist * 1000.0 < per_body[bname]["min_hull_mm"]:
                per_body[bname] = {"min_hull_mm": round(dist * 1000.0, 2), "pose": {n: round(float(v), 3) for n, v in zip(names, combo)},
                                   "mesh": m.mesh(m.geom_dataid[g]).name}
            if dist < pose_min[0]:
                pose_min = (dist, g)
        worst.append((pose_min[0], combo, pose_min[1], own_min))
    worst.sort(key=lambda w: w[0])
    hull_hits = sum(1 for w in worst if w[0] < 0)
    hull_near = sum(1 for w in worst if w[0] * 1000 < margin_mm)
    refined = []
    if part_stl and worst:
        part = trimesh.load_mesh(part_stl, process=True)
        part.apply_scale(0.001)
        samples, _ = trimesh.sample.sample_surface(part, 1200, seed=3)
        cand = [w for w in worst if w[0] * 1000 < margin_mm][:max(refine, 40)] or worst[:refine]
        for dist, combo, g, own_min in cand:
            r = _exact(m, d, names, qadr, combo, pb, same, part, samples)
            r["robot_own_hull_clearance_mm"] = round(own_min * 1000.0, 2)
            r["part_hull_mm"] = round(dist * 1000.0, 2)
            refined.append(r)
    exact_min = min((r["min_mm"] for r in refined), default=None)
    exact_hits = sum(1 for r in refined if r["penetrating"])
    hit_own = [r["robot_own_hull_clearance_mm"] for r in refined if r["penetrating"]]
    return {
        "joints_swept": {n: [round(float(v[0]), 3), round(float(v[-1]), 3), len(v)] for n, v in zip(names, values)},
        "other_joints": "shoulder_pan = 0 (it turns the whole arm and does not change link-to-link distances)",
        "poses": n_pose,
        "poses_excluded_robot_self_contact": excluded,
        "poses_checked": n_pose - excluded,
        "hull": {"min_mm": round(worst[0][0] * 1000.0, 2) if worst else None, "poses_penetrating": hull_hits,
                 "poses_below_margin": hull_near, "margin_mm": margin_mm, "per_body": per_body,
                 "note": "convex hulls: conservative (reads closer than the real parts)"},
        "exact": {"poses_checked": len(refined), "min_mm": exact_min, "poses_penetrating": exact_hits, "details": refined,
                  "note": "the closest hull poses re-checked on the real (decimated) meshes"},
        "collision_free": (exact_hits == 0) if refined else (hull_hits == 0),
        "collisions_only_where_robot_clearance_below_mm": round(max(hit_own), 2) if hit_own else None,
    }


def _exact(m, d, names, qadr, combo, pb, same, part, samples):
    d.qpos[:] = 0
    for a, v in zip(qadr, combo):
        d.qpos[a] = v
    mujoco.mj_kinematics(m, d)
    Rp, tp = d.xmat[pb].reshape(3, 3), d.xpos[pb]
    world_pts = samples @ Rp.T + tp
    best, pen, best_body = 1e9, False, None
    for g in range(m.ngeom):
        b = m.geom_bodyid[g]
        if b in same or b == 0 or int(m.geom_type[g]) != MESH or int(m.geom_group[g]) != 2:
            continue
        mid = m.geom_dataid[g]
        va, vn, fa, fn = m.mesh_vertadr[mid], m.mesh_vertnum[mid], m.mesh_faceadr[mid], m.mesh_facenum[mid]
        Rg, tg = d.geom_xmat[g].reshape(3, 3), d.geom_xpos[g]
        V = m.mesh_vert[va:va + vn] @ Rg.T + tg
        other = trimesh.Trimesh(V, m.mesh_face[fa:fa + fn], process=False)
        # cheap reject: bounding boxes more than 20 mm apart
        lo, hi = world_pts.min(0), world_pts.max(0)
        if np.any(V.min(0) > hi + 0.02) or np.any(V.max(0) < lo - 0.02):
            continue
        _, dist, _ = trimesh.proximity.closest_point(other, world_pts)
        dm = float(dist.min())
        # other link's vertices inside the (watertight) part -> penetration
        local = (V - tp) @ Rp
        near = local[np.all((local > part.bounds[0] - 1e-3) & (local < part.bounds[1] + 1e-3), axis=1)]
        inside = bool(len(near) and part.contains(near).any())
        if inside:
            pen = True
        if dm < best:
            best, best_body = dm, m.body(b).name
    return {"pose": {n: round(float(v), 3) for n, v in zip(names, combo)}, "min_mm": round(best * 1000.0, 2),
            "closest_body": best_body, "penetrating": pen or best * 1000.0 < CONTACT_MM}


def static_fit(xml, part_stl, seat_axis=1, seat_values=(24.0,), seat_tol=0.3, part_geom="forge_part", depth_tol=0.2):
    """Part vs the meshes on its own link group (fixed jaw, servo, camera mount) at the assembly pose.
    Samples lying on the seat face (the plane the part is screwed against) are ignored for the
    distance; vertices of the other meshes inside the part are reported as interference."""
    m = mujoco.MjModel.from_xml_path(xml)
    d = mujoco.MjData(m)
    mujoco.mj_kinematics(m, d)
    pg = m.geom(part_geom).id
    pb = m.geom_bodyid[pg]
    same = _welded_group(m, pb)
    part = trimesh.load_mesh(part_stl, process=True)
    pts, _ = trimesh.sample.sample_surface(part, 4000, seed=5)
    off_seat = pts[np.all([np.abs(pts[:, seat_axis] - v) > seat_tol for v in seat_values], axis=0)]
    Rp, tp = d.xmat[pb].reshape(3, 3), d.xpos[pb]
    out = []
    for g in range(m.ngeom):
        if m.geom_bodyid[g] not in same or g == pg or int(m.geom_type[g]) != MESH or int(m.geom_group[g]) != 2:
            continue
        mid = m.geom_dataid[g]
        va, vn, fa, fn = m.mesh_vertadr[mid], m.mesh_vertnum[mid], m.mesh_faceadr[mid], m.mesh_facenum[mid]
        V = m.mesh_vert[va:va + vn] @ d.geom_xmat[g].reshape(3, 3).T + d.geom_xpos[g]
        local = (V - tp) @ Rp * 1000.0          # into the part frame (mm)
        other = trimesh.Trimesh(local, m.mesh_face[fa:fa + fn], process=False)
        _, dist, _ = trimesh.proximity.closest_point(other, off_seat)
        near = local[np.all((local > part.bounds[0] - 0.5) & (local < part.bounds[1] + 0.5), axis=1)]
        depth = trimesh.proximity.signed_distance(part, near) if len(near) else np.zeros(0)
        inside = int((depth > depth_tol).sum())
        out.append({"mesh": m.mesh(mid).name, "min_mm": round(float(dist.min()), 2), "vertices_inside_part": inside,
                    "max_depth_mm": round(float(depth.max()), 2) if len(depth) else 0.0,
                    "deepest_at": [round(float(v), 1) for v in near[int(np.argmax(depth))]] if len(depth) and depth.max() > depth_tol else None})
    return {"meshes": out, "min_mm": min(o["min_mm"] for o in out), "interference": any(o["vertices_inside_part"] for o in out),
            "note": f"part samples on the seat planes (axis {seat_axis} = {list(seat_values)} ± {seat_tol} mm) are not counted; a vertex counts as inside when deeper than {depth_tol} mm"}


def gravity_torques(xml, grid=None):
    """Max |gravity torque| per joint over a pose grid (N·m), static (qvel = qacc = 0)."""
    m = mujoco.MjModel.from_xml_path(xml)
    d = mujoco.MjData(m)
    grid = grid or {"shoulder_lift": 9, "elbow_flex": 9, "wrist_flex": 9, "wrist_roll": 5}
    names, values = joint_grid(m, grid)
    qadr = [m.jnt_qposadr[m.joint(n).id] for n in names]
    joints = ["shoulder_lift", "elbow_flex", "wrist_flex", "wrist_roll", "gripper"]
    dadr = {j: m.jnt_dofadr[m.joint(j).id] for j in joints}
    best = {j: 0.0 for j in joints}
    for combo in itertools.product(*values):
        d.qpos[:] = 0
        for a, v in zip(qadr, combo):
            d.qpos[a] = v
        d.qvel[:] = 0
        mujoco.mj_forward(m, d)
        for j in joints:
            best[j] = max(best[j], abs(float(d.qfrc_bias[dadr[j]])))
    return {j: round(v, 4) for j, v in best.items()}


def torque_check(base_xml, part_xml, added_mass_g, stall_nm, lever_note):
    base = gravity_torques(base_xml)
    withp = gravity_torques(part_xml)
    rows = []
    for j in base:
        delta = withp[j] - base[j]
        rows.append({"joint": j, "max_static_nm_without": base[j], "max_static_nm_with": withp[j],
                     "delta_nm": round(delta, 4), "delta_pct": round(100.0 * delta / base[j], 2) if base[j] > 1e-6 else None,
                     "pct_of_stall_with": {k: round(100.0 * withp[j] / v, 1) for k, v in stall_nm.items()}})
    return {"added_mass_g": added_mass_g, "stall_nm": stall_nm, "rows": rows, "note": lever_note}
