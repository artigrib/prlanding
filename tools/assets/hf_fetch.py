"""Download ONLY the requested SimReady packages from a Hugging Face dataset (huggingface_hub, allow_patterns).

  python -I tools/assets/hf_fetch.py --repo nvidia/PhysicalAI-SimReady-Example --assets "apple*,mug_a01" \
      --max-count 5 [--revision main] --out "$RUNNER_TEMP/hf" --result fetch.json

--assets: comma-separated names or fnmatch globs, matched against package folder paths (e.g. "fruits/apple*",
"*mug*"). A package folder is one that holds com.nvidia.simready.packaging.json, or else a USD named after its
folder (directly or one intermediate folder down). The revision is pinned to the commit SHA it resolves to.
Packages over policy.budget.max_download_bytes_per_asset are skipped. The dataset card licence is recorded;
the licence gate itself runs in import_assets.py. Writes fetch.json for import_assets.py --fetch.
"""
import argparse
import fnmatch
import json
import re
import sys
from pathlib import Path, PurePosixPath

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import load_policy, status, write_json  # noqa: E402

REPO_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}/[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$")
GLOB_RE = re.compile(r"^[A-Za-z0-9_.*?/\-\[\]]{1,200}$")
REV_RE = re.compile(r"^[A-Za-z0-9_.\-/]{1,100}$")
USD = (".usd", ".usda", ".usdc", ".usdz")
PKG_FILE = "com.nvidia.simready.packaging.json"


def package_dirs(files):
    """Package folders from a flat file list."""
    dirs = set()
    for f in files:
        p = PurePosixPath(f)
        if p.name == PKG_FILE and str(p.parent) != ".":
            dirs.add(str(p.parent))
    if dirs:
        return sorted(dirs)
    for f in files:  # no packaging files: <name>/<name>.usd or <name>/<intermediate>/<name>.usd
        p = PurePosixPath(f)
        if p.suffix in USD:
            if p.parent.name == p.stem:
                dirs.add(str(p.parent))
            elif p.parent.parent.name == p.stem:
                dirs.add(str(p.parent.parent))
    return sorted(dirs)


def parse_globs(text):
    globs = [g.strip() for g in text.split(",") if g.strip()]
    if not globs or any(not GLOB_RE.match(g) or ".." in g for g in globs):
        raise SystemExit("invalid --assets")
    return globs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", required=True)
    ap.add_argument("--assets", required=True)
    ap.add_argument("--max-count", type=int, default=5)
    ap.add_argument("--revision", default="main")
    ap.add_argument("--out", required=True)
    ap.add_argument("--result", default="fetch.json")
    a = ap.parse_args()
    if not REPO_RE.match(a.repo) or not REV_RE.match(a.revision) or not (1 <= a.max_count <= 50):
        raise SystemExit("invalid --repo / --revision / --max-count")
    globs = parse_globs(a.assets)
    budget = load_policy()["budget"]

    from huggingface_hub import HfApi, snapshot_download
    api = HfApi()
    info = api.dataset_info(a.repo, revision=a.revision)
    sha = info.sha
    card = info.card_data.to_dict() if info.card_data else {}
    lic = card.get("license")
    if isinstance(lic, list):
        lic = lic[0] if len(lic) == 1 else ",".join(lic)  # several licences -> not a single allowed id
    files = api.list_repo_files(a.repo, repo_type="dataset", revision=sha)
    pkgs = package_dirs(files)
    chosen = [p for p in pkgs if any(fnmatch.fnmatch(p, g) or fnmatch.fnmatch(PurePosixPath(p).name, g) for g in globs)]
    status(f"fetch: {len(pkgs)} packages in dataset, {len(chosen)} match, taking up to {a.max_count}")

    picked, skipped = [], []
    for p in chosen:
        if len(picked) >= a.max_count:
            break
        size = sum((e.size or 0) for e in api.list_repo_tree(a.repo, path_in_repo=p, repo_type="dataset",
                                                               revision=sha, recursive=True)
                   if getattr(e, "size", None) is not None)
        if size > budget["max_download_bytes_per_asset"]:
            skipped.append({"path": p, "reason": "package too large"})
            continue
        picked.append({"path": p, "bytes": size})
    out = Path(a.out)
    if picked:
        snapshot_download(a.repo, repo_type="dataset", revision=sha, local_dir=str(out),
                          allow_patterns=[f"{p['path']}/**" for p in picked])
    for p in picked:
        p["local_dir"] = str(out / p["path"])
    write_json(a.result, {"repo": a.repo, "revision": sha, "dataset_license": lic,
                          "dataset_license_name": card.get("license_name"),
                          "dataset_license_link": card.get("license_link"),
                          "assets": picked, "skipped": skipped})
    status(f"fetch: downloaded {len(picked)} package(s), skipped {len(skipped)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
