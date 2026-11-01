"""UC2 simple smartphone microscope (mechanical version) -> raw GLB with named nodes.

Source: https://github.com/openUC2/UC2-GIT @ afc9de36f27d5a387e6b9ef1d85ae0cf33b4d3d6 (hardware CERN-OHL-1.2, License.md).
Usage:  python3 -I tools/lab-cad/uc2_glb.py <UC2-GIT>/TheBOX/SimpleBOX/BUILD_ME/STL uc2-raw.glb
        npx -y gltfpack@0.25.0 -i uc2-raw.glb -o models/uc2.glb -kn -km -cc -vp 14 -vn 8
Renders: node tools/render-kit/render.mjs uc2 dist=5.0
Licence of this derived model: CERN-OHL-1.2 (same as the source), see models/NOTICE.txt.
Parts: the author's STL files from openUC2/UC2-GIT TheBOX/SimpleBOX/BUILD_ME/STL (UC2 v2 cubes), placed on the
50 mm UC2 grid per APPLICATIONS/APP_SIMPLE-Smartphone_Microscope/mechanical/Readme.md ("Building the Smartphone
microscope"):  layer 1: mirror - (nothing) - mirror - support cube on a 4x1 baseplate; layer 2: Z-stage - (nothing)
- eyepiece - support cube; smartphone holder over eyepiece + support; baseplate puzzle + sample holder cube on the
Z-stage. Inserts are placed in their cube's local frame (printed orientation, resting on the 2 mm floor ring); a
module (cube + lid + insert) is rotated as a whole where its optical axis requires it.
CAD frame: mm, z up, row along +x, viewer on -y. Output: Y up, front = +Z, floor y = 0, centred, bbox diagonal = 1.
Purchased parts (mirrors, objective, eyepiece, magnets, screws, smartphone) are not modelled.
"""
import sys, numpy as np, trimesh
from trimesh.visual.material import PBRMaterial
from trimesh.visual import TextureVisuals

S, OUT = sys.argv[1].rstrip('/') + '/', sys.argv[2]
MAT = {'print': PBRMaterial(name='print', baseColorFactor=[0.89, 0.89, 0.86, 1], metallicFactor=0.0, roughnessFactor=0.55),
       'accent': PBRMaterial(name='accent', baseColorFactor=[0.17, 0.17, 0.16, 1], metallicFactor=0.0, roughnessFactor=0.6)}


def load(name, part=None):
    m = trimesh.load(S + name, force='mesh')
    if part is not None:  # 0 = largest connected component, 1 = second
        cs = sorted(m.split(only_watertight=False), key=lambda c: -len(c.faces))
        m = cs[part]
    m.merge_vertices()
    return m


def T(x=0, y=0, z=0):
    return trimesh.transformations.translation_matrix([x, y, z])


def R(axis, deg, about=(0, 0, 0)):
    return trimesh.transformations.rotation_matrix(np.radians(deg), axis, about)


X = [1, 0, 0]
G = {}  # geometry name -> mesh (shared between instances)


def geom(name, mesh, mat):
    if name not in G:
        mesh = mesh.copy(); mesh.visual = TextureVisuals(material=MAT[mat]); G[name] = mesh
    return name


cube = geom('cube_1x1', load('01_10_Cube_1x1_v2.stl'), 'print')
lid_m = load('02_10_Lid_1x1_v2.stl'); c = lid_m.bounds.mean(0); lid_m.apply_translation([-c[0], -c[1], 0])
lid = geom('lid_1x1', lid_m, 'print')
base = geom('baseplate_4x1', load('03_Assembly_base_4x1.stl'), 'print')
_b = load('03_Assembly_base_4x1.stl')   # one puzzle piece (x -25..25): its connected components
base1_m = trimesh.util.concatenate([c for c in _b.split(only_watertight=False) if c.bounds[1][0] <= 25.01])
puzzle = geom('baseplate_puzzle', base1_m, 'print')
mirror = geom('insert_mirror_45', load('08_20_Cube_Insert_Mirror_Holder_30x30Mirror_v2.stl'), 'accent')

zins = geom('insert_zstage_focus', load('05_20_focus_inlet_linearflexure_stage_objectivemount.stl', 0), 'accent')
zmount = geom('zstage_objective_mount', load('05_20_focus_inlet_linearflexure_stage_objectivemount.stl', 1), 'accent')
gear = geom('zstage_gear', load('06_20_gear.stl'), 'accent')
eyep = geom('insert_eyepiece', load('07_20_Cube_Insert_Holder_flashlight_eyepiece_v2.stl'), 'accent')
sample = geom('insert_sample_holder', load('09_20_Cube_insert_Sample_holder.stl'), 'accent')
clamp = geom('sample_clamp', load('10_20_Cube_Insert_Sample_clamp.stl'), 'accent')
phone = geom('smartphone_holder', load('11_30_Smartphone_Holder.stl'), 'print')

PITCH, BASE_H, CUBE_H, FLOOR = 50.0, 8.0, 49.8, 2.0
nodes = []  # (node, parent, matrix, geometry or None)


def module(name, slot, z0, rot, parts):
    """Cube + lid + inserts; module-local frame: cube floor at z = 0, centred in x/y. rot: 4x4 about the cube centre."""
    M = T(PITCH * slot, 0, z0) @ rot
    nodes.append((name, 'uc2_smartphone_microscope', M, None))
    nodes.append((name + '_cube', name, np.eye(4), cube))
    nodes.append((name + '_lid', name, T(0, 0, 41.8), lid))
    for n, g, m in parts:
        nodes.append((n, name, m, g))


L1, L2 = BASE_H, BASE_H + CUBE_H
C = (0, 0, CUBE_H / 2)
nodes.append(('baseplate_4x1', 'uc2_smartphone_microscope', np.eye(4), base))
# layer 1: mirror (slot 0) folds the image from the objective towards +x, mirror (slot 2) folds it up to the eyepiece
module('mod_mirror_1', 0, L1, R(X, 90, C), [('mod_mirror_1_insert', mirror, T(0, 0, FLOOR))])
module('mod_mirror_2', 2, L1, R(X, -90, C), [('mod_mirror_2_insert', mirror, T(0, 0, FLOOR))])
module('mod_support_1', 3, L1, np.eye(4), [])
# layer 2: Z-stage above mirror 1; the insert's objective axis (= its z) sits at the cube centre; the gear housing
# sticks out towards +x (into the free slot 1) as in the author's photos. Cube upside down: ring near the top.
ZC = T(12.9, 19.3, FLOOR)  # insert frame -> module frame (objective mount centre x -12.9, y -19.3)
module('mod_zstage', 0, L2, R(X, 180, C), [('mod_zstage_insert', zins, ZC), ('mod_zstage_objective_mount', zmount, ZC),
                                           ('mod_zstage_gear', gear, T(44.9 - 29.8, 0 - 65.0, FLOOR + 17 + 20.8))])
module('mod_eyepiece', 2, L2, R(X, 180, C), [('mod_eyepiece_insert', eyep, T(-0.2, 1.4, FLOOR))])
module('mod_support_2', 3, L2, np.eye(4), [])
TOP2 = L2 + CUBE_H
# smartphone holder (plate z 0..4.5 on the lids, pegs z -8..0 into the lid holes): its hole (x 30.5, y 24.9 in the STL) over the eyepiece, plate overhanging towards +x
nodes.append(('smartphone_holder', 'uc2_smartphone_microscope',
              T(2 * PITCH, 0, TOP2) @ R([0, 0, 1], 180) @ T(-30.5, -24.9, 0), phone))
# layer 3: baseplate puzzle on the Z-stage, sample holder cube above the objective
nodes.append(('baseplate_puzzle_top', 'uc2_smartphone_microscope', T(0, 0, TOP2), puzzle))
module('mod_sample', 0, TOP2 + BASE_H, np.eye(4), [('mod_sample_insert', sample, T(0, 0, FLOOR)),
                                                   ('mod_sample_clamp', clamp, T(0, 0, FLOOR + 5))])

# world bounds in the CAD frame
pts = []
mats = {}
def world(n):
    for node, par, M, g in nodes:
        if node == n:
            return (world(par) if par != 'uc2_smartphone_microscope' else np.eye(4)) @ M
for node, par, M, g in nodes:
    if g:
        W = world(node); mats[node] = W
        pts.append(trimesh.transform_points(G[g].bounds_corners if hasattr(G[g], 'bounds_corners') else trimesh.bounds.corners(G[g].bounds), W))
P = np.vstack(pts)
for node, g in [(n, g) for n, _, _, g in nodes if g]:
    v = trimesh.transform_points(G[g].vertices[::7], mats[node]); P = np.vstack([P, v])
lo, hi = P.min(0), P.max(0)
conv = np.array([[1, 0, 0, 0], [0, 0, 1, 0], [0, -1, 0, 0], [0, 0, 0, 1]], float)   # CAD z-up -> glTF y-up, -y -> +z
ctr = np.array([(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, lo[2]])
s = 1.0 / np.linalg.norm(hi - lo)
ROOT = np.diag([s, s, s, 1]) @ conv @ T(*-ctr)
print('size mm', (hi - lo).round(1), 'scale', s)

sc = trimesh.Scene()
for k, m in G.items():
    sc.geometry[k] = m
sc.graph.update(frame_from=sc.graph.base_frame, frame_to='uc2_smartphone_microscope', matrix=ROOT)
for node, par, M, g in nodes:
    kw = {'geometry': g} if g else {}
    sc.graph.update(frame_from=par, frame_to=node, matrix=M, **kw)
sc.export(OUT)
print('nodes', [n for n, *_ in nodes])
