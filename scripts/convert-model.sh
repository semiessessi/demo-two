#!/usr/bin/env bash
# One-time asset pipeline: sa-43-hammerhead.zip -> optimized public/hammerhead.glb
#
# NOTE: FBX2glTF produced broken geometry for this model (the hull rendered full of holes — it
# mishandles the FBX's transform-inheritance / rigging). Blender's FBX importer handles it cleanly,
# so we convert with Blender, then optimize with gltf-transform. The committed GLB means running the
# demo never needs any of this. Re-run only if the source model changes.
set -uo pipefail
cd "$(dirname "$0")/.."

BLENDER="/c/Program Files/Blender Foundation/Blender 3.5/blender.exe"
SRC_ZIP="sa-43-hammerhead.zip"
WORK="assets-src"
FBX="$WORK/source/SA-43.fbx"
BLEND_GLB="$WORK/converted/hammerhead.blender.glb"
OUT="public/hammerhead.glb"
mkdir -p "$WORK" "$WORK/converted" public

echo "=== [1/4] extract source zip ==="
[ -f "$FBX" ] || unzip -o "$SRC_ZIP" -d "$WORK"

echo "=== [2/4] install optimizer (gltf-transform cli + sharp) ==="
npm install --no-save @gltf-transform/cli sharp

echo "=== [3/4] FBX -> GLB via Blender (robust geometry) ==="
"$BLENDER" --background --python scripts/convert_blender.py -- "$(pwd)/$FBX" "$(pwd)/$BLEND_GLB"

echo "=== [4/4] optimize: Draco geometry + 2K WebP textures (no palette/join — keeps real materials) ==="
node_modules/.bin/gltf-transform optimize "$BLEND_GLB" "$OUT" \
  --compress draco \
  --texture-compress webp \
  --texture-size 2048 \
  --simplify false --palette false --join false --flatten false --instance false

echo "=== done ==="
du -h "$OUT"
