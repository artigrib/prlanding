# Smoke-test add-on for the Unitree Go2 package: a 120 x 80 x 4 mm plate with a 30 mm boss, sitting on the
# mesh-measured back top face (z = 57 mm, base frame, mm). NOT a real dock-rail part: the rail profile is
# unknown (mounts.json dock_rails geometry = null + TODO); this only exercises run_cad -> fit -> collision -> payload.
from build123d import *

PARAMS = {"w": 120.0, "d": 80.0, "t": 4.0, "boss_d": 30.0, "boss_h": 30.0, "cx": -23.6, "top_z": 57.0}
P = PARAMS
plate = Pos(P["cx"], 0, P["top_z"] + P["t"] / 2) * Box(P["w"], P["d"], P["t"])
boss = Pos(P["cx"], 0, P["top_z"] + P["t"] + P["boss_h"] / 2) * Cylinder(P["boss_d"] / 2, P["boss_h"])
result = plate + boss
meta = {"frame": "base body, mm", "mount_interface": "back_top_face", "print_build_dir": [0, 0, -1], "params": P}
