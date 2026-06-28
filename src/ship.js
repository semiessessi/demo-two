import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

// Loads the optimized SA-43 Hammerhead GLB (converted from FBX via Blender, then gltf-transform) and
// prepares it to fly:
//  - materials are forced DOUBLE-SIDED (the model's triangle winding is inconsistent; single-sided
//    culls the back-wound faces and the hull renders full of holes)
//  - glassy canopy, emissive Engine Glow (drives the thrusters), emissive running lights
//  - hide the deployed landing gear and the leftover hangar-floor ("Ground") meshes — we're in space
//  - recenter + scale to a known size; the model already faces -Z (three.js forward)
//
// Returns { pivot, align, model, engineMaterials, nozzles, rearDir, radius }.

const TARGET_RADIUS = 5.0;
const NOSE_FIX = new THREE.Euler(0, 0, 0);

export async function loadShip() {
  const draco = new DRACOLoader();
  draco.setDecoderPath('/draco/gltf/');
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);

  const gltf = await loader.loadAsync('/hammerhead.glb');
  const model = gltf.scene;

  const engineMaterials = [];
  const ordnance = {}; // detachable loadout meshes keyed by mount id (e.g. fuelL -> Tank_L mesh)
  const log = [];
  // Blender renamed the meshes generically (Mesh001, Mesh005, …) but kept the MATERIAL names, so we
  // branch on the material name (with a mesh-name fallback for the ones Blender preserved).
  model.traverse((o) => {
    if (!o.isMesh) return;
    const m = o.material;
    const mat = (m && m.name) || '';
    log.push(`${o.name} [${mat}]`);
    if (m) m.side = THREE.DoubleSide; // fix winding holes
    o.castShadow = o.receiveShadow = false;

    // detachable ordnance (separated from the hull in scripts/cut_ordnance.py) -> show/hide per loadout
    if (/^tank_l/i.test(o.name)) ordnance.fuelL = o;
    else if (/^tank_r/i.test(o.name)) ordnance.fuelR = o;

    // drop the hangar floor and the deployed gear — we're in space
    if (/ground/i.test(mat) || /ground/i.test(o.name)) {
      o.visible = false;
      return;
    }
    // deployed landing gear (material "Landing Gear" / "Landing_Gear"). Keep the *closed* gear
    // doors visible — they cover the bay with the gear up, which is what we want in space.
    if (/^gear$/i.test(o.name) || /landing[\s_]?gear/i.test(mat)) {
      o.visible = false;
      return;
    }

    if (/glass/i.test(mat) || /canopy/i.test(o.name)) {
      // dark, reflective canopy — mostly opaque so the stars don't read through the cockpit
      const g = (o.material = m.clone());
      g.transparent = true;
      g.opacity = 0.92;
      g.depthWrite = true;
      g.roughness = 0.05;
      g.metalness = 0.55;
      g.color = new THREE.Color(0x14140f);
      g.envMapIntensity = 1.1;
      o.receiveShadow = true; // sun/ship shadows fall across the glass (glass itself doesn't cast)
    } else if (/engine.*glow/i.test(mat) || /engine[\s_]*glow/i.test(o.name)) {
      const g = (o.material = m.clone());
      g.emissive = new THREE.Color(/orange/i.test(mat) ? 0xff7a2a : 0x66e0ff);
      g.emissiveIntensity = 2.4;
      g.transparent = false;
      g.depthWrite = true;
      o.userData.isEngineGlow = true;
      engineMaterials.push(g);
    } else if (/glowstrip|glowey/i.test(mat) || /lights|cockpit/i.test(o.name)) {
      if (m.emissive) m.emissiveIntensity = Math.max(m.emissiveIntensity || 0, 1.2);
      m.transparent = false;
      m.depthWrite = true;
      m.envMapIntensity = 0.5;
    } else {
      // hull / control surfaces / doors. The model is authored as a pure metal, which has NO diffuse
      // response — so a directional sun only ever shows a specular hotspot. Knock metalness down so
      // the baseColor acts as diffuse albedo and the sun lights the surface properly. Low
      // envMapIntensity keeps the (blue nebula) reflections from tinting it.
      m.transparent = false;
      m.depthWrite = true;
      m.alphaTest = 0;
      m.opacity = 1;
      m.metalness = 0.35;
      m.envMapIntensity = 0.5;
      o.castShadow = true; // hull self-shadows + shadows other ships
      o.receiveShadow = true;
    }
  });

  // The hangar floor is one object split into two material primitives (Ground + Dark Grey). Hiding
  // just the Ground primitive leaves the Dark Grey disc body, so hide the whole group: every mesh
  // under the parent of any Ground-material primitive.
  const groundParents = new Set();
  model.traverse((o) => {
    if (o.isMesh && /ground/i.test(o.material?.name || '') && o.parent) groundParents.add(o.parent);
  });
  groundParents.forEach((p) => p.traverse((c) => {
    if (c.isMesh) c.visible = false;
  }));

  // --- recenter + scale (from the VISIBLE ship only) ---
  const box = new THREE.Box3();
  model.traverse((o) => {
    if (o.isMesh && o.visible) box.expandByObject(o);
  });
  const center = box.getCenter(new THREE.Vector3());
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const scale = TARGET_RADIUS / sphere.radius;
  model.position.sub(center);

  const align = new THREE.Group();
  align.add(model);
  align.scale.setScalar(scale);
  align.rotation.copy(NOSE_FIX);

  const pivot = new THREE.Group();
  pivot.add(align);
  pivot.updateMatrixWorld(true);

  // engine nozzles (for thruster plumes), in pivot-local space
  const glow = [];
  pivot.traverse((o) => {
    if (o.isMesh && o.userData.isEngineGlow) glow.push(o);
  });
  const nozzles = [];
  for (const g of glow) {
    const c = new THREE.Box3().setFromObject(g).getCenter(new THREE.Vector3());
    pivot.worldToLocal(c);
    nozzles.push(c);
  }
  if (nozzles.length === 0) nozzles.push(new THREE.Vector3(0, 0, TARGET_RADIUS * 0.85));
  const rearDir = nozzles
    .reduce((a, n) => a.add(n.clone()), new THREE.Vector3())
    .multiplyScalar(1 / nozzles.length)
    .normalize();

  console.log(
    `[ship] ${log.length} meshes:`,
    log.join(', '),
    '\n[ship] bbox size',
    box.getSize(new THREE.Vector3()).toArray().map((v) => v.toFixed(2)),
    'scale',
    scale.toFixed(3),
    'nozzles',
    nozzles.length,
    'rearDir',
    rearDir.toArray().map((v) => +v.toFixed(2)),
  );

  return { pivot, align, model, engineMaterials, nozzles, ordnance, rearDir, radius: TARGET_RADIUS };
}
