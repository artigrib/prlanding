"""Tessellate build123d shapes and write a small glTF 2.0 binary with a named node tree.

CAD frame (mm): +X = robot's right, +Y = forward, +Z = up, origin = chassis origin (floor at z = -RIDE).
Sim/glTF frame (1 u = 10 cm): X = -x (robot's left), Y = z, Z = y. Positions are scaled by 0.01.
Normals come from the exact B-rep surfaces (crisp chamfers, smooth fillets) instead of being guessed.
"""
import json
import struct

import numpy as np
from OCP.BRep import BRep_Tool
from OCP.BRepLib import BRepLib_ToolTriangulatedShape
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.TopAbs import TopAbs_FACE, TopAbs_REVERSED
from OCP.TopExp import TopExp_Explorer
from OCP.TopLoc import TopLoc_Location
from OCP.TopoDS import TopoDS

MM = 0.01  # mm -> sim units


def tessellate(shape, tol=0.06, ang=0.35):
    """Return (positions[n,3], normals[n,3], indices[m,3]) in CAD mm."""
    occ = shape.wrapped if hasattr(shape, 'wrapped') else shape
    BRepMesh_IncrementalMesh(occ, tol, False, ang, True)
    P, N, I = [], [], []
    base = 0
    ex = TopExp_Explorer(occ, TopAbs_FACE)
    while ex.More():
        face = TopoDS.Face(ex.Current()) if not hasattr(TopoDS, "Face_s") else TopoDS.Face_s(ex.Current())
        loc = TopLoc_Location()
        tri = BRep_Tool.Triangulation_s(face, loc)
        ex.Next()
        if tri is None:
            continue
        if not tri.HasNormals():
            BRepLib_ToolTriangulatedShape.ComputeNormals_s(face, tri)
        trsf = loc.Transformation()
        rev = face.Orientation() == TopAbs_REVERSED
        n = tri.NbNodes()
        m = trsf.VectorialPart()
        R = np.array([[m.Value(r, c) for c in (1, 2, 3)] for r in (1, 2, 3)])
        fn = []
        for i in range(1, n + 1):
            p = tri.Node(i).Transformed(trsf)
            P.append((p.X(), p.Y(), p.Z()))
            d = tri.Normal(i)
            fn.append((d.X(), d.Y(), d.Z()))
        fn = np.array(fn) @ R.T          # rotate normals with the location (rigid locations only)
        N.extend(-fn if rev else fn)
        for t in range(1, tri.NbTriangles() + 1):
            a, b, c = tri.Triangle(t).Get()
            if rev:
                b, c = c, b
            I.append((base + a - 1, base + b - 1, base + c - 1))
        base += n
    P = np.array(P, dtype=np.float64).reshape(-1, 3)
    N = np.array(N, dtype=np.float64).reshape(-1, 3)
    N /= np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-12)
    return P, N, np.array(I, dtype=np.uint32).reshape(-1, 3)


def to_sim(P, N, origin=(0, 0, 0)):
    o = np.asarray(origin, dtype=np.float64)
    Q = P - o
    pos = np.stack([-Q[:, 0], Q[:, 2], Q[:, 1]], axis=1) * MM
    nrm = np.stack([-N[:, 0], N[:, 2], N[:, 1]], axis=1)
    return pos.astype(np.float32), nrm.astype(np.float32)


def sim_vec(p):
    return [-p[0] * MM, p[2] * MM, p[1] * MM]


class Node:
    def __init__(self, name, origin=(0, 0, 0)):
        self.name = name
        self.origin = origin          # CAD mm, absolute
        self.parts = {}               # material -> list of shapes
        self.children = []
        self.tol = None               # (linear mm, angular rad) override for this node's meshes

    def add(self, mat, *shapes):
        self.parts.setdefault(mat, []).extend(shapes)
        return self

    def child(self, name, origin=None):
        c = Node(name, self.origin if origin is None else origin)
        c.tol = self.tol
        self.children.append(c)
        return c


MATERIALS = {
    # name: (baseColor, metallic, roughness)
    'print': ((0.89, 0.89, 0.86, 1), 0.0, 0.55),
    'metal': ((0.62, 0.62, 0.60, 1), 1.0, 0.32),
    'bolt': ((0.42, 0.42, 0.40, 1), 1.0, 0.38),
    'rubber': ((0.025, 0.025, 0.025, 1), 0.0, 0.82),
    'accent': ((0.17, 0.17, 0.16, 1), 0.0, 0.6),
    'servo': ((0.012, 0.012, 0.012, 1), 0.0, 0.35),
    'copper': ((0.72, 0.42, 0.22, 1), 1.0, 0.4),
}


def write_glb(root, path, tol=0.06, ang=0.35):
    gl = {'asset': {'version': '2.0', 'generator': 'printedrobotics.cz robots-cad'},
          'scenes': [{'nodes': [0]}], 'scene': 0, 'nodes': [], 'meshes': [], 'materials': [],
          'accessors': [], 'bufferViews': [], 'buffers': []}
    blob = bytearray()
    mat_index = {}
    stats = {'tris': 0}

    def material(name):
        if name not in mat_index:
            c, m, r = MATERIALS[name]
            mat_index[name] = len(gl['materials'])
            gl['materials'].append({'name': name, 'pbrMetallicRoughness': {
                'baseColorFactor': list(c), 'metallicFactor': m, 'roughnessFactor': r}})
        return mat_index[name]

    def view(data, target):
        while len(blob) % 4:
            blob.append(0)
        off = len(blob)
        blob.extend(data)
        gl['bufferViews'].append({'buffer': 0, 'byteOffset': off, 'byteLength': len(data), 'target': target})
        return len(gl['bufferViews']) - 1

    def accessor(arr, comp, typ, target, minmax=False):
        v = view(arr.tobytes(), target)
        a = {'bufferView': v, 'componentType': comp, 'count': int(arr.shape[0]), 'type': typ}
        if minmax:
            a['min'] = arr.min(axis=0).tolist()
            a['max'] = arr.max(axis=0).tolist()
        gl['accessors'].append(a)
        return len(gl['accessors']) - 1

    def emit(node, parent_origin):
        idx = len(gl['nodes'])
        nd = {'name': node.name}
        t = [a - b for a, b in zip(node.origin, parent_origin)]
        if any(abs(x) > 1e-9 for x in t):
            nd['translation'] = sim_vec(t)
        gl['nodes'].append(nd)
        prims = []
        for mat, shapes in node.parts.items():
            Ps, Ns, Is, base = [], [], [], 0
            for s in shapes:
                P, N, I = tessellate(s, *(node.tol or (tol, ang)))
                Ps.append(P); Ns.append(N); Is.append(I + base); base += len(P)
            if not base:
                continue
            P = np.concatenate(Ps); N = np.concatenate(Ns); I = np.concatenate(Is)
            pos, nrm = to_sim(P, N, node.origin)
            stats['tris'] += len(I)
            stats[node.name] = stats.get(node.name, 0) + len(I)
            prims.append({'attributes': {
                'POSITION': accessor(pos, 5126, 'VEC3', 34962, True),
                'NORMAL': accessor(nrm, 5126, 'VEC3', 34962)},
                'indices': accessor(I.astype(np.uint32).reshape(-1), 5125, 'SCALAR', 34963),
                'material': material(mat)})
        if prims:
            gl['meshes'].append({'name': node.name, 'primitives': prims})
            nd['mesh'] = len(gl['meshes']) - 1
        kids = [emit(c, node.origin) for c in node.children]
        if kids:
            nd['children'] = kids
        return idx

    emit(root, (0, 0, 0))
    while len(blob) % 4:
        blob.append(0)
    gl['buffers'].append({'byteLength': len(blob)})
    js = json.dumps(gl, separators=(',', ':')).encode()
    while len(js) % 4:
        js += b' '
    out = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(blob))
    out += struct.pack('<II', len(js), 0x4E4F534A) + js
    out += struct.pack('<II', len(blob), 0x004E4942) + bytes(blob)
    with open(path, 'wb') as f:
        f.write(out)
    return stats
