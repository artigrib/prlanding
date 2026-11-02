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


# --------------------------------------------------------------------------- mount-library driven fit checks
# Both checks are robot-agnostic: everything robot-specific (body, mating plane, tolerances, aim targets) comes
# from the mount library entry (forge/mounts/<robot>.json), so a new platform only needs its own library.

def _body_meshes_in_frame(m, d, body_id, exclude_geoms=()):
    """Visual meshes (group 2) of the bodies welded to body_id, in body_id's frame (mm)."""
    same = _welded_group(m, body_id)
    Rb, tb = d.xmat[body_id].reshape(3, 3), d.xpos[body_id]
    out = []
    for g in range(m.ngeom):
        if m.geom_bodyid[g] not in same or g in exclude_geoms or int(m.geom_type[g]) != MESH or int(m.geom_group[g]) != 2:
            continue
        mid = m.geom_dataid[g]
        va, vn, fa, fn = m.mesh_vertadr[mid], m.mesh_vertnum[mid], m.mesh_faceadr[mid], m.mesh_facenum[mid]
        V = m.mesh_vert[va:va + vn] @ d.geom_xmat[g].reshape(3, 3).T + d.geom_xpos[g]
        out.append((m.mesh(mid).name, trimesh.Trimesh((V - tb) @ Rb * 1000.0, m.mesh_face[fa:fa + fn], process=False)))
    return out


def support_check(xml, part_stl, interface, part_geom="forge_part", n_samples=20000, seed=7):
    """How well the add-on sits on its mount. Part surface samples whose normal faces the host
    (n·plane_normal < -0.5) and that lie at or below the mount plane (+ band_mm) form the seat; the
    contact ratio is the share of that seat area within contact_tol_mm of the host body's meshes.
    A plate hanging over the edge of the flat face, or a sleeve held off the surface, lowers the ratio."""
    sup = interface.get("support") or {}
    tol, band, need = sup.get("contact_tol_mm", 0.5), sup.get("band_mm", 0.5), sup.get("min_contact_ratio", 0.8)
    m = mujoco.MjModel.from_xml_path(xml)
    d = mujoco.MjData(m)
    mujoco.mj_kinematics(m, d)
    host_body = m.body(interface["body"]).id
    pg = m.geom(part_geom).id
    host = [t for name, t in _body_meshes_in_frame(m, d, host_body, exclude_geoms=(pg,))]
    host = trimesh.util.concatenate(host)
    part = trimesh.load_mesh(part_stl, process=True)
    pts, fi = trimesh.sample.sample_surface_even(part, n_samples, seed=seed)
    n = np.asarray(interface["plane"]["normal"], float)
    p0 = np.asarray(interface["plane"]["point"], float)
    facing = part.face_normals[fi] @ n < -0.5
    height = (pts - p0) @ n
    seat = facing & (height <= band)
    if not seat.any():
        return {"seat_area_mm2": 0.0, "contact_ratio": 0.0, "ok": False, "note": "no part surface faces the mount"}
    _, dist, _ = trimesh.proximity.closest_point(host, pts[seat])
    area_per = part.area / len(pts)
    ratio = float((dist <= tol).mean())
    sp = pts[seat]
    fb = interface.get("face_bounds")
    out_of_face = None
    if fb:
        ax = fb["axes"]
        inside = np.all([(sp[:, a] >= lo - tol) & (sp[:, a] <= hi + tol) for a, lo, hi in zip(ax, fb["min"], fb["max"])], axis=0)
        out_of_face = round(float(1.0 - inside.mean()), 3)
    worst = sp[np.argmax(dist)]
    return {"interface": interface["id"], "seat_area_mm2": round(float(seat.sum() * area_per), 1),
            "contact_area_mm2": round(float((dist <= tol).sum() * area_per), 1), "contact_ratio": round(ratio, 3),
            "min_contact_ratio": need, "contact_tol_mm": tol, "max_gap_mm": round(float(dist.max()), 2),
            "max_gap_at": [round(float(v), 1) for v in worst], "seat_share_outside_flat_face": out_of_face,
            "ok": ratio >= need,
            "note": "seat = part surface facing the host at or below the mount plane; contact = within contact_tol_mm of the host meshes"}


def aim_check(xml, axis, target, attach_body, part_geom="forge_part", reach_mm=None):
    """Emitter/sensor axis vs a library target site. axis = {"origin": [mm], "dir": [unit]} in the attach
    body's frame. Miss = perpendicular distance of the target from the axis (target behind the emitter
    counts as a miss of the full distance). Occlusion: the segment origin->closest point must not pass
    through the robot's own meshes (welded to the attach body) or the part."""
    m = mujoco.MjModel.from_xml_path(xml)
    d = mujoco.MjData(m)
    mujoco.mj_kinematics(m, d)
    b = m.body(attach_body).id
    tb_body = m.body(target["body"]).id
    s = m.site(target["site"]).id
    Rb, tb = d.xmat[b].reshape(3, 3), d.xpos[b]
    tgt = (d.site_xpos[s] - tb) @ Rb * 1000.0
    o = np.asarray(axis["origin"], float)
    u = np.asarray(axis["dir"], float)
    u = u / np.linalg.norm(u)
    t = float((tgt - o) @ u)
    miss = float(np.linalg.norm(tgt - (o + max(t, 0.0) * u)))
    blocked_by = []
    if t > 0:
        for name, mm in _body_meshes_in_frame(m, d, b):
            loc, _, _ = mm.ray.intersects_location([o + u * 0.5], [u])
            if len(loc) and np.min(np.linalg.norm(loc - o, axis=1)) < t:
                blocked_by.append(name)
    tol = target.get("aim_tol_mm", 5.0)
    return {"target": target["id"], "target_mm": [round(float(v), 2) for v in tgt], "origin_mm": [round(float(v), 2) for v in o],
            "dir": [round(float(v), 4) for v in u], "distance_along_axis_mm": round(t, 1), "miss_mm": round(miss, 2),
            "aim_tol_mm": tol, "blocked_by": sorted(set(blocked_by)), "same_body": tb_body == b,
            "ok": t > 0 and miss <= tol and not blocked_by}
