"""Import gate + batch conversion into sim/so101/objects/.

For every candidate asset:  licence gate -> brand gate -> convert.py -> drop test (validate.py) -> keep or drop.
Writes a JSON + Markdown report (included/excluded with reasons) and leaves manifest regeneration to manifest.py.

Sources:
  --spec specs/gso-poc.json --root <dir>   local assets listed in a spec (kind "gso" packages are wrapped into
                                           SimReady-style USD with gso2usd.py first; kind "usd" are used as-is)
  --fetch <fetch.json>                     result of hf_fetch.py (downloaded Hugging Face SimReady packages)

Usage: python -I tools/assets/import_assets.py (--spec S --root R | --fetch F) [--out sim/so101/objects]
                                               [--report-dir DIR] [--quiet]
"""
import argparse
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import (HERE, OBJECTS_DIR, ID_RE, brand_hits, detail, license_decision, load_policy,  # noqa: E402
                    metadata_brand_fields, safe_id, status, write_json)
from convert import ConvertError, convert  # noqa: E402
from usd_read import AssetError, find_root_usd  # noqa: E402
import validate  # noqa: E402

NAMES_CS = {k: v for k, v in json.loads((HERE / "names_cs.json").read_text(encoding="utf-8")).items()
            if not k.startswith("_")}


def czech_name(text):
    for tok in re.split(r"[^a-z]+", str(text).lower()):
        if tok in NAMES_CS:
            return NAMES_CS[tok]
    return None


def root_metadata(pkg):
    """Licence/metadata read from the root layer only (payloads closed) - used before any conversion."""
    from pxr import Sdf
    out = {"packaging": {}, "metadata": {}}
    try:
        root = find_root_usd(Path(pkg))
    except AssetError:
        return out
    pj = Path(pkg) / "com.nvidia.simready.packaging.json"
    if pj.is_file():
        try:
            out["packaging"] = json.loads(pj.read_text(encoding="utf-8"))
        except ValueError:
            pass
    layer = Sdf.Layer.FindOrOpen(str(root))
    if layer is not None:
        md = layer.customLayerData.get("SimReady_Metadata", {})
        out["metadata"] = {str(k): (v if isinstance(v, (str, int, float, bool)) else str(v)) for k, v in dict(md).items()}
    return out


def candidates_from_spec(spec_path, root, work):
    spec = json.loads(Path(spec_path).read_text(encoding="utf-8"))
    ds = spec.get("dataset", {})
    for a in spec["assets"]:
        src = Path(root) / a["path"]
        pkg = src
        if spec.get("kind") == "gso":
            pkg = Path(work) / a["path"]
            cmd = [sys.executable, "-I", str(HERE / "gso2usd.py"), str(src), str(pkg), "--name", a["path"],
                   "--license", a.get("license", ds.get("license", "")), "--category", a.get("category", "object")]
            if a.get("mass"):
                cmd += ["--mass", str(a["mass"] / a.get("scale", 1.0) ** 3)]  # USD carries the unscaled scan's mass
            if a.get("friction"):
                cmd += ["--friction", str(a["friction"])]
            subprocess.run(cmd, check=True, capture_output=True)
        yield {"spec": a, "package": pkg, "dataset_license": ds.get("license"),
               "physics_in_usd": spec.get("kind") == "gso",  # mass/friction were authored into the USD
               "source": {"dataset": ds.get("url"), "path": a["path"]}}


def candidates_from_fetch(fetch_path):
    f = json.loads(Path(fetch_path).read_text(encoding="utf-8"))
    for a in f["assets"]:
        aid = safe_id(Path(a["path"]).name)
        yield {"spec": {"id": aid, "path": a["path"]}, "package": Path(a["local_dir"]),
               "dataset_license": f.get("dataset_license"),
               "dataset_license_extra": f.get("dataset_license_name") or f.get("dataset_license_link"),
               "source": {"repo": f["repo"], "revision": f["revision"], "path": a["path"],
                          "url": f"https://huggingface.co/datasets/{f['repo']}/tree/{f['revision']}/{a['path']}"}}


def process(c, out_root, policy):
    s = c["spec"]
    oid = s["id"]
    if not ID_RE.match(oid):
        return {"id": oid, "ok": False, "reason": "invalid id"}
    rm = root_metadata(c["package"])
    md, pk = rm["metadata"], rm["packaging"]
    lic_candidates = [("spec", s.get("license")), ("dataset", c.get("dataset_license")),
                      ("package", pk.get("license")), ("usd", md.get("asset_license"))]
    if c.get("dataset_license") == "other":  # HF card "license: other" -> the named custom licence decides
        lic_candidates[1] = ("dataset", c.get("dataset_license_extra"))
    spdx, url, why = license_decision(lic_candidates, policy)
    if not spdx:
        return {"id": oid, "ok": False, "reason": why}

    texts = [oid, s.get("path"), s.get("name_en"), s.get("name_cs"), md.get("asset_name"), md.get("category"),
             md.get("description"), md.get("asset_type"), pk.get("package_id")]
    hits = brand_hits(texts, policy) + metadata_brand_fields(md, policy)
    if hits and not s.get("brand_review"):
        return {"id": oid, "ok": False, "reason": "possible trademark/brand: " + ", ".join(hits)}

    name_en = s.get("name_en") or md.get("asset_name") or Path(s["path"]).name.replace("_", " ")
    name_cs = s.get("name_cs") or czech_name(name_en) or czech_name(s["path"])
    attribution = s.get("attribution") or (
        f"\"{name_en}\" from {c['source'].get('repo', 'unknown source')}"
        + (f" by {md['author']}" if md.get("author") else "") + f", {spdx}; converted by printedrobotics.cz")
    try:
        rec = convert(c["package"], oid, out_root, license_id=spdx, license_url=url, scale=s.get("scale", 1.0),
                      mass=None if c.get("physics_in_usd") else s.get("mass"),
                      friction=None if c.get("physics_in_usd") else s.get("friction"), name_cs=name_cs or name_en, name_en=name_en,
                      category=s.get("category") or md.get("category"), attribution=attribution,
                      source_url=s.get("source_url") or c["source"].get("url"), source=c["source"], policy=policy)
    except (ConvertError, AssetError) as e:
        shutil.rmtree(Path(out_root) / oid, ignore_errors=True)
        return {"id": oid, "ok": False, "reason": f"conversion: {e}"}
    except Exception as e:  # malformed USD etc.
        shutil.rmtree(Path(out_root) / oid, ignore_errors=True)
        return {"id": oid, "ok": False, "reason": f"conversion error: {type(e).__name__}"}
    if not name_cs:
        rec["name_cs_auto"] = True
        write_json(Path(out_root) / oid / f"{oid}.json", rec)
    if s.get("brand_review"):
        rec["brand_review"] = s["brand_review"]
        write_json(Path(out_root) / oid / f"{oid}.json", rec)

    v = validate.validate_object(Path(out_root) / oid)
    if not v["ok"]:
        shutil.rmtree(Path(out_root) / oid, ignore_errors=True)
        return {"id": oid, "ok": False, "reason": "drop test failed: " + "; ".join(v["errors"])}
    return {"id": oid, "ok": True, "license": spdx, "glb_bytes": rec["conversion"]["glb"]["bytes"],
            "hulls": rec["conversion"]["hulls"], "mass_kg": rec["mass_kg"], "size_m": rec["size_m"],
            "drop": v["drop"], "path": s.get("path")}


def report_md(results):
    inc = [r for r in results if r["ok"]]
    exc = [r for r in results if not r["ok"]]
    lines = ["# Object import report", "", f"Included: {len(inc)} · excluded: {len(exc)}", ""]
    if inc:
        lines += ["| id | source path | licence | GLB KB | hulls | mass kg | size m | settle s |",
                  "|---|---|---|---|---|---|---|---|"]
        for r in inc:
            lines.append(f"| {r['id']} | `{r.get('path')}` | {r['license']} | {r['glb_bytes'] / 1024:.0f} | {r['hulls']} | "
                         f"{r['mass_kg']} | {' × '.join(str(x) for x in r['size_m'])} | {r['drop']['settle_s']} |")
    if exc:
        lines += ["", "## Excluded", "", "| id | reason |", "|---|---|"]
        for r in exc:
            lines.append(f"| {r['id']} | {r['reason'].replace('|', '/')} |")
    return "\n".join(lines) + "\n"


def main():
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--spec")
    g.add_argument("--fetch")
    ap.add_argument("--root")
    ap.add_argument("--out", default=str(OBJECTS_DIR))
    ap.add_argument("--report-dir", default=".")
    ap.add_argument("--quiet", action="store_true")
    a = ap.parse_args()
    policy = load_policy()
    results = []
    with tempfile.TemporaryDirectory() as work:
        cands = candidates_from_spec(a.spec, a.root, work) if a.spec else candidates_from_fetch(a.fetch)
        for c in cands:
            r = process(c, a.out, policy)
            results.append(r)
            if not a.quiet:
                detail(json.dumps(r, ensure_ascii=False))
    rd = Path(a.report_dir)
    rd.mkdir(parents=True, exist_ok=True)
    write_json(rd / "import-report.json", results)
    (rd / "import-report.md").write_text(report_md(results), encoding="utf-8")
    n_ok = sum(r["ok"] for r in results)
    status(f"import: {n_ok} included, {len(results) - n_ok} excluded")
    return 0


if __name__ == "__main__":
    sys.exit(main())
