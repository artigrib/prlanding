"""Shared helpers for tools/assets: policy, licence normalisation, brand screening, quiet status output.

All asset files handled by these tools are untrusted data. Nothing here executes content from an asset;
USD is parsed with usd-core (no plugins are loaded from the asset) and only geometry/metadata is read.
"""
import json
import os
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
OBJECTS_DIR = REPO / "sim" / "so101" / "objects"
SCENE_XML = REPO / "sim" / "so101" / "model" / "scene.xml"
ID_RE = re.compile(r"^[a-z][a-z0-9_]{1,31}$")


def load_policy(path=None):
    return json.loads(Path(path or HERE / "policy.json").read_text(encoding="utf-8"))


def status(msg, level="notice"):
    """Fixed, content-free status line. In GitHub Actions it becomes a notice/warning/error annotation.
    Callers must never pass asset-derived text here (the import log of a public repo is public)."""
    if os.environ.get("GITHUB_ACTIONS") == "true":
        print(f"::{level}::{msg}", flush=True)
    else:
        print(msg, file=sys.stderr, flush=True)


def detail(msg):
    """Free-form (possibly asset-derived) diagnostics: local runs only, never in the public CI log.
    In CI the same information goes into the report files that become part of the import PR."""
    if os.environ.get("GITHUB_ACTIONS") != "true":
        print(msg, file=sys.stderr, flush=True)


# ---------------------------------------------------------------- licences
_LICENSE_ALIASES = {
    "cc0": "CC0-1.0", "cc0-1.0": "CC0-1.0", "cc0 1.0": "CC0-1.0", "public domain": "CC0-1.0",
    "cc-by-4.0": "CC-BY-4.0", "cc by 4.0": "CC-BY-4.0", "cc-by 4.0": "CC-BY-4.0", "creative commons attribution 4.0": "CC-BY-4.0",
    "cc-by-3.0": "CC-BY-3.0", "cc by 3.0": "CC-BY-3.0",
    "apache-2.0": "Apache-2.0", "apache 2.0": "Apache-2.0", "apache license 2.0": "Apache-2.0", "apache license, version 2.0": "Apache-2.0",
    "mit": "MIT", "mit license": "MIT", "bsd-3-clause": "BSD-3-Clause", "bsd-2-clause": "BSD-2-Clause",
}


def normalize_license(value):
    """Map a free-form licence string to an SPDX-like id; unknown strings are returned stripped."""
    if value is None:
        return None
    s = str(value).strip()
    if not s:
        return None
    key = re.sub(r"\s+", " ", s.lower().replace("_", "-"))
    if key in _LICENSE_ALIASES:
        return _LICENSE_ALIASES[key]
    m =re.match(r"^(?:https?://)?creativecommons\.org/(licenses|publicdomain)/([a-z-]+)/([\d.]+)", key)
    if m:
        kind, ver = m.group(2), m.group(3)
        return "CC0-1.0" if kind == "zero" else f"CC-{kind.upper()}-{ver}"
    return s


def license_decision(candidates, policy):
    """candidates: list of (source, raw licence string). Returns (spdx|None, url|None, reason).
    All declared licences must agree after normalisation; any conflict, denial or unknown excludes the asset."""
    lic = policy["licenses"]
    found = [(src, normalize_license(v)) for src, v in candidates if normalize_license(v)]
    if not found:
        return None, None, "no licence declared"
    for src, v in found:
        if any(pat in v.upper() for pat in lic["deny_patterns"]):
            return None, None, f"licence {v} ({src}) not permissive for commercial redistribution"
    ids = {v for _, v in found}
    if len(ids) > 1:
        return None, None, "conflicting licences: " + ", ".join(f"{s}={v}" for s, v in found)
    spdx = ids.pop()
    up = spdx.upper()
    for pat in lic["deny_patterns"]:
        if pat in up:
            return None, None, f"licence {spdx} not permissive for commercial redistribution"
    if spdx in lic["allow"]:
        return spdx, lic["allow"][spdx], "ok"
    if spdx in lic.get("reviewed_custom", {}):
        return spdx, lic["reviewed_custom"][spdx].get("url"), "ok (reviewed custom licence)"
    return None, None, f"licence {spdx!r} not on the allow list (unknown = excluded)"


# ---------------------------------------------------------------- brands
def brand_hits(texts, policy):
    """Return the brand terms found (word-boundary, case-insensitive) in the given descriptive texts."""
    blob = " ".join(str(t) for t in texts if t).lower().replace("_", " ")
    hits = []
    for term in policy["brands"]["deny"]:
        if re.search(r"(?<![a-z0-9])" + re.escape(term.lower()) + r"(?![a-z0-9])", blob):
            hits.append(term)
    return sorted(set(hits))


def metadata_brand_fields(meta, policy):
    """Non-empty manufacturer/brand-like fields in SimReady metadata (OEM products are trademarked)."""
    out = []
    for k, v in (meta or {}).items():
        if str(k).lower() in policy["brands"]["metadata_fields"] and v not in (None, "", [], {}):
            out.append(str(k))
    return out


def safe_id(text):
    s = re.sub(r"[^a-z0-9]+", "_", str(text).lower()).strip("_")
    if not s or not s[0].isalpha():
        s = "o_" + s
    return s[:32]


def write_json(path, obj):
    Path(path).write_text(json.dumps(obj, indent=1, ensure_ascii=False, sort_keys=False) + "\n", encoding="utf-8")
