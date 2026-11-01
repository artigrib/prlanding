# SPDX-License-Identifier: CERN-OHL-S-2.0
"""OpenFlexure Microscope v7 (motorised, RMS optics) -> raw GLB with one named node per part.

Source: https://gitlab.com/openflexure/openflexure-microscope, tag v7.0.0-beta5 (CERN-OHL-S-2.0).
Parts: STL files exported one by one from tools/lab-cad/openflexure/ofm_assembly.scad (each already in its assembled
position, main-body frame, mm, z up):
  for p in <PARTS below>; do OPENSCADPATH=<dir with symlink ofm -> source> openscad -D "PART=\"$p\"" -o stl/$p.stl ofm_assembly.scad; done
Usage:  python3 -I tools/lab-cad/openflexure/ofm_glb.py <stl dir> openflexure-raw.glb
        npx -y gltfpack@0.25.0 -i openflexure-raw.glb -o models/openflexure.glb -kn -km -cc -vp 14 -vn 8
Renders: node tools/render-kit/render.mjs openflexure dist=5.2 ty=0.45 (OpenSCAD 2021.01, OpenSCAD part export ~2 min in total)
Licence of this derived model: CERN-OHL-S-2.0 (same as the source), see models/NOTICE.txt.
Output: Y up, front (CAD -y, the side the electronics drawer opens to) = +Z, floor y = 0, centred, bbox diagonal = 1.
Printed parts get the material 'print' (recoloured by the render kit); the optics module (printed black in the
authors' renders), camera, boards and motors get fixed dark / neutral materials.
"""
import sys
import numpy as np
import trimesh
import fast_simplification
from trimesh.visual.material import PBRMaterial
from trimesh.visual import TextureVisuals

S, OUT = sys.argv[1].rstrip('/') + '/', sys.argv[2]
MAT = {'print': PBRMaterial(name='print', baseColorFactor=[0.89, 0.89, 0.86, 1], metallicFactor=0.0, roughnessFactor=0.55),
       'dark': PBRMaterial(name='dark', baseColorFactor=[0.12, 0.12, 0.12, 1], metallicFactor=0.0, roughnessFactor=0.6),
       'board': PBRMaterial(name='board', baseColorFactor=[0.10, 0.20, 0.13, 1], metallicFactor=0.0, roughnessFactor=0.6),
       'metal': PBRMaterial(name='metal', baseColorFactor=[0.62, 0.62, 0.60, 1], metallicFactor=0.8, roughnessFactor=0.45)}

# (node, group, material, target triangle count)
PARTS = [
    ('main_body', 'microscope', 'print', 60000),
    ('foot_x', 'actuator_x', 'print', 2500), ('large_gear_x', 'actuator_x', 'print', 3000),
    ('small_gear_x', 'actuator_x', 'print', 1500), ('motor_x', 'actuator_x', 'metal', 1500),
    ('foot_y', 'actuator_y', 'print', 2500), ('large_gear_y', 'actuator_y', 'print', 3000),
    ('small_gear_y', 'actuator_y', 'print', 1500), ('motor_y', 'actuator_y', 'metal', 1500),
    ('foot_z', 'actuator_z', 'print', 2500), ('large_gear_z', 'actuator_z', 'print', 3000),
    ('small_gear_z', 'actuator_z', 'print', 1500), ('motor_z', 'actuator_z', 'metal', 1500),
    ('optics_module', 'optics', 'dark', 12000), ('objective', 'optics', 'metal', 3000),
    ('camera', 'optics', 'board', 2000), ('camera_cover', 'optics', 'print', 1000),
    ('sample_clip_1', 'stage', 'print', 800), ('sample_clip_2', 'stage', 'print', 800),
    ('illumination_dovetail', 'illumination', 'print', 8000), ('condenser', 'illumination', 'print', 6000),
    ('condenser_lid', 'illumination', 'print', 3000), ('condenser_thumbscrew', 'illumination', 'print', 800),
    ('stand', 'stand_assembly', 'print', 25000), ('electronics_drawer', 'stand_assembly', 'print', 6000),
    ('raspberry_pi', 'stand_assembly', 'board', 4000), ('sangaboard', 'stand_assembly', 'board', 3000),
]
ROOT_NAME = 'openflexure_microscope'


def load(name, target):
    m = trimesh.load(S + name + '.stl', force='mesh')
    m.merge_vertices()
    n0 = len(m.faces)
    if n0 > target:
        v, f = fast_simplification.simplify(m.vertices.astype(np.float32), m.faces.astype(np.int32),
                                            target_reduction=1 - target / n0, agg=5)
        m = trimesh.Trimesh(v, f, process=True)
    print(f'{name:24s} {n0:7d} -> {len(m.faces):6d} tris')
    return m


meshes = {}
for name, group, mat, target in PARTS:
    m = load(name, target)
    m.visual = TextureVisuals(material=MAT[mat])
    meshes[name] = m

P = np.vstack([m.vertices for m in meshes.values()])
lo, hi = P.min(0), P.max(0)
conv = np.array([[1, 0, 0, 0], [0, 0, 1, 0], [0, -1, 0, 0], [0, 0, 0, 1]], float)   # CAD z-up -> glTF y-up, -y -> +z
ctr = np.array([(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, lo[2]])
s = 1.0 / np.linalg.norm(hi - lo)
T = np.eye(4); T[:3, 3] = -ctr
ROOT = np.diag([s, s, s, 1]) @ conv @ T
print('size mm', (hi - lo).round(1), 'scale', s)

sc = trimesh.Scene()
sc.graph.update(frame_from=sc.graph.base_frame, frame_to=ROOT_NAME, matrix=ROOT)
for g in dict.fromkeys(g for _, g, _, _ in PARTS):
    sc.graph.update(frame_from=ROOT_NAME, frame_to=g, matrix=np.eye(4))
for name, group, _, _ in PARTS:
    sc.geometry[name] = meshes[name]
    sc.graph.update(frame_from=group, frame_to=name, matrix=np.eye(4), geometry=name)
sc.export(OUT)
print('nodes', [n for n, *_ in PARTS])
