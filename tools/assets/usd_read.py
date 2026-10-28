"""Read a SimReady-style OpenUSD asset with usd-core (no Omniverse needed).

read_asset(path) -> dict with
  visuals:   list of {vertices (N,3) m Z-up, faces (M,3), uv (N,2)|None, base_color rgba, texture path|None,
                      roughness, metallic}
  colliders: list of {kind: 'hull'|'decompose', points (K,3) m Z-up, faces (L,3)|None}
  physics:   {mass, density, center_of_mass, static_friction, dynamic_friction, restitution}
  metadata:  SimReady_Metadata from the root layer (category, asset_license, ...)
  packaging: com.nvidia.simready.packaging.json (package_id, license, ...) when present
  root_usd, package_dir, layers (all resolved inside package_dir)

Packages pick the MuJoCo runtime variant when a physics variant set offers one.
Every layer the stage uses must resolve inside the package folder (no absolute/escaping references).
"""
import json
from pathlib import Path

import numpy as np

USD_SUFFIXES = (".usd", ".usda", ".usdc", ".usdz")
PACKAGING_FILE = "com.nvidia.simready.packaging.json"


class AssetError(Exception):
    pass


def find_root_usd(pkg: Path):
    """Same convention as SimReady Central's index_to_library: <asset>.<usd> at the top level or one folder
    down (skipping dot-folders); otherwise the only USD in such a folder."""
    if pkg.is_file():
        return pkg
    asset = pkg.name
    folders = [pkg] + sorted(p for p in pkg.iterdir() if p.is_dir() and not p.name.startswith("."))
    for f in folders:
        for s in USD_SUFFIXES:
            if (f / f"{asset}{s}").is_file():
                return f / f"{asset}{s}"
    for f in folders:
        c = [p for p in f.iterdir() if p.is_file() and p.suffix in USD_SUFFIXES]
        if len(c) == 1:
            return c[0]
        if c:
            break
    raise AssetError("no root USD found")


def _jsonable(v):
    if isinstance(v, dict):
        return {str(k): _jsonable(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [_jsonable(x) for x in v]
    if v is None or isinstance(v, (str, int, float, bool)):
        return v
    try:
        return [_jsonable(x) for x in v]
    except TypeError:
        return str(v)


def _to_zup(p, up):
    if up == "Y":  # (x, y, z)_Yup -> (x, -z, y)_Zup
        return np.stack([p[:, 0], -p[:, 2], p[:, 1]], axis=1)
    return p


def _triangulate(counts, idx):
    tris, corner = [], []
    k = 0
    for c in counts:
        for j in range(1, c - 1):
            tris.append((idx[k], idx[k + j], idx[k + j + 1]))
            corner.append((k, k + j, k + j + 1))
        k += c
    return np.array(tris, dtype=np.int64).reshape(-1, 3), np.array(corner, dtype=np.int64).reshape(-1, 3)


def _material(prim, UsdShade, pkg):
    """UsdPreviewSurface -> base colour / texture / roughness / metallic (render purpose)."""
    out = {"base_color": [0.8, 0.8, 0.8, 1.0], "texture": None, "roughness": 0.6, "metallic": 0.0, "st_name": "st"}
    mat = UsdShade.MaterialBindingAPI(prim).ComputeBoundMaterial()[0]
    if not mat:
        return out
    shader = mat.ComputeSurfaceSource()[0]
    if not shader or shader.GetIdAttr().Get() != "UsdPreviewSurface":
        return out

    def inp(name):
        i = shader.GetInput(name)
        if not i:
            return None, None
        if i.HasConnectedSource():
            src = i.GetConnectedSource()[0]
            return None, UsdShade.Shader(src.GetPrim())
        return i.Get(), None

    v, tex = inp("diffuseColor")
    if v is not None:
        out["base_color"][:3] = [float(x) for x in v]
    if tex is not None and tex.GetIdAttr().Get() == "UsdUVTexture":
        f = tex.GetInput("file")
        a = f.Get() if f else None
        rp = Path(a.resolvedPath) if a is not None and a.resolvedPath else None
        if rp and rp.is_file() and _inside(rp, pkg):
            out["texture"] = str(rp)
        st = tex.GetInput("st")
        if st and st.HasConnectedSource():
            reader = UsdShade.Shader(st.GetConnectedSource()[0].GetPrim())
            vn = reader.GetInput("varname")
            if vn and vn.Get():
                out["st_name"] = str(vn.Get())
    for name, key in (("roughness", "roughness"), ("metallic", "metallic")):
        v, _ = inp(name)
        if v is not None:
            out[key] = float(v)
    v, _ = inp("opacity")
    if v is not None:
        out["base_color"][3] = float(v)
    return out


def _inside(p: Path, root: Path):
    try:
        Path(p).resolve().relative_to(root.resolve())
        return True
    except ValueError:
        return False


def read_asset(path):
    from pxr import Usd, UsdGeom, UsdPhysics, UsdShade, Sdf

    path = Path(path)
    root_usd = find_root_usd(path)
    pkg = path if path.is_dir() else path.parent
    packaging = {}
    for cand in (pkg / PACKAGING_FILE, root_usd.parent.parent / PACKAGING_FILE):
        if cand.is_file() and _inside(cand, pkg):
            packaging = json.loads(cand.read_text(encoding="utf-8"))
            break

    layer = Sdf.Layer.FindOrOpen(str(root_usd))
    if layer is None:
        raise AssetError("root USD cannot be opened")
    metadata = _jsonable(layer.customLayerData.get("SimReady_Metadata", {}))

    stage = Usd.Stage.Open(str(root_usd))
    if stage is None:
        raise AssetError("stage cannot be opened")
    default = stage.GetDefaultPrim() or stage.GetPseudoRoot()
    # physics runtime variant: prefer MuJoCo
    for vs_name in default.GetVariantSets().GetNames():
        vs = default.GetVariantSets().GetVariantSet(vs_name)
        names = vs.GetVariantNames()
        pick = next((n for n in names if n.lower() == "mujoco"), None)
        if pick:
            vs.SetVariantSelection(pick)
    layers = []
    for lyr in stage.GetUsedLayers():
        rp = lyr.realPath
        if not rp:
            continue  # anonymous/session layers
        if not _inside(Path(rp), pkg):
            raise AssetError("USD references a layer outside the package")
        layers.append(str(Path(rp).resolve().relative_to(pkg.resolve())))

    mpu = UsdGeom.GetStageMetersPerUnit(stage) or 0.01
    up = UsdGeom.GetStageUpAxis(stage)
    xc = UsdGeom.XformCache()
    visuals, colliders = [], []
    phys = {"mass": None, "density": None, "center_of_mass": None,
            "static_friction": [], "dynamic_friction": [], "restitution": [], "material_density": []}

    def world_points(prim, pts):
        M = np.array(xc.GetLocalToWorldTransform(prim))  # row-vector convention
        p = np.c_[pts, np.ones(len(pts))] @ M
        return _to_zup(p[:, :3] * mpu, up)

    for prim in stage.Traverse():
        if prim.HasAPI(UsdPhysics.MassAPI):
            m = UsdPhysics.MassAPI(prim)
            mass, dens = m.GetMassAttr().Get(), m.GetDensityAttr().Get()
            if mass and mass > 0:
                phys["mass"] = float(mass)
            if dens and dens > 0:
                phys["density"] = float(dens)
            com = m.GetCenterOfMassAttr().Get()
            if com is not None and all(np.isfinite(list(com))) and max(abs(c) for c in com) < 1e6:
                phys["center_of_mass"] = [float(c) for c in com]
        if prim.HasAPI(UsdPhysics.MaterialAPI):
            pm = UsdPhysics.MaterialAPI(prim)
            for attr, key in ((pm.GetStaticFrictionAttr(), "static_friction"),
                              (pm.GetDynamicFrictionAttr(), "dynamic_friction"),
                              (pm.GetRestitutionAttr(), "restitution"),
                              (pm.GetDensityAttr(), "material_density")):
                v = attr.Get()
                if v is not None and v > 0:
                    phys[key].append(float(v))

        purpose = UsdGeom.Imageable(prim).ComputePurpose() if prim.IsA(UsdGeom.Imageable) else "default"
        visible = (UsdGeom.Imageable(prim).ComputeVisibility() != UsdGeom.Tokens.invisible
                   if prim.IsA(UsdGeom.Imageable) else True)
        is_col = prim.HasAPI(UsdPhysics.CollisionAPI)
        if is_col and not UsdPhysics.CollisionAPI(prim).GetCollisionEnabledAttr().Get() is False:
            approx = (UsdPhysics.MeshCollisionAPI(prim).GetApproximationAttr().Get()
                      if prim.HasAPI(UsdPhysics.MeshCollisionAPI) else "none")
            if prim.IsA(UsdGeom.Mesh):
                mesh = UsdGeom.Mesh(prim)
                pts = np.array(mesh.GetPointsAttr().Get() or [], dtype=float)
                if len(pts):
                    wp = world_points(prim, pts)
                    if approx in ("convexHull", "boundingCube", "boundingSphere"):
                        colliders.append({"kind": "hull", "points": wp, "faces": None, "approx": approx})
                    else:  # convexDecomposition / none / meshSimplification / sdf: decompose ourselves
                        tris, _ = _triangulate(mesh.GetFaceVertexCountsAttr().Get(),
                                               list(mesh.GetFaceVertexIndicesAttr().Get()))
                        colliders.append({"kind": "decompose", "points": wp, "faces": tris, "approx": approx})
            elif prim.IsA(UsdGeom.Gprim):
                pts = _primitive_points(prim, UsdGeom)
                if pts is not None:
                    colliders.append({"kind": "hull", "points": world_points(prim, pts), "faces": None,
                                      "approx": prim.GetTypeName()})
        if prim.IsA(UsdGeom.Mesh) and purpose in ("default", "render") and visible:
            mesh = UsdGeom.Mesh(prim)
            pts = np.array(mesh.GetPointsAttr().Get() or [], dtype=float)
            counts = mesh.GetFaceVertexCountsAttr().Get()
            if not len(pts) or not counts:
                continue
            idx = np.array(mesh.GetFaceVertexIndicesAttr().Get(), dtype=np.int64)
            tris, corners = _triangulate(counts, idx)
            if mesh.GetOrientationAttr().Get() == UsdGeom.Tokens.leftHanded:
                tris, corners = tris[:, ::-1], corners[:, ::-1]
            wp = world_points(prim, pts)
            mat = _material(prim, UsdShade, pkg)
            uv = None
            pv = UsdGeom.PrimvarsAPI(prim).GetPrimvar(mat["st_name"]) or UsdGeom.PrimvarsAPI(prim).GetPrimvar("st")
            if pv and pv.HasValue():
                st = np.array(pv.ComputeFlattened() or [], dtype=float)
                interp = pv.GetInterpolation()
                if interp == "faceVarying" and len(st) == len(idx):
                    # unweld: one vertex per face corner (gltf-transform welds identical ones later)
                    wp, uv = wp[idx[corners.ravel()]], st[corners.ravel()]
                    tris = np.arange(len(wp)).reshape(-1, 3)
                elif interp in ("vertex", "varying") and len(st) == len(pts):
                    uv = st
            visuals.append({"vertices": wp, "faces": tris, "uv": uv, **{k: mat[k] for k in
                            ("base_color", "texture", "roughness", "metallic")}})

    if not visuals:
        raise AssetError("no renderable mesh")
    physics = {"mass": phys["mass"], "density": phys["density"] or (phys["material_density"][0]
               if phys["material_density"] else None), "center_of_mass": phys["center_of_mass"],
               "static_friction": float(np.mean(phys["static_friction"])) if phys["static_friction"] else None,
               "dynamic_friction": float(np.mean(phys["dynamic_friction"])) if phys["dynamic_friction"] else None,
               "restitution": float(np.mean(phys["restitution"])) if phys["restitution"] else None}
    return {"visuals": visuals, "colliders": colliders, "physics": physics, "metadata": metadata,
            "packaging": packaging, "root_usd": str(root_usd), "package_dir": str(pkg), "layers": sorted(layers),
            "meters_per_unit": mpu, "up_axis": up}


def _primitive_points(prim, UsdGeom):
    t = prim.GetTypeName()
    if t == "Cube":
        s = (UsdGeom.Cube(prim).GetSizeAttr().Get() or 2.0) / 2
        return np.array([[x, y, z] for x in (-s, s) for y in (-s, s) for z in (-s, s)], dtype=float)
    ang = np.linspace(0, 2 * np.pi, 16, endpoint=False)
    if t == "Sphere":
        r = UsdGeom.Sphere(prim).GetRadiusAttr().Get() or 1.0
        g = (1 + 5 ** 0.5) / 2
        n = 42
        i = np.arange(n) + 0.5
        phi, th = np.arccos(1 - 2 * i / n), 2 * np.pi * i / g
        return r * np.stack([np.cos(th) * np.sin(phi), np.sin(th) * np.sin(phi), np.cos(phi)], 1)
    if t in ("Cylinder", "Capsule"):
        api = UsdGeom.Cylinder(prim) if t == "Cylinder" else UsdGeom.Capsule(prim)
        r, h = api.GetRadiusAttr().Get() or 1.0, api.GetHeightAttr().Get() or 2.0
        axis = api.GetAxisAttr().Get() or "Z"
        ring = np.stack([r * np.cos(ang), r * np.sin(ang)], 1)
        zs = [-h / 2, h / 2] if t == "Cylinder" else [-h / 2 - r, -h / 2, h / 2, h / 2 + r]
        pts = []
        for z in zs:
            k = 0.05 if (t == "Capsule" and abs(z) > h / 2) else 1.0
            pts += [[x * k, y * k, z] for x, y in ring]
        p = np.array(pts)
        return {"X": p[:, [2, 0, 1]], "Y": p[:, [1, 2, 0]], "Z": p}[axis]
    return None
