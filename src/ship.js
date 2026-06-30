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
  let hullMaterial = null; // the SA43 textured hull skin — reused by the front-gun mesh (it kept matching UVs)
  const log = [];
  // Blender renamed the meshes generically (Mesh001, Mesh005, …) but kept the MATERIAL names, so we
  // branch on the material name (with a mesh-name fallback for the ones Blender preserved).
  model.traverse((o) => {
    if (!o.isMesh) return;
    const m = o.material;
    const mat = (m && m.name) || '';
    log.push(`${o.name} [${mat}]`);
    if (m) m.side = THREE.DoubleSide; // fix winding holes
    if (mat === 'SA43' && !hullMaterial) hullMaterial = m; // grab the hull skin for the front-gun mesh
    o.castShadow = o.receiveShadow = false;

    // detachable ordnance (separated from the hull in scripts/cut_ordnance.py) -> show/hide per loadout
    if (/^tank_l/i.test(o.name)) ordnance.fuelL = o;
    else if (/^tank_r/i.test(o.name)) ordnance.fuelR = o;
    else if (/^missile_l/i.test(o.name)) ordnance.missileL = o;
    else if (/^missile_r/i.test(o.name)) ordnance.missileR = o;

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

  // --- carve the baked-in chin gun out of the hull -------------------------------------------------
  // The new pivoting gun (front-gun.glb) was modelled in place, so ITS bounding box marks exactly the
  // hull region the old gun occupies. Delete every triangle whose centroid lies inside it. Done now,
  // in the raw model/scene frame (before the recenter below) — the same frame the gun GLB lives in.
  {
    // The cuboid the user placed in Blender to bound the gun (Blender Z-up: a unit cube * scale at pos).
    // Convert to the GLB's Y-up model frame: (bx, by, bz) -> (bx, bz, -by). This is the exact region the
    // old gun occupies on the fuselage, so delete every hull triangle whose centroid lies inside it.
    const B = { x: 0.015887, y: 5.83745, z: -1.16687, sx: 0.22, sy: 1, sz: 0.2 };
    const cut = new THREE.Box3(
      new THREE.Vector3(B.x - B.sx, B.z - B.sz, -(B.y + B.sy)),
      new THREE.Vector3(B.x + B.sx, B.z + B.sz, -(B.y - B.sy)),
    );
    model.updateMatrixWorld(true);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    let removed = 0;
    model.traverse((o) => {
      if (!o.isMesh || !o.geometry || !o.geometry.index) return;
      const geo = o.geometry, p = geo.attributes.position, ix = geo.index.array, M = o.matrixWorld, keep = [];
      for (let t = 0; t < ix.length; t += 3) {
        const i0 = ix[t], i1 = ix[t + 1], i2 = ix[t + 2];
        a.fromBufferAttribute(p, i0).applyMatrix4(M);
        b.fromBufferAttribute(p, i1).applyMatrix4(M);
        c.fromBufferAttribute(p, i2).applyMatrix4(M);
        const X = (a.x + b.x + c.x) / 3, Y = (a.y + b.y + c.y) / 3, Z = (a.z + b.z + c.z) / 3;
        if (X >= cut.min.x && X <= cut.max.x && Y >= cut.min.y && Y <= cut.max.y && Z >= cut.min.z && Z <= cut.max.z) { removed++; continue; }
        keep.push(i0, i1, i2);
      }
      if (keep.length !== ix.length) { geo.setIndex(keep); geo.computeBoundingSphere(); }
    });
    console.log('[ship] carved baked-in gun:', removed, 'tris in', cut.min.toArray().map((v) => +v.toFixed(2)), '..', cut.max.toArray().map((v) => +v.toFixed(2)));
  }

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

  return { pivot, align, model, engineMaterials, nozzles, ordnance, rearDir, radius: TARGET_RADIUS, center, hullMaterial };
}
