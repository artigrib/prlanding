"""zcar2 (Alex Yu, GPL-3.0): split the author's assembled STL into named parts for the catalogue viewer.

Usage: python3 zcar2.py <zcar2 repo checkout> <out-raw.glb>
Then: npx -y gltfpack@0.25.0 -i out-raw.glb -o ../../models/zcar2.glb -kn -km -cc -vp 14 -vn 8

Source: github.com/alexyu132/zcar2 @ 43c964cd (zcar2.stl = whole car exported from zcar2.skp, stl/ = print files).
The geometry is the author's assembled mesh, unchanged apart from units and axes. Connected pieces are named
by matching their surface area against the author's per-part STLs; pieces that are not in stl/ (bought parts:
MR105 bearings, 130 motor) are named from the README parts list by size and position; anything that cannot be
identified keeps a neutral name (part_N). Slivers and tread faces are merged into the nearest named piece.
Output: metres, Y up, front of the car towards +Z, floor at y = 0.
"""
import glob
import os
import sys

import numpy as np
import trimesh
from trimesh.visual.material import PBRMaterial

src, dst = sys.argv[1:3]
asm = trimesh.load(os.path.join(src, 'zcar2.stl'))
parts = {}
for f in glob.glob(os.path.join(src, 'stl', '*.stl')):
    n = os.path.basename(f)[:-4].split(' (')[0]
    # mirrored twins have the same area: name them once (wheel bearing block 1/2, rear body mount left/right)
    n = n.replace('wheel bearing block 1', 'wheel bearing block').replace('wheel bearing block 2', 'wheel bearing block')
    n = n.replace('rear body mount left', 'rear body mount').replace('rear body mount right', 'rear body mount')
    parts[n] = trimesh.load(f).area

comps = asm.split(only_watertight=False)
big, small, seen = [], [], []
for c in comps:
    # duplicates in the export (the same piece twice in place) -> keep one
    if any(abs(a - c.area) < 0.5 and np.linalg.norm(p - c.centroid) < 0.5 for a, p in seen):
        continue
    seen.append((c.area, c.centroid))
    (big if c.area >= 80 else small).append(c)


def role(c):
    e = np.sort(c.extents)
    for n, a in parts.items():
        if abs(a - c.area) / a < 0.003:
            return n, 'print'
    if np.allclose(e, [4, 10, 10], atol=0.2):
        return 'bearing_mr105', 'metal'          # README: MR105 bearing (5 x 10 x 4 mm)
    if np.allclose(e, [8.5, 24.5, 24.5], atol=0.2):
        return 'tire', 'rubber'                  # README: TPU printed tires
    if np.allclose(e, [8.5, 21, 21], atol=0.2):
        return 'wheel', 'print'
    if np.allclose(e, [15, 20, 20], atol=0.2):
        return 'motor_130', 'servo'              # README: 130 size brushed motor; in line with the motor pinion
    if np.allclose(e, [11.5, 19.8, 25.1], atol=0.2):
        return 'servo support', 'print'          # same envelope as stl/servo support.stl (later revision)
    if np.allclose(e, [19.7, 21.0, 26.5], atol=0.3):
        return 'axle bearing block front', 'print'
    if abs(c.area - 456.6) < 1:
        return 'u-joint end', 'print'
    if abs(c.area - 88.5) < 0.5:
        return 'u-joint coupler', 'print'
    return 'part', 'accent'


named = [(role(c), c) for c in big]
# merge small pieces (slivers, tread faces, tiny hardware) into the nearest named piece
cent = np.array([c.centroid for _, c in named])
groups = [[c] for _, c in named]
for s in small:
    d = np.linalg.norm(cent - s.centroid, axis=1)
    groups[int(np.argmin(d))].append(s)

R = np.array([[-1, 0, 0], [0, 0, 1], [0, 1, 0]], dtype=float)   # z-up, +y front -> y-up, +z front
allv = np.concatenate([g.vertices for grp in groups for g in grp]) @ R.T
off = np.array([(allv[:, 0].min() + allv[:, 0].max()) / 2, allv[:, 1].min(), (allv[:, 2].min() + allv[:, 2].max()) / 2])

COL = {'print': ((0.89, 0.89, 0.86, 1), 0.0, 0.55), 'metal': ((0.62, 0.62, 0.60, 1), 1.0, 0.32),
       'rubber': ((0.025, 0.025, 0.025, 1), 0.0, 0.82), 'servo': ((0.012, 0.012, 0.012, 1), 0.0, 0.35),
       'accent': ((0.17, 0.17, 0.16, 1), 0.0, 0.6)}
mats = {k: PBRMaterial(name=k, baseColorFactor=[int(x * 255) for x in c], metallicFactor=m, roughnessFactor=r)
        for k, (c, m, r) in COL.items()}

scene = trimesh.Scene()
count = {}
order = sorted(range(len(named)), key=lambda i: (named[i][0][0], -named[i][1].centroid[1], named[i][1].centroid[0]))
for i in order:
    (name, mat), _ = named[i]
    base = name.replace('-', '_').replace(' ', '_')
    count[base] = count.get(base, 0) + 1
    node = f'{base}_{count[base]}'
    m = trimesh.util.concatenate(groups[i])
    m = trimesh.Trimesh((m.vertices @ R.T - off) / 1000.0, m.faces, process=True)
    m.visual = trimesh.visual.TextureVisuals(material=mats[mat])
    scene.add_geometry(m, node_name=node, geom_name=node)
scene.export(dst)
print({k: v for k, v in sorted(count.items())}, 'extent m', ((allv.max(0) - allv.min(0)) / 1000).round(3))
