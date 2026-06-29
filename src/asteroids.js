import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createSpatialGrid } from './spatialGrid.js';

// Asteroid field for the Jupiter Trojans ("the Belt"): a cloud of ~200 procedurally-built cratered rocks
// that are REAL world-space obstacles — they drift + tumble, collide with each other, and collide with the
// player, the enemies, and cannon fire. Inspired by acko.net "Making Worlds" (an even sphere displaced by
// noise); craters are carved per-vertex with a raised rim. Rendered with one InstancedMesh per variant
// (cheap draws); physics on a plain JS body array using the shared spatial grid (debris.js pattern).
//
// createAsteroidField(scene, opts) -> { group, setVisible, update(dt, ctx), reset, dispose }
//   ctx = { player:{pos,radius,vel}, enemies, projectiles, damage, mode }

const REST = 0.4;        // rock-vs-rock restitution (heavy, low bounce)
const HIT_CD = 0.6;      // seconds before one rock can damage the same ship again (no instant grind-death)

// --- seeded RNG (mulberry32) so a field is stable per seed ---
function makeRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// --- compact 3D value-noise FBM (same Hermite value-noise the GLSL shaders use), for surface lumps ---
function hash3(x, y, z) { const n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return n - Math.floor(n); }
function vnoise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const lerp = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => hash3(xi + dx, yi + dy, zi + dz);
  const x00 = lerp(c(0, 0, 0), c(1, 0, 0), u), x10 = lerp(c(0, 1, 0), c(1, 1, 0), u);
  const x01 = lerp(c(0, 0, 1), c(1, 0, 1), u), x11 = lerp(c(0, 1, 1), c(1, 1, 1), u);
  return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w); // 0..1
}
function fbm(x, y, z) {
  let a = 0, amp = 0.5, f = 1;
  for (let o = 0; o < 4; o++) { a += amp * vnoise(x * f, y * f, z * f); f *= 2.03; amp *= 0.5; }
  return a; // ~0..1
}
const smoothstep = (e0, e1, t) => { const x = Math.min(1, Math.max(0, (t - e0) / (e1 - e0))); return x * x * (3 - 2 * x); };
function randUnit(rng, out) {
  const z = rng() * 2 - 1, a = rng() * Math.PI * 2, r = Math.sqrt(Math.max(0, 1 - z * z));
  return out.set(r * Math.cos(a), r * Math.sin(a), z);
}

// Build one displaced + cratered rock geometry on a unit sphere (instance scale sets real size).
// Welds vertices + recomputes normals so shading is SMOOTH (not faceted), and bakes a crevice/crater
// ambient-occlusion term into vertex colours (dark insides). Fine surface grain is added in the shader.
function buildVariant(detail, rng) {
  let geo = new THREE.IcosahedronGeometry(1, detail);
  geo.deleteAttribute('uv');
  geo.deleteAttribute('normal'); // re-derived smooth after welding
  const pos = geo.attributes.position;
  const off = rng() * 100; // per-variant noise offset so each rock looks distinct
  const K = 3 + Math.floor(rng() * 5); // 3..7 craters
  const craters = [];
  for (let i = 0; i < K; i++) craters.push({ dir: randUnit(rng, new THREE.Vector3()), radius: 0.22 + rng() * 0.5, depth: 0.10 + rng() * 0.16 });
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i); // point on the unit sphere
    let r = 1
      + 0.22 * (fbm(v.x * 1.5 + off, v.y * 1.5 + off, v.z * 1.5 + off) - 0.5) * 2  // boulder lumps
      + 0.09 * (fbm(v.x * 4.2 + off, v.y * 4.2, v.z * 4.2) - 0.5) * 2;             // surface roughness
    for (const c of craters) {
      const a = Math.acos(Math.min(1, Math.max(-1, v.dot(c.dir)))); // angular distance to crater centre
      if (a < c.radius) {
        const t = a / c.radius;                                  // 0 centre .. 1 edge
        r -= c.depth * (1 - smoothstep(0.0, 0.85, t));           // carve the bowl
        r += c.depth * 0.55 * Math.exp(-Math.pow((t - 0.9) / 0.09, 2)); // raised rim near the edge
      }
    }
    v.multiplyScalar(r);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  geo = mergeVertices(geo, 1e-4); // weld coincident verts -> indexed -> smooth shading
  geo.computeVertexNormals();     // smooth normals across the welded surface
  // bake crevice/crater AO to vertex colours: darker where the surface is pushed in (r < 1)
  const p2 = geo.attributes.position;
  const col = new Float32Array(p2.count * 3);
  for (let i = 0; i < p2.count; i++) {
    const x = p2.getX(i), y = p2.getY(i), z = p2.getZ(i);
    const ao = 0.4 + 0.6 * smoothstep(0.72, 1.06, Math.sqrt(x * x + y * y + z * z));
    col[i * 3] = ao; col[i * 3 + 1] = ao; col[i * 3 + 2] = ao;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeBoundingSphere();
  return geo;
}

// GLSL injected into the rock material for fine procedural surface detail (the "fancy" part): a derivative
// bump (normal mapping without UVs/textures) + mottled albedo grain, both from object-space 3D FBM so the
// detail sticks to each rock as it tumbles.
const GLSL_NOISE = `
float aHash(vec3 p){ p=fract(p*0.3183099+0.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float aNoise(vec3 x){ vec3 i=floor(x),f=fract(x); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(aHash(i+vec3(0,0,0)),aHash(i+vec3(1,0,0)),f.x),mix(aHash(i+vec3(0,1,0)),aHash(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(aHash(i+vec3(0,0,1)),aHash(i+vec3(1,0,1)),f.x),mix(aHash(i+vec3(0,1,1)),aHash(i+vec3(1,1,1)),f.x),f.y),f.z); }
float aFbm(vec3 p){ float a=0.0,amp=0.5; for(int i=0;i<4;i++){ a+=amp*aNoise(p); p*=2.03; amp*=0.5; } return a; }
varying vec3 vDet;
`;
const GLSL_BUMP = `
{
  float hC = aFbm(vDet * 9.0) + 0.5 * aFbm(vDet * 24.0);
  vec3 sp = -vViewPosition;
  vec3 sx = dFdx(sp); vec3 sy = dFdy(sp);
  vec3 R1 = cross(sy, normal); vec3 R2 = cross(normal, sx);
  float det = dot(sx, R1);
  vec3 grad = sign(det) * (dFdx(hC) * R1 + dFdy(hC) * R2);
  normal = normalize(abs(det) * normal - 0.55 * grad);
}
`;
const GLSL_ALBEDO = `
{
  float g = aFbm(vDet * 5.0);
  diffuseColor.rgb *= 0.72 + 0.5 * g;                              // mottled light/dark rock
  diffuseColor.rgb *= mix(vec3(1.0), vec3(1.07, 0.99, 0.9), g);    // faint warm grain
}
`;
function makeRockMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.96, metalness: 0.03 });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vDet;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vDet = transformed;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', GLSL_NOISE + '\n#include <common>')
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n' + GLSL_BUMP)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + GLSL_ALBEDO);
  };
  return mat;
}

export function createAsteroidField(scene, opts = {}) {
  const vfx = opts.vfx || null;
  const isMobile = !!opts.isMobile;
  const count = opts.count || (isMobile ? 70 : 200);
  const detail = opts.detail != null ? opts.detail : (isMobile ? 2 : 3);
  const nVariants = opts.variants || (isMobile ? 8 : 14);
  const center = new THREE.Vector3().fromArray(opts.center || [0, 0, -1500]); // well ahead of spawn (-Z)
  const half = new THREE.Vector3().fromArray(opts.halfExtents || [1300, 450, 1000]);
  const SPAWN_CLEAR = opts.spawnClear || 450; // keep a clear bubble around the origin so you don't spawn in a rock
  const seed = opts.seed || 1337;

  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);

  // --- build variant geometries + a shared rocky material ---
  const rng = makeRng(seed);
  const geos = [];
  for (let i = 0; i < nVariants; i++) geos.push(buildVariant(detail, makeRng((seed * 2654435761 + i * 40503) >>> 0)));
  const material = makeRockMaterial();

  // --- generate bodies, grouped by variant ---
  const bodies = [];            // { pos, vel, quat, axis, rate, radius, mass, variant, scale, inst, home, hitCd, color }
  const perVariant = new Array(nVariants).fill(0);
  const _u = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    // size class: mostly small, some medium, few large
    const roll = rng();
    const scale = roll < 0.68 ? 6 + rng() * 12 : roll < 0.93 ? 18 + rng() * 22 : 40 + rng() * 30;
    // position in an ellipsoid around `center` (ahead of spawn)
    const p = new THREE.Vector3((rng() * 2 - 1), (rng() * 2 - 1), (rng() * 2 - 1));
    if (p.lengthSq() > 1) p.normalize().multiplyScalar(0.35 + 0.65 * rng()); // fill the volume
    p.multiply(half).add(center);
    if (p.lengthSq() < SPAWN_CLEAR * SPAWN_CLEAR) p.setLength(SPAWN_CLEAR + rng() * 250); // clear the spawn bubble
    const variant = (rng() * nVariants) | 0;
    const tint = new THREE.Color().setHSL(0.07 + rng() * 0.04, 0.18 + rng() * 0.12, 0.32 + rng() * 0.16); // grey-brown
    bodies.push({
      pos: p, home: p.clone(),
      vel: new THREE.Vector3((rng() * 2 - 1), (rng() * 2 - 1), (rng() * 2 - 1)).multiplyScalar(2 + rng() * 4),
      quat: new THREE.Quaternion().setFromAxisAngle(randUnit(rng, _u), rng() * Math.PI * 2),
      axis: randUnit(rng, new THREE.Vector3()), rate: (rng() * 2 - 1) * 0.4,
      radius: scale * 1.02, mass: scale * scale * scale, variant, scale, inst: perVariant[variant]++, hitCd: 0, color: tint,
    });
  }

  // --- one InstancedMesh per variant ---
  const meshes = geos.map((g, vi) => {
    const n = perVariant[vi];
    const im = new THREE.InstancedMesh(g, material, Math.max(1, n));
    im.count = n;
    im.castShadow = false; im.receiveShadow = false; // 200 instanced shadow casters is too heavy; normals carry the form
    im.frustumCulled = false; // the whole field is the play area; keep it simple
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    group.add(im);
    return im;
  });
  // write static per-instance colours once
  for (const b of bodies) meshes[b.variant].setColorAt(b.inst, b.color);
  for (const im of meshes) if (im.instanceColor) im.instanceColor.needsUpdate = true;

  // --- collision scratch ---
  const grid = createSpatialGrid(90);
  const _m = new THREE.Matrix4();
  const _s = new THREE.Vector3();
  const _dq = new THREE.Quaternion();
  const _n = new THREE.Vector3();
  const _rel = new THREE.Vector3();
  const _seg = new THREE.Vector3();
  const _toC = new THREE.Vector3();
  const _cl = new THREE.Vector3();
  const _cp = new THREE.Vector3();
  let MAXR = 0; for (const b of bodies) MAXR = Math.max(MAXR, b.radius);

  function segDistSq(a, end, c) { // squared dist from point c to segment [a->end]
    _seg.copy(end).sub(a); const len2 = _seg.lengthSq();
    let t = len2 > 1e-9 ? _toC.copy(c).sub(a).dot(_seg) / len2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
    _cl.copy(a).addScaledVector(_seg, t); return _cl.distanceToSquared(c);
  }

  function writeMatrices() {
    for (const b of bodies) { _s.setScalar(b.scale); _m.compose(b.pos, b.quat, _s); meshes[b.variant].setMatrixAt(b.inst, _m); }
    for (const im of meshes) im.instanceMatrix.needsUpdate = true;
  }
  function setVisible(on) {
    group.visible = !!on;
    if (on) reset(); // fresh field each time you enter the Belt
  }
  function reset() {
    for (const b of bodies) { b.pos.copy(b.home); b.vel.set((Math.random() * 2 - 1), (Math.random() * 2 - 1), (Math.random() * 2 - 1)).multiplyScalar(2 + Math.random() * 4); b.hitCd = 0; }
    writeMatrices(); // place them even if update() isn't ticked (e.g. static menu preview)
  }

  // collide a rock against a ship sphere; push the rock out, bounce it, and return the closing speed (for
  // damage). `shipPush` (0..1) is how much the ship itself gets shoved out (player gets a knock; enemies more).
  function hitShip(b, sp, sr, sv, shipPush) {
    _n.copy(b.pos).sub(sp); const d = _n.length(); const overlap = (b.radius + sr) - d;
    if (overlap <= 0 || d < 1e-3) return -1;
    _n.multiplyScalar(1 / d);
    b.pos.addScaledVector(_n, overlap * (1 - shipPush));
    const closing = sv ? _rel.copy(sv).sub(b.vel).dot(_n) : -b.vel.dot(_n); // + = approaching
    if (closing > 0) { b.vel.addScaledVector(_n, closing * (1 + REST) * 0.5); b.rate += (Math.random() * 2 - 1) * 0.6; }
    _cp.copy(sp).addScaledVector(_n, sr); // contact point on the hull
    return closing;
  }

  function update(dt, ctx = {}) {
    if (!group.visible) return;
    const flying = ctx.mode === 'flying';

    // integrate drift + spin, and gently spring back toward home so the field can't disperse forever
    for (const b of bodies) {
      b.pos.addScaledVector(b.vel, dt);
      _rel.copy(b.home).sub(b.pos); const hd = _rel.length();
      if (hd > 1) b.vel.addScaledVector(_rel.multiplyScalar(1 / hd), Math.min(hd, 60) * 0.02 * dt); // soft tether
      b.vel.multiplyScalar(1 - 0.02 * dt);
      if (b.hitCd > 0) b.hitCd -= dt;
      _dq.setFromAxisAngle(b.axis, b.rate * dt); b.quat.multiply(_dq);
    }

    // broad-phase: insert all rocks
    grid.begin();
    for (const b of bodies) grid.insert(b.pos.x, b.pos.y, b.pos.z, b);

    // rock vs rock (each pair resolved once via the per-body index _i)
    for (let i = 0; i < bodies.length; i++) bodies[i]._i = i;
    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i];
      grid.query(a.pos.x, a.pos.y, a.pos.z, a.radius + MAXR, (b) => {
        if (b._i <= i) return;
        _n.copy(b.pos).sub(a.pos); const d = _n.length(); const overlap = (a.radius + b.radius) - d;
        if (overlap <= 0 || d < 1e-3) return;
        _n.multiplyScalar(1 / d);
        const mA = a.mass, mB = b.mass, inv = 1 / (mA + mB);
        a.pos.addScaledVector(_n, -overlap * (mB * inv));
        b.pos.addScaledVector(_n, overlap * (mA * inv));
        const rv = _rel.copy(b.vel).sub(a.vel).dot(_n);
        if (rv < 0) {
          const j = -(1 + REST) * rv;
          a.vel.addScaledVector(_n, -j * mB * inv);
          b.vel.addScaledVector(_n, j * mA * inv);
          a.rate += (Math.random() * 2 - 1) * 0.3; b.rate += (Math.random() * 2 - 1) * 0.3;
        }
      });
    }

    if (flying) {
      // rock vs player
      const pl = ctx.player;
      if (pl && pl.pos) {
        grid.query(pl.pos.x, pl.pos.y, pl.pos.z, (pl.radius || 5) + MAXR, (b) => {
          const closing = hitShip(b, pl.pos, pl.radius || 5, pl.vel, 0.5);
          if (closing >= 0 && b.hitCd <= 0 && ctx.damage) {
            const dmg = Math.min(45, 6 + closing * 0.5 + b.scale * 0.4);
            ctx.damage.applyHit(_cp.clone(), dmg, b.pos);
            if (vfx) vfx.firework(_cp.clone(), 0.5);
            b.hitCd = HIT_CD;
          }
        });
      }
      // rock vs enemies
      const en = ctx.enemies;
      if (en) for (const e of en) {
        if (!e.alive) continue;
        grid.query(e.pos.x, e.pos.y, e.pos.z, (e.radius || 2.2) + MAXR, (b) => {
          const closing = hitShip(b, e.pos, e.radius || 2.2, e.vel, 0.85);
          if (closing >= 0 && b.hitCd <= 0) {
            if (vfx) vfx.spark(_cp.clone(), 0xffd0a0);
            e.hp -= Math.min(e.maxHp || 30, 14 + b.scale * 0.5);
            if (e.hp <= 0 && ctx.enemyMgr) ctx.enemyMgr.kill(e);
            b.hitCd = HIT_CD;
          }
        });
      }
      // bolts vs rocks (block + spark; rocks aren't destroyed)
      const pr = ctx.projectiles;
      if (pr && pr.live) {
        const bolts = pr.live;
        for (let i = bolts.length - 1; i >= 0; i--) {
          const bo = bolts[i];
          _seg.copy(bo.pos).addScaledVector(bo.vel, -dt); _cp.copy(_seg); // segStart in _cp
          let hit = false;
          grid.query(bo.pos.x, bo.pos.y, bo.pos.z, bo.radius + MAXR, (b) => {
            if (hit) return;
            const rr = b.radius + bo.radius;
            if (segDistSq(_cp, bo.pos, b.pos) <= rr * rr) { hit = true; }
          });
          if (hit) { if (vfx) vfx.spark(bo.pos.clone(), 0xffe0b0); pr.kill(bo); }
        }
      }
    }

    writeMatrices();
  }

  function dispose() {
    for (const im of meshes) { group.remove(im); im.dispose(); }
    for (const g of geos) g.dispose();
    material.dispose();
    scene.remove(group);
  }

  return { group, setVisible, update, reset, dispose, get count() { return bodies.length; } };
}
