"""Wrap a Google Scanned Objects model (as shipped by kevinzakka/mujoco_scanned_objects: model.obj,
texture.png, model_collision_*.obj) into a SimReady-style OpenUSD package, so local assets travel through
exactly the same USD -> GLB/MJCF path as Hugging Face SimReady packages.

The package mimics SimReady conventions on purpose (centimetres, Y-up, UsdPreviewSurface + UsdUVTexture,
faceVarying st, UsdPhysics rigid body + mass + physics material, convex-hull collider prims with guide
purpose, SimReady_Metadata in customLayerData, com.nvidia.simready.packaging.json).

Usage: python -I gso2usd.py <gso_model_dir> <out_pkg_dir> --name <asset> --license CC-BY-4.0 \
         [--mass 0.1] [--friction 0.8] [--category toy] [--author "..."]
"""
import argparse
import glob
import json
import os
import shutil
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))


def load_obj(path):
    """Minimal OBJ reader: v, vt, f (v/vt[/vn]). Returns positions, uvs, face corner (vi, ti) lists."""
    V, T, F = [], [], []
    with open(path, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            if line.startswith("v "):
                V.append([float(x) for x in line.split()[1:4]])
            elif line.startswith("vt "):
                T.append([float(x) for x in line.split()[1:3]])
            elif line.startswith("f "):
                poly = []
                for tok in line.split()[1:]:
                    parts = tok.split("/")
                    vi = int(parts[0]) - 1
                    ti = int(parts[1]) - 1 if len(parts) > 1 and parts[1] else -1
                    poly.append((vi, ti))
                F.append(poly)
    return np.array(V, float), np.array(T, float) if T else None, F


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("out")
    ap.add_argument("--name", required=True)
    ap.add_argument("--license", required=True)
    ap.add_argument("--mass", type=float)
    ap.add_argument("--friction", type=float, default=0.8)
    ap.add_argument("--category", default="household")
    ap.add_argument("--author", default="Google Research (Google Scanned Objects)")
    a = ap.parse_args()

    from pxr import Gf, Sdf, Usd, UsdGeom, UsdPhysics, UsdShade, Vt

    src, pkg = Path(a.src), Path(a.out)
    if pkg.exists():
        shutil.rmtree(pkg)
    usd_dir = pkg / "simready_usd"
    (usd_dir / "textures").mkdir(parents=True)
    shutil.copy(src / "texture.png", usd_dir / "textures" / "texture.png")

    def to_usd(p):  # Z-up metres -> Y-up centimetres
        return np.stack([p[:, 0], p[:, 2], -p[:, 1]], 1) * 100.0

    root = usd_dir / f"{a.name}.usda"
    stage = Usd.Stage.CreateNew(str(root))
    UsdGeom.SetStageMetersPerUnit(stage, 0.01)
    UsdGeom.SetStageUpAxis(stage, UsdGeom.Tokens.y)
    body = UsdGeom.Xform.Define(stage, f"/{a.name}")
    stage.SetDefaultPrim(body.GetPrim())
    UsdPhysics.RigidBodyAPI.Apply(body.GetPrim())
    if a.mass:
        UsdPhysics.MassAPI.Apply(body.GetPrim()).CreateMassAttr(a.mass)

    # render material
    mat = UsdShade.Material.Define(stage, f"/{a.name}/Looks/Scan")
    sh = UsdShade.Shader.Define(stage, f"/{a.name}/Looks/Scan/Surface")
    sh.CreateIdAttr("UsdPreviewSurface")
    sh.CreateInput("roughness", Sdf.ValueTypeNames.Float).Set(0.7)
    sh.CreateInput("metallic", Sdf.ValueTypeNames.Float).Set(0.0)
    tex = UsdShade.Shader.Define(stage, f"/{a.name}/Looks/Scan/Diffuse")
    tex.CreateIdAttr("UsdUVTexture")
    tex.CreateInput("file", Sdf.ValueTypeNames.Asset).Set("./textures/texture.png")
    rd = UsdShade.Shader.Define(stage, f"/{a.name}/Looks/Scan/ST")
    rd.CreateIdAttr("UsdPrimvarReader_float2")
    rd.CreateInput("varname", Sdf.ValueTypeNames.Token).Set("st")
    tex.CreateInput("st", Sdf.ValueTypeNames.Float2).ConnectToSource(rd.ConnectableAPI(), "result")
    sh.CreateInput("diffuseColor", Sdf.ValueTypeNames.Color3f).ConnectToSource(tex.ConnectableAPI(), "rgb")
    mat.CreateSurfaceOutput().ConnectToSource(sh.ConnectableAPI(), "surface")

    # physics material
    pm = UsdShade.Material.Define(stage, f"/{a.name}/Looks/Physics")
    pma = UsdPhysics.MaterialAPI.Apply(pm.GetPrim())
    pma.CreateStaticFrictionAttr(a.friction)
    pma.CreateDynamicFrictionAttr(a.friction * 0.9)
    pma.CreateRestitutionAttr(0.1)

    # visual mesh (faceVarying st, like most DCC exports)
    V, T, F = load_obj(src / "model.obj")
    counts, idx, st = [], [], []
    for poly in F:
        counts.append(len(poly))
        for vi, ti in poly:
            idx.append(vi)
            st.append(T[ti] if T is not None and ti >= 0 else (0.0, 0.0))
    vis = UsdGeom.Mesh.Define(stage, f"/{a.name}/visual")
    vis.CreatePointsAttr(Vt.Vec3fArray.FromNumpy(to_usd(V).astype(np.float32)))
    vis.CreateFaceVertexCountsAttr(counts)
    vis.CreateFaceVertexIndicesAttr(idx)
    vis.CreateSubdivisionSchemeAttr(UsdGeom.Tokens.none)
    pv = UsdGeom.PrimvarsAPI(vis).CreatePrimvar("st", Sdf.ValueTypeNames.TexCoord2fArray, UsdGeom.Tokens.faceVarying)
    pv.Set(Vt.Vec2fArray.FromNumpy(np.array(st, np.float32)))
    UsdShade.MaterialBindingAPI.Apply(vis.GetPrim()).Bind(mat)

    # colliders: the V-HACD convex pieces shipped with the model, as convexHull collision prims
    cols = UsdGeom.Scope.Define(stage, f"/{a.name}/collisions")
    UsdGeom.Imageable(cols).CreatePurposeAttr(UsdGeom.Tokens.guide)
    files = sorted(glob.glob(str(src / "model_collision_*.obj")), key=lambda s: int(s.rsplit("_", 1)[1][:-4]))
    for i, f in enumerate(files):
        cv, _, cf = load_obj(f)
        m = UsdGeom.Mesh.Define(stage, f"/{a.name}/collisions/hull_{i}")
        m.CreatePointsAttr(Vt.Vec3fArray.FromNumpy(to_usd(cv).astype(np.float32)))
        m.CreateFaceVertexCountsAttr([len(p) for p in cf])
        m.CreateFaceVertexIndicesAttr([vi for p in cf for vi, _ in p])
        UsdPhysics.CollisionAPI.Apply(m.GetPrim())
        UsdPhysics.MeshCollisionAPI.Apply(m.GetPrim()).CreateApproximationAttr("convexHull")
        UsdShade.MaterialBindingAPI.Apply(m.GetPrim()).Bind(pm, UsdShade.Tokens.weakerThanDescendants, "physics")

    stage.GetRootLayer().customLayerData = {"SimReady_Metadata": {
        "asset_name": a.name, "category": a.category, "author": a.author, "asset_license": a.license}}
    stage.GetRootLayer().Save()
    (usd_dir / ".thumbs" / "256x256").mkdir(parents=True)
    pkgdef = {"package_id": f"simready.local.gso.{a.name}.1.0.0", "license": a.license, "format_version": "1"}
    (pkg / "com.nvidia.simready.packaging.json").write_text(json.dumps(pkgdef, indent=1) + "\n")
    print(json.dumps({"package": str(pkg), "root_usd": str(root), "hulls": len(files)}))


if __name__ == "__main__":
    main()
