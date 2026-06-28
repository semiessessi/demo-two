#!/usr/bin/env bash
# Rebuild public/hammerhead.glb with detachable ordnance.
#
# Runs the headless Blender surgery (scripts/cut_ordnance.py) — removes the fused fuel-tank / bomb
# bodies from the hull, patches each with a flush cap-plate, emits Tank_L/Tank_R as separate meshes —
# then optimizes (draco + webp + 2K) keeping the named parts (--join/--flatten false).
#
# To add missiles / a laser later: produce isolated `*-just-*.fbx` for them and extend cut_ordnance.py
# (same coincidence-cut + cap-plate), then re-run this.
#
# Usage: scripts/cut-ordnance.sh   (assets default to C:/code/demo-two/assets-src/source)
set -euo pipefail

SRC="${1:-C:/code/demo-two/assets-src/source}"
BLENDER="${BLENDER:-/c/Program Files/Blender Foundation/Blender 3.5/blender.exe}"
TMP="$(dirname "$0")/.cut-tmp.glb"

echo "[cut-ordnance] Blender surgery ..."
"$BLENDER" --background --python "$(dirname "$0")/cut_ordnance.py" -- \
  "$SRC/SA-43.fbx" \
  "$SRC/hammerhead-1-just-tanks.fbx" \
  "$SRC/hammerhead-1-just-bombs.fbx" \
  "$SRC/hammerhead-1-just-missiles.fbx" \
  "$TMP"

echo "[cut-ordnance] optimize -> public/hammerhead.glb ..."
npm install --no-save @gltf-transform/cli sharp >/dev/null 2>&1
node_modules/.bin/gltf-transform optimize "$TMP" public/hammerhead.glb \
  --compress draco --texture-compress webp --texture-size 2048 \
  --simplify false --palette false --join false --flatten false --instance false

rm -f "$TMP"
echo "[cut-ordnance] done -> public/hammerhead.glb"
