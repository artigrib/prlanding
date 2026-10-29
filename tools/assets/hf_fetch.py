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


# ---------------------------------------------------------------- what to download
SKIP_DIRS = {".thumbs", "source_assets", "dcc_source", "Thumbnails", "thumbnails"}
META_SUFFIXES = (".json", ".txt")


def phase1_files(entries, pkg):
    """USD layers + package metadata only: no images, MDL, thumbnails or source assets."""
    out = []
    for path, size in entries:
        rel = PurePosixPath(path).relative_to(pkg)
        if any(part in SKIP_DIRS for part in rel.parts):
            continue
        if rel.suffix in USD or (rel.suffix in META_SUFFIXES and (len(rel.parts) <= 2 or rel.parts[0] == ".metadata")):
            out.append((path, size))
    return out


# ---------------------------------------------------------------- error categories (fixed strings only)
def category(exc):
    """Map an exception to a fixed category; never echo the message (it may contain asset/remote text)."""
    import errno
    name = type(exc).__name__
    code = None
    resp = getattr(exc, "response", None)
    if resp is not None:
        code = getattr(resp, "status_code", None)
    if name in ("RepositoryNotFoundError", "RevisionNotFoundError", "EntryNotFoundError") or code == 404:
        return "404 not found"
    if name == "GatedRepoError" or code in (401, 403):
        return "auth required"
    if code == 429:
        return "rate limit"
    if code is not None and 500 <= code < 600:
        return "server error"
    if name in ("SizeLimit",):
        return "size limit"
    if "Timeout" in name or isinstance(exc, TimeoutError):
        return "timeout"
    if isinstance(exc, OSError) and getattr(exc, "errno", None) == errno.ENOSPC:
        return "disk full"
    if "xet" in name.lower() or "lfs" in name.lower():
        return "LFS/xet"
    if "Connection" in name or "Network" in name:
        return "network"
    return "other"


class SizeLimit(Exception):
    pass


def retry(fn, tries=4):
    import time
    for k in range(tries):
        try:
            return fn()
        except Exception as e:  # noqa: BLE001
            if category(e) not in ("rate limit", "timeout", "server error", "network") or k == tries - 1:
                raise
            time.sleep(10 * (k + 1) ** 2)


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
    try:
        return run(a, globs, budget)
    except Exception as e:  # noqa: BLE001
        status(f"download: failed before any package ({category(e)})", level="error")
        raise


def run(a, globs, budget):
    from huggingface_hub import HfApi, hf_hub_download
    api = HfApi()
    info = retry(lambda: api.dataset_info(a.repo, revision=a.revision))
    sha = info.sha
    card = info.card_data.to_dict() if info.card_data else {}
    lic = card.get("license")
    if isinstance(lic, list):
        lic = lic[0] if len(lic) == 1 else ",".join(lic)  # several licences -> not a single allowed id
    files = retry(lambda: api.list_repo_files(a.repo, repo_type="dataset", revision=sha))
    pkgs = package_dirs(files)
    match = lambda p, g: fnmatch.fnmatch(p, g) or fnmatch.fnmatch(PurePosixPath(p).name, g)  # noqa: E731
    chosen = [p for p in pkgs if any(match(p, g) for g in globs)]
    unmatched = [g for g in globs if not any(match(p, g) for p in pkgs)]
    status(f"fetch: {len(pkgs)} packages in dataset, {len(chosen)} match, {len(unmatched)} name(s) matched nothing, "
           f"taking up to {a.max_count}")

    out = Path(a.out)
    picked, skipped = [], []
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from usd_read import AssetError, diffuse_texture_files, find_root_usd
    for p in chosen:
        if len(picked) >= a.max_count:
            break
        try:
            tree = [(e.path, e.size or 0) for e in retry(lambda: list(api.list_repo_tree(
                a.repo, path_in_repo=p, repo_type="dataset", revision=sha, recursive=True)))
                if getattr(e, "size", None) is not None]
            sizes = dict(tree)
            want = phase1_files(tree, p)
            # phase 2 needs the USD layers on disk to see which textures the materials use
            for f, _ in want:
                retry(lambda f=f: hf_hub_download(a.repo, f, repo_type="dataset", revision=sha, local_dir=str(out)))
            pkg_dir = out / p
            try:
                tex = diffuse_texture_files(find_root_usd(pkg_dir), pkg_dir)
            except AssetError:
                tex = []
            tex = [f"{p}/{t}" for t in tex if f"{p}/{t}" in sizes]
            total = sum(s for _, s in want) + sum(sizes[t] for t in tex)
            if total > budget["max_download_bytes_per_asset"]:
                raise SizeLimit()
            for f in tex:
                retry(lambda f=f: hf_hub_download(a.repo, f, repo_type="dataset", revision=sha, local_dir=str(out)))
            picked.append({"path": p, "bytes": total, "files": len(want) + len(tex),
                           "package_bytes": sum(sizes.values()), "local_dir": str(pkg_dir)})
        except Exception as e:  # noqa: BLE001  one bad package must not stop the others
            skipped.append({"path": p, "reason": "download: " + category(e)})
    write_json(a.result, {"repo": a.repo, "revision": sha, "dataset_license": lic,
                          "dataset_license_name": card.get("license_name"),
                          "dataset_license_link": card.get("license_link"),
                          "unmatched": unmatched, "assets": picked, "skipped": skipped})
    cats = sorted({s["reason"] for s in skipped})
    status(f"fetch: downloaded {len(picked)} package(s) ({sum(x['bytes'] for x in picked) // 1_000_000} MB), "
           f"skipped {len(skipped)}" + (f" [{'; '.join(cats)}]" if cats else ""))
    if not picked and chosen:
        status("download: no package could be downloaded", level="error")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
