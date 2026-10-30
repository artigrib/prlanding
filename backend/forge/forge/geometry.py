"""Geometry report for a run_cad result (computed in the parent from the exported STL).

Units: mm, mm^3, g. Mass is given two ways:
  mass_solid_g   volume x density (100 % infill)
  mass_print_g   rough FDM estimate: a 0.8 mm shell (2 perimeters of 0.4 mm) is solid, the rest
                 at `infill` (default 30 %), never more than the solid mass
Min wall: rays are cast inwards from deterministic surface samples along the inverted face normal;
the distance to the first hit is the local thickness. Inside corners make a few rays exit through
the neighbouring face, so the report gives the 2nd percentile as `min_wall_mm` (and the raw min).
"""
import numpy as np
import trimesh

PLA_DENSITY = 1.24  # g/cm^3, typical datasheet value for PLA


def _first_hits(origins, dirs, tris, eps=1e-9, chunk=256):
    """Distance along each ray to the nearest triangle hit (Moller-Trumbore, numpy, no rtree)."""
    v0, e1, e2 = tris[:, 0], tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0]
    out = np.full(len(origins), np.inf)
    for i in range(0, len(origins), chunk):
        o, d = origins[i:i + chunk, None, :], dirs[i:i + chunk, None, :]
        p = np.cross(d, e2[None])
        det = np.einsum("ijk,ijk->ij", np.broadcast_to(e1[None], p.shape), p)
        ok = np.abs(det) > eps
        inv = np.where(ok, 1.0 / np.where(ok, det, 1.0), 0.0)
        tv = o - v0[None]
        u = np.einsum("ijk,ijk->ij", tv, p) * inv
        q = np.cross(tv, np.broadcast_to(e1[None], tv.shape))
        v = np.einsum("ijk,ijk->ij", np.broadcast_to(d, q.shape), q) * inv
        t = np.einsum("ijk,ijk->ij", np.broadcast_to(e2[None], q.shape), q) * inv
        hit = ok & (u >= 0) & (v >= 0) & (u + v <= 1) & (t > 0.02)
        out[i:i + chunk] = np.where(hit, t, np.inf).min(axis=1)
    return out


def wall_thickness(mesh, n=1500, seed=7):
    pts, fidx = trimesh.sample.sample_surface(mesh, n, seed=seed)
    if len(pts) == 0:
        return None
    normals = mesh.face_normals[fidx]
    origins = pts - normals * 1e-3
    best = _first_hits(origins, -normals, mesh.triangles)
    best = best[np.isfinite(best)]
    if len(best) == 0:
        return None
    return {"min_wall_mm": round(float(np.percentile(best, 2)), 2), "raw_min_mm": round(float(best.min()), 2),
            "p10_mm": round(float(np.percentile(best, 10)), 2), "median_mm": round(float(np.median(best)), 2),
            "samples": int(len(best)), "method": "inward rays from surface samples, 2nd percentile"}


def overhang_area(mesh, build_dir=(0, 0, 1), limit_deg=45.0):
    """Area (mm^2) of downward faces steeper than `limit_deg` from vertical, excluding the bed face."""
    up = np.asarray(build_dir, float) / np.linalg.norm(build_dir)
    z = mesh.vertices @ up
    zmin = z.min()
    cos = mesh.face_normals @ up
    tri_z = (mesh.triangles @ up).min(axis=1)
    over = (cos < -np.cos(np.radians(limit_deg))) & (tri_z > zmin + 0.05)
    return round(float(mesh.area_faces[over].sum()), 1)


def geometry_report(stl_path, child, density_g_cm3=PLA_DENSITY, infill=0.30, shell_mm=0.8):
    mesh = trimesh.load_mesh(stl_path, process=True)
    vol_occ = float(child.get("occ_volume_mm3", 0.0))
    vol_mesh = float(abs(mesh.volume)) if mesh.is_volume else float("nan")
    vol = vol_occ if vol_occ > 0 else vol_mesh
    area = float(child.get("occ_area_mm2", mesh.area))
    shell = min(vol, area * shell_mm)
    mass_solid = vol / 1000.0 * density_g_cm3
    mass_print = min(mass_solid, (shell + (vol - shell) * infill) / 1000.0 * density_g_cm3)
    bb = mesh.bounds
    com = mesh.center_mass if mesh.is_volume else mesh.centroid
    return {
        "units": "mm",
        "bbox_mm": [[round(float(v), 2) for v in bb[0]], [round(float(v), 2) for v in bb[1]]],
        "size_mm": [round(float(v), 2) for v in bb[1] - bb[0]],
        "volume_mm3": round(vol, 1),
        "volume_mesh_mm3": round(vol_mesh, 1),
        "area_mm2": round(area, 1),
        "density_g_cm3": density_g_cm3,
        "mass_solid_g": round(mass_solid, 2),
        "mass_print_g": round(mass_print, 2),
        "mass_print_assumptions": f"{shell_mm} mm solid shell + {int(infill * 100)} % infill",
        "center_of_mass_mm": [round(float(v), 2) for v in com],
        "watertight": bool(mesh.is_watertight),
        "winding_consistent": bool(mesh.is_winding_consistent),
        "euler_number": int(mesh.euler_number),
        "triangles": int(len(mesh.faces)),
        "n_solids": int(child.get("n_solids", 0)),
        "occ_valid": bool(child.get("occ_valid", False)),
        "wall": wall_thickness(mesh),
        "meta": child.get("meta", {}),
    }
