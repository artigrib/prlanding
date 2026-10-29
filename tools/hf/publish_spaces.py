#!/usr/bin/env python3
"""Create or update the static Hugging Face Spaces from dist-hf/ (built by tools/hf/build-space.mjs).

Used by .github/workflows/hf-publish.yml. Reads HF_TOKEN and HF_ORG from the environment and prints only
fixed status lines (never the token, never server responses). Exit code 0 when nothing to do
(no token) or all uploads succeeded, 1 otherwise.

  dist-hf/so101-sim -> spaces/<HF_ORG>/so101-sim
  dist-hf/arena     -> spaces/<HF_ORG>/combat-arena
"""
import os
import re
import sys

SPACES = [("dist-hf/so101-sim", "so101-sim"), ("dist-hf/arena", "combat-arena")]


def main():
    token = os.environ.get("HF_TOKEN", "")
    org = os.environ.get("HF_ORG", "").strip() or "printedrobotics"
    if not token:
        print("HF_TOKEN not set: skipping Hugging Face publish")
        return 0
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,95}", org):
        print("HF_ORG is not a valid Hugging Face namespace")
        return 1
    os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
    os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
    from huggingface_hub import HfApi
    from huggingface_hub.utils import logging as hf_logging
    hf_logging.set_verbosity_error()

    api = HfApi(token=token)
    sha = (os.environ.get("GITHUB_SHA") or "local")[:12]
    failed = 0
    for folder, name in SPACES:
        repo_id = "%s/%s" % (org, name)
        if not os.path.isfile(os.path.join(folder, "README.md")):
            print("%s: build output missing, run node tools/hf/build-space.mjs" % name)
            failed += 1
            continue
        try:
            api.create_repo(repo_id, repo_type="space", space_sdk="static", exist_ok=True)
            api.upload_folder(
                repo_id=repo_id, repo_type="space", folder_path=folder,
                commit_message="Update from printedrobotics.cz %s" % sha,
                delete_patterns="*",  # mirror the build: drop files that are gone (.gitattributes is kept)
            )
            print("::notice::%s: published https://huggingface.co/spaces/%s" % (name, repo_id))
        except Exception as e:  # fixed line only: no server text, which could echo request details
            status = getattr(getattr(e, "response", None), "status_code", None)
            print("::error::%s: upload failed (%s%s)" % (name, type(e).__name__, ", HTTP %s" % status if status else ""))
            failed += 1
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
