"""Device packages: loader, schema validation of devices/*, and that forge reads SO-101 from devices/so101.

    python3 -m unittest tests.test_device -v
"""
import copy
import json
import os
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from forge import device as dv  # noqa: E402


class SchemaFiles(unittest.TestCase):
    def test_schemas_are_json_with_titles(self):
        for n in ("device", "mounts", "ports", "checks"):
            s = dv.schema(n)
            self.assertEqual(s["type"], "object", n)
            self.assertTrue(s.get("title"), n)

    def test_every_device_validates(self):
        ids = dv.list_devices()
        self.assertIn("so101", ids)
        for i in ids:
            d = dv.Device(i)
            self.assertEqual(dv.validate(d.spec, dv.schema("device")), [])
            self.assertEqual(dv.validate(d.mounts, dv.schema("mounts")), [])
            if d.ports is not None:
                self.assertEqual(dv.validate(d.ports, dv.schema("ports")), [])
            self.assertEqual(dv.validate(d.checks, dv.schema("checks")), [])

    def test_validator_rejects(self):
        s = dv.schema("mounts")
        bad = {"robot": "x", "units": "inch", "interfaces": [{"id": "a", "body": "b", "kind": "glue",
                                                               "edge_limits": {"min_contact_ratio": 1.5},
                                                               "fastener_spec": {"thread": "3mm"}}]}
        errs = " | ".join(dv.validate(bad, s))
        for frag in ("units", "kind", "min_contact_ratio", "thread"):
            self.assertIn(frag, errs)
        self.assertTrue(dv.validate({"robot": "x", "units": "mm"}, s))  # missing interfaces
        self.assertEqual(dv.validate({"robot": "x", "units": "mm", "interfaces": [
            {"id": "a", "body": "b", "kind": "screw_face", "fastener": "M3 prose",
             "support_polygon": [[0, 0], [1, 0], [1, 1]], "keep_out": [{"kind": "swept", "joint": "gripper"}]}]}, s), [])


class So101(unittest.TestCase):
    def setUp(self):
        self.d = dv.load_device("so101")

    def test_paths(self):
        self.assertTrue(os.path.isfile(self.d.model_xml))
        self.assertTrue(self.d.model_xml.endswith(os.path.join("sim", "so101", "model", "so101.xml")))
        self.assertTrue(os.path.isdir(os.path.join(self.d.model_dir, self.d.meshdir)))

    def test_values_match_previous_constants(self):
        d = self.d
        self.assertEqual(d.grid("quick"), {"shoulder_lift": 3, "elbow_flex": 3, "wrist_flex": 5, "wrist_roll": 3, "gripper": 2})
        self.assertEqual(d.grid("full"), {"shoulder_lift": 5, "elbow_flex": 5, "wrist_flex": 11, "wrist_roll": 9, "gripper": 4})
        self.assertEqual(d.grid("torque"), {"shoulder_lift": 9, "elbow_flex": 9, "wrist_flex": 9, "wrist_roll": 5})
        self.assertEqual(d.torque_joints, ["shoulder_lift", "elbow_flex", "wrist_flex", "wrist_roll", "gripper"])
        self.assertEqual(d.sandwich, {"gripper_cam_face": "camera_mount"})
        self.assertEqual(d.default_mount, "gripper_cam_face")
        self.assertEqual(d.tcp_site, "gripperframe")
        self.assertEqual(d.stall_nm, {"C018 12 V (30 kg·cm)": 2.94, "C001 7.4 V (16.5 kg·cm at 6 V)": 1.62})
        self.assertEqual(d.check("fit", "seat_tol_mm"), 0.3)
        self.assertEqual(d.check("collision", "margin_mm"), 2.0)
        self.assertEqual(d.mount("gripper_cam_face")["body"], "gripper")

    def test_joints_and_sites_exist_in_model(self):
        import mujoco
        m = mujoco.MjModel.from_xml_path(self.d.model_xml)
        for j in set(self.d.joints) | set(self.d.torque_joints) | set(self.d.grid("full")) | set(self.d.pose("work")):
            m.joint(j)
        m.site(self.d.tcp_site)
        for it in self.d.mounts["interfaces"]:
            m.body(it["body"])
        for b in self.d.sandwich.values():
            m.body(b)

    def test_hooks_for_fit_checks(self):
        # contact-ratio / aim checks (branch forge-fit-fixes) read these; disabled sections are not run yet
        self.assertEqual(self.d.check("fit", "min_contact_ratio"), 0.8)
        self.assertFalse(self.d.enabled("function"))
        self.assertEqual(self.d.check("function", "targets")[0]["site"], "gripperframe")

    def test_forge_modules_use_device(self):
        from forge import agent, sim, tools
        self.assertEqual(sim.MODEL_DIR, self.d.model_dir)
        self.assertEqual(tools.MOUNTS, self.d.path(self.d.spec["mounts"]))
        self.assertEqual(tools.SWEEP["quick"], self.d.grid("quick"))
        self.assertIn("so101", agent.DEVICE_IDS)
        self.assertIn('"so101" | "other"', agent.SYSTEM_PARSE)
        self.assertIn("SO-101 robot arm", agent.SYSTEM_DESIGN)


class Loader(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        src = os.path.join(dv.DEVICES, "so101")
        self.dst = os.path.join(self.tmp, "so101")
        shutil.copytree(src, self.dst)

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def _write(self, spec):
        with open(os.path.join(self.dst, "device.json"), "w") as f:
            json.dump(spec, f)

    def _spec(self):
        with open(os.path.join(self.dst, "device.json")) as f:
            return json.load(f)

    def test_copy_loads(self):
        self.assertEqual(dv.Device("so101", devices_dir=self.tmp).id, "so101")

    def test_errors(self):
        with self.assertRaises(dv.DeviceError):
            dv.Device("../etc", devices_dir=self.tmp)
        with self.assertRaises(dv.DeviceError):
            dv.Device("nope", devices_dir=self.tmp)
        base = self._spec()
        for mut in (lambda s: s.pop("sweep"), lambda s: s.update(default_mount="no_such_mount"),
                    lambda s: s["model"].update(xml="missing.xml"), lambda s: s.update(id="other"),
                    lambda s: s["sweep"]["quick"].update(gripper=0)):
            s = copy.deepcopy(base)
            mut(s)
            self._write(s)
            with self.assertRaises(dv.DeviceError):
                dv.Device("so101", devices_dir=self.tmp)


if __name__ == "__main__":
    unittest.main()
