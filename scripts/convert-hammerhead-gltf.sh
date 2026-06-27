#!/usr/bin/env bash
# Rebuild public/hammerhead.glb from the source glTF (assets-src/source/gltf/scene.gltf).
#
# Why not the FBX (see convert-model.sh)? The FBX is missing UVs on the canards, so their
# SA43 texture mapped to a single texel. The source glTF has proper per-part UVs (incl. the
# canards/ailerons), but its materials are KHR_materials_pbrSpecularGlossiness, which three.js
# r0.171 no longer renders — so we convert specGloss -> metalRough, then optimize.
#
# The committed GLB means running the demo never needs this. Re-run only if the source changes.
set -uo pipefail
cd "$(dirname "$0")/.."

SRC="assets-src/source/gltf/scene.gltf"   # git-ignored source (scene.bin + textures/ alongside)
OUT="public/hammerhead.glb"
TMP="assets-src/converted/hammerhead.metalrough.glb"
mkdir -p assets-src/converted

echo "=== [1/3] install tooling (gltf-transform cli + sharp) ==="
npm install --no-save @gltf-transform/cli sharp

echo "=== [2/3] specGloss -> metalRough ==="
node_modules/.bin/gltf-transform metalrough "$SRC" "$TMP"

echo "=== [3/3] optimize: Draco geometry + 2K WebP textures ==="
node_modules/.bin/gltf-transform optimize "$TMP" "$OUT" \
  --compress draco \
  --texture-compress webp \
  --texture-size 2048 \
  --simplify false --palette false --join false --flatten false --instance false

echo "=== done ==="
du -h "$OUT"
