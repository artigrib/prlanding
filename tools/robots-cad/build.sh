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

# RC cars converted from the authors' published CAD (not our designs; licences in models/NOTICE.txt).
# Needs: pip install cadquery-ocp trimesh ; checkouts of the source repos at the commits named in each script.
#   python3 rc128.py  <open_128_rc_car>/modular_car "$TMP/rc128-raw.glb"   && npx -y gltfpack@0.25.0 -i "$TMP/rc128-raw.glb"  -o ../../models/rc128.glb  -kn -km -cc -vp 14 -vn 8 -si 0.5
#   python3 zcar2.py  <zcar2>                       "$TMP/zcar2-raw.glb"   && npx -y gltfpack@0.25.0 -i "$TMP/zcar2-raw.glb"  -o ../../models/zcar2.glb  -kn -km -cc -vp 14 -vn 8
#   unzip "<Lizard>/Assembly files/Assembly.zip" -d "$TMP/liz"
#   python3 step2glb.py "$TMP/liz/Assembly/Assembly.step" "$TMP/lizard-raw.glb" lizard-rules.json --tol 0.3 --ang 0.2 \
#     && npx -y gltfpack@0.25.0 -i "$TMP/lizard-raw.glb" -o ../../models/lizard.glb -kn -km -cc -vp 14 -vn 8 -si 0.05
