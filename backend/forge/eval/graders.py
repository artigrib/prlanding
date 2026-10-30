"""Automatic graders for one finished forge job (files in <job>/out, as the worker writes them).

grade(task, out_dir, status) -> {"pass": bool, "checks": {name: {"ok": bool, "value": ...}}}

Checks: the job finished (status done), a valid single watertight solid, check_fit was run on one of the
task's mounts with no interference (and, if the task asks, collision-free over the sweep), thinnest wall
>= min_wall_mm, printed mass <= max_mass_g, bounding box within max_bbox_mm (sorted, orientation-free).
Pure file reading: no LLM, no network; CI tests them against the recorded mock flashlight job.
"""
import json
import os


def _load(p):
    try:
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def grade(task, out_dir, status):
    rep = _load(os.path.join(out_dir, "report.json")) or {}
    chk = _load(os.path.join(out_dir, "checks.json")) or {}
    c = {}
    c["finished"] = {"ok": status == "done", "value": status}
    c["valid_solid"] = {"ok": bool(rep) and rep.get("watertight") is True and rep.get("n_solids") == 1 and rep.get("occ_valid") is not False,
                        "value": {"watertight": rep.get("watertight"), "n_solids": rep.get("n_solids")}}
    sf = chk.get("static_fit") or {}
    coll = chk.get("collision") or {}
    on_mount = chk.get("mount") in task["mounts"]
    fit_ok = on_mount and sf.get("interference") is False
    if task.get("require_collision_free"):
        fit_ok = fit_ok and coll.get("collision_free") is True
    c["fits_mount"] = {"ok": bool(fit_ok), "value": {"mount": chk.get("mount"), "interference": sf.get("interference"),
                                                       "collision_free": coll.get("collision_free")}}
    wall = (rep.get("wall") or {}).get("min_wall_mm")
    c["min_wall"] = {"ok": isinstance(wall, (int, float)) and wall >= task.get("min_wall_mm", 1.2), "value": wall}
    mass = rep.get("mass_print_g")
    c["mass"] = {"ok": isinstance(mass, (int, float)) and mass <= task["max_mass_g"], "value": mass}
    size = rep.get("size_mm")
    ok_bbox = isinstance(size, list) and len(size) == 3 and all(a <= b for a, b in zip(sorted(size), sorted(task["max_bbox_mm"])))
    c["bbox"] = {"ok": ok_bbox, "value": size}
    return {"pass": all(v["ok"] for v in c.values()), "checks": c}
