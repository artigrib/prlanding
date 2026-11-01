"""open-128-rc-car (Kurtis Kopf / zortness, CC BY 4.0): basic car from the author's FreeCAD files, as a raw glTF.

Usage: python3 rc128.py <open_128_rc_car checkout>/modular_car <out-raw.glb>
Then: npx -y gltfpack@0.25.0 -i out-raw.glb -o ../../models/rc128.glb -kn -km -cc -vp 14 -vn 8 -si 0.5

No FreeCAD needed: an .FCStd file is a zip whose Document.xml lists the objects and whose *.Shape.brp files are
the saved OpenCASCADE result shapes, read here with OCP. Source: github.com/zortness/open_128_rc_car @ f9155c21.
Part set: close to doc/gettingstarted.md "most basic car" (single-piece pan chassis, tilted 130 motor rear end,
threaded rear axle); the servo mount is the one the author placed in 03_Servo.FCStd (MicroServoMount), not the
MicroServoMountLongThrow the guide recommends, which is only saved at the print origin. Parts the author placed
in car coordinates (chassis, right knuckle, steering link, servo and servo mount, tilted motor mount with its
motor, pinion and main gear clones, rear axle mount) keep the author's position. Placed by us:
- left steering knuckle: the author's body is saved 64 mm off to the side (print layout); it is exactly the mirror
  image of the right knuckle, so we move it +64 mm in y into the mirror position (meets the steering link at +y);
- wheels and tyres (modelled at the print origin): on the author's wheel proxies (02_WheelProxies.FCStd);
- the M3 rod: on the main-gear axis.
Car frame: +x forward, +y left, +z up (mm) -> glTF: X = y, Y = z, Z = x, metres, floor at 0.
"""
import os
import sys
import tempfile
import xml.etree.ElementTree as ET
import zipfile

import numpy as np
import trimesh
from OCP.BRep import BRep_Builder
from OCP.BRepBndLib import BRepBndLib
from OCP.Bnd import Bnd_Box
from OCP.BRepTools import BRepTools
from OCP.TopoDS import TopoDS_Shape

sys.path.insert(0, os.path.dirname(__file__))
from step2glb import mesh_shape, MATERIALS  # noqa: E402
from trimesh.visual.material import PBRMaterial  # noqa: E402

D, dst = sys.argv[1:3]


def brp(fn, obj):
    z = zipfile.ZipFile(os.path.join(D, fn))
    root = ET.fromstring(z.read('Document.xml'))
    for o in root.find('ObjectData'):
        if o.get('name') != obj:
            continue
        for p in o.iter('Property'):
            if p.get('name') == 'Shape':
                f = list(p)[0].get('file')
                t = tempfile.NamedTemporaryFile(suffix='.brp', delete=False)
                t.write(z.read(f)); t.close()
                s = TopoDS_Shape()
                BRepTools.Read_s(s, t.name, BRep_Builder())
                os.unlink(t.name)
                return s
    raise KeyError(fn + ':' + obj)


def bbox(s):
    b = Bnd_Box(); BRepBndLib.Add_s(s, b)
    p0, p1 = b.CornerMin(), b.CornerMax()
    return np.array([p0.X(), p0.Y(), p0.Z()]), np.array([p1.X(), p1.Y(), p1.Z()])


def mesh(s, tol=0.05, ang=0.25):
    P, I = mesh_shape(s, tol, ang)
    return P, I


def axis_y_at(P, centre, flip=False):
    """Wheel modelled along +z from z = 0 -> axle along y, centred on `centre` (outer face to the outside)."""
    c = (P.min(0) + P.max(0)) / 2
    Q = P - c
    # rotate +z onto -y (left side) or +y; x stays
    Q = np.stack([Q[:, 0], -Q[:, 2], Q[:, 1]], 1) if not flip else np.stack([Q[:, 0], Q[:, 2], -Q[:, 1]], 1)
    return Q + centre


parts = []   # (group, name, material, P, I)


def add(group, name, mat, fn, obj, place=None):
    s = brp(fn, obj)
    P, I = mesh(s)
    if place is not None:
        P = place(P)
    parts.append((group, name, mat, P, I))


B = '19_PanChassisSinglePiece.FCStd'
add('chassis', 'pan_chassis', 'print', B, 'Body071')
add('steering', 'steering_knuckle_right', 'print', '01_PanChassisTwoPiece.FCStd', 'Body019')
add('steering', 'steering_knuckle_left', 'print', '01_PanChassisTwoPiece.FCStd', 'Body023',
    place=lambda P: P + np.array([0.0, 64.0, 0.0]))   # print-layout offset -> mirror of the right knuckle
add('steering', 'steering_link', 'print', '01_PanChassisTwoPiece.FCStd', 'Body022')
add('steering', 'micro_servo', 'servo', '03_Servo.FCStd', 'Body006')
add('steering', 'servo_mount', 'print', '03_Servo.FCStd', 'Body030')
R = '11_130MotorTiltedRearEnd.FCStd'
add('rear_drive', 'motor_mount_130_tilted', 'print', R, 'Body087')
add('rear_drive', 'motor_130', 'metal', R, 'Body037')
add('rear_drive', 'pinion_10t', 'print', R, 'Body039')
add('rear_drive', 'main_gear_42t', 'print', R, 'Body041')
add('rear_drive', 'rear_axle_mount', 'print', '13_ThreadedRearAxle.FCStd', 'Body')

g0, g1 = bbox(brp(R, 'Body041'))
gc = (g0 + g1) / 2
add('rear_drive', 'threaded_rod_m3', 'bolt', '13_ThreadedRearAxle.FCStd', 'ThreadedRod001',
    place=lambda P: P + np.array([gc[0], 0.0, gc[2]]))

W = '08_Wheels.FCStd'
proxies = {'right_front': 'Body003', 'left_front': 'Body005', 'right_rear': 'Body002', 'left_rear': 'Body004'}
for corner, body in proxies.items():
    p0, p1 = bbox(brp('02_WheelProxies.FCStd', body))
    c = (p0 + p1) / 2
    left = corner.startswith('left')
    front = corner.endswith('front')
    wheel, tire = ('Body018', 'Body050') if front else ('Body016', 'Body049')
    add('wheels', f'wheel_{corner}', 'print', W, wheel, place=lambda P, c=c, l=left: axis_y_at(P, c, flip=not l))
    add('wheels', f'tire_{corner}', 'rubber', W, tire, place=lambda P, c=c, l=left: axis_y_at(P, c, flip=not l))

allp = np.concatenate([p[3] for p in parts])
conv = lambda q: np.stack([q[:, 1], q[:, 2], q[:, 0]], 1)
A = conv(allp)
off = np.array([(A[:, 0].min() + A[:, 0].max()) / 2, A[:, 1].min(), (A[:, 2].min() + A[:, 2].max()) / 2])
mats = {k: PBRMaterial(name=k, baseColorFactor=[int(x * 255) for x in c], metallicFactor=m, roughnessFactor=r)
        for k, (c, m, r) in MATERIALS.items()}
scene = trimesh.Scene()
seen = set()
for group, name, mat, P, I in parts:
    if group not in seen:
        scene.graph.update(frame_to=group, frame_from=scene.graph.base_frame)
        seen.add(group)
    m = trimesh.Trimesh((conv(P) - off) / 1000.0, I, process=False)
    m.visual = trimesh.visual.TextureVisuals(material=mats[mat])
    scene.add_geometry(m, node_name=name, geom_name=name, parent_node_name=group)
scene.export(dst)
print(len(parts), 'parts', sum(len(p[4]) for p in parts), 'tris', 'extent m', ((A.max(0) - A.min(0)) / 1000).round(3))
