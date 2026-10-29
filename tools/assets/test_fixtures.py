"""Synthetic package that mimics the nvidia/simready-assets layout (checked 2026-10-29 on factory_nut_m8_loose):

  <name>/com.nvidia.simready.packaging.json, .metadata/{LICENSE.txt, com.nvidia.simready.root_usds.json}
  simready_usd/sm_<name>_01.usda        Enabled/Disabled variant set per runtime (MuJoCo, PhysX), payloads below
  simready_usd/payloads/base.usda       instanceable prim referencing instances.usda; sublayer Physics/physics.usda
  simready_usd/payloads/instances.usda  -> geometries.usda mesh, CollisionAPI convexDecomposition, MassAPI, material
  simready_usd/payloads/materials.usda  UsdPreviewSurface, ../Textures/t_alb.png (+ ORM, normal maps)
  simready_usd/runnables/physics/mujoco.usda  physics:approximation = convexHull on the instance root
  simready_usd/.thumbs, source_assets   must not be downloaded
"""
import json
from pathlib import Path

import numpy as np

HDR = '#usda 1.0\n(\n    defaultPrim = "{dp}"\n    metersPerUnit = 1\n{extra}    upAxis = "Z"\n)\n'


def _hdr(dp, extra=""):
    return HDR.format(dp=dp, extra=extra)


GEOM = """
def Scope "Geometries"
{{
    def Xform "{n}_mesh_00"
    {{
        def Mesh "{n}_mesh_00"
        {{
            int[] faceVertexCounts = [{counts}]
            int[] faceVertexIndices = [{idx}]
            point3f[] points = [{pts}]
            texCoord2f[] primvars:st = [{st}] (interpolation = "faceVarying")
        }}
    }}
}}
"""

MATERIALS = """
def Scope "Materials"
{
    def Material "m_metal"
    {
        token outputs:surface.connect = </Materials/m_metal/Principled_BSDF.outputs:surface>
        def Shader "Principled_BSDF"
        {
            uniform token info:id = "UsdPreviewSurface"
            color3f inputs:diffuseColor.connect = </Materials/m_metal/Albedo.outputs:rgb>
            float inputs:roughness.connect = </Materials/m_metal/ORM.outputs:g>
            normal3f inputs:normal.connect = </Materials/m_metal/Normal.outputs:rgb>
            token outputs:surface
        }
        def Shader "Albedo"
        {
            uniform token info:id = "UsdUVTexture"
            asset inputs:file = @../Textures/t_alb.png@
            float2 inputs:st.connect = </Materials/m_metal/uvmap.outputs:result>
            float3 outputs:rgb
        }
        def Shader "ORM"
        {
            uniform token info:id = "UsdUVTexture"
            asset inputs:file = @../Textures/t_orm.png@
            float outputs:g
        }
        def Shader "Normal"
        {
            uniform token info:id = "UsdUVTexture"
            asset inputs:file = @../Textures/t_nor.png@
            float3 outputs:rgb
        }
        def Shader "uvmap"
        {
            uniform token info:id = "UsdPrimvarReader_float2"
            string inputs:varname = "st"
            float2 outputs:result
        }
    }
}
"""

INSTANCES = """
def Scope "Instances"
{{
    def Xform "{n}_mesh_00" (prepend references = @./geometries.usda@</Geometries/{n}_mesh_00>)
    {{
        over "{n}_mesh_00" (prepend apiSchemas = ["MaterialBindingAPI", "PhysicsCollisionAPI", "PhysicsMassAPI", "PhysicsMeshCollisionAPI"])
        {{
            rel material:binding = </Instances/{n}_mesh_00/VisualMaterials/m_metal>
            uniform token physics:approximation = "convexDecomposition"
            float physics:mass = 0.001
        }}
        def Scope "VisualMaterials"
        {{
            def Material "m_metal" (
                instanceable = true
                prepend references = @./materials.usda@</Materials/m_metal>
            )
            {{
            }}
        }}
    }}
}}
"""

PHYSICS = """
over "RootNode"
{{
    over "Geometry"
    {{
        over "{n}_obj_00" (prepend apiSchemas = ["PhysicsRigidBodyAPI"])
        {{
        }}
    }}
    over "PhysicsMaterials"
    {{
        over "physics_mat" (prepend apiSchemas = ["PhysicsMaterialAPI"])
        {{
            float physics:density = 2700
            float physics:dynamicFriction = 0.47
            float physics:staticFriction = 0.61
        }}
    }}
}}
"""

BASE = """
def Xform "RootNode" (kind = "component")
{{
    def Scope "Geometry"
    {{
        def Xform "{n}_obj_00"
        {{
            def Xform "{n}_mesh_00" (
                instanceable = true
                prepend references = @./instances.usda@</Instances/{n}_mesh_00>
            )
            {{
                rel material:binding:physics = </RootNode/PhysicsMaterials/physics_mat>
            }}
            def Xform "grasp_identifier"
            {{
                uniform token purpose = "guide"
            }}
        }}
    }}
    def Scope "PhysicsMaterials"
    {{
        def Material "physics_mat"
        {{
        }}
    }}
}}
"""

RUNTIME = """
over "RootNode"
{{
    over "Geometry"
    {{
        over "{n}_obj_00"
        {{
            over "{n}_mesh_00" (prepend apiSchemas = ["PhysicsMeshCollisionAPI"])
            {{
                token physics:approximation = "{approx}"
            }}
        }}
    }}
}}
"""

ROOT = """#usda 1.0
(
    customLayerData = {{
        dictionary SimReady_Metadata = {{
            string asset_license = "CC-BY 4.0"
            string asset_name = "{n}"
            string author = "NVIDIA"
            string category = "screw"
            double mass = 0.001
        }}
    }}
    defaultPrim = "RootNode"
    metersPerUnit = 1
    upAxis = "Z"
)

def Xform "RootNode" (
    prepend references = @./payloads/base.usda@
    variants = {{
        string MuJoCo = "Disabled"
        string PhysX = "Enabled"
    }}
    append variantSets = ["MuJoCo", "PhysX"]
)
{{
    variantSet "MuJoCo" = {{
        "Disabled" {{
        }}
        "Enabled" (prepend payload = @./runnables/physics/mujoco.usda@) {{
        }}
    }}
    variantSet "PhysX" = {{
        "Disabled" {{
        }}
        "Enabled" (prepend payload = @./runnables/physics/physx.usda@) {{
        }}
    }}
}}
"""


def make_simready_layout(root, name, *, mujoco_override=True):
    import trimesh
    from PIL import Image
    pkg = Path(root) / name
    sr = pkg / "simready_usd"
    for d in ("payloads/Physics", "runnables/physics", "Textures", ".thumbs/256x256", "source_assets"):
        (sr / d).mkdir(parents=True, exist_ok=True)
    (pkg / ".metadata").mkdir(parents=True)
    rng = np.random.default_rng(2)
    for t in ("alb", "nor", "orm"):
        Image.fromarray((rng.random((128, 128, 3)) * 255).astype(np.uint8)).save(sr / "Textures" / f"t_{t}.png")
    Image.new("RGB", (8, 8)).save(sr / ".thumbs" / "256x256" / "thumb.png")
    ring = trimesh.creation.annulus(r_min=0.004, r_max=0.0075, height=0.0065, sections=6)
    ring.apply_translation([0, 0, 0.00325])
    V, F = ring.vertices, ring.faces
    (sr / "payloads" / "geometries.usda").write_text(_hdr("Geometries") + GEOM.format(
        n=name, counts=", ".join(["3"] * len(F)), idx=", ".join(str(i) for i in F.ravel()),
        pts=", ".join(f"({x:.6f}, {y:.6f}, {z:.6f})" for x, y, z in V),
        st=", ".join(f"({(V[i][0] + 0.01) * 50:.4f}, {(V[i][1] + 0.01) * 50:.4f})" for i in F.ravel())))
    (sr / "payloads" / "materials.usda").write_text(_hdr("Materials") + MATERIALS)
    (sr / "payloads" / "instances.usda").write_text(_hdr("Instances") + INSTANCES.format(n=name))
    (sr / "payloads" / "Physics" / "physics.usda").write_text(_hdr("RootNode") + PHYSICS.format(n=name))
    (sr / "payloads" / "base.usda").write_text(
        _hdr("RootNode", "    subLayers = [@./Physics/physics.usda@]\n") + BASE.format(n=name))
    mj = RUNTIME.format(n=name, approx="convexHull") if mujoco_override else 'over "RootNode"\n{\n}\n'
    (sr / "runnables" / "physics" / "mujoco.usda").write_text(_hdr("RootNode") + mj)
    (sr / "runnables" / "physics" / "physx.usda").write_text(_hdr("RootNode") + RUNTIME.format(n=name, approx="sdf"))
    root_name = f"sm_{name}_01.usda"
    (sr / root_name).write_text(ROOT.format(n=name))
    (pkg / ".metadata" / "com.nvidia.simready.root_usds.json").write_text(
        json.dumps({"format_version": "1.0", "entries": [f"simready_usd/{root_name}"]}))
    (pkg / ".metadata" / "LICENSE.txt").write_text("Creative Commons Attribution 4.0 International\n")
    (pkg / "com.nvidia.simready.packaging.json").write_text(json.dumps(
        {"format_version": "1.0", "package_id": f"simready.hf.test.ds.{name}.1", "license": "CC-BY-4.0"}))
    return pkg
