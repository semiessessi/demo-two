import * as THREE from 'three';

// Runtime ship-fracture debris. A Web Worker (fracture-worker.js) generates fracture variations off
// the main thread; we cache them as they arrive and grow the pool toward `count` (64). On an enemy
// death, burst() clones one variation's fragments (shared geometry, cheap) at the wreck's transform
// and flings them outward with spin, fading by shrink. Until the first variation lands, burst() is a
// no-op (caller keeps the explosion-only death).

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
  g.applyMatrix4(mesh.matrixWorld); // template space (template at origin)
  return {
    pos: Float32Array.from(g.attributes.position.array),
    index: g.index ? Uint32Array.from(g.index.array) : null,
  };
}

export function createDebris(scene, { chigTemplate, chigMaterial, count = 64, cap = 240 } = {}) {
  // fragment materials: reuse the chig look (no vertex colors on fragments) + a dark torn interior
  const hullMat = chigMaterial ? chigMaterial.clone() : new THREE.MeshStandardMaterial({ color: 0x3a423c, metalness: 0.45, roughness: 0.45, flatShading: true, side: THREE.DoubleSide });
  hullMat.vertexColors = false;
  const interiorMat = new THREE.MeshStandardMaterial({ color: 0x1d1916, metalness: 0.6, roughness: 0.6, flatShading: true, side: THREE.DoubleSide });
  const mats = [hullMat, interiorMat];

  const variations = []; // each: [{ geometry, centroid:Vector3 }]
  let worker = null;
  try {
    worker = new Worker(new URL('./fracture-worker.js', import.meta.url), { type: 'module' });
    const hull = extractHull(chigTemplate);
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type !== 'variation') return;
      const frs = m.frags.map((f) => {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(f.pos, 3));
        if (f.nrm && f.nrm.length) g.setAttribute('normal', new THREE.BufferAttribute(f.nrm, 3));
        for (const [s, c, mi] of f.groups) g.addGroup(s, c, mi);
        return { geometry: g, centroid: new THREE.Vector3(f.centroid[0], f.centroid[1], f.centroid[2]) };
      });
      if (frs.length) variations.push(frs);
    };
    worker.postMessage(
      { type: 'gen', pos: hull.pos, index: hull.index, count, opts: { kNeighbors: 8 } },
      hull.index ? [hull.pos.buffer, hull.index.buffer] : [hull.pos.buffer],
    );
  } catch (e) {
    console.warn('[debris] worker unavailable — deaths stay explosion-only', e);
  }

  const movers = [];
  const _dir = new THREE.Vector3();
  const _pos = new THREE.Vector3();
  const _n = new THREE.Vector3();
  let quality = 'high';
  const CULL2 = 520 * 520; // cull a chunk once it's this far from the player
  const RESTITUTION = 0.6; // bounce energy kept (non-damaging collisions)
  const FRAG_R = 1.1; // approximate chunk collision radius

  // Spawn debris at a dying enemy. `e` carries pos, obj.quaternion, vel. Returns true if it fired.
  function burst(e, scale = 1) {
    if (!variations.length || quality === 'low') return false;
    const v = variations[(Math.random() * variations.length) | 0];
    const q = e.obj.quaternion;
    for (const fr of v) {
      if (movers.length >= cap) break;
      const mesh = new THREE.Mesh(fr.geometry, mats);
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      _pos.copy(fr.centroid).applyQuaternion(q); // fragment offset in world
      mesh.position.copy(e.pos).add(_pos);
      mesh.quaternion.copy(q);
      _dir.copy(_pos);
      if (_dir.lengthSq() < 1e-4) _dir.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
      _dir.normalize();
      const vel = _dir.multiplyScalar((3 + Math.random() * 12) * scale); // 3..15
      if (e.vel) vel.addScaledVector(e.vel, 0.4);
      vel.x += (Math.random() - 0.5) * 5; vel.y += (Math.random() - 0.5) * 5; vel.z += (Math.random() - 0.5) * 5;
      scene.add(mesh);
      movers.push({
        mesh, vel: vel.clone(),
        ang: new THREE.Vector3((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8),
        life: 7 + Math.random() * 4, // backstop; mostly culled by distance
      });
    }
    return true;
  }

  // Bounce a mover off a sphere collider (non-damaging): push out + reflect inward velocity.
  function collide(m, cpos, cr, cvel) {
    _n.copy(m.mesh.position).sub(cpos);
    const d = _n.length();
    const minD = cr + FRAG_R;
    if (d >= minD || d < 1e-4) return;
    _n.multiplyScalar(1 / d);
    m.mesh.position.copy(cpos).addScaledVector(_n, minD); // push to the surface
    const vn = m.vel.dot(_n);
    if (vn < 0) m.vel.addScaledVector(_n, -(1 + RESTITUTION) * vn); // reflect
    if (cvel) m.vel.addScaledVector(cvel, 0.3); // carry some of the collider's motion
    m.ang.multiplyScalar(1.3); // knock it spinning
  }

  // player: { pos, radius, vel }; enemies: live ships to bounce off (non-damaging).
  function update(dt, player, enemies) {
    for (let i = movers.length - 1; i >= 0; i--) {
      const m = movers[i];
      m.life -= dt;
      if (m.life <= 0 || (player && m.mesh.position.distanceToSquared(player.pos) > CULL2)) {
        scene.remove(m.mesh); movers.splice(i, 1); continue;
      }
      m.mesh.position.addScaledVector(m.vel, dt);
      m.vel.multiplyScalar(1 - 0.35 * dt); // gentle drag
      m.mesh.rotation.x += m.ang.x * dt;
      m.mesh.rotation.y += m.ang.y * dt;
      m.mesh.rotation.z += m.ang.z * dt;
      if (player) collide(m, player.pos, player.radius, player.vel);
      if (enemies) for (const e of enemies) { if (e.alive) collide(m, e.pos, e.radius, e.vel); }
      if (m.life < 0.5) m.mesh.scale.setScalar(Math.max(0.001, m.life / 0.5)); // graceful shrink at end-of-life
    }
  }

  function reset() {
    for (const m of movers) scene.remove(m.mesh);
    movers.length = 0;
  }

  function setQuality(q) { quality = q; }

  return { burst, update, reset, setQuality, get ready() { return variations.length; } };
}
