"""Self-test of the import pipeline on synthetic SimReady-style packages (no network, no external data).

Run: python -I tools/assets/test_pipeline.py      (needs requirements.txt + `npm ci` in tools/assets)

Builds a fake downloaded dataset with packages that must be included or excluded for known reasons, runs
import_assets.py --fetch on it into a temp folder and checks the outcome, the MJCF physics and the GLB budget.
"""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from common import brand_hits, license_decision, load_policy, normalize_license  # noqa: E402
from hf_fetch import package_dirs  # noqa: E402
from validate import inject, place, split_mjcf  # noqa: E402

POLICY = load_policy()


def make_package(root, name, *, license=None, card_meta=None, textured=True, collider="cube", mpu=0.01, up="Y",
                 mass=None, density=None, size=0.05):
    """A box-ish object: render mesh (optionally textured, faceVarying st), collider prim, physics material."""
    from PIL import Image
    from pxr import Sdf, Usd, UsdGeom, UsdPhysics, UsdShade, Vt
    pkg = Path(root) / name
    usd_dir = pkg / "simready_usd"
    (usd_dir / "textures").mkdir(parents=True)
    stage = Usd.Stage.CreateNew(str(usd_dir / f"{name}.usda"))
    UsdGeom.SetStageMetersPerUnit(stage, mpu)
    UsdGeom.SetStageUpAxis(stage, UsdGeom.Tokens.y if up == "Y" else UsdGeom.Tokens.z)
    root_prim = UsdGeom.Xform.Define(stage, f"/{name}")
    stage.SetDefaultPrim(root_prim.GetPrim())
    UsdPhysics.RigidBodyAPI.Apply(root_prim.GetPrim())
    m = UsdPhysics.MassAPI.Apply(root_prim.GetPrim())
    if mass:
        m.CreateMassAttr(mass)
    if density:
        m.CreateDensityAttr(density)
    s = size / mpu / 2
    h = 2 * s
    # cube mesh, 6 quads; "up" axis is the second (Y) or third (Z) coordinate
    P = np.array([[x, y, z] for z in (0, h) for y in (-s, s) for x in (-s, s)], float)
    if up == "Y":
        P = P[:, [0, 2, 1]] * [1, 1, -1]
    quads = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]]
    mesh = UsdGeom.Mesh.Define(stage, f"/{name}/visual")
    mesh.CreatePointsAttr(Vt.Vec3fArray.FromNumpy(P.astype(np.float32)))
    mesh.CreateFaceVertexCountsAttr([4] * 6)
    mesh.CreateFaceVertexIndicesAttr([i for q in quads for i in q])
    mat = UsdShade.Material.Define(stage, f"/{name}/Looks/M")
    sh = UsdShade.Shader.Define(stage, f"/{name}/Looks/M/S")
    sh.CreateIdAttr("UsdPreviewSurface")
    if textured:
        Image.fromarray((np.random.default_rng(1).random((64, 64, 3)) * 255).astype(np.uint8)).save(
            usd_dir / "textures" / "c.png")
        t = UsdShade.Shader.Define(stage, f"/{name}/Looks/M/T")
        t.CreateIdAttr("UsdUVTexture")
        t.CreateInput("file", Sdf.ValueTypeNames.Asset).Set("./textures/c.png")
        sh.CreateInput("diffuseColor", Sdf.ValueTypeNames.Color3f).ConnectToSource(t.ConnectableAPI(), "rgb")
        st = UsdGeom.PrimvarsAPI(mesh).CreatePrimvar("st", Sdf.ValueTypeNames.TexCoord2fArray, UsdGeom.Tokens.faceVarying)
        st.Set(Vt.Vec2fArray.FromNumpy(np.tile([[0, 0], [1, 0], [1, 1], [0, 1]], (6, 1)).astype(np.float32)))
    else:
        sh.CreateInput("diffuseColor", Sdf.ValueTypeNames.Color3f).Set((0.2, 0.5, 0.9))
    mat.CreateSurfaceOutput().ConnectToSource(sh.ConnectableAPI(), "surface")
    UsdShade.MaterialBindingAPI.Apply(mesh.GetPrim()).Bind(mat)
    pm = UsdShade.Material.Define(stage, f"/{name}/Looks/P")
    UsdPhysics.MaterialAPI.Apply(pm.GetPrim()).CreateStaticFrictionAttr(0.7)
    if collider == "cube":
        c = UsdGeom.Cube.Define(stage, f"/{name}/col")
        c.CreateSizeAttr(h)
        c.AddTranslateOp().Set((0, s, 0) if up == "Y" else (0, 0, s))
        UsdGeom.Imageable(c).CreatePurposeAttr(UsdGeom.Tokens.guide)
        UsdPhysics.CollisionAPI.Apply(c.GetPrim())
    elif collider == "decomp":
        UsdPhysics.CollisionAPI.Apply(mesh.GetPrim())
        UsdPhysics.MeshCollisionAPI.Apply(mesh.GetPrim()).CreateApproximationAttr("convexDecomposition")
    md = {"asset_name": name, "category": "test"}
    if license:
        md["asset_license"] = license
    md.update(card_meta or {})
    stage.GetRootLayer().customLayerData = {"SimReady_Metadata": md}
    stage.GetRootLayer().Save()
    pj = {"package_id": f"simready.hf.test.ds.{name}.1", "license": license} if license else {"package_id": "x"}
    (pkg / "com.nvidia.simready.packaging.json").write_text(json.dumps(pj))
    return pkg


class Policy(unittest.TestCase):
    def test_licenses(self):
        ok = lambda *c: license_decision(list(enumerate(c)), POLICY)[0]  # noqa: E731
        self.assertEqual(ok("CC BY 4.0"), "CC-BY-4.0")
        self.assertEqual(ok("cc0-1.0", "CC0"), "CC0-1.0")
        self.assertEqual(ok("https://creativecommons.org/licenses/by/4.0/"), "CC-BY-4.0")
        self.assertIsNone(ok("CC-BY-NC-4.0"))
        self.assertIsNone(ok("cc-by-sa-4.0"))
        self.assertIsNone(ok("CC-BY-ND-4.0"))
        self.assertIsNone(ok("other"))
        self.assertIsNone(ok("NVIDIA Some Custom License"))
        self.assertIsNone(ok(None, ""))
        self.assertIsNone(ok("CC-BY-4.0", "CC0-1.0"))  # conflict
        self.assertEqual(normalize_license(" Apache 2.0 "), "Apache-2.0")

    def test_brands(self):
        self.assertEqual(brand_hits(["Lego_Duplo_brick"], POLICY), ["duplo", "lego"])
        self.assertEqual(brand_hits(["apple_a01", "fruit", "tape_measure"], POLICY), [])
        self.assertEqual(brand_hits(["Cole_Hardware_Mug"], POLICY), ["cole hardware"])

    def test_package_dirs(self):
        files = ["README.md", "a/com.nvidia.simready.packaging.json", "a/simready_usd/a.usd",
                 "cat/b/com.nvidia.simready.packaging.json", "cat/b/x/b.usda"]
        self.assertEqual(package_dirs(files), ["a", "cat/b"])
        self.assertEqual(package_dirs(["m/m.usd", "n/i/n.usdc", "o/p.usd"]), ["m", "n"])

    def test_inject_twin(self):
        scene = '<mujoco><worldbody/><worldbody></worldbody><keyframe><key qpos="1"/></keyframe></mujoco>'
        a, b = split_mjcf('<mujoco><asset><mesh name="m"/></asset><worldbody><body name="o" pos="0 0 0"/></worldbody></mujoco>')
        out = inject(scene, [(a, place(b, "1 2 3"), (1, 2, 3, 1, 0, 0, 0))])
        self.assertIn('<key qpos="1 1 2 3 1 0 0 0"/>', out)
        self.assertIn('<body name="o" pos="1 2 3" quat="1 0 0 0"/>', out)


class SimReadyLayout(unittest.TestCase):
    def test_reader_uses_mujoco_payload(self):
        from test_fixtures import make_simready_layout
        from usd_read import diffuse_texture_files, find_root_usd, read_asset
        with tempfile.TemporaryDirectory() as td:
            pkg = make_simready_layout(td, "factory_nut_test")
            self.assertEqual(find_root_usd(pkg).name, "sm_factory_nut_test_01.usda")
            self.assertEqual(diffuse_texture_files(find_root_usd(pkg), pkg), ["simready_usd/Textures/t_alb.png"])
            a = read_asset(pkg)
            self.assertEqual(a["physics_variant"], "MuJoCo:Enabled")
            self.assertEqual([c["approx"] for c in a["colliders"]], ["convexHull"])
            self.assertAlmostEqual(a["physics"]["mass"], 0.001, places=6)
            self.assertAlmostEqual(a["physics"]["static_friction"], 0.61, places=5)
            self.assertEqual(len(a["visuals"]), 1)
            self.assertTrue(a["visuals"][0]["texture"].endswith("t_alb.png"))
            self.assertIsNotNone(a["visuals"][0]["uv"])
            pkg2 = make_simready_layout(td, "nut_generic", mujoco_override=False)
            self.assertEqual([c["approx"] for c in read_asset(pkg2)["colliders"]], ["convexDecomposition"])

    def test_phase1_filter(self):
        from hf_fetch import phase1_files
        p = "factory_nut_m8_loose"
        keep = ["com.nvidia.simready.packaging.json", ".metadata/LICENSE.txt",
                ".metadata/com.nvidia.simready.root_usds.json", "simready_usd/sm_x_01.usda", "simready_usd/sm_x_01.json",
                "simready_usd/payloads/geometries.usd", "simready_usd/payloads/Physics/physics.usda",
                "simready_usd/runnables/physics/mujoco.usd"]
        drop = ["simready_usd/.thumbs/256x256/sm_x_01.usda.png", "simready_usd/Textures/t_alb.png",
                "simready_usd/source_assets/t_alb.png", "simready_usd/materials/OmniPBR/OmniPBR.mdl",
                "simready_usd/.simready/validation.json"]
        got = sorted(f.split("/", 1)[1] for f, _ in phase1_files([(f"{p}/{f}", 1) for f in keep + drop], p))
        self.assertEqual(got, sorted(keep))

    def test_error_categories(self):
        from hf_fetch import SizeLimit, category

        class R:
            def __init__(self, c):
                self.status_code = c

        class HfHubHTTPError(Exception):
            def __init__(self, c):
                self.response = R(c)
        self.assertEqual(category(HfHubHTTPError(404)), "404 not found")
        self.assertEqual(category(HfHubHTTPError(401)), "auth required")
        self.assertEqual(category(HfHubHTTPError(429)), "rate limit")
        self.assertEqual(category(HfHubHTTPError(503)), "server error")
        self.assertEqual(category(SizeLimit()), "size limit")
        self.assertEqual(category(TimeoutError()), "timeout")
        self.assertEqual(category(ValueError("secret asset text")), "other")


class Pipeline(unittest.TestCase):
    def test_import_fetch_result(self):
        with tempfile.TemporaryDirectory() as td:
            ds, out, rep = Path(td) / "ds", Path(td) / "out", Path(td) / "rep"
            make_package(ds, "box_textured", license="CC-BY-4.0", mass=0.12)
            make_package(ds, "box_plain_zup", license=None, textured=False, collider="decomp", mpu=1.0, up="Z",
                         density=400)
            make_package(ds, "box_nc", license="CC-BY-NC-4.0", mass=0.1)
            make_package(ds, "lego_brick", license="CC0-1.0", mass=0.01)
            make_package(ds, "box_oem", license="CC0-1.0", mass=0.1, card_meta={"manufacturer": "ACME"})
            make_package(ds, "box_huge", license="CC0-1.0", mass=0.1, size=1.2)
            fetch = {"repo": "test/ds", "revision": "0" * 40, "dataset_license": "cc0-1.0",
                     "assets": [{"path": p.name, "local_dir": str(p)} for p in sorted(ds.iterdir())]}
            (Path(td) / "fetch.json").write_text(json.dumps(fetch))
            r = subprocess.run([sys.executable, "-I", str(HERE / "import_assets.py"), "--fetch", str(Path(td) / "fetch.json"),
                                "--out", str(out), "--report-dir", str(rep), "--quiet"], capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr[-800:])
            res = {x["id"]: x for x in json.loads((rep / "import-report.json").read_text())}
            # dataset says CC0 but the package says CC BY -> conflict -> excluded
            self.assertFalse(res["box_textured"]["ok"])
            self.assertIn("conflicting", res["box_textured"]["reason"])
            self.assertTrue(res["box_plain_zup"]["ok"], res["box_plain_zup"])
            self.assertIn("not permissive", res["box_nc"]["reason"])
            self.assertIn("brand", res["lego_brick"]["reason"])
            self.assertIn("brand", res["box_oem"]["reason"])
            self.assertIn("size", res["box_huge"]["reason"])
            rec = json.loads((out / "box_plain_zup" / "box_plain_zup.json").read_text())
            self.assertAlmostEqual(rec["mass_kg"], 400 * 0.05 ** 3, delta=0.2 * 400 * 0.05 ** 3)
            self.assertEqual(rec["conversion"]["hull_source"], "usd")
            self.assertEqual([round(x, 3) for x in rec["size_m"]], [0.05, 0.05, 0.05])
            self.assertEqual(rec["license"], "CC0-1.0")
            self.assertLessEqual((out / "box_plain_zup" / "box_plain_zup.glb").stat().st_size, 307200)

            # same dataset with a CC BY card: the textured box passes, mass from USD, Y-up/cm converted
            fetch["dataset_license"] = "cc-by-4.0"
            fetch["assets"] = [{"path": "box_textured", "local_dir": str(ds / "box_textured")}]
            (Path(td) / "fetch.json").write_text(json.dumps(fetch))
            r = subprocess.run([sys.executable, "-I", str(HERE / "import_assets.py"), "--fetch", str(Path(td) / "fetch.json"),
                                "--out", str(out), "--report-dir", str(rep), "--quiet"], capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr[-800:])
            rec = json.loads((out / "box_textured" / "box_textured.json").read_text())
            self.assertEqual(rec["mass_kg"], 0.12)
            self.assertEqual(rec["friction"], 0.7)
            self.assertEqual([round(x, 3) for x in rec["size_m"]], [0.05, 0.05, 0.05])
            self.assertEqual(rec["conversion"]["usd_up_axis"], "Y")
            self.assertGreater(rec["conversion"]["glb"]["texture"], 0)
            import mujoco
            m = mujoco.MjModel.from_xml_path(str(out / "box_textured" / "box_textured.xml"))
            self.assertAlmostEqual(float(m.body_mass[1]), 0.12, places=5)
            # solid 5 cm cube: I = m a^2 / 6
            self.assertTrue(np.allclose(m.body_inertia[1], 0.12 * 0.05 ** 2 / 6, rtol=0.02), m.body_inertia[1])


    def test_import_simready_layout(self):
        from test_fixtures import make_simready_layout
        with tempfile.TemporaryDirectory() as td:
            ds, out, rep = Path(td) / "ds", Path(td) / "out", Path(td) / "rep"
            make_simready_layout(ds, "factory_nut_m8_loose")
            fetch = {"repo": "test/ds", "revision": "0" * 40, "dataset_license": "cc-by-4.0",
                     "assets": [{"path": "factory_nut_m8_loose", "local_dir": str(ds / "factory_nut_m8_loose")}]}
            (Path(td) / "fetch.json").write_text(json.dumps(fetch))
            r = subprocess.run([sys.executable, "-I", str(HERE / "import_assets.py"), "--fetch", str(Path(td) / "fetch.json"),
                                "--out", str(out), "--report-dir", str(rep), "--quiet"], capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr[-800:])
            res = json.loads((rep / "import-report.json").read_text())[0]
            self.assertTrue(res["ok"], res)
            rec = json.loads((out / "factory_nut_m8_loose" / "factory_nut_m8_loose.json").read_text())
            self.assertEqual(rec["conversion"]["usd_physics_variant"], "MuJoCo:Enabled")
            self.assertEqual(rec["conversion"]["hulls"], 1)        # MuJoCo payload: convexHull
            self.assertAlmostEqual(rec["mass_kg"], 0.001, places=6)
            self.assertEqual(rec["friction"], 0.61)
            self.assertEqual(rec["name_cs"], "Matice M8")
            self.assertEqual(rec["license"], "CC-BY-4.0")


if __name__ == "__main__":
    unittest.main(verbosity=1)
