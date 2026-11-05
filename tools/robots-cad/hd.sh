#!/bin/sh
# Full-detail desktop models for the /3d/ flyover (models/hd/<id>.glb), converted from the authors' STEP assemblies.
# Fine tessellation (0.08 mm / 0.25 rad), normals split per B-rep face (crisp edges, no runtime crease pass),
# 12-bit normals, light simplification. Mobile keeps the lighter models/<id>.glb (page budget <= 10 MB).
# Needs: python with cadquery-ocp + trimesh, npx (gltfpack 0.25). Sources (shallow clones), passed as SRC=<dir>:
#   $SRC/Lizard               github.com/TRD-B/Lizard             ("Assembly files/Assembly.zip", commit ce1855a)
#   $SRC/orcahand_hardware    github.com/orcahand/orcahand_hardware (orca_v2/base/Orcahand_BaseV2_Right.zip, commit 0ce2646)
#   $SRC/SO-ARM-102           github.com/roboninecom/SO-ARM-102   (models/step/SO-ARM102_Follower.STEP, commit 6006f85)
set -e
cd "$(dirname "$0")"
PY=${PY:-python3}; TMP=${TMPDIR:-/tmp}; OUT=../../models/hd; mkdir -p "$OUT"
pack() { npx -y gltfpack@0.25.0 -i "$TMP/$1-raw.glb" -o "$OUT/$1.glb" -km -cc -vp 14 -vn 12 -si "$2"; }
unzip -qo "$SRC/Lizard/Assembly files/Assembly.zip" -d "$TMP/liz"
$PY step2glb.py "$TMP/liz/Assembly/Assembly.step" "$TMP/lizard-raw.glb" lizard-rules.json --tol 0.08 --ang 0.25 && pack lizard 0.25
unzip -qo "$SRC/orcahand_hardware/orca_v2/base/Orcahand_BaseV2_Right.zip" -d "$TMP/orca"
$PY step2glb.py "$TMP/orca/Base_Right.step" "$TMP/orca-raw.glb" orca-rules.json --up y --tol 0.08 --ang 0.25 && pack orca 0.15
$PY step2glb.py "$SRC/SO-ARM-102/models/step/SO-ARM102_Follower.STEP" "$TMP/so102-raw.glb" so102-rules.json --up y --tol 0.08 --ang 0.25 && pack so102 0.4
