"""MuJoCo checks for add-ons on floating-base robots (quadrupeds; device kind with base.floating=true).

The SO-101 checks in sim.py assume a fixed base and one kinematic chain. Here the part is attached to the
floating base body and checked with the robot held in named poses from device.json:

  leg_sweep      each leg is swept over its own joint grid while the other legs stay in the pose; the part's
                 convex hull is tested against every leg mesh (mj_geomDistance, conservative), close poses are
                 re-checked on the real meshes (trimesh).
  payload_check  total mass, CoM shift, static stability margin (CoM inside the feet polygon) and the joint
                 torques needed to hold the pose with the extra mass (foot forces from static balance), compared
                 with the motor limits in the MJCF (actuator ctrlrange, gear 1).

Everything is static: no gait dynamics, no impacts.
"""
import itertools

import mujoco
import numpy as np
import trimesh

from . import sim
from .device import load_device

G = 9.81


_CACHE = {}


def _model(xml):
    """Compiling the Go2 meshes is the slow part; reuse models per (path, mtime). Fresh MjData each call."""
    import os
    key = (os.path.realpath(xml), os.path.getmtime(xml))
    m = _CACHE.get(key)
    if m is None:
        if len(_CACHE) > 8:
            _CACHE.clear()
        m = _CACHE[key] = mujoco.MjModel.from_xml_path(xml)
    return m, mujoco.MjData(m)


def set_pose(m, d, pose, base_z=0.5):
    """qpos0 for the free joint (base level at base_z m), joints from the pose dict."""
    d.qpos[:] = m.qpos0
    for j in range(m.njnt):
        if m.jnt_type[j] == mujoco.mjtJoint.mjJNT_FREE:
            a = m.jnt_qposadr[j]
            d.qpos[a:a + 7] = [0, 0, base_z, 1, 0, 0, 0]
    for jn, v in pose.items():
        d.qpos[m.jnt_qposadr[m.joint(jn).id]] = v
    d.qvel[:] = 0
    mujoco.mj_forward(m, d)


def _leg_geoms(m, dev):
    base = m.body(dev.spec["base"]["body"]).id
    return [g for g in range(m.ngeom) if int(m.geom_type[g]) == sim.MESH and int(m.geom_group[g]) == 2
            and m.geom_bodyid[g] != base and m.body_rootid[m.geom_bodyid[g]] == m.body_rootid[base]]


def _exact_mm(m, d, part_g, g, part_pts, part_mesh):
    """Real-mesh distance (mm) between the part and one leg mesh in the current pose; <0 = penetrating."""
    mid = m.geom_dataid[g]
    va, vn, fa, fn = m.mesh_vertadr[mid], m.mesh_vertnum[mid], m.mesh_faceadr[mid], m.mesh_facenum[mid]
    V = m.mesh_vert[va:va + vn] @ d.geom_xmat[g].reshape(3, 3).T + d.geom_xpos[g]
    pb = m.geom_bodyid[part_g]
    local = (V - d.xpos[pb]) @ d.xmat[pb].reshape(3, 3) * 1000.0
    other = trimesh.Trimesh(local, m.mesh_face[fa:fa + fn], process=False)
    _, dist, _ = trimesh.proximity.closest_point(other, part_pts)
    near = local[np.all((local > part_mesh.bounds[0] - 1) & (local < part_mesh.bounds[1] + 1), axis=1)]
    depth = trimesh.proximity.signed_distance(part_mesh, near) if len(near) else np.zeros(0)
    if len(depth) and depth.max() > 0.2:
        return -float(depth.max())
    return float(dist.min())


def leg_sweep(xml, part_stl, device=None, grid=None, poses=None, margin_mm=None, part_geom="forge_part", max_exact=60):
    dev = device or load_device()
    m, d = _model(xml)
    pg = m.geom(part_geom).id
    legs_geoms = _leg_geoms(m, dev)
    grid = grid or dev.grid("quick")
    poses = poses or dev.check("collision", "poses") or ["stand"]
    margin = (margin_mm if margin_mm is not None else dev.check("collision", "margin_mm", 5.0)) / 1000.0
    part_mesh = trimesh.load_mesh(part_stl, process=True)
    part_pts, _ = trimesh.sample.sample_surface(part_mesh, 3000, seed=5)
    fromto = np.zeros(6)
    close, n, hull_min = [], 0, 1e9
    for pname in poses:
        base_pose = dev.pose(pname)
        for leg, joints in dev.spec["legs"].items():
            vals = []
            for jn in joints:
                lo, hi = m.joint(jn).range
                vals.append(np.linspace(lo, hi, grid.get(jn, 1)) if grid.get(jn, 1) > 1 else [base_pose.get(jn, 0.0)])
            for combo in itertools.product(*vals):
                pose = dict(base_pose, **dict(zip(joints, combo)))
                set_pose(m, d, pose)
                n += 1
                best, bg = 1e9, None
                for g in legs_geoms:
                    dist = mujoco.mj_geomDistance(m, d, pg, g, margin + 0.05, fromto)
                    if dist < best:
                        best, bg = dist, g
                hull_min = min(hull_min, best)
                if best < margin:
                    close.append((best, pname, leg, {k: round(float(v), 3) for k, v in pose.items()}, bg))
    close.sort(key=lambda r: r[0])
    details = []
    for best, pname, leg, pose, bg in close[:max_exact]:
        set_pose(m, d, pose)
        mm = min(_exact_mm(m, d, pg, g, part_pts, part_mesh) for g in legs_geoms if m.geom_bodyid[g] == m.geom_bodyid[bg]
                 or m.body_parentid[m.geom_bodyid[g]] == m.body_parentid[m.geom_bodyid[bg]])
        details.append({"pose": pname, "leg": leg, "joints": pose, "hull_mm": round(best * 1000, 2), "exact_mm": round(mm, 2),
                        "body": m.body(m.geom_bodyid[bg]).name})
    exact_min = min((x["exact_mm"] for x in details), default=None)
    pen = [x for x in details if x["exact_mm"] < sim.CONTACT_MM]
    return {"poses": list(poses), "poses_checked": n, "hull_min_mm": round(hull_min * 1000, 2), "margin_mm": round(margin * 1000, 2),
            "poses_within_margin": len(close), "exact_checked": len(details), "exact_min_mm": exact_min,
            "poses_penetrating": len(pen), "collision_free": not pen,
            "closest": sorted(details, key=lambda x: x["exact_mm"])[:5],
            "note": "per-leg joint grid around each named pose; hull distance first (conservative), closest poses re-checked on meshes"}


def _torque_limits(m):
    out = {}
    for a in range(m.nu):
        if m.actuator_trntype[a] == mujoco.mjtTrn.mjTRN_JOINT:
            j = m.actuator_trnid[a, 0]
            lim = float(max(abs(m.actuator_ctrlrange[a, 0]), abs(m.actuator_ctrlrange[a, 1])) * abs(m.actuator_gear[a, 0]))
            out[m.joint(j).name] = lim
    return out


def _support_margin(c, feet):
    pts = np.asarray(feet)[:, :2]
    hull = pts[_hull_idx(pts)]
    mins = []
    for i in range(len(hull)):
        a, b = hull[i], hull[(i + 1) % len(hull)]
        e = b - a
        nrm = np.array([e[1], -e[0]]) / np.linalg.norm(e)
        mins.append(float(np.dot(c - a, -nrm)))
    return min(mins)  # >0 inside (counter-clockwise hull)


def _hull_idx(p):
    idx = sorted(range(len(p)), key=lambda i: (p[i][0], p[i][1]))
    def cross(o, a, b):
        return (p[a][0] - p[o][0]) * (p[b][1] - p[o][1]) - (p[a][1] - p[o][1]) * (p[b][0] - p[o][0])
    lo, up = [], []
    for i in idx:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], i) <= 0:
            lo.pop()
        lo.append(i)
    for i in reversed(idx):
        while len(up) >= 2 and cross(up[-2], up[-1], i) <= 0:
            up.pop()
        up.append(i)
    return lo[:-1] + up[:-1]


def static_state(xml, pose, device=None):
    """Mass, CoM, feet, stability margin and holding torques for one pose (feet on the ground, static)."""
    dev = device or load_device()
    m, d = _model(xml)
    set_pose(m, d, pose)
    base = m.body(dev.spec["base"]["body"]).id
    mass = float(m.body_subtreemass[base])
    com = d.subtree_com[base].copy()
    feet = {leg: d.geom_xpos[m.geom(g).id].copy() for leg, g in dev.spec["feet"].items()}
    P = np.array(list(feet.values()))
    # vertical foot forces: sum = m g, moments about the CoM = 0 (x and y); minimum-norm solution
    A = np.vstack([np.ones(len(P)), P[:, 0] - com[0], P[:, 1] - com[1]])
    f, *_ = np.linalg.lstsq(A, np.array([mass * G, 0.0, 0.0]), rcond=None)
    tau = d.qfrc_bias.copy()  # gravity on the links (qvel = 0)
    jac = np.zeros((3, m.nv))
    for (leg, gname), fz in zip(dev.spec["feet"].items(), f):
        gid = m.geom(gname).id
        mujoco.mj_jacGeom(m, d, jac, None, gid)
        tau -= jac.T @ np.array([0.0, 0.0, fz])
    joints = {}
    for jn in dev.torque_joints:
        j = m.joint(jn).id
        joints[jn] = round(abs(float(tau[m.jnt_dofadr[j]])), 3)
    return {"mass_kg": round(mass, 4), "com_mm": [round(float(v) * 1000, 1) for v in com],
            "foot_forces_n": {leg: round(float(v), 2) for leg, v in zip(dev.spec["feet"], f)},
            "stability_margin_mm": round(_support_margin(com[:2], P) * 1000, 1),
            "torque_nm": joints, "limits_nm": _torque_limits(m)}


def payload_check(base_xml, part_xml, added_mass_g, device=None, poses=None):
    dev = device or load_device()
    poses = poses or dev.check("payload", "poses") or ["stand"]
    max_shift = dev.check("payload", "max_com_shift_mm", 20.0)
    min_margin = dev.check("payload", "min_stability_margin_mm", 30.0)
    max_pct = dev.check("payload", "max_torque_pct_of_limit", 80.0)
    pay = dev.spec.get("payload") or {}
    rows, worst = [], []
    for p in poses:
        a, b = static_state(base_xml, dev.pose(p), dev), static_state(part_xml, dev.pose(p), dev)
        shift = float(np.hypot(b["com_mm"][0] - a["com_mm"][0], b["com_mm"][1] - a["com_mm"][1]))
        tj = []
        for jn, t in b["torque_nm"].items():
            lim = b["limits_nm"].get(jn)
            tj.append({"joint": jn, "without_nm": a["torque_nm"][jn], "with_nm": t, "limit_nm": lim,
                       "pct_of_limit": round(100 * t / lim, 1) if lim else None})
        top = max(tj, key=lambda r: r["pct_of_limit"] or 0)
        ok = shift <= max_shift and b["stability_margin_mm"] >= min_margin and (top["pct_of_limit"] or 0) <= max_pct
        rows.append({"pose": p, "com_shift_xy_mm": round(shift, 1), "stability_margin_mm": b["stability_margin_mm"],
                     "stability_margin_without_mm": a["stability_margin_mm"], "worst_joint": top, "joints": tj, "ok": ok,
                     "foot_forces_n": b["foot_forces_n"]})
        worst.append(ok)
    within = None if pay.get("nominal_g") is None else added_mass_g <= pay["nominal_g"]
    return {"added_mass_g": added_mass_g, "payload_nominal_g": pay.get("nominal_g"), "payload_max_g": pay.get("max_g"),
            "within_nominal_payload": within, "limits": {"max_com_shift_mm": max_shift, "min_stability_margin_mm": min_margin,
                                                          "max_torque_pct_of_limit": max_pct},
            "rows": rows, "ok": bool(all(worst) and within is not False),
            "note": "static: feet on flat ground, foot forces from static balance (minimum norm), torque limits = MJCF motor ctrlrange"}


def check_fit(device, stl, mount, total_g, com_mm, out_dir, sweep="quick"):
    """Full floating-base check for a part on `mount` (dict from mounts.json). Returns (summary, full)."""
    import os
    body = mount["body"]
    model_xml = sim.model_with_part(stl, body, max(total_g, 1e-6) / 1000.0, com_mm, os.path.join(out_dir, "model_with_part.xml"), device=device)
    base_xml = sim.model_with_part(stl, body, 1e-9, com_mm, os.path.join(out_dir, "model_base.xml"), device=device)
    plane = mount.get("plane")
    if plane:
        axis = max(range(3), key=lambda k: abs(plane["normal"][k]))
        seat = (plane["point"][axis],)
    else:
        axis, seat = 2, (1e9,)
    fit = sim.static_fit(model_xml, stl, seat_axis=axis, seat_values=seat, seat_tol=device.check("fit", "seat_tol_mm", 0.3),
                         depth_tol=device.check("fit", "depth_tol_mm", 0.2))
    coll = leg_sweep(model_xml, stl, device, grid=device.grid("quick" if sweep == "quick" else "full"))
    pay = payload_check(base_xml, model_xml, total_g, device)
    return fit, coll, pay
