"""Unitree Go2 device package: schema/metadata always; MuJoCo checks only when the Menagerie meshes are present
(devices/unitree_go2/tools/fetch_model.sh)."""
import json
import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from forge.device import Device, load_device, validate, schema  # noqa: E402

PKG = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(HERE))), "devices", "unitree_go2")
HAVE_ASSETS = os.path.isdir(os.path.join(PKG, "model", "assets")) and len(os.listdir(os.path.join(PKG, "model", "assets"))) > 10


def _read(p):
    with open(p) as f:
        return f.read()


def _j(name):
    with open(os.path.join(PKG, name)) as f:
        return json.load(f)


class Go2Package(unittest.TestCase):
    def test_files_validate(self):
        for f, s in (("device.json", "device"), ("checks.json", "checks"), ("mounts.json", "mounts"), ("ports.json", "ports")):
            self.assertEqual(validate(_j(f), schema(s)), [], f)

    def test_licence_and_pin(self):
        notice = _read(os.path.join(PKG, "model", "NOTICE.txt"))
        self.assertIn("b0655057a9df2abe39ea7fc989914ba6f248301c", notice)
        self.assertIn("BSD-3-Clause", _read(os.path.join(PKG, "model", "LICENSE")) + notice)

    def test_hand_transcribed_values_are_flagged(self):
        for it in _j("mounts.json")["interfaces"]:
            self.assertFalse(it["verified"], it["id"])
            self.assertTrue(it.get("source"), it["id"])
            if it.get("plane") is None:
                self.assertTrue(it.get("todo"), it["id"])
        for p in _j("ports.json")["ports"]:
            self.assertFalse(p["verified"], p["id"])
            self.assertTrue(p.get("source"), p["id"])
            if p.get("location") is None:
                self.assertTrue(p.get("todo"), p["id"])

    def test_payload_from_docs(self):
        pay = _j("device.json")["payload"]
        self.assertEqual((pay["nominal_g"], pay["max_g"]), (8000, 12000))

    def test_not_in_agent_prompt(self):
        from forge import agent
        self.assertEqual(agent.DEVICE_IDS, ("so101",))


@unittest.skipUnless(HAVE_ASSETS, "Go2 meshes missing: run devices/unitree_go2/tools/fetch_model.sh")
class Go2Sim(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import trimesh
        from forge import sim, sim_legged
        cls.sim, cls.L, cls.dev = sim, sim_legged, load_device("unitree_go2")
        cls.tmp = tempfile.mkdtemp(prefix="go2-test-")
        cls.small = os.path.join(cls.tmp, "small.stl")
        trimesh.creation.box((100, 70, 4), trimesh.transformations.translation_matrix((-23.6, 0, 59))).export(cls.small)
        cls.wide = os.path.join(cls.tmp, "wide.stl")  # reaches out over the hips into the thighs' swing
        trimesh.creation.box((500, 300, 4), trimesh.transformations.translation_matrix((0, 0, 59))).export(cls.wide)
        cls.grid = {j: 2 for j in cls.dev.joints}

    def _xml(self, stl, g, name):
        return self.sim.model_with_part(stl, "base", g / 1000.0, [-23.6, 0, 59], os.path.join(self.tmp, name), device=self.dev)

    def test_static_state_stand(self):
        s = self.L.static_state(self.dev.model_xml, self.dev.pose("stand"), self.dev)
        self.assertAlmostEqual(sum(s["foot_forces_n"].values()), s["mass_kg"] * 9.81, delta=0.05)
        self.assertGreater(s["stability_margin_mm"], 50)
        self.assertTrue(all(v < s["limits_nm"][k] for k, v in s["torque_nm"].items()))

    def test_small_plate_fits_and_is_clear(self):
        xml = self._xml(self.small, 40, "small.xml")
        fit = self.sim.static_fit(xml, self.small, seat_axis=2, seat_values=(57.0,))
        self.assertFalse(fit["interference"])
        coll = self.L.leg_sweep(xml, self.small, self.dev, grid=self.grid, poses=["stand", "sit"])
        self.assertTrue(coll["collision_free"])
        self.assertEqual(coll["poses_checked"], 2 * 4 * 8)

    def test_wide_plate_hits_legs(self):
        xml = self._xml(self.wide, 300, "wide.xml")
        coll = self.L.leg_sweep(xml, self.wide, self.dev, grid=self.grid, poses=["stand"], max_exact=5)
        self.assertFalse(coll["collision_free"])
        self.assertTrue(coll["closest"][0]["body"].split("_")[0] in ("FL", "FR", "RL", "RR"))

    def test_payload_light_ok_heavy_fails(self):
        base = self._xml(self.small, 1e-6, "b.xml")
        ok = self.L.payload_check(base, self._xml(self.small, 500, "l.xml"), 500, self.dev)
        self.assertTrue(ok["ok"])
        heavy = self.L.payload_check(base, self._xml(self.small, 15000, "h.xml"), 15000, self.dev)
        self.assertFalse(heavy["ok"])
        self.assertFalse(heavy["within_nominal_payload"])
        r = heavy["rows"][0]["worst_joint"]
        self.assertGreater(r["with_nm"], r["without_nm"])

    def test_smoke_addon_run_cad(self):
        from forge.sandbox import run_cad, netns_available
        src = _read(os.path.join(PKG, "addons", "smoke_plate.py"))
        r = run_cad(src, os.path.join(self.tmp, "cad"), allow_no_netns=not netns_available())
        self.assertTrue(r["ok"], r["errors"])
        stl = os.path.join(self.tmp, "cad", "part.stl")
        xml = self._xml(stl, r["report"]["mass_print_g"], "smoke.xml")
        self.assertFalse(self.sim.static_fit(xml, stl, seat_axis=2, seat_values=(57.0,))["interference"])
        self.assertTrue(self.L.leg_sweep(xml, stl, self.dev, grid=self.grid, poses=["stand", "trot_a"])["collision_free"])


if __name__ == "__main__":
    unittest.main()
