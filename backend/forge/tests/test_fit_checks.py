"""Mount-library driven fit checks (forge/sim.py support_check + aim_check).

Regression: the holder published before the fit fixes hung half its seat over the edge of the jaw's flat
face and aimed 40 mm past the TCP; it must fail both checks. The current published example must pass.
Run from backend/forge:  python3 -m unittest tests.test_fit_checks -v      (≈ 15 s)
"""
import json
import os
import shutil
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
FORGE = os.path.dirname(HERE)
sys.path.insert(0, FORGE)
from forge import pipeline, sim  # noqa: E402

FIX = os.path.join(HERE, "fixtures")
EX = os.path.join(FORGE, "examples", "so101-flashlight")


def load(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)


class FitChecksTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dir = tempfile.mkdtemp(prefix="forge-fit-")
        cls.lib = load(pipeline.MOUNTS)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.dir, ignore_errors=True)

    def run_checks(self, stl, interface_id, axis, shift, name):
        it = next(i for i in self.lib["interfaces"] if i["id"] == interface_id)
        xml = sim.model_with_part(stl, it["body"], 0.005, [0, 0, 0], os.path.join(self.dir, f"{name}.xml"), shift)
        target = next(t for t in self.lib["targets"] if t["id"] == axis.get("target", "tcp"))
        return sim.support_check(xml, stl, it), sim.aim_check(xml, axis, target, it["body"])

    def test_library_drives_the_checks(self):
        it = next(i for i in self.lib["interfaces"] if i["id"] == "gripper_cam_face")
        for k in ("face_bounds", "beyond_edge_profile", "support"):
            self.assertIn(k, it)
        self.assertTrue(self.lib["targets"])

    def test_old_design_fails(self):
        fx = load(os.path.join(FIX, "so101_flashlight_v0.json"))
        sup, aim = self.run_checks(os.path.join(FIX, "so101_flashlight_v0_part.stl"), fx["interface"], fx["emitter_axis"], fx["shift"], "v0")
        self.assertFalse(sup["ok"], sup)
        self.assertLess(sup["contact_ratio"], 0.6)
        self.assertGreater(sup["seat_share_outside_flat_face"], 0.4)
        self.assertFalse(aim["ok"], aim)
        self.assertGreater(aim["miss_mm"], 30.0)

    def test_library_sets_max_overhang(self):
        it = next(i for i in self.lib["interfaces"] if i["id"] == "gripper_cam_face")
        self.assertEqual(it["support"]["max_overhang_mm"], 3.0)

    def test_short_foot_design_fails_overhang(self):
        # bd84f15: good contact (91.8 %) and aim, but a strip of the seat at the plate's -x edge and below the
        # foot's z band hung 8.4 mm above the jaw bevel; max_overhang_mm (3 mm, mount data) must reject it
        sup, _ = self.run_checks(os.path.join(FIX, "so101_flashlight_v1_part.stl"), "gripper_cam_face",
                                 {"origin": [-24.9, 30.36, -29.73], "dir": [0.4425, -0.3665, -0.8184]},
                                 {"camera_mount": [0, 3.0, 0]}, "v1")
        self.assertGreaterEqual(sup["contact_ratio"], 0.8)
        self.assertGreater(sup["max_gap_mm"], 8.0)
        self.assertFalse(sup["overhang_ok"], sup)
        self.assertFalse(sup["ok"], sup)

    def test_published_design_passes(self):
        meta = load(os.path.join(EX, "report.json"))["meta"]
        p = meta["params"]
        sup, aim = self.run_checks(os.path.join(EX, "part.stl"), meta["mount_interface"], meta["emitter_axis"],
                                   {"camera_mount": [0, p["plate_t"], 0]}, "current")
        self.assertTrue(sup["ok"], sup)
        self.assertGreaterEqual(sup["contact_ratio"], 0.9)
        self.assertLessEqual(sup["max_gap_mm"], 3.0)
        self.assertTrue(aim["ok"], aim)
        self.assertLess(aim["miss_mm"], 1.0)
        self.assertEqual(aim["blocked_by"], [])


if __name__ == "__main__":
    unittest.main()
