import * as THREE from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';

// Runtime ship-fracture debris. A Web Worker (fracture-worker.js) generates fracture variations off
// the main thread; we cache them as they arrive and grow the pool toward `count` (64). On an enemy
// death, burst() clones one variation's fragments (shared geometry, cheap) at the wreck's transform
// and flings them outward with spin, fading by shrink. Until the first variation lands, burst() is a
// no-op (caller keeps the explosion-only death).

// Extract a CSG-friendly hull in the template's rig-local space (template must be at origin/identity).
// Default: the single biggest visible mesh (good for a clean low-poly model like the Chig).
// convex: merge ALL visible meshes into one convex envelope — for detailed multi-mesh models (the
// Hammerhead is 171k verts across 45 meshes); the convex hull is clean, low-poly and CSG-safe.
function extractHull(template, convex = false) {
  template.updateMatrixWorld(true);
  if (convex) {
    const pts = [];
    const v = new THREE.Vector3();
    let mat = null;
    let best = 0;
    template.traverse((o) => {
      if (!(o.isMesh && o.visible && o.geometry && o.geometry.attributes.position)) return;
      const p = o.geometry.attributes.position;
      if (p.count > best) { best = p.count; mat = Array.isArray(o.material) ? o.material[0] : o.material; }
      const step = Math.max(1, Math.floor(p.count / 4000)); // sample (hull only needs extreme points)
      for (let i = 0; i < p.count; i += step) { v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); pts.push(v.clone()); }
    });
    const g = new ConvexGeometry(pts);
    return { pos: Float32Array.from(g.attributes.position.array), index: null, material: mat };
  }
  let mesh = null;
  let best = 0;
  template.traverse((o) => {
    if (o.isMesh && o.visible && o.geometry && o.geometry.attributes.position) {
      const n = o.geometry.attributes.position.count;
      if (n > best) { best = n; mesh = o; }
    }
  });
  const g = mesh.geometry.clone();
  g.applyMatrix4(mesh.matrixWorld);
  return {
    pos: Float32Array.from(g.attributes.position.array),
    index: g.index ? Uint32Array.from(g.index.array) : null,
    material: Array.isArray(mesh.material) ? mesh.material[0] : mesh.material,
  };
}

export function createDebris(scene, { template, material, convex = false, vfx = null, count = 64, cap = 240 } = {}) {
  const hull = extractHull(template, convex);
  const tag = convex ? 'player' : 'enemy';
  // fragment materials: reuse the source hull look (no vertex colors, faceted) + a dark torn interior
  const srcMat = material || hull.material;
  const hullMat = srcMat ? srcMat.clone() : new THREE.MeshStandardMaterial({ color: 0x3a423c, metalness: 0.45, roughness: 0.45 });
  hullMat.vertexColors = false;
  hullMat.flatShading = true;
  hullMat.side = THREE.DoubleSide;
  hullMat.needsUpdate = true;
  const interiorMat = new THREE.MeshStandardMaterial({ color: 0x1d1916, emissive: 0xff5a1e, emissiveIntensity: 0, metalness: 0.6, roughness: 0.6, flatShading: true, side: THREE.DoubleSide });
  const mats = [hullMat, interiorMat];

  const variations = []; // each: [rootNode, ...] of a fracture tree
  let worker = null;
  try {
    worker = new Worker(new URL('./fracture-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'error') { console.warn('[debris] ' + tag + ' gen error seed', m.seed, m.msg); return; }
      if (m.type !== 'variation' || !m.nodes || !m.nodes.length) return;
      const byId = {};
      for (const nd of m.nodes) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(nd.pos, 3));
        if (nd.nrm && nd.nrm.length) g.setAttribute('normal', new THREE.BufferAttribute(nd.nrm, 3));
        for (const [s, c, mi] of nd.groups) g.addGroup(s, c, mi);
        byId[nd.id] = { rule: nd.rule || { reBreak: 0, destroy: 0.2 }, depth: nd.depth || 0, centroid: new THREE.Vector3(nd.centroid[0], nd.centroid[1], nd.centroid[2]), geometry: g, parent: nd.parent, children: [] };
      }
      for (const id in byId) { const n = byId[id]; if (n.parent != null && byId[n.parent]) byId[n.parent].children.push(n); }
      const roots = (m.roots || []).map((id) => byId[id]).filter(Boolean);
      if (roots.length) variations.push(roots); // each variation = array of root tree-nodes
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
  const _v2 = new THREE.Vector3();
  const _smk = new THREE.Vector3();
  let quality = 'high';
  let heat = 0; // fresh cut faces glow hot then cool (shared across recent debris; cheap)
  let elapsed = 0;
  const CULL2 = 520 * 520; // cull a chunk once it's this far from the player
  const RESTITUTION = 0.6; // bounce energy kept (non-damaging collisions)
  const FRAG_R = 1.1; // approximate chunk collision radius

  // Pre-created pool of chunk meshes — reused across deaths + re-breaks so a burst never allocates a
  // Mesh or churns the scene graph (that per-chunk new Mesh()/scene.add() was the death-hitch). castShadow
  // stays OFF: the chunks are tiny + short-lived and aren't worth a per-cascade shadow pass each.
  const _placeholder = new THREE.BufferGeometry();
  _placeholder.setAttribute('position', new THREE.BufferAttribute(new Float32Array(18), 3));
  _placeholder.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(18), 3));
  _placeholder.addGroup(0, 3, 0); _placeholder.addGroup(3, 3, 1); // touch both materials for the pre-warm
  const pool = [];
  for (let i = 0; i < cap; i++) {
    const mesh = new THREE.Mesh(_placeholder, mats);
    mesh.castShadow = false; mesh.frustumCulled = false; mesh.visible = false;
    scene.add(mesh); pool.push(mesh);
  }
  let poolNext = 0;
  function grabMesh() {
    for (let n = 0; n < pool.length; n++) {
      const idx = (poolNext + n) % pool.length;
      if (!pool[idx].visible) { poolNext = (idx + 1) % pool.length; return pool[idx]; }
    }
    return null; // pool exhausted — skip
  }

  // Add one chunk mover. `comWorld` = where the chunk's COM goes; it flies outward from `fromPos`.
  // If allowReBreak and the node has children, it may shatter again mid-flight (secondary re-break).
  function addMover(node, comWorld, quat, fromPos, baseVel, scale, allowReBreak) {
    const mesh = grabMesh();
    if (!mesh) return; // pool exhausted
    mesh.geometry = node.geometry;
    mesh.scale.setScalar(1);
    mesh.visible = true;
    mesh.position.copy(comWorld);
    mesh.quaternion.copy(quat);
    _dir.copy(comWorld).sub(fromPos);
    if (_dir.lengthSq() < 1e-4) _dir.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
    _dir.normalize();
    // INDEPENDENT velocity per chunk — CLONE, because `_dir` is a shared module temp; aliasing it made
    // every chunk's mover.vel point at the same vector, so they all moved with one shared velocity ("they
    // all move together"). Now: a modest outward burst + jitter (so they actually scatter) + half the
    // wreck's momentum carried over.
    const vel = _dir.clone().multiplyScalar((6 + Math.random() * 14) * scale); // 6..20 outward
    if (baseVel) vel.addScaledVector(baseVel, 0.5); // inherit HALF the wreck's velocity
    vel.x += (Math.random() - 0.5) * 8; vel.y += (Math.random() - 0.5) * 8; vel.z += (Math.random() - 0.5) * 8;
    const mover = {
      mesh, vel,
      ang: new THREE.Vector3((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8),
      life: 11 + Math.random() * 6, // backstop; drifts off in vacuum, mostly culled by distance
      node: null, reBreakAt: 0,
      noCollideT: 0.4, // ignore collisions for a beat so chunks clear the wreck/ships before they can bounce
      // big (depth-0) wreckage trails cheap sprite smoke as it tumbles away (-1 = no trail)
      smoke: (vfx && node.depth === 0 && quality !== 'low' && Math.random() < 0.6) ? 0 : -1,
    };
    if (allowReBreak && node.children && node.children.length && Math.random() < 0.4) {
      mover.node = node;
      mover.reBreakAt = elapsed + 0.4 + Math.random() * 0.7; // shatter again shortly after
    }
    movers.push(mover);
  }

  // Spawn debris at a dying enemy. Walks the fracture tree: each chunk re-breaks into finer pieces,
  // detaches whole, or vaporizes (per its baked-in rule + randomness). `e` carries pos, obj.quaternion, vel.
  function burst(e, scale = 1) {
    if (!variations.length || quality === 'low') return false;
    const roots = variations[(Math.random() * variations.length) | 0];
    const q = e.obj.quaternion;
    heat = 1; // re-heat the torn interior faces for fresh chunks
    const stack = roots.slice();
    while (stack.length) {
      if (movers.length >= cap) break;
      const node = stack.pop();
      const r = Math.random();
      if (node.children.length && r < node.rule.reBreak) { for (const c of node.children) stack.push(c); continue; } // re-break now
      if (r < node.rule.reBreak + node.rule.destroy) continue; // vaporized — no chunk
      _v2.copy(node.centroid).applyQuaternion(q).add(e.pos); // chunk COM in world
      addMover(node, _v2, q, e.pos, e.vel, scale, true); // detach (may re-break again mid-flight)
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
    elapsed += dt;
    if (heat > 0) { heat = Math.max(0, heat - dt / 2.0); interiorMat.emissiveIntensity = heat * 0.8; } // cool over ~2s
    for (let i = movers.length - 1; i >= 0; i--) {
      const m = movers[i];
      // secondary re-break: shatter this chunk into its children mid-flight
      if (m.reBreakAt && elapsed >= m.reBreakAt) {
        heat = 1;
        const pq = m.mesh.quaternion, ppos = m.mesh.position, pn = m.node;
        for (const c of pn.children) {
          _v2.copy(c.centroid).sub(pn.centroid).applyQuaternion(pq).add(ppos); // child COM world
          addMover(c, _v2, pq, ppos, m.vel, 1, false);
        }
        m.mesh.visible = false; m.mesh.scale.setScalar(1); movers.splice(i, 1); continue; // return to pool
      }
      m.life -= dt;
      if (m.life <= 0 || (player && m.mesh.position.distanceToSquared(player.pos) > CULL2)) {
        m.mesh.visible = false; m.mesh.scale.setScalar(1); movers.splice(i, 1); continue; // return to pool
      }
      m.mesh.position.addScaledVector(m.vel, dt); // vacuum — no drag, keeps its velocity
      m.mesh.rotation.x += m.ang.x * dt;
      m.mesh.rotation.y += m.ang.y * dt;
      m.mesh.rotation.z += m.ang.z * dt;
      if (m.smoke >= 0 && m.life > 1.2) { // trail smoke off big tumbling wreckage
        m.smoke += dt;
        if (m.smoke >= 0.09) { m.smoke = 0; _smk.copy(m.vel).multiplyScalar(0.2); _smk.y += 0.5; vfx.smoke(m.mesh.position, _smk); }
      }
      if (m.noCollideT > 0) m.noCollideT -= dt; // let the chunk clear the wreck first (no sticking on spawn)
      else {
        if (player) collide(m, player.pos, player.radius, player.vel);
        if (enemies) for (const e of enemies) { if (e.alive) collide(m, e.pos, e.radius, e.vel); }
      }
      if (m.life < 0.5) m.mesh.scale.setScalar(Math.max(0.001, m.life / 0.5)); // graceful shrink at end-of-life
    }
  }

  function reset() {
    for (const m of movers) { m.mesh.visible = false; m.mesh.scale.setScalar(1); }
    movers.length = 0;
  }

  function setQuality(q) { quality = q; }

  return { burst, update, reset, setQuality, get ready() { return variations.length; } };
}
