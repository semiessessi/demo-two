#!/usr/bin/env bash
# Convert the front-gun FBX -> optimized public/front-gun.glb (same Blender + gltf-transform pipeline
# as convert-model.sh; FBX2glTF mangled this model's geometry, Blender imports it cleanly). Re-run only
# if assets-src/source/hammerhead-1-just-front-gun.fbx changes.
set -uo pipefail
cd "$(dirname "$0")/.."

BLENDER="/c/Program Files/Blender Foundation/Blender 3.5/blender.exe"
FBX="assets-src/source/hammerhead-1-just-front-gun.fbx"
BLEND_GLB="assets-src/converted/front-gun.blender.glb"
OUT="public/front-gun.glb"
mkdir -p assets-src/converted public

echo "=== [1/3] FBX -> GLB via Blender ==="
"$BLENDER" --background --python scripts/convert_blender.py -- "$(pwd)/$FBX" "$(pwd)/$BLEND_GLB"

echo "=== [2/3] ensure gltf-transform cli ==="
[ -x node_modules/.bin/gltf-transform ] || npm install --no-save @gltf-transform/cli sharp

echo "=== [3/3] optimize: Draco geometry + WebP textures ==="
node_modules/.bin/gltf-transform optimize "$BLEND_GLB" "$OUT" \
  --compress draco \
  --texture-compress webp \
  --texture-size 1024 \
  --simplify false --palette false --join false --flatten false --instance false

echo "=== done ==="
du -h "$OUT"
