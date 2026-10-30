"""Sandbox tests: malicious inputs are rejected by the policy or killed at run time.

Run from backend/forge:  python3 -m unittest tests.test_sandbox -v
(the run-time cases start real child processes; ≈ 30 s on 2 cores)
"""
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from forge import sandbox  # noqa: E402
from forge.policy import check_source  # noqa: E402

GOOD = "from build123d import *\nimport math\nresult = Box(10, 10, 4) - Cylinder(2, 10)\nmeta = {'r': math.pi}\n"

MALICIOUS = {
    "import os": "import os\nos.system('id')",
    "import subprocess": "import subprocess\nsubprocess.run(['id'])",
    "from os import system": "from os import system",
    "import socket": "import socket",
    "relative import": "from . import x",
    "open()": "data = open('/etc/passwd').read()",
    "__import__": "__import__('os').system('id')",
    "eval": "eval('1+1')",
    "exec": "exec('x=1')",
    "compile": "c = compile('1', 'x', 'eval')",
    "getattr dunder": "getattr((), '__class__')",
    "getattr concat": "getattr((), '_' + '_class_' + '_')",
    "dunder attribute": "x = ().__class__.__bases__[0].__subclasses__()",
    "private attribute": "from build123d import *\nx = Box(1, 1, 1)._wrapped",
    "format string escape": "x = '{0.__class__}'.format(1)",
    "format method": "x = '{0}'.format(1)",
    "globals()": "g = globals()",
    "vars()": "v = vars()",
    "type()": "t = type(1)",
    # native OCCT writers/readers do file I/O in C++ (no Python audit event): the names themselves are denied
    "OCCT STEP writer": "import build123d\napp = build123d.XCAFApp_Application.GetApplication_s()\n"
                        "doc = build123d.TDocStd_Document(build123d.TCollection_ExtendedString('x'))\napp.InitDocument(doc)\n"
                        "st = build123d.XCAFDoc_DocumentTool.ShapeTool_s(doc.Main())\nbox = build123d.Box(2, 2, 2)\n"
                        "st.AddShape(box.wrapped)\nw = build123d.STEPCAFControl_Writer()\nw.Transfer(doc)\n"
                        "w.Perform(doc, '/jobs/spend/' + 'poison.step')\nresult = box",
    "OCCT via star import": "from build123d import *\nw = STEPControl_Writer()\nresult = Box(1, 1, 1)",
    "OCCT reader": "from build123d import *\nr = STEPCAFControl_Reader()\nresult = Box(1, 1, 1)",
    "raw handle": "from build123d import *\nh = Box(1, 1, 1).wrapped\nresult = Box(1, 1, 1)",
    "class def": "class A:\n    pass",
    "global": "def f():\n    global x\n    x = 1",
    "generator frame": "def g():\n    yield 1\nf = g().gi_frame.f_globals",
    "lambda dunder arg": "f = lambda __x: __x",
    "build123d module os": "import build123d\nbuild123d.topology.os.system('id')",
    "build123d module sys": "import build123d\nm = build123d.topology.sys.modules",
    "export to arbitrary path": "from build123d import *\nexport_step(Box(1, 1, 1), '/tmp/x.step')",
    "import_step read": "from build123d import *\nx = import_step('/etc/passwd')",
    "method export": "from build123d import *\nBox(1, 1, 1).export_stl('/tmp/x.stl')",
    "from build123d import export": "from build123d import export_stl",
    "power blow-up": "x = 10 ** 10 ** 10",
    "big exponent": "x = 2 ** 100000",
    "sequence blow-up literal": "x = [0] * 10000000000",
    "huge int literal": "x = 123456789012345",
    "bit shift": "x = 1 << 100000",
    "bytes literal": "x = b'abc'",
    "breakpoint": "breakpoint()",
    "NUL byte": "x = 1\x00",
    "oversize": "x = 1\n" * 40000,
    "syntax error": "def (:",
    "decorator": "def d(f):\n    return f\n@d\ndef g():\n    pass",
    "async": "async def f():\n    pass",
}


class PolicyTests(unittest.TestCase):
    def test_good_source_passes(self):
        self.assertEqual(check_source(GOOD), [])

    def test_flashlight_design_passes(self):
        with open(os.path.join(os.path.dirname(HERE), "designs", "so101_flashlight.py"), encoding="utf-8") as f:
            src = f.read()
        self.assertEqual(check_source(src), [])

    def test_malicious_sources_rejected(self):
        for name, src in MALICIOUS.items():
            with self.subTest(name=name):
                self.assertTrue(check_source(src), f"policy accepted: {name}")

    def test_rejected_source_never_runs(self):
        d = tempfile.mkdtemp(prefix="forge-test-")
        try:
            r = sandbox.run_cad("import os\nos.system('touch /tmp/forge-pwned')", d)
            self.assertFalse(r["ok"])
            self.assertEqual(r["stage"], "policy")
            self.assertFalse(os.path.exists(os.path.join(d, "design.py")))
        finally:
            shutil.rmtree(d, ignore_errors=True)


class RuntimeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.netns = sandbox.netns_available()
        if not cls.netns:
            print("WARNING: network namespaces unavailable here; run-time tests run without the netns layer")

    def setUp(self):
        self.d = tempfile.mkdtemp(prefix="forge-test-")

    def tearDown(self):
        shutil.rmtree(self.d, ignore_errors=True)

    def run_cad(self, src, **kw):
        return sandbox.run_cad(src, self.d, allow_no_netns=not self.netns, **kw)

    def test_valid_design(self):
        r = self.run_cad(GOOD)
        self.assertTrue(r["ok"], r["errors"])
        rep = r["report"]
        self.assertTrue(rep["watertight"])
        self.assertEqual(rep["size_mm"], [10.0, 10.0, 4.0])
        self.assertAlmostEqual(rep["volume_mm3"], 400 - 3.14159 * 4 * 4, delta=1.0)
        self.assertAlmostEqual(rep["mass_solid_g"], rep["volume_mm3"] / 1000 * 1.24, places=2)
        self.assertGreater(rep["wall"]["min_wall_mm"], 2.5)
        for k in ("step", "stl", "report"):
            self.assertTrue(os.path.getsize(r["files"][k]) > 0)

    def test_infinite_loop_killed(self):
        r = self.run_cad("x = 0\nwhile True:\n    x = x + 1\n", timeout_s=6)
        self.assertFalse(r["ok"])
        self.assertIn(r["stage"], ("timeout", "killed"))
        self.assertLess(r["elapsed_s"], 15)

    def test_memory_bomb_stopped(self):
        r = self.run_cad("n = 20000 * 20000\nx = [1.5] * n\nresult = x\n", mem_mb=1536, timeout_s=30)
        self.assertFalse(r["ok"])
        self.assertTrue(r["stage"] == "killed" or any("MemoryError" in e for e in r["errors"]), r)

    def test_growing_memory_stopped(self):
        r = self.run_cad("x = []\nwhile True:\n    x.append([0.5] * 1000000)\n", mem_mb=1536, timeout_s=30)
        self.assertFalse(r["ok"])
        self.assertTrue(r["stage"] in ("killed", "timeout") or any("MemoryError" in e for e in r["errors"]), r)

    def test_recursion_bomb_contained(self):
        r = self.run_cad("def f(n):\n    return f(n + 1)\nf(0)\n", timeout_s=20)
        self.assertFalse(r["ok"])
        self.assertTrue(any("RecursionError" in e for e in r["errors"]), r)

    def test_missing_result(self):
        r = self.run_cad("from build123d import *\nb = Box(1, 1, 1)\n")
        self.assertFalse(r["ok"])
        self.assertIn("result", r["errors"][0])

    def test_isolation_layers(self):
        """The same preexec as run_cad: no network, nobody uid (as root), limits set."""
        probe = (
            "import os, socket, resource, json\n"
            "out = {'uid': os.geteuid()}\n"
            "s = socket.socket(); s.settimeout(2)\n"
            "try:\n    s.connect(('1.1.1.1', 80)); out['net'] = 'open'\n"
            "except OSError as e:\n    out['net'] = 'blocked'\n"
            "out['as'] = resource.getrlimit(resource.RLIMIT_AS)[0]\n"
            "try:\n    open('/root/forge-probe', 'w'); out['write_root'] = 'ok'\n"
            "except OSError:\n    out['write_root'] = 'denied'\n"
            "print(json.dumps(out))\n")
        r = subprocess.run([sys.executable, "-I", "-c", probe], capture_output=True, text=True, timeout=30,
                           preexec_fn=sandbox._preexec(512, 10, 8, 64, self.netns), env={"PATH": "/usr/bin:/bin"})
        import json
        out = json.loads(r.stdout.strip().splitlines()[-1])
        if self.netns:
            self.assertEqual(out["net"], "blocked")
        self.assertEqual(out["as"], 512 * 1024 * 1024)
        if os.geteuid() == 0:
            self.assertEqual(out["uid"], sandbox.NOBODY)
            self.assertEqual(out["write_root"], "denied")


if __name__ == "__main__":
    unittest.main()
