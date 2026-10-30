"""The forge agent's tools: the ONLY things the LLM can make the worker do.

    run_cad(code)                 build123d source -> sandbox (forge-cad container, no network) -> STEP/STL + report
    list_mounts()                 the SO-101 mount-point library (read-only)
    check_fit(part, mount, ...)   MuJoCo: static fit, collision sweep over the joint range, servo torque; printability
    pick_components(query)        search data/components + the forge parts catalogue (read-only)
    render_steps()                render spec for the latest part; renders when a renderer is available

There is no shell, no file access, no network tool. Arguments are validated here; anything else the
model asks for gets an error result. Every result goes through sanitize() before it reaches the model:
strings are cut and stripped of control characters, nesting and list sizes are capped, and the result
is wrapped as data ({"tool": ..., "result": ...}).
"""
import glob
import json
import math
import os
import re
import shutil
import subprocess

from . import checks, sim
from .budget import BudgetExceeded

HERE = os.path.dirname(os.path.abspath(__file__))
FORGE = os.path.dirname(HERE)
ROOT = os.path.abspath(os.path.join(FORGE, "..", ".."))
MOUNTS = os.path.join(HERE, "mounts", "so101.json")
CATALOG = os.path.join(HERE, "parts", "catalog.json")
COMPONENTS_DIR = os.path.join(ROOT, "data", "components")
MAX_CODE = 64 * 1024
SWEEP = {
    "quick": {"shoulder_lift": 3, "elbow_flex": 3, "wrist_flex": 5, "wrist_roll": 3, "gripper": 2},
    "full": None,  # sim.collision_sweep default grid (9 900 poses)
}
# bodies sandwiched under an add-on plate on a mount (they move out along the face normal)
SANDWICH = {"gripper_cam_face": "camera_mount"}
STALL_NM = {"C018 12 V (30 kg·cm)": 2.94, "C001 7.4 V (16.5 kg·cm at 6 V)": 1.62}
CTRL = re.compile(r"[\x00-\x08\x0b-\x1f\x7f‪-‮⁦-⁩]")

TOOL_STEP = {"run_cad": "cad", "list_mounts": "mount", "check_fit": "checks", "pick_components": "parts", "render_steps": "render"}


def _fn(name, desc, props=None, required=()):
    return {"type": "function", "function": {"name": name, "description": desc, "parameters": {
        "type": "object", "properties": props or {}, "required": list(required), "additionalProperties": False}}}


SCHEMAS = [
    _fn("run_cad", "Run build123d Python source in the CAD sandbox. Allowed imports: build123d, math. Assign the final solid "
        "to `result`; optionally a JSON-able dict `meta`. Units mm, frame = the MuJoCo body frame of the mount (see list_mounts). "
        "Returns ok/errors and a geometry report (size, mass, watertight, min wall) and a part id for check_fit.",
        {"code": {"type": "string", "description": "build123d source, at most 64 KB"}}, ["code"]),
    _fn("list_mounts", "List the SO-101 mount points: body frame, faces, screw holes, fasteners, uncertainty."),
    _fn("check_fit", "Simulate a part on a mount in MuJoCo: static fit against the parts of the same link, collision sweep over "
        "the joint range, static servo torque with the added mass, printability (min wall, overhangs).",
        {"part": {"type": "string", "description": "part id from run_cad (e.g. cad-03) or 'latest'"},
         "mount": {"type": "string", "description": "mount id from list_mounts"},
         "added_mass_g": {"type": "number", "description": "extra mass carried by the part (electronics, cable), grams, 0-200"},
         "sandwich_mm": {"type": "number", "description": "plate thickness sandwiched under an existing part on this mount, 0-10 mm"}},
        ["part", "mount"]),
    _fn("pick_components", "Search the curated component data (parts with dated sources). Read-only.",
        {"query": {"type": "string", "description": "a few words, e.g. '10 mm white LED'"}}, ["query"]),
    _fn("render_steps", "Prepare assembly-style renders of the latest part on the robot (renders when a renderer is available)."),
]
TOOL_NAMES = [s["function"]["name"] for s in SCHEMAS]


def sanitize(obj, max_str=2000, depth=6, max_items=40):
    if depth <= 0:
        return "…"
    if isinstance(obj, str):
        s = CTRL.sub("", obj)
        return s if len(s) <= max_str else s[:max_str] + "…"
    if isinstance(obj, bool) or obj is None:
        return obj
    if isinstance(obj, (int, float)):
        return obj if not (isinstance(obj, float) and not math.isfinite(obj)) else None
    if isinstance(obj, dict):
        out = {}
        for i, (k, v) in enumerate(obj.items()):
            if i >= max_items:
                out["…"] = f"{len(obj) - max_items} more"
                break
            out[sanitize(str(k), 80, 1)] = sanitize(v, max_str, depth - 1, max_items)
        return out
    if isinstance(obj, (list, tuple)):
        items = [sanitize(v, max_str, depth - 1, max_items) for v in list(obj)[:max_items]]
        if len(obj) > max_items:
            items.append(f"… {len(obj) - max_items} more")
        return items
    return sanitize(str(obj), max_str, depth, max_items)


def _load(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)


class ToolError(Exception):
    pass


class Toolbox:
    def __init__(self, job_id, job_dir, cad, budget, sweep="quick", render=False, jobs_dir=None):
        self.job_id, self.job_dir, self.cad, self.budget = job_id, job_dir, cad, budget
        self.jobs_dir = jobs_dir or os.path.dirname(job_dir)
        self.out = os.path.join(job_dir, "out")
        os.makedirs(self.out, exist_ok=True)
        self.sweep = sweep if sweep in SWEEP else "quick"
        self.render = render
        self.parts = {}          # "cad-01" -> {"dir", "report"}
        self.latest = None
        self.fits = {}           # (part, mount) -> summary
        self.last_fit = None
        self.components = {}     # id -> component (everything pick_components returned)
        self.renders = []
        self.mounts = _load(MOUNTS)

    # ------------------------------------------------------------------ dispatch
    def dispatch(self, name, raw_args):
        """-> (result for the model (sanitized), event summary, artifacts). Never raises except BudgetExceeded."""
        if name not in TOOL_NAMES:
            return self._wrap(name, {"ok": False, "error": f"unknown tool {str(name)[:40]!r}; available: {', '.join(TOOL_NAMES)}"}), "unknown tool", []
        try:
            args = json.loads(raw_args or "{}") if isinstance(raw_args, str) else (raw_args or {})
            if not isinstance(args, dict):
                raise ToolError("arguments must be a JSON object")
            res, summary, arts = getattr(self, "t_" + name)(**self._check_args(name, args))
        except BudgetExceeded:
            raise
        except ToolError as e:
            res, summary, arts = {"ok": False, "error": str(e)}, str(e)[:200], []
        except (ValueError, TypeError) as e:
            res, summary, arts = {"ok": False, "error": f"bad arguments: {str(e)[:200]}"}, "bad arguments", []
        except Exception as e:  # noqa: BLE001  a tool failure is reported to the model, never crashes the job
            res, summary, arts = {"ok": False, "error": f"tool failed: {type(e).__name__}"}, f"tool failed: {type(e).__name__}", []
        return self._wrap(name, res), summary, arts

    def _wrap(self, name, res):
        return {"tool": name, "result": sanitize(res)}

    def _check_args(self, name, args):
        allowed = set(next(s for s in SCHEMAS if s["function"]["name"] == name)["function"]["parameters"]["properties"])
        extra = set(args) - allowed
        if extra:
            raise ToolError(f"unexpected argument(s): {', '.join(sorted(extra))[:100]}")
        return args

    # ------------------------------------------------------------------ tools
    def t_run_cad(self, code=None):
        if not isinstance(code, str) or not code.strip():
            raise ToolError("code must be a non-empty string")
        if len(code.encode()) > MAX_CODE:
            raise ToolError("code is larger than 64 KB")
        n = self.budget.take_cad()
        pid = f"cad-{n:02d}"
        os.makedirs(os.path.join(self.job_dir, "cad_src"), exist_ok=True)
        with open(os.path.join(self.job_dir, "cad_src", pid + ".py"), "w", encoding="utf-8") as f:
            f.write(code)  # every attempt, also the rejected ones (bundle history/)
        res = self.cad.run(self.job_id, n, code, self.jobs_dir)
        if not res.get("ok"):
            return ({"ok": False, "part": pid, "stage": res.get("stage"), "errors": [str(e)[:600] for e in (res.get("errors") or [])][:8],
                     "stdout_tail": str(res.get("stdout") or "")[-1500:]},
                    f"{pid}: failed at {res.get('stage')}", [])
        d = os.path.join(self.jobs_dir, self.job_id, "cad", f"{n:02d}")
        rep = res["report"]
        self.parts[pid] = {"dir": d, "report": rep}
        self.latest = pid
        self._publish_part(pid)
        brief = {k: rep.get(k) for k in ("size_mm", "bbox_mm", "volume_mm3", "mass_solid_g", "mass_print_g", "watertight", "n_solids",
                                         "occ_valid", "wall", "center_of_mass_mm") if k in rep}
        size = rep.get("size_mm") or [0, 0, 0]
        return ({"ok": True, "part": pid, "report": brief, "meta": rep.get("meta", {})},
                f"{pid}: {size[0]:.1f}×{size[1]:.1f}×{size[2]:.1f} mm, {rep.get('mass_print_g')} g PLA, watertight {rep.get('watertight')}",
                ["design.py", "part.step", "part.stl", "report.json"])

    def _publish_part(self, pid):
        d = self.parts[pid]["dir"]
        for f in ("design.py", "part.step", "part.stl", "report.json"):
            src = os.path.join(d, f)
            if os.path.isfile(src) and not os.path.islink(src):
                shutil.copyfile(src, os.path.join(self.out, f))

    def t_list_mounts(self):
        lib = self.mounts
        keep = ("id", "name", "body", "kind", "plane", "flat_area_mm2", "holes", "hole_pitch_mm", "fastener", "other_features",
                "occupied_by", "clearance_envelope", "use", "uncertainty_mm", "verify", "face_bounds_yz", "features_note", "section",
                "band_width_max_mm", "center")
        out = [{k: it[k] for k in keep if k in it} for it in lib["interfaces"]]
        return ({"robot": lib.get("robot"), "units": lib.get("units"), "frames": lib.get("frames"), "interfaces": out,
                 "sandwich": {k: f"the {v} body sits on this face; pass sandwich_mm to check_fit if your plate goes under it" for k, v in SANDWICH.items()}},
                f"{len(out)} mount points: " + ", ".join(i["id"] for i in out), [])

    def _part(self, part):
        pid = self.latest if part in (None, "", "latest") else part
        if not isinstance(pid, str) or pid not in self.parts:
            raise ToolError(f"unknown part {str(part)[:20]!r}; run run_cad first (known: {', '.join(self.parts) or 'none'})")
        return pid

    def t_check_fit(self, part=None, mount=None, added_mass_g=0.0, sandwich_mm=0.0):
        pid = self._part(part)
        it = next((i for i in self.mounts["interfaces"] if i["id"] == mount), None)
        if it is None:
            raise ToolError(f"unknown mount {str(mount)[:40]!r}")
        extra_g = float(added_mass_g or 0.0)
        sw = float(sandwich_mm or 0.0)
        if not (0 <= extra_g <= 200) or not (0 <= sw <= 10):
            raise ToolError("added_mass_g must be 0-200 and sandwich_mm 0-10")
        P = self.parts[pid]
        rep, stl = P["report"], os.path.join(P["dir"], "part.stl")
        meta = rep.get("meta") or {}
        fdir = os.path.join(self.job_dir, "fit", pid)
        os.makedirs(fdir, exist_ok=True)
        normal = (it.get("plane") or {}).get("normal")
        build_dir = meta.get("print_build_dir") if isinstance(meta.get("print_build_dir"), list) else (normal or [0, 0, 1])
        pr = checks.printability(stl, rep, build_dir)
        part_g = float(rep.get("mass_print_g") or 0.0)
        total_g = round(part_g + extra_g, 2)
        com = rep.get("center_of_mass_mm") or [0, 0, 0]
        shift = None
        if sw > 0 and it["id"] in SANDWICH and normal:
            shift = {SANDWICH[it["id"]]: [round(n * sw, 3) for n in normal]}
        body = it["body"]
        model_xml = sim.model_with_part(stl, body, max(total_g, 1e-6) / 1000.0, com, os.path.join(fdir, "model_with_part.xml"), shift)
        base_xml = sim.model_with_part(stl, body, 1e-9, com, os.path.join(fdir, "model_base.xml"), shift)
        if normal:
            axis = max(range(3), key=lambda k: abs(normal[k]))
            v = it["plane"]["point"][axis]
            seats = (v, v + normal[axis] * sw) if sw else (v,)
        else:
            axis, seats = 1, (1e9,)
        fit = sim.static_fit(model_xml, stl, seat_axis=axis, seat_values=seats)
        coll = sim.collision_sweep(model_xml, part_stl=stl, grid=SWEEP[self.sweep])
        torque = sim.torque_check(base_xml, model_xml, {"total": total_g, "part_print_g": part_g, "extra_g": extra_g}, STALL_NM,
                                  "Static gravity torque, max over a pose grid; dynamic loads not included.")
        rows = [{k: r[k] for k in ("joint", "max_static_nm_without", "max_static_nm_with", "delta_pct", "pct_of_stall_with")} for r in torque["rows"]]
        worst = sorted(coll["exact"]["details"], key=lambda r: r["min_mm"])[:3]
        ok = bool(pr["ok"] and not fit["interference"] and coll["collision_free"])
        summary = {
            "ok": ok, "part": pid, "mount": it["id"], "body": body, "sweep": self.sweep,
            "printability": {k: pr[k] for k in ("min_wall_mm", "min_wall_required_mm", "wall_ok", "overhang_area_mm2_over_45deg", "watertight", "ok") if k in pr},
            "static_fit": {"min_mm": fit["min_mm"], "interference": fit["interference"],
                           "meshes": [{k: m[k] for k in ("mesh", "min_mm", "vertices_inside_part", "max_depth_mm", "deepest_at")} for m in fit["meshes"]]},
            "collision": {"poses": coll["poses"], "poses_checked": coll["poses_checked"], "collision_free": coll["collision_free"],
                          "exact_min_mm": coll["exact"]["min_mm"], "hull_min_mm": coll["hull"]["min_mm"],
                          "poses_penetrating": coll["exact"]["poses_penetrating"],
                          "collisions_only_where_robot_clearance_below_mm": coll["collisions_only_where_robot_clearance_below_mm"],
                          "closest": [{"pose": w["pose"], "min_mm": w["min_mm"], "body": w["closest_body"], "penetrating": w["penetrating"]} for w in worst]},
            "torque": rows, "added_mass_g": total_g,
        }
        full = {"printability": pr, "static_fit": fit, "collision": coll, "torque": torque, "added_mass_g": total_g, "part": pid, "mount": it["id"]}
        with open(os.path.join(self.out, "checks.json"), "w", encoding="utf-8") as f:
            json.dump(full, f, indent=1, ensure_ascii=False)
        self.fits[(pid, it["id"])] = summary
        self.last_fit = summary
        wf = next((r for r in torque["rows"] if r["joint"] == "wrist_flex"), None)
        return (summary, f"{pid} on {it['id']}: wall {pr['min_wall_mm']} mm, fit {'interference' if fit['interference'] else 'ok'} (min {fit['min_mm']} mm), "
                         f"sweep {coll['poses_checked']} poses {'collision-free' if coll['collision_free'] else str(coll['exact']['poses_penetrating']) + ' in contact'}"
                         + (f", wrist_flex +{wf['delta_pct']} %" if wf and wf.get("delta_pct") is not None else ""),
                ["checks.json"])

    def t_pick_components(self, query=None):
        if not isinstance(query, str) or not (2 <= len(query.strip()) <= 200):
            raise ToolError("query must be 2-200 characters")
        words = [w for w in re.findall(r"[a-z0-9áčďéěíňóřšťúůýž.]+", query.lower()) if len(w) >= 2][:12]
        pool = []
        for p in sorted(glob.glob(os.path.join(COMPONENTS_DIR, "*.json"))):
            if p.endswith(".schema.json"):
                continue
            try:
                d = _load(p)
            except ValueError:
                continue
            pool += [c for c in d.get("components", []) if isinstance(c, dict) and c.get("id")]
        cat = _load(CATALOG)
        pool += cat.get("leds", []) + cat.get("others", [])
        scored = []
        for c in pool:
            hay = json.dumps({k: c.get(k) for k in ("id", "name", "name_cs", "role", "specs", "pick", "group")}, ensure_ascii=False).lower()
            s = sum(1 for w in words if w in hay)
            if s:
                scored.append((-s, c["id"], c))
        scored.sort(key=lambda x: (x[0], x[1]))
        out = []
        seen = set()
        for _, cid, c in scored:
            if cid in seen:
                continue
            seen.add(cid)
            self.components[cid] = c
            out.append({"id": cid, "name": c.get("name"), "role": c.get("role"), "specs": c.get("specs"), "pick": c.get("pick"),
                        "constraints": (c.get("constraints") or [])[:3],
                        "sources": [{k: s.get(k) for k in ("supplier", "label", "url", "checked", "status", "recommend", "price", "currency")}
                                    for s in (c.get("sources") or [])][:3]})
            if len(out) >= 6:
                break
        return ({"ok": True, "query": query, "results": out, "note": "prices/stock as of the 'checked' date; status per source"},
                f"{len(out)} component(s) for '{query[:60]}'" + (f": {out[0]['name']}" if out else ""), [])

    def t_render_steps(self):
        pid = self._part("latest")
        P = self.parts[pid]
        body = (self.last_fit or {}).get("body") or "gripper"
        spec = {
            "setup": {"cameraMount": True},
            "parts": [{"key": "forge:part", "body": body, "stl": "part.stl"}],
            "steps": [
                {"id": "01-part", "az": 30, "el": 26, "pose": [0, 0, 0, 0, 0, 0], "solo": ["forge:part"], "frame": ["forge:part"], "zoom": 1.15,
                 "hot": ["forge:part"], "ground": False},
                {"id": "02-arm", "az": 40, "el": 18, "pose": [-0.35, 0.55, 1.15, 0.0, 0.45, 0.0], "frame": ["forge:part"], "zoom": 0.35,
                 "done": ["forge:part"], "hot": ["forge:part"]},
            ],
        }
        with open(os.path.join(self.out, "render_spec.json"), "w", encoding="utf-8") as f:
            json.dump(spec, f, indent=1)
        shutil.copyfile(os.path.join(P["dir"], "part.stl"), os.path.join(self.out, "part.stl"))
        if not self.render or not shutil.which("node"):
            return ({"ok": True, "rendered": False, "views": [s["id"] for s in spec["steps"]],
                     "note": "no renderer in this worker: the render spec is in the bundle; the operator renders it before publishing"},
                    "render spec written; renders skipped (no renderer in the worker)", ["render_spec.json"])
        from .pipeline import run_render  # node + Playwright only (development machines)
        try:
            run_render(self.out)
            files = _load(os.path.join(self.out, "renders", "index.json"))
        except (RuntimeError, OSError, ValueError, subprocess.SubprocessError) as e:
            raise ToolError(f"render failed ({type(e).__name__})") from None
        self.renders = files
        return ({"ok": True, "rendered": True, "views": [s["id"] for s in spec["steps"]]}, f"{len(spec['steps'])} views rendered",
                ["render_spec.json"] + files)
