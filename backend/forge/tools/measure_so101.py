"""Measure SO-101 mount interfaces from the sim meshes and write forge/mounts/so101.json.

Source geometry: sim/so101/model (MuJoCo Menagerie robotstudio_so101, Apache-2.0, meshes decimated
and converted to .msh by printedrobotics.cz). Coordinates are in the MuJoCo BODY frame named in each
interface, in millimetres. Run from the repo root:
    python3 backend/forge/tools/measure_so101.py [--check]
--check compares the measured numbers with the committed JSON (used by the pipeline test).

Method: mesh vertices are placed with the geom pos/quat into the body frame; flat faces are found
from face normals; holes are closed, near-circular loops in plane sections (equivalent diameter
from loop area). The meshes are decimated, so small features move by a few tenths of a millimetre:
every interface carries an uncertainty and "verify": "ověřit na tisku" (check on a real print).
"""
import json
import os
import sys

import mujoco
import numpy as np
import trimesh

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
MODEL = os.path.join(ROOT, "sim/so101/model/so101.xml")
OUT = os.path.join(ROOT, "backend/forge/forge/mounts/so101.json")


def body_meshes(m, bname):
    b = m.body(bname).id
    out = {}
    for g in range(m.ngeom):
        if m.geom_bodyid[g] != b or m.geom_type[g] != mujoco.mjtGeom.mjGEOM_MESH:
            continue
        mid = m.geom_dataid[g]
        va, vn = m.mesh_vertadr[mid], m.mesh_vertnum[mid]
        fa, fn = m.mesh_faceadr[mid], m.mesh_facenum[mid]
        R = np.zeros(9)
        mujoco.mju_quat2Mat(R, m.geom_quat[g])
        V = m.mesh_vert[va:va + vn] @ R.reshape(3, 3).T + m.geom_pos[g]
        out[m.mesh(mid).name] = trimesh.Trimesh(V * 1000.0, m.mesh_face[fa:fa + fn], process=True)
    return out


def loops(mesh, origin, normal):
    """Closed loops of a plane section: [(eq_diameter, circularity, centre_xyz)]"""
    s = mesh.section(plane_origin=origin, plane_normal=normal)
    if s is None:
        return []
    p2, T = s.to_2D()
    res = []
    for lp in p2.discrete:
        x, y = lp[:, 0], lp[:, 1]
        cr = x[:-1] * y[1:] - x[1:] * y[:-1]
        A = 0.5 * cr.sum()
        L = np.linalg.norm(np.diff(lp, axis=0), axis=1).sum()
        if abs(A) < 1e-6 or L == 0:
            continue
        cx, cy = ((x[:-1] + x[1:]) * cr).sum() / (6 * A), ((y[:-1] + y[1:]) * cr).sum() / (6 * A)
        c3 = (T @ np.array([cx, cy, 0, 1]))[:3]
        res.append((2 * np.sqrt(abs(A) / np.pi), 4 * np.pi * abs(A) / L ** 2, c3))
    return res


def holes(mesh, origin, normal, dmax=11.0):
    return sorted([(round(float(d), 2), [round(float(v), 1) for v in c]) for d, circ, c in loops(mesh, origin, normal)
                   if d < dmax and circ > 0.9], key=lambda h: (h[1][0], h[1][2]))


def flat_face(mesh, axis, sign, coord, tol=0.6):
    n = mesh.face_normals
    sel = (n[:, axis] * sign > 0.98) & (np.abs(mesh.triangles_center[:, axis] - coord) < tol)
    tri = mesh.triangles[sel].reshape(-1, 3)
    return float(mesh.area_faces[sel].sum()), tri.min(axis=0), tri.max(axis=0)


def measure():
    m = mujoco.MjModel.from_xml_path(MODEL)
    g = body_meshes(m, "gripper")
    cam = body_meshes(m, "camera_mount")["wrist_roll_follower_so101_camera_mount"]
    jaw = g["wrist_roll_follower_so101_v1"]
    la = body_meshes(m, "lower_arm")["under_arm_so101_v1"]
    out = {}
    # M1: +y face of the fixed jaw (where the wrist camera mount bolts on)
    area, lo, hi = flat_face(jaw, 1, +1, 24.0)
    out["m1"] = {
        "face_y": round(float(hi[1]), 2), "face_area_mm2": round(area, 0),
        "face_bounds_xz": [[round(float(lo[0]), 1), round(float(lo[2]), 1)], [round(float(hi[0]), 1), round(float(hi[2]), 1)]],
        "holes_jaw_y23": holes(jaw, [0, 23.0, 0], [0, 1, 0], 6),
        "holes_jaw_y20": holes(jaw, [0, 20.0, 0], [0, 1, 0], 6),
        "holes_cam_y25": holes(cam, [0, 25.0, 0], [0, 1, 0], 6),
        "camera_mount_bbox": [[round(float(v), 1) for v in cam.bounds[0]], [round(float(v), 1) for v in cam.bounds[1]]],
        "jaw_bbox": [[round(float(v), 1) for v in jaw.bounds[0]], [round(float(v), 1) for v in jaw.bounds[1]]],
    }
    # M2: outer (-x) face of the fixed jaw
    area, lo, hi = flat_face(jaw, 0, -1, -35.0)
    out["m2"] = {"face_x": round(float(lo[0]), 2), "face_area_mm2": round(area, 0),
                 "face_bounds_yz": [[round(float(lo[1]), 1), round(float(lo[2]), 1)], [round(float(hi[1]), 1), round(float(hi[2]), 1)]],
                 "features_x33": holes(jaw, [-33.0, 0, 0], [1, 0, 0], 11)}
    # M3: straight section of the forearm (lower_arm body)
    secs = {}
    for x in (-50.0, -60.0, -70.0, -80.0, -90.0):
        s = la.section(plane_origin=[x, 0, 0], plane_normal=[1, 0, 0])
        b = s.bounds
        secs[str(int(x))] = [round(float(b[0][1]), 1), round(float(b[1][1]), 1), round(float(b[0][2]), 1), round(float(b[1][2]), 1)]
    out["m3"] = {"sections_y0_y1_z0_z1": secs}
    return out


def library(meas):
    m1, m2, m3 = meas["m1"], meas["m2"], meas["m3"]
    hc = m1["holes_cam_y25"]
    # the screw pair = jaw holes that line up (±1 mm in x and z) with the camera mount holes
    hj = [h for h in m1["holes_jaw_y23"] if any(abs(h[1][0] - c[1][0]) <= 1.0 and abs(h[1][2] - c[1][2]) <= 1.0 for c in hc)]
    other = [h for h in m1["holes_jaw_y23"] if h not in hj]
    pitch_jaw = round(abs(hj[1][1][0] - hj[0][1][0]), 2) if len(hj) >= 2 else None
    pitch_cam = round(abs(hc[1][1][0] - hc[0][1][0]), 2) if len(hc) >= 2 else None
    s70 = m3["sections_y0_y1_z0_z1"]["-70"]
    return {
        "$comment": "GENERATED by backend/forge/tools/measure_so101.py from sim/so101/model (MuJoCo Menagerie robotstudio_so101, Apache-2.0). Edit the script, not this file.",
        "robot": "so101",
        "units": "mm",
        "frames": "Each interface is given in the MuJoCo body frame named in `body` (sim/so101/model/so101.xml), in mm. The gripper frame: z runs from the wrist (z≈0) to the jaw tips (z≈-104), the fixed jaw is on -x, the moving jaw on +x, the wrist-camera side is +y.",
        "source_note": "Measured on decimated sim meshes, not on the original CAD: features can be off by ±0.5 mm; hole diameters on decimated meshes read small. Every value must be checked on a real print (ověřit na tisku).",
        "measured": meas,
        "interfaces": [
            {
                "id": "gripper_cam_face",
                "name": "Fixed jaw, camera face (+y)",
                "name_cs": "Pevná čelist, plocha pro kameru (+y)",
                "body": "gripper",
                "kind": "screw_face",
                "plane": {"point": [-1.0, m1["face_y"], -23.4], "normal": [0, 1, 0]},
                "flat_area_mm2": m1["face_area_mm2"],
                "holes": [
                    {"center": [hj[0][1][0], m1["face_y"], hj[0][1][2]], "d_measured": hj[0][0], "d_nominal": 3.2, "axis": [0, -1, 0]},
                    {"center": [hj[1][1][0], m1["face_y"], hj[1][1][2]], "d_measured": hj[1][0], "d_nominal": 3.2, "axis": [0, -1, 0]},
                ] if len(hj) >= 2 else [],
                "hole_pitch_mm": {"jaw_mesh": pitch_jaw, "camera_mount_mesh": pitch_cam, "design_value": 8.0, "uncertainty": 0.6},
                "fastener": "M3 (screws through the add-on into the jaw holes; the wrist camera mount uses the same pair). Length = existing screw + add-on plate thickness.",
                "fastener_cs": "M3 (šrouby přes díl do otvorů v čelisti; stejnou dvojici používá držák zápěstní kamery). Délka = původní šroub + tloušťka destičky.",
                "other_features": [{"d_measured": h[0], "center": [h[1][0], m1["face_y"], h[1][2]], "note": "Ø≈4 mm opening not used by the camera mount (purpose unknown, not a mounting hole for this library)."} for h in other],
                "counterbore_inside_jaw": {"d_measured": max(h[0] for h in m1["holes_jaw_y20"]) if m1["holes_jaw_y20"] else None, "at_y": 20.0, "note": "Wider pocket ≈4 mm below the face: probably for a nut or screw head from the inside (not confirmed)."},
                "occupied_by": {"part": "wrist camera mount (Menagerie camera_mount body)", "bbox": m1["camera_mount_bbox"]},
                "clearance_envelope": {"note": "Free space next to the camera mount for an add-on, before the collision check: x -40…-23, y 24…60, z -50…-10 (gripper frame).", "box": [[-40, 24, -50], [-23, 60, -10]]},
                "use": "Add-ons that rotate with the gripper (lights, small sensors). With the wrist camera fitted, sandwich a ≤3 mm plate under the camera mount (the camera moves 3 mm along +y).",
                "uncertainty_mm": 0.6,
                "verify": "ověřit na tisku",
            },
            {
                "id": "gripper_outer_face",
                "name": "Fixed jaw, outer face (-x)",
                "name_cs": "Pevná čelist, vnější plocha (-x)",
                "body": "gripper",
                "kind": "flat_face_no_holes",
                "plane": {"point": [m2["face_x"], 0.0, -25.0], "normal": [-1, 0, 0]},
                "flat_area_mm2": m2["face_area_mm2"],
                "face_bounds_yz": m2["face_bounds_yz"],
                "features": m2["features_x33"],
                "features_note": "One Ø≈10 mm round recess coaxial with the jaw servo (z≈-23.4) and Ø≈1.5 mm marks; no screw holes usable for mounting.",
                "fastener": "None in the part: double-sided foam tape (VHB-type) or a clip around the jaw. Drilling the jaw is not recommended.",
                "fastener_cs": "Žádné otvory: oboustranná pěnová páska (typ VHB) nebo klip kolem čelisti. Vrtání čelisti nedoporučujeme.",
                "use": "Very light add-ons (< 10 g) when the camera face is taken; the face touches objects when grasping wide items.",
                "uncertainty_mm": 0.5,
                "verify": "ověřit na tisku",
            },
            {
                "id": "forearm_clamp",
                "name": "Forearm band clamp",
                "name_cs": "Objímka na předloktí",
                "body": "lower_arm",
                "kind": "clamp",
                "section": {"x_range": [-90, -50], "y": [s70[0], s70[1]], "z": [s70[2], s70[3]],
                            "width_mm": round(s70[1] - s70[0], 1), "height_mm": round(s70[3] - s70[2], 1),
                            "sections": m3["sections_y0_y1_z0_z1"]},
                "band_width_max_mm": 25,
                "center": [-70.0, 0.0, round((s70[2] + s70[3]) / 2, 1)],
                "fastener": "Printed two-piece band with 2× M3 screws + nuts, or two cable ties through a printed saddle. Keep ≥1 mm clearance to the elbow and wrist servo cables.",
                "fastener_cs": "Tištěná dvoudílná objímka se 2× M3 + matice, nebo dvě stahovací pásky přes tištěné sedlo. Nechat ≥1 mm vůli ke kabelům serv.",
                "use": "Add-ons that should not rotate with the wrist (work light aimed at the table, cable strain relief).",
                "uncertainty_mm": 0.5,
                "verify": "ověřit na tisku",
            },
        ],
    }


def main():
    lib = library(measure())
    text = json.dumps(lib, indent=1, ensure_ascii=False) + "\n"
    if "--check" in sys.argv:
        with open(OUT, encoding="utf-8") as f:
            committed = json.load(f)
        if committed["measured"] != json.loads(text)["measured"]:
            print("mount library is stale: run backend/forge/tools/measure_so101.py")
            sys.exit(1)
        print("mount library matches the meshes")
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(text)
    print("wrote", OUT)


if __name__ == "__main__":
    main()
