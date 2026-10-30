#!/usr/bin/env python3
"""Decimate the ROBOTO ORIGIN (rpo_description) STL meshes and write MuJoCo .msh files.

printedrobotics.cz tooling (our code, not RoboParty code). Reproduces
sim/origin/vendor/roboto_origin/meshes/*.msh from an upstream checkout:

  python3 -I sim/origin/tools/decimate.py <roboto_origin>/modules/rpo_description/meshes \
      sim/origin/vendor/roboto_origin/meshes

Per mesh: weld duplicate STL vertices (trimesh), quadric decimation (fast_simplification) to
KEEP of the faces with a floor of MIN_FACES, positions only (no normals: the browser computes
creased normals). .msh layout (MuJoCo): int32 nvert, nnormal, ntexcoord, nface; float32
vert[3*nvert]; int32 face[3*nface]. Geometry stays in the upstream STL frame and units (m).
Needs: numpy, trimesh, fast_simplification.
"""
import sys, os, glob, struct, json
import numpy as np, trimesh, fast_simplification

KEEP = 0.2
MIN_FACES = 1200

def main(src, dst):
    os.makedirs(dst, exist_ok=True)
    report = []
    for f in sorted(glob.glob(os.path.join(src, '*.STL'))):
        m = trimesh.load(f, force='mesh', process=True)   # process=True merges duplicate vertices
        n0 = len(m.faces)
        target = max(MIN_FACES, int(n0 * KEEP))
        if target < n0:
            v, fc = fast_simplification.simplify(m.vertices.astype(np.float32), m.faces.astype(np.int32),
                                                 target_reduction=1 - target / n0, agg=5)
        else:
            v, fc = m.vertices.astype(np.float32), m.faces.astype(np.int32)
        mm = trimesh.Trimesh(v, fc, process=True)
        mm.remove_unreferenced_vertices()
        v = np.ascontiguousarray(mm.vertices, dtype=np.float32); fc = np.ascontiguousarray(mm.faces, dtype=np.int32)
        name = os.path.splitext(os.path.basename(f))[0] + '.msh'
        with open(os.path.join(dst, name), 'wb') as o:
            o.write(struct.pack('<4i', len(v), 0, 0, len(fc)))
            o.write(v.tobytes()); o.write(fc.tobytes())
        dev = float(np.abs(np.asarray(m.bounds) - np.asarray(mm.bounds)).max())
        report.append({'mesh': name, 'faces_in': n0, 'faces_out': int(len(fc)), 'verts_out': int(len(v)), 'bbox_dev_mm': round(dev * 1000, 2)})
    print(json.dumps(report, indent=1))
    print('total faces', sum(r['faces_in'] for r in report), '->', sum(r['faces_out'] for r in report), file=sys.stderr)

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
