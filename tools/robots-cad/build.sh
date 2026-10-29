#!/bin/sh
# Rebuild the arena robot models from the parametric sources (original designs, CC BY 4.0).
# Needs: pip install build123d ; npx (gltfpack). Output: models/<robot>.glb (meshopt, sim units).
set -e
cd "$(dirname "$0")"
TMP=${TMPDIR:-/tmp}
for r in ${*:-kosa klepeto svrn}; do
  python3 "$r.py" "$TMP/$r-raw.glb"
  npx -y gltfpack@0.25.0 -i "$TMP/$r-raw.glb" -o "../../models/$r.glb" -kn -km -cc -vp 14 -vn 8
done
