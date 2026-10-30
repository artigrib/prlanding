"""Forge pipeline test: a fresh job (without renders) must reproduce the published outputs exactly.

Run from backend/forge:  python3 -m unittest tests.test_pipeline -v      (≈ 2.5 min, one full job)
If a change is intended, re-publish: python3 -m forge.pipeline "SO-101 s baterkou (flashlight)" --job /tmp/j --publish
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
FORGE = os.path.dirname(HERE)
ROOT = os.path.abspath(os.path.join(FORGE, "..", ".."))
sys.path.insert(0, FORGE)
from forge import pipeline  # noqa: E402
from forge.sandbox import run_cad, netns_available  # noqa: E402

REQUEST = "SO-101 s baterkou (flashlight)"
EX = os.path.join(FORGE, "examples", "so101-flashlight")


def load(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def strip_volatile(steps):
    out = []
    for s in steps:
        s = {k: v for k, v in s.items() if k not in ("elapsed_s",)}
        if s["id"] == "cad":
            s["data"] = {k: v for k, v in s["data"].items() if k != "sandbox"}
        if s["id"] == "render":
            s = {"id": s["id"], "title": s["title"]}
        out.append(s)
    return out


class PipelineTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dir = tempfile.mkdtemp(prefix="forge-pipeline-")
        cls.job = pipeline.run_job(REQUEST, cls.dir, render=False)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.dir, ignore_errors=True)

    def f(self, name):
        return os.path.join(self.dir, name)

    def test_steps_in_order(self):
        self.assertEqual([s["id"] for s in self.job["steps"]], [s[0] for s in pipeline.STEPS])
        st = {s["id"]: s["status"] for s in self.job["steps"]}
        self.assertEqual(st["render"], "skipped")
        for k in ("parse", "mount", "cad", "parts", "guide"):
            self.assertEqual(st[k], "ok", k)
        self.assertIn(st["checks"], ("ok", "warn"))

    def test_cad_matches_published(self):
        self.assertEqual(load(self.f("report.json")), load(os.path.join(EX, "report.json")))
        with open(self.f("design.py"), encoding="utf-8") as a, open(os.path.join(EX, "design.py"), encoding="utf-8") as b:
            self.assertEqual(a.read(), b.read())

    def test_checks_match_published(self):
        self.assertEqual(load(self.f("checks.json")), load(os.path.join(EX, "checks.json")))
        self.assertEqual(load(self.f("electrical.json")), load(os.path.join(EX, "electrical.json")))

    def test_check_values(self):
        c = load(self.f("checks.json"))
        self.assertTrue(c["printability"]["wall_ok"])
        self.assertGreaterEqual(c["printability"]["min_wall_mm"], 1.2)
        self.assertFalse(c["static_fit"]["interference"])
        self.assertLessEqual(c["added_mass_g"], 15)
        col = c["collision"]
        self.assertGreater(col["poses_checked"], 5000)
        # any contact must be in poses where the robot itself is already within 3 mm of that link
        if not col["collision_free"]:
            self.assertLess(col["collisions_only_where_robot_clearance_below_mm"], 3.0)
        e = load(self.f("electrical.json"))
        self.assertLessEqual(e["recommended"]["circuit"]["i_ma"]["max"], 20.0)

    def test_site_outputs_match(self):
        for lang in ("cs", "en"):
            with open(self.f(f"guide.{lang}.html"), encoding="utf-8") as a, open(pipeline.PUBLISH[f"guide_{lang}"], encoding="utf-8") as b:
                self.assertEqual(a.read(), b.read(), f"tools/content/forge-flashlight.{lang}.html is stale")
        self.assertEqual(load(self.f("bom_delta.json")), load(pipeline.PUBLISH["bom"]))
        lab = load(pipeline.PUBLISH["lab"])
        self.assertEqual(strip_volatile(self.job["steps"]), strip_volatile(lab["steps"]))
        self.assertEqual({k: v for k, v in self.job["summary"].items()}, lab["summary"])

    def test_guide_labels(self):
        with open(self.f("guide.cs.html"), encoding="utf-8") as a, open(self.f("guide.en.html"), encoding="utf-8") as b:
            cs, en = a.read(), b.read()
        self.assertIn("komunitní návrh – ověřeno pouze v simulaci", cs.lower())
        self.assertIn("ověřit na tisku", cs)
        self.assertIn("verified in simulation only", en)
        self.assertNotRegex(en, r"[ěřůčšžťďňĚŘŮČŠŽŤĎŇ]")
        self.assertNotIn("{{", cs + en)

    def test_bom_sources(self):
        bom = load(pipeline.PUBLISH["bom"])
        gen = bom["meta"]["generated"]
        comps = {c["id"]: c for c in bom["components"]}
        for c in bom["components"]:
            for s in c["sources"]:
                where = f"{c['id']}/{s['id']}"
                self.assertRegex(s["url"], r"^https://\S+$", where)
                self.assertRegex(s["checked"], r"^20\d\d-[01]\d-[0-3]\d$", where)
                self.assertLessEqual(s["checked"], gen, where)
                self.assertIn(s["status"], ("verified", "carried", "unverified", "estimate"), where)
                self.assertIn(s["supplier"], bom["suppliers"], where)
                if s.get("price") is not None:
                    self.assertTrue(s.get("currency"), where)
        for line in bom["delta"]["lines"]:
            src = next(s for s in comps[line["component"]]["sources"] if s["id"] == line["source"])
            self.assertTrue(src["recommend"], line)

    def test_mount_library_up_to_date(self):
        r = subprocess.run([sys.executable, os.path.join(FORGE, "tools", "measure_so101.py"), "--check"], capture_output=True, text=True, cwd=ROOT)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)


class ParametricTest(unittest.TestCase):
    def test_led_diameter_parameter(self):
        """Same source, 5 mm LED: still builds, smaller bore and lighter part."""
        brain = pipeline.ScriptedBrain()
        lib = load(pipeline.MOUNTS)
        mount = next(i for i in lib["interfaces"] if i["id"] == "gripper_cam_face")
        p = brain.params({}, mount, [12.0, -0.218, -98.127])
        p.update(led_d=5.0, flange_d=6.2, flange_h=1.0)
        d = tempfile.mkdtemp(prefix="forge-param-")
        try:
            r = run_cad(brain.write_cad(p), d, allow_no_netns=not netns_available())
            self.assertTrue(r["ok"], r["errors"])
            self.assertAlmostEqual(r["report"]["meta"]["bore_d"], 5.25)
            self.assertLess(r["report"]["mass_print_g"], load(os.path.join(EX, "report.json"))["mass_print_g"])
        finally:
            shutil.rmtree(d, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
