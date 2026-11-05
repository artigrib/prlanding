"""Compatibility shim: the SO-101 mount library and its generator live in the device package now.
Runs devices/so101/tools/measure_so101.py (writes devices/so101/mounts.json)."""
import os
import runpy

runpy.run_path(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "devices", "so101", "tools", "measure_so101.py"), run_name="__main__")
