"""Author's STEP assembly -> catalogue GLB (models/<id>.glb), keeping one named node per part.

Usage (python 3.12+, pip install build123d trimesh fast_simplification; gltfpack via npx):
  git clone --depth 1 https://github.com/dorianborian/sesame-robot   # or jess-moss/koch-v1-1, next to each other
  python3 -I tools/render-kit/cad/step2glb.py tools/render-kit/cad/sesame.json /tmp/sesame-raw.glb <dir with the clones>
  npx -y gltfpack@0.25.0 -i /tmp/sesame-raw.glb -o models/sesame.glb -kn -km -cc -vp 14 -vn 8
  node tools/render-kit/render.mjs sesame az=35 el=24 dist=4.8      # koch: az=50 el=16 dist=4.6
config: { "steps": [{"file": STEP (relative to the clone dir), "parts_dir": multi-file assembly part folder}],
          "up": "y"|"z", "front": "+x"|"-x"|... (direction the robot faces, CAD frame),
          "rules": [[regex on the label path, node name, material, kept triangle fraction]], "tol", "ang",
          "split": [regex: leaves exploded into one leaf per solid, paths <path>/s0, /s1 ...] }
Node names: '' keeps the leaf label, '{1}' inserts regex group 1, 'servo#' numbers leaves, 'servo#2' numbers
distinct values of regex group 2 (one node per sub-assembly instance). Materials: 'print' takes the print colour
in render.html / viewer3d.js; servo, accent, pcb, metal stay dark/neutral.
Output frame: Y up, robot faces +Z, floor at y = 0, centred in X/Z, bounding-box diagonal = 1 (like models/*.glb).
"""
import json, re, sys, math
from collections import OrderedDict
import numpy as np
import trimesh
import fast_simplification
from build123d import import_step
from OCP.BRep import BRep_Tool
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.TopAbs import TopAbs_FACE, TopAbs_REVERSED
from OCP.TopExp import TopExp_Explorer
from OCP.TopLoc import TopLoc_Location
from OCP.TopoDS import TopoDS

MATS = {   # same values as the other catalogue models (models/lekiwi.glb, so102.glb)
    'print': ((0.891, 0.891, 0.859, 1), 0.0, 0.55),
    'servo': ((0.0066, 0.0066, 0.0066, 1), 0.0, 0.35),      # + clearcoat 0.2, added after export
    'accent': ((0.267, 0.267, 0.251, 1), 0.0, 0.4),
    'metal': ((0.488, 0.488, 0.465, 1), 1.0, 0.3),
    'rubber': ((0.025, 0.025, 0.025, 1), 0.0, 0.82),
    'pcb': ((0.03, 0.12, 0.06, 1), 0.0, 0.5),
}
CLEARCOAT = {'servo': {'clearcoatFactor': 0.2, 'clearcoatRoughnessFactor': 0}}


def add_clearcoat(path):
    """trimesh writes no material extensions: add KHR_materials_clearcoat to the glossy materials."""
    import pygltflib
    g = pygltflib.GLTF2().load(path)
    hit = False
    for m in g.materials:
        if m.name in CLEARCOAT:
            m.extensions = dict(m.extensions or {}, KHR_materials_clearcoat=CLEARCOAT[m.name]); hit = True
    if hit:
        g.extensionsUsed = sorted(set((g.extensionsUsed or []) + ['KHR_materials_clearcoat']))
        g.save(path)


def tess(shape, tol, ang):
    occ = shape.wrapped if hasattr(shape, 'wrapped') else shape
    BRepMesh_IncrementalMesh(occ, tol, False, ang, True)
    P, I, base = [], [], 0
    ex = TopExp_Explorer(occ, TopAbs_FACE)
    while ex.More():
        face = TopoDS.Face_s(ex.Current()) if hasattr(TopoDS, 'Face_s') else TopoDS.Face(ex.Current())
        ex.Next()
        loc = TopLoc_Location()
        tri = BRep_Tool.Triangulation_s(face, loc)
        if tri is None:
            continue
        trsf = loc.Transformation()
        rev = face.Orientation() == TopAbs_REVERSED
        n = tri.NbNodes()
        for i in range(1, n + 1):
            p = tri.Node(i).Transformed(trsf)
            P.append((p.X(), p.Y(), p.Z()))
        for t in range(1, tri.NbTriangles() + 1):
            a, b, c = tri.Triangle(t).Get()
            if rev:
                b, c = c, b
            I.append((base + a - 1, base + b - 1, base + c - 1))
        base += n
    return np.array(P, float).reshape(-1, 3), np.array(I, np.int64).reshape(-1, 3)


def leaves(s, path, locs=(), idx=0):
    """Yield (label path, label, TopoDS shape in the root frame). A child's shape is stored in its parent's
    frame, so the ancestors' locations are applied from the parent up to the root."""
    kids = list(getattr(s, 'children', []) or [])
    lab = s.label or '?'
    p = f'{path}/{lab}@{idx}'
    if not kids:
        occ = s.wrapped
        for L in reversed(locs):
            occ = occ.Moved(L)
        yield p, lab, occ
    else:
        L = s.wrapped.Location()
        for i, k in enumerate(kids):
            yield from leaves(k, p, locs + (L,), i)


PART_CACHE = {}


def part_shape(parts_dir, label):
    """Multi-file STEP assembly (SolidWorks): an empty leaf is an external part <label>.STEP in parts_dir."""
    import glob, os
    base = re.sub(r'(-\d+|_\d+)$', '', label)
    if base not in PART_CACHE:
        f = [g for g in glob.glob(os.path.join(parts_dir, '*')) if os.path.splitext(os.path.basename(g))[0].lower() == base.lower()]
        PART_CACHE[base] = import_step(f[0]).wrapped if f else None
        if not f:
            print('MISSING PART', label)
    return PART_CACHE[base]


def basis(up, front):
    ax = {'x': np.array([1., 0, 0]), 'y': np.array([0, 1., 0]), 'z': np.array([0, 0, 1.])}
    U = ax[up[-1]] * (-1 if up.startswith('-') else 1)
    F = ax[front[-1]] * (-1 if front.startswith('-') else 1)
    X = np.cross(U, F)  # glTF +X = up x front (robot's left when it faces +Z... consistent right-handed)
    return np.stack([X, U, F])  # rows: new x, y, z


def main(cfg_path, out, src='.'):
    import os
    cfg = json.load(open(cfg_path))
    for st in cfg['steps']:
        for k in ('file', 'parts_dir'):
            if k in st:
                st[k] = os.path.join(src, st[k])
    tol, ang = cfg.get('tol', 0.1), cfg.get('ang', 0.4)
    rules = [(re.compile(r[0]), r[1], r[2], r[3]) for r in cfg['rules']]
    drop = [re.compile(d) for d in cfg.get('drop', [])]
    split = [re.compile(d) for d in cfg.get('split', [])]
    groups = OrderedDict()  # node -> {mat: [(P, I, keep)]}
    unmatched = []
    counts = {}
    for st in cfg['steps']:
        root = import_step(st['file'])
        M = np.array(st.get('matrix', np.eye(4)), float)
        pending = []
        for path, lab, s in leaves(root, ''):
            if st.get('parts_dir'):
                ps = part_shape(st['parts_dir'], lab)
                if ps is None:
                    continue
                s = ps.Moved(s.Location())
            if any(d.search(path) for d in drop):
                continue
            if any(x.search(path) for x in split):   # one leaf per solid: <path>/s0, <path>/s1 ...
                from OCP.TopAbs import TopAbs_SOLID
                ex, k = TopExp_Explorer(s, TopAbs_SOLID), 0
                while ex.More():
                    pending.append((f'{path}/s{k}', f'{lab}_{k}', ex.Current())); ex.Next(); k += 1
                continue
            pending.append((path, lab, s))
        for path, lab, s in pending:
            for rx, node, mat, keep in rules:
                mo = rx.search(path)
                if mo:
                    break
            else:
                unmatched.append(path); continue
            name = node.format(None, *mo.groups()) if node else re.sub(r'[^A-Za-z0-9]+', '_', lab).strip('_')
            m2 = re.search(r'#(\d*)$', name)
            if m2:   # one node per instance: 'servo#' numbers leaves, 'servo#2' numbers distinct values of regex group 2
                stem = name[:m2.start()] or re.sub(r'[^A-Za-z0-9]+', '_', lab).strip('_')
                key = (stem, mo.group(int(m2.group(1))) + mo.string[:mo.start()]) if m2.group(1) else (stem, path)
                seen = counts.setdefault(stem, {})
                seen.setdefault(key, len(seen) + 1)
                name = f'{stem}_{seen[key]}'
            P, I = tess(s, tol, ang)
            if not len(I):
                continue
            P = P @ M[:3, :3].T + M[:3, 3]
            groups.setdefault(name, OrderedDict()).setdefault(mat, []).append((P, I, keep))
    if unmatched:
        print('UNMATCHED', len(unmatched), *unmatched[:40], sep='\n  ')
    B = basis(cfg['up'], cfg['front'])
    meshes, total0, total1 = [], 0, 0
    for name, mats in groups.items():
        for mat, items in mats.items():
            Ps, Is, base, keep = [], [], 0, items[0][2]
            for P, I, k in items:
                Ps.append(P); Is.append(I + base); base += len(P)
            P = np.concatenate(Ps) @ B.T; I = np.concatenate(Is)
            m = trimesh.Trimesh(P, I, process=True)
            m.merge_vertices(digits_vertex=4)
            total0 += len(m.faces)
            if keep < 1 and len(m.faces) > 200:
                v, f = fast_simplification.simplify(m.vertices.astype(np.float32), m.faces.astype(np.int64), target_reduction=1 - keep, agg=5)
                m = trimesh.Trimesh(v, f, process=True)
            total1 += len(m.faces)
            meshes.append((name, mat, m))
    allv = np.concatenate([m.vertices for _, _, m in meshes])
    lo, hi = allv.min(0), allv.max(0)
    s = 1.0 / np.linalg.norm(hi - lo)
    off = np.array([-(lo[0] + hi[0]) / 2, -lo[1], -(lo[2] + hi[2]) / 2])
    scene = trimesh.Scene()
    cache = {}
    for name, mat, m in meshes:
        m.vertices = (m.vertices + off) * s
        m = trimesh.graph.smooth_shade(m, angle=math.radians(cfg.get('crease', 32)))
        c, met, rough = MATS[mat]
        if mat not in cache:
            cache[mat] = trimesh.visual.material.PBRMaterial(name=mat, baseColorFactor=[int(round(x * 255)) for x in c], metallicFactor=met, roughnessFactor=rough)
        m.visual = trimesh.visual.TextureVisuals(material=cache[mat])
        nn = name if len([1 for n2, _, _ in meshes if n2 == name]) == 1 else f'{name}__{mat}'
        scene.add_geometry(m, node_name=nn, geom_name=nn)
    scene.export(out)
    add_clearcoat(out)
    print(f'{out}: nodes={len(meshes)} tris {total0} -> {total1}; size mm {(hi - lo).round(1).tolist()}')
    print('nodes:', ', '.join(dict.fromkeys(n for n, _, _ in meshes)))


if __name__ == '__main__':
    main(*sys.argv[1:4])
