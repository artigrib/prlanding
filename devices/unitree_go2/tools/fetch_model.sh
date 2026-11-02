#!/usr/bin/env bash
# Download the Go2 meshes from the pinned MuJoCo Menagerie commit and verify them (see ../model/NOTICE.txt).
set -euo pipefail
SHA=b0655057a9df2abe39ea7fc989914ba6f248301c
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$HERE/model/assets"
mkdir -p "$OUT"
while read -r sum name; do
  if [ -f "$OUT/$name" ] && echo "$sum  $OUT/$name" | sha256sum -c --quiet - 2>/dev/null; then continue; fi
  curl -fsSL "https://raw.githubusercontent.com/google-deepmind/mujoco_menagerie/$SHA/unitree_go2/assets/$name" -o "$OUT/$name"
  echo "$sum  $OUT/$name" | sha256sum -c --quiet -
done < "$HERE/model/assets.sha256"
echo "Go2 meshes OK in $OUT"
