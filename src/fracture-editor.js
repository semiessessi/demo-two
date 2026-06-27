import * as THREE from 'three';
import { generateFracture, DEFAULTS } from './fracture-gen.js';

// DEBUG-only fracture authoring harness. Dynamically imported by debug.js (so three-bvh-csg stays out
// of the shipped bundle). Builds fragments from the Chig hull, shows them assembled, and can "explode"
// them so you can tune the look (cells, voids, distortion) live, then log params for the bake.

function extractHull(template) {
  template.updateMatrixWorld(true);
  let mesh = null;
  let best = 0;
  template.traverse((o) => {
    if (o.isMesh && o.geometry && o.geometry.attributes.position) {
      const n = o.geometry.attributes.position.count;
      if (n > best) { best = n; mesh = o; }
    }
  });
  const g = mesh.geometry.clone();
  g.applyMatrix4(mesh.matrixWorld); // template is at the origin -> this is template space
  return g;
}

export function createFractureEditor({ scene, chigKit, gui }) {
  const hullGeo = extractHull(chigKit.template);
  const hullMat = new THREE.MeshStandardMaterial({ color: 0x3a423c, metalness: 0.45, roughness: 0.45, flatShading: true, side: THREE.DoubleSide });
  const interiorMat = new THREE.MeshStandardMaterial({ color: 0x1d1916, metalness: 0.65, roughness: 0.6, flatShading: true, side: THREE.DoubleSide });

  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);

  const params = { ...DEFAULTS, explodeForce: 12 }; // launch speed 3..(3+force) -> 3..15
  let frags = [];
  let exploding = false;
  let info = { fragments: 0 };

  function clearFrags() {
    for (const f of frags) { group.remove(f.mesh); f.mesh.geometry.dispose(); }
    frags = [];
  }

  function regenerate() {
    clearFrags();
    let res;
    try { res = generateFracture(hullGeo, params); } catch (e) { console.error('[fracture] generate failed', e); return; }
    for (const n of res.nodes.filter((x) => !x.children.length)) { // leaves = the finest complete shatter (no parent/child overlap)
      const c = n.centroid;
      n.geometry.translate(-c.x, -c.y, -c.z); // recenter on COM so it tumbles about its own centre
      const mesh = new THREE.Mesh(n.geometry, [hullMat, interiorMat]);
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.position.copy(c); // sits in its original spot when assembled
      group.add(mesh);
      frags.push({ mesh, home: c.clone(), vel: new THREE.Vector3(), angVel: new THREE.Vector3() });
    }
    exploding = false;
    info.fragments = frags.length;
    console.log('[fracture] leaves', frags.length, '/ nodes', res.nodes.length, '/ roots', res.roots.length);
  }

  const _d = new THREE.Vector3();
  function explode() {
    if (!frags.length) regenerate();
    exploding = true;
    for (const f of frags) {
      _d.copy(f.home);
      if (_d.lengthSq() < 1e-4) _d.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
      _d.normalize();
      f.vel.copy(_d).multiplyScalar(3 + Math.random() * params.explodeForce);
      f.angVel.set((Math.random() - 0.5) * 5, (Math.random() - 0.5) * 5, (Math.random() - 0.5) * 5);
    }
  }

  function reset() {
    exploding = false;
    for (const f of frags) { f.mesh.position.copy(f.home); f.mesh.rotation.set(0, 0, 0); f.mesh.scale.setScalar(1); }
  }

  function update(dt) {
    if (!exploding) return;
    for (const f of frags) {
      f.mesh.position.addScaledVector(f.vel, dt);
      f.mesh.rotation.x += f.angVel.x * dt;
      f.mesh.rotation.y += f.angVel.y * dt;
      f.mesh.rotation.z += f.angVel.z * dt;
    }
  }

  function show() { group.visible = true; if (!frags.length) regenerate(); }
  function hide() { group.visible = false; }

  // ---- GUI ----
  const ff = gui.addFolder('Fracture');
  ff.add(params, 'seed', 1, 64, 1).onChange(regenerate);
  ff.add(params, 'cellCount', 4, 32, 1).onChange(regenerate);
  ff.add(params, 'surfaceBias', 0, 1, 0.05).name('surface bias').onChange(regenerate);
  ff.add(params, 'inset', 0, 1, 0.02).onChange(regenerate);
  ff.add(params, 'voidCount', 0, 8, 1).name('void count').onChange(regenerate);
  ff.add(params, 'voidSize', 0.1, 1.5, 0.05).name('void size').onChange(regenerate);
  ff.add(params, 'voidType', ['box', 'tetra', 'mix']).name('void type').onChange(regenerate);
  ff.add(params, 'twist', 0, 0.6, 0.01).onChange(regenerate);
  ff.add(params, 'skew', 0, 0.6, 0.01).onChange(regenerate);
  ff.add(params, 'warp', 0, 0.6, 0.01).onChange(regenerate);
  ff.add(params, 'maxDepth', 0, 3, 1).name('re-break depth').onChange(regenerate);
  ff.add(params, 'childCount', 2, 8, 1).name('child cells').onChange(regenerate);
  ff.add(params, 'splitProb', 0, 1, 0.05).name('split chance').onChange(regenerate);
  ff.add(params, 'explodeForce', 2, 30, 1).name('explode force');
  ff.add({ b: () => regenerate() }, 'b').name('▸ regenerate');
  ff.add({ b: () => explode() }, 'b').name('▸ explode');
  ff.add({ b: () => reset() }, 'b').name('▸ reset (assemble)');
  ff.add({ b: () => console.log('[fracture params]\n' + JSON.stringify(params, null, 2)) }, 'b').name('log params → console');
  ff.open();

  return { group, regenerate, explode, reset, update, show, hide, params };
}
