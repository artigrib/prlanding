"""Convert one SimReady-style OpenUSD asset into browser-sim files for sim/so101/objects/<id>/:

  <id>.glb   visual: Y-up glTF, meshopt-compressed geometry, WebP texture, <= policy budget (default 300 KB)
  <id>.xml   MJCF: <asset> convex hull meshes (inline vertices) + <body name="obj_<id>"> with freejoint,
             explicit <inertial> (mass, COM, full inertia from the hulls), friction. Loadable on its own.
  <id>.json  per-object metadata (the manifest entry + provenance + conversion stats)

Frames: body origin = bottom centre of the scaled visual bounding box, Z-up metres (MuJoCo). The GLB holds the
same geometry rotated to Y-up (glTF convention); library.js rotates it back.

Usage (normally called by import_assets.py, which applies the licence/brand gate first):
  python -I convert.py <usd_or_package> --id mug --out sim/so101/objects --license CC-BY-4.0 \
      [--scale 1] [--mass KG] [--friction MU] [--name-cs ..] [--name-en ..] [--category ..] \
      [--attribution ..] [--source-url ..] [--license-url ..]
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import HERE, ID_RE, load_policy, write_json  # noqa: E402
from usd_read import read_asset  # noqa: E402


class ConvertError(Exception):
    pass


# ---------------------------------------------------------------- collision hulls
def _hull(points):
    import trimesh
    pts = np.unique(np.round(np.asarray(points, float), 7), axis=0)
    if len(pts) < 4:
        return None
    try:
        h = trimesh.Trimesh(pts).convex_hull
    except Exception:
        return None
    if h.volume < 1e-10:  # flat piece: thicken by 0.5 mm along its thinnest axis so MuJoCo gets a solid
        c = pts - pts.mean(0)
        n = np.linalg.svd(c, full_matrices=False)[2][-1]
        pts = np.vstack([pts + 5e-4 * n, pts - 5e-4 * n])
        try:
            h = trimesh.Trimesh(pts).convex_hull
        except Exception:
            return None
    return h


def _cap_vertices(h, n):
    """Farthest-point sampling keeps a hull's extremes (random picks would shrink it)."""
    pts = h.vertices
    if len(pts) <= n:
        return h
    sel = [int(np.argmax(np.linalg.norm(pts - pts.mean(0), axis=1)))]
    d = np.linalg.norm(pts - pts[sel[0]], axis=1)
    while len(sel) < n:
        j = int(np.argmax(d))
        sel.append(j)
        d = np.minimum(d, np.linalg.norm(pts - pts[j], axis=1))
    return _hull(pts[sel])


def _merge_hulls(hulls, max_n):
    """Greedy: merge the pair whose joint hull adds the least volume, until max_n remain."""
    hulls = list(hulls)
    if len(hulls) <= max_n:
        return hulls
    cache = {}

    def cost(i, j):
        key = (id(hulls[i]), id(hulls[j]))
        if key not in cache:
            m = _hull(np.vstack([hulls[i].vertices, hulls[j].vertices]))
            cache[key] = (m.volume - hulls[i].volume - hulls[j].volume, m) if m is not None else (np.inf, None)
        return cache[key]

    while len(hulls) > max_n:
        best = None
        for i in range(len(hulls)):
            for j in range(i + 1, len(hulls)):
                c, m = cost(i, j)
                if m is not None and (best is None or c < best[0]):
                    best = (c, i, j, m)
        if best is None:
            break
        _, i, j, m = best
        hulls = [h for k, h in enumerate(hulls) if k not in (i, j)] + [m]
    return hulls


def _decompose(vertices, faces, max_hulls):
    import coacd
    import trimesh
    coacd.set_log_level("error")
    plain = trimesh.Trimesh(vertices, faces, process=True)
    parts = coacd.run_coacd(coacd.Mesh(plain.vertices, plain.faces), threshold=0.05,
                            max_convex_hull=max_hulls, preprocess_mode="auto", resolution=2000, seed=1)
    return [h for h in (_hull(v) for v, _ in parts) if h is not None]


def build_hulls(asset, xform, budget):
    hulls = []
    for c in asset["colliders"]:
        pts = xform(c["points"])
        if c["kind"] == "hull":
            h = _hull(pts)
            if h is not None:
                hulls.append(h)
        else:
            hulls += _decompose(pts, c["faces"], budget["max_hulls"])
    source = "usd"
    if not hulls:  # no UsdPhysics colliders authored: decompose the render mesh
        V, F, off = [], [], 0
        for v in asset["visuals"]:
            V.append(xform(v["vertices"]))
            F.append(v["faces"] + off)
            off += len(v["vertices"])
        hulls = _decompose(np.vstack(V), np.vstack(F), budget["max_hulls"])
        source = "coacd"
    hulls = _merge_hulls(hulls, budget["max_hulls"])
    hulls = [h for h in (_cap_vertices(h, budget["max_hull_vertices"]) for h in hulls) if h is not None]
    if not hulls:
        raise ConvertError("no usable collision hulls")
    return hulls, source


def inertial_from_hulls(hulls, mass):
    """Uniform density over the hull union (overlaps counted twice; CoACD/V-HACD pieces barely overlap)."""
    vols = np.array([h.volume for h in hulls])
    vol = float(vols.sum())
    rho = mass / vol
    com = sum(h.center_mass * h.volume for h in hulls) / vol
    I = np.zeros((3, 3))
    for h in hulls:
        m = rho * h.volume
        Ic = h.moment_inertia * rho  # trimesh: unit density, about the hull's own COM
        d = h.center_mass - com
        I += Ic + m * (np.dot(d, d) * np.eye(3) - np.outer(d, d))
    return com, I, vol


# ---------------------------------------------------------------- visual GLB
def write_full_glb(asset, xform, path):
    import trimesh
    from PIL import Image
    scene = trimesh.Scene()
    rot = trimesh.transformations.rotation_matrix(-np.pi / 2, [1, 0, 0])  # Z-up -> Y-up
    for k, v in enumerate(asset["visuals"]):
        verts = xform(v["vertices"])
        tex = None
        if v["texture"] and v["uv"] is not None:
            tex = Image.open(v["texture"]).convert("RGBA" if v["base_color"][3] < 1 else "RGB")
        mat = trimesh.visual.material.PBRMaterial(
            baseColorFactor=[int(round(255 * c)) for c in v["base_color"]] if tex is None else None,
            baseColorTexture=tex, metallicFactor=v["metallic"], roughnessFactor=v["roughness"],
            alphaMode="BLEND" if v["base_color"][3] < 1 else None)
        visual = (trimesh.visual.TextureVisuals(uv=v["uv"], material=mat) if tex is not None
                  else trimesh.visual.TextureVisuals(material=mat))
        m = trimesh.Trimesh(verts, v["faces"], visual=visual, process=False)
        if tex is not None:
            m.merge_vertices(merge_tex=False, merge_norm=True)
        m.apply_transform(rot)
        scene.add_geometry(m, geom_name=f"part{k}")
    scene.export(path, include_normals=True)


def optimize_glb(src, dst, budget):
    cfg = json.dumps({"maxBytes": budget["glb_max_bytes"], "textureSizes": budget["texture_sizes"],
                      "triangleTargets": budget["triangle_targets"]})
    r = subprocess.run(["node", str(HERE / "optimize_glb.mjs"), src, dst, cfg], capture_output=True, text=True)
    if r.returncode != 0:
        raise ConvertError("GLB optimisation failed: " + (r.stderr.strip().splitlines() or ["?"])[-1][:200])
    return json.loads(r.stdout.strip().splitlines()[-1])


# ---------------------------------------------------------------- MJCF
def fmt(a, p=5):
    out = []
    for x in np.asarray(a, float).ravel():
        s = f"{x:.{p}f}".rstrip("0").rstrip(".")
        out.append("0" if s in ("", "-0") else s)
    return " ".join(out)


def write_mjcf(path, oid, hulls, mass, com, I, friction, budget, defaults, comment):
    body = f"obj_{oid}"
    lines = [f'<mujoco model="{body}">', f"  <!-- {comment} -->", "  <asset>"]
    for i, h in enumerate(hulls):
        lines.append(f'    <mesh name="{body}_c{i}" vertex="{fmt(h.vertices)}"/>')
    lines += ["  </asset>", "  <worldbody>", f'    <body name="{body}" pos="0 0 0">',
              f'      <freejoint name="{body}"/>',
              f'      <inertial pos="{fmt(com, 6)}" mass="{mass:.6g}" '
              f'fullinertia="{" ".join(f"{x:.6g}" for x in (I[0, 0], I[1, 1], I[2, 2], I[0, 1], I[0, 2], I[1, 2]))}"/>']
    fr = f'{friction:.3g} {defaults["torsional_friction"]} {defaults["rolling_friction"]}'
    for i in range(len(hulls)):
        lines.append(f'      <geom name="{body}_g{i}" type="mesh" mesh="{body}_c{i}" friction="{fr}" '
                     f'condim="4" solref="0.01 1" group="3"/>')
    lines += ["    </body>", "  </worldbody>", "</mujoco>"]
    Path(path).write_text("\n".join(lines) + "\n", encoding="utf-8")


# ---------------------------------------------------------------- main
def convert(src, oid, out_root, *, license_id, license_url=None, scale=1.0, mass=None, friction=None,
            name_cs=None, name_en=None, category=None, attribution=None, source_url=None, source=None,
            policy=None):
    policy = policy or load_policy()
    budget, defaults = policy["budget"], policy["defaults"]
    if not ID_RE.match(oid):
        raise ConvertError("invalid id")
    asset = read_asset(src)
    meta = asset["metadata"] or {}

    allv = np.vstack([v["vertices"] for v in asset["visuals"]]) * scale
    lo, hi = allv.min(0), allv.max(0)
    offset = -np.array([(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, lo[2]])

    def xform(p):
        return np.asarray(p, float) * scale + offset

    size = (hi - lo)
    if size.max() > budget["max_size_m"] or size.max() < budget["min_size_m"]:
        raise ConvertError(f"size {size.max():.3f} m outside [{budget['min_size_m']}, {budget['max_size_m']}] m "
                           "(fix units or pass a scale)")

    hulls, hull_source = build_hulls(asset, xform, budget)
    phys = asset["physics"]
    vol = float(sum(h.volume for h in hulls))
    if mass is None:
        if phys["mass"]:
            mass = phys["mass"] * (scale ** 3 if scale != 1 else 1)
            mass_source = "usd:mass" + (" (scaled by volume)" if scale != 1 else "")
        elif phys["density"]:
            mass, mass_source = phys["density"] * vol, "usd:density"
        else:
            mass, mass_source = defaults["density_kg_m3"] * vol, "default density"
    else:
        mass_source = "spec"
    if not (0 < mass <= budget["max_mass_kg"]):
        raise ConvertError("mass out of range")
    if friction is None:
        friction = phys["static_friction"] or phys["dynamic_friction"] or defaults["friction"]
        fr_source = "usd" if (phys["static_friction"] or phys["dynamic_friction"]) else "default"
    else:
        fr_source = "spec"
    friction = float(np.clip(friction, 0.2, 2.0))
    com, I, _ = inertial_from_hulls(hulls, mass)

    out = Path(out_root) / oid
    out.mkdir(parents=True, exist_ok=True)
    comment = (f"generated by tools/assets/convert.py; licence {license_id}; "
               f"hulls={len(hulls)} ({hull_source}); mass {mass:.4g} kg ({mass_source})").replace("--", "-")
    write_mjcf(out / f"{oid}.xml", oid, hulls, mass, com, I, friction, budget, defaults, comment)

    with tempfile.TemporaryDirectory() as td:
        full = os.path.join(td, "full.glb")
        write_full_glb(asset, xform, full)
        glb = optimize_glb(full, str(out / f"{oid}.glb"), budget)
    if glb["bytes"] > budget["glb_max_bytes"]:
        raise ConvertError("GLB over budget")

    entry = {
        "id": oid,
        "name_cs": name_cs or name_en or meta.get("asset_name") or oid,
        "name_en": name_en or meta.get("asset_name") or oid,
        "category": category or meta.get("category") or "object",
        "mass_kg": round(float(mass), 4),
        "size_m": [round(float(x), 4) for x in size],
        "friction": round(friction, 3),
        "license": license_id,
        "license_url": license_url,
        "attribution": attribution,
        "source_url": source_url,
        "files": {"glb": f"{oid}/{oid}.glb", "mjcf": f"{oid}/{oid}.xml"},
        "body": f"obj_{oid}",
        "graspable": bool(sorted(size)[0] < 0.07 or sorted(size)[1] < 0.07) and mass < 0.3,
    }
    record = {**entry, "source": source or {}, "conversion": {
        "scale": scale, "mass_source": mass_source, "friction_source": fr_source, "hull_source": hull_source,
        "hulls": len(hulls), "hull_vertices": [int(len(h.vertices)) for h in hulls],
        "hull_volume_cm3": round(vol * 1e6, 2), "com_m": [round(float(c), 5) for c in com],
        "usd_meters_per_unit": asset["meters_per_unit"], "usd_up_axis": asset["up_axis"],
        "glb": glb, "usd_layers": asset["layers"]}}
    write_json(out / f"{oid}.json", record)
    return record


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("--id", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--license", required=True)
    ap.add_argument("--license-url")
    ap.add_argument("--scale", type=float, default=1.0)
    ap.add_argument("--mass", type=float)
    ap.add_argument("--friction", type=float)
    ap.add_argument("--name-cs")
    ap.add_argument("--name-en")
    ap.add_argument("--category")
    ap.add_argument("--attribution")
    ap.add_argument("--source-url")
    a = ap.parse_args()
    rec = convert(a.src, a.id, a.out, license_id=a.license, license_url=a.license_url, scale=a.scale, mass=a.mass,
                  friction=a.friction, name_cs=a.name_cs, name_en=a.name_en, category=a.category,
                  attribution=a.attribution, source_url=a.source_url)
    print(json.dumps({k: rec[k] for k in ("id", "mass_kg", "size_m")} | {"glb_bytes": rec["conversion"]["glb"]["bytes"],
                     "hulls": rec["conversion"]["hulls"]}))


if __name__ == "__main__":
    main()
