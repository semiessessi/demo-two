import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

// USS Saratoga / Lexington-class carrier. CC BY-NC-SA STL (alpokemon / Katase, Thingiverse #1889381) converted
// to a UV-unwrapped GLB (public/saratoga.glb) so a texture can be painted onto it later. Plain grey metal hull
// for now — iterate on the look next. Returns a template normalized to unit length; the caller scales + places.
export async function loadSaratoga() {
  const draco = new DRACOLoader();
  draco.setDecoderPath('/draco/gltf/');
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  const gltf = await loader.loadAsync('/saratoga.glb');
  const root = gltf.scene;
  root.updateMatrixWorld(true);

  const mat = new THREE.MeshStandardMaterial({ color: 0x8b929c, metalness: 0.55, roughness: 0.6, side: THREE.DoubleSide });

  const geos = [];
  root.traverse((o) => { if (o.isMesh && o.geometry && o.geometry.attributes.position) { const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld); geos.push(g); } });
  const box = new THREE.Box3();
  for (const g of geos) { g.computeBoundingBox(); box.union(g.boundingBox); }
  const c = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const norm = 1.0 / (Math.max(size.x, size.y, size.z) || 1); // normalize the longest dimension to 1

  const template = new THREE.Group();
  for (const g of geos) {
    g.translate(-c.x, -c.y, -c.z);
    g.scale(norm, norm, norm); // keeps the UVs; uniform scale keeps normals valid
    const m = new THREE.Mesh(g, mat);
    m.castShadow = m.receiveShadow = true;
    m.frustumCulled = false;
    template.add(m);
  }
  return { template, material: mat }; // template is unit-length; caller does template.scale.setScalar(length)
}
