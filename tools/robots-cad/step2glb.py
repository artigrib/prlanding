"""Convert an author's STEP assembly into a raw glTF with one named node per part, grouped by sub-assembly.

Usage: python3 step2glb.py <assembly.step> <out-raw.glb> <rules.json> [--up z|y] [--tol 0.15] [--ang 0.5]
Then compress like the other catalogue models:
  npx -y gltfpack@0.25.0 -i out-raw.glb -o ../../models/<id>.glb -kn -km -cc -vp 14 -vn 8 -si <ratio>

rules.json: {"groups": {"<sub-assembly name regex>": "<node name>"},
             "materials": [["<part name regex>", "print|rubber|metal|bolt|servo|accent|copper|pcb|drop"], ...],
             "default": "print"}
Material 'print' is recoloured by the render kit; 'drop' leaves the part out (e.g. hidden helper bodies).
The geometry is the author's own, only tessellated and re-grouped; positions are baked in world space
(metres, Y up) so every node can be shown or hidden on its own for assembly-step renders.
"""
import json
import re
import sys

import numpy as np
from OCP.BRep import BRep_Tool
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.IFSelect import IFSelect_RetDone
from OCP.STEPCAFControl import STEPCAFControl_Reader
from OCP.TCollection import TCollection_ExtendedString
from OCP.TDataStd import TDataStd_Name
from OCP.TDF import TDF_Label
from OCP.OCP.collections import Sequence_TDF_Label as TDF_LabelSequence
from OCP.TDocStd import TDocStd_Document
from OCP.TopAbs import TopAbs_FACE, TopAbs_REVERSED
from OCP.TopExp import TopExp_Explorer
from OCP.TopLoc import TopLoc_Location
from OCP.TopoDS import TopoDS
from OCP.XCAFDoc import XCAFDoc_DocumentTool

sys.path.insert(0, __import__('os').path.dirname(__file__))
from gltfout import MATERIALS  # noqa: E402

MATERIALS = dict(MATERIALS, pcb=((0.05, 0.22, 0.12, 1), 0.0, 0.5))


def name_of(label):
    attr = TDataStd_Name()
    if label.FindAttribute(TDataStd_Name.GetID_s(), attr):
        return attr.Get().ToExtString()
    return ''


def mesh_shape(shape, tol, ang=0.5):
    BRepMesh_IncrementalMesh(shape, tol, False, ang, True)
    P, I, base = [], [], 0
    ex = TopExp_Explorer(shape, TopAbs_FACE)
    while ex.More():
        face = TopoDS.Face_s(ex.Current()) if hasattr(TopoDS, "Face_s") else TopoDS.Face(ex.Current())
        ex.Next()
        loc = TopLoc_Location()
        tri = BRep_Tool.Triangulation_s(face, loc)
        if tri is None:
            continue
        trsf = loc.Transformation()
        n = tri.NbNodes()
        for i in range(1, n + 1):
            p = tri.Node(i).Transformed(trsf)
            P.append((p.X(), p.Y(), p.Z()))
        rev = face.Orientation() == TopAbs_REVERSED
        for t in range(1, tri.NbTriangles() + 1):
            a, b, c = tri.Triangle(t).Get()
            I.append((base + a - 1, base + c - 1, base + b - 1) if rev else (base + a - 1, base + b - 1, base + c - 1))
        base += n
    return np.array(P, dtype=np.float64).reshape(-1, 3), np.array(I, dtype=np.uint32).reshape(-1, 3)


def trsf_matrix(loc):
    t = loc.Transformation()
    M = np.eye(4)
    for r in range(3):
        for c in range(4):
            M[r, c] = t.Value(r + 1, c + 1)
    return M


def main():
    src, dst, rules_path = sys.argv[1:4]
    up = sys.argv[sys.argv.index('--up') + 1] if '--up' in sys.argv else 'z'
    tol = float(sys.argv[sys.argv.index('--tol') + 1]) if '--tol' in sys.argv else 0.15
    ang = float(sys.argv[sys.argv.index('--ang') + 1]) if '--ang' in sys.argv else 0.5
    rules = json.load(open(rules_path))
    mat_rules = [(re.compile(p, re.I), m) for p, m in rules['materials']]
    group_rules = [(re.compile(p, re.I), g) for p, g in rules.get('groups', {}).items()]

    doc = TDocStd_Document(TCollection_ExtendedString('doc'))
    rd = STEPCAFControl_Reader()
    rd.SetNameMode(True); rd.SetColorMode(True)
    if rd.ReadFile(src) != IFSelect_RetDone:
        raise SystemExit('cannot read ' + src)
    rd.Transfer(doc)
    st = XCAFDoc_DocumentTool.ShapeTool_s(doc.Main())

    cache = {}
    parts = []   # (group, part name, material, world points, tris)

    def walk(label, M, path):
        ref = TDF_Label()
        if st.IsReference_s(label):
            st.GetReferredShape_s(label, ref)
        else:
            ref = label
        pname = name_of(ref) or name_of(label)
        if st.IsAssembly_s(ref):
            comps = TDF_LabelSequence()
            st.GetComponents_s(ref, comps)
            for i in range(1, comps.Length() + 1):
                c = comps.Value(i)
                walk(c, M @ trsf_matrix(st.GetLocation_s(c)), path + [pname])
            return
        mat = rules.get('default', 'print')
        full = '/'.join(path + [pname])
        for rx, m in mat_rules:
            if rx.search(full):
                mat = m
                break
        if mat == 'drop':
            return
        group = 'other'
        for rx, g in group_rules:
            if rx.search(full):
                group = g
                break
        key = ref.Tag()
        if key not in cache:
            cache[key] = mesh_shape(st.GetShape_s(ref), tol, ang)
        P, I = cache[key]
        if not len(I):
            return
        W = (np.c_[P, np.ones(len(P))] @ M.T)[:, :3]
        parts.append((group, pname, mat, W, I))

    free = TDF_LabelSequence()
    st.GetFreeShapes(free)
    for i in range(1, free.Length() + 1):
        walk(free.Value(i), np.eye(4), [])

    # world frame: mm -> m, Y up, floor at 0, centred in plan
    allp = np.concatenate([p[3] for p in parts])
    if up == 'z':
        conv = lambda q: np.stack([q[:, 0], q[:, 2], -q[:, 1]], 1)
    else:
        conv = lambda q: q
    A = conv(allp)
    off = np.array([(A[:, 0].min() + A[:, 0].max()) / 2, A[:, 1].min(), (A[:, 2].min() + A[:, 2].max()) / 2])

    import trimesh
    from trimesh.visual.material import PBRMaterial
    mats = {}
    for k, (c, met, rough) in MATERIALS.items():
        mats[k] = PBRMaterial(name=k, baseColorFactor=[int(x * 255) for x in c], metallicFactor=met, roughnessFactor=rough)
    scene = trimesh.Scene()
    counts = {}
    groups = {}
    for group, pname, mat, W, I in parts:
        base = re.sub(r'[^A-Za-z0-9]+', '_', pname).strip('_').lower() or 'part'
        counts[base] = counts.get(base, 0) + 1
        node = f'{base}_{counts[base]}' if counts[base] > 1 else base
        V = (conv(W) - off) / 1000.0
        m = trimesh.Trimesh(V, I, process=False)
        m.visual = trimesh.visual.TextureVisuals(material=mats[mat])
        if group not in groups:
            scene.graph.update(frame_to=group, frame_from=scene.graph.base_frame)
            groups[group] = 0
        groups[group] += len(I)
        scene.add_geometry(m, node_name=node, geom_name=node, parent_node_name=group)
    scene.export(dst)
    tris = sum(len(p[4]) for p in parts)
    print(json.dumps({'parts': len(parts), 'triangles': tris, 'groups': groups,
                      'extent_m': ((A.max(0) - A.min(0)) / 1000).round(3).tolist()}))


if __name__ == '__main__':
    main()
