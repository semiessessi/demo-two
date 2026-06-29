import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createSpatialGrid } from './spatialGrid.js';

// Asteroid field for the Jupiter Trojans ("the Belt"): a cloud of ~200 procedurally-built cratered rocks
// that are REAL world-space obstacles. They drift + tumble, and collide with each other, the player, the
// enemies, and cannon fire — every impact imparts LINEAR + ANGULAR momentum (mass ∝ volume, so small things
// fling and big ones barely budge). Four material types (silicate / tholin / ice w/ fake SSS / iron w/ env
// reflections), all GGX. Rendered with INSTANCED LOD — each variant has 3 detail levels (hi/med/lo) and
// each rock is bucketed per-frame by its on-screen size, so close rocks are high-poly and far ones cheap.
//
// createAsteroidField(scene, opts) -> { group, setVisible, update(dt, ctx), reset, dispose }
//   ctx = { player:{pos,radius,vel}, enemies, projectiles, damage, enemyMgr, mode }

const REST = 0.45;
const HIT_CD = 0.55;
const BOLT_IMPULSE = 1700;
const SHIP_MASS = 75;
const ENEMY_MASS = 22;
const MAX_SPIN = 3.0;
const LOD_HI_R = 16;  // dist/radius below this -> hi-poly
const LOD_MED_R = 52; // ...below this -> med; beyond -> lo

function makeRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function hash3(x, y, z) { const n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return n - Math.floor(n); }
function vnoise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const lerp = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => hash3(xi + dx, yi + dy, zi + dz);
  const x00 = lerp(c(0, 0, 0), c(1, 0, 0), u), x10 = lerp(c(0, 1, 0), c(1, 1, 0), u);
  const x01 = lerp(c(0, 0, 1), c(1, 0, 1), u), x11 = lerp(c(0, 1, 1), c(1, 1, 1), u);
  return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w);
}
function fbm(x, y, z) { let a = 0, amp = 0.5, f = 1; for (let o = 0; o < 4; o++) { a += amp * vnoise(x * f, y * f, z * f); f *= 2.03; amp *= 0.5; } return a; }
const smoothstep = (e0, e1, t) => { const x = Math.min(1, Math.max(0, (t - e0) / (e1 - e0))); return x * x * (3 - 2 * x); };
function randUnit(rng, out) { const z = rng() * 2 - 1, a = rng() * Math.PI * 2, r = Math.sqrt(Math.max(0, 1 - z * z)); return out.set(r * Math.cos(a), r * Math.sin(a), z); }

// Build a displaced rock geometry at a given subdivision. The RNG drives the shape/craters, so calling this
// with the SAME seed at different `detail` produces the same rock at different resolutions (for LOD).
function buildVariant(detail, rng) {
  let geo = new THREE.IcosahedronGeometry(1, detail);
  geo.deleteAttribute('uv');
  geo.deleteAttribute('normal');
  const pos = geo.attributes.position;
  const off = rng() * 100;
  const stype = rng();
  const elong = stype >= 0.45;
  const bilobe = stype >= 0.78;
  const ax = elong ? 1.6 + rng() * 0.85 : 1, ay = elong ? 0.58 + rng() * 0.24 : 1, az = elong ? 0.66 + rng() * 0.24 : 1;
  const pinch = bilobe ? 0.34 + rng() * 0.24 : 0;
  function shapeMul(x, y, z) {
    let s = 1;
    if (elong) { const X = x / ax, Y = y / ay, Z = z / az; s = 1 / Math.sqrt(X * X + Y * Y + Z * Z); }
    if (bilobe) { const w = x / 0.34; s *= 1 - pinch * Math.exp(-(w * w)); }
    return s;
  }
  const K = 4 + Math.floor(rng() * 5);
  const craters = [];
  for (let i = 0; i < K; i++) craters.push({ dir: randUnit(rng, new THREE.Vector3()), radius: 0.18 + rng() * 0.46, depth: 0.16 + rng() * 0.2 });
  const col = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const sh = shapeMul(v.x, v.y, v.z);
    let r = sh * (1 + 0.18 * (fbm(v.x * 1.5 + off, v.y * 1.5 + off, v.z * 1.5 + off) - 0.5) * 2 + 0.07 * (fbm(v.x * 4.2 + off, v.y * 4.2, v.z * 4.2) - 0.5) * 2);
    for (const c of craters) {
      const a = Math.acos(Math.min(1, Math.max(-1, v.dot(c.dir))));
      if (a < c.radius) { const t = a / c.radius; r -= sh * c.depth * (1 - smoothstep(0.0, 0.82, t)); r += sh * c.depth * 0.5 * Math.exp(-Math.pow((t - 0.88) / 0.1, 2)); }
    }
    const recess = (sh - r) / Math.max(0.001, sh);
    const ao = Math.min(1, Math.max(0.4, 1 - recess * 2.6));
    col[i * 3] = ao; col[i * 3 + 1] = ao; col[i * 3 + 2] = ao;
    v.multiplyScalar(r);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo = mergeVertices(geo, 1e-4);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

// --- GLSL surface detail (FBM lumps + WORLEY craters -> derivative bump = normal map; no textures) ---
const GLSL_NOISE = `
varying vec3 vDet;
float aHash(vec3 p){ p=fract(p*0.3183099+0.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float aNoise(vec3 x){ vec3 i=floor(x),f=fract(x); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(aHash(i+vec3(0,0,0)),aHash(i+vec3(1,0,0)),f.x),mix(aHash(i+vec3(0,1,0)),aHash(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(aHash(i+vec3(0,0,1)),aHash(i+vec3(1,0,1)),f.x),mix(aHash(i+vec3(0,1,1)),aHash(i+vec3(1,1,1)),f.x),f.y),f.z); }
float aFbm(vec3 p){ float a=0.0,amp=0.5; for(int i=0;i<4;i++){ a+=amp*aNoise(p); p*=2.03; amp*=0.5; } return a; }
float aWorley(vec3 p){ vec3 ip=floor(p),fp=fract(p); float d=1.0;
  for(int x=-1;x<=1;x++)for(int y=-1;y<=1;y++)for(int z=-1;z<=1;z++){
    vec3 g=vec3(float(x),float(y),float(z));
    vec3 o=vec3(aHash(ip+g),aHash(ip+g+vec3(31.7)),aHash(ip+g+vec3(57.3)));
    vec3 r=g+o-fp; d=min(d,dot(r,r)); }
  return sqrt(d); }
float aCraters(vec3 p){ float w=aWorley(p); return (smoothstep(0.0,0.5,w)-1.0) + 0.18*exp(-pow((w-0.42)/0.12,2.0)); }
float aHeight(vec3 p){ return 0.8*aFbm(p*3.5) + 0.45*aFbm(p*8.0) + 0.85*aCraters(p*2.4); }
`;
const GLSL_BUMP = `
{
  float hC = aHeight(vDet);
  vec3 sp = -vViewPosition;
  vec3 sx = dFdx(sp); vec3 sy = dFdy(sp);
  vec3 R1 = cross(sy, normal); vec3 R2 = cross(normal, sx);
  float det = dot(sx, R1);
  vec3 grad = sign(det) * (dFdx(hC) * R1 + dFdy(hC) * R2);
  normal = normalize(abs(det) * normal - 0.6 * grad);
}
`;
const GLSL_ALBEDO = `
{
  float g = aFbm(vDet * 3.0);
  diffuseColor.rgb *= 0.62 + 0.26 * g;             // mottling, darker overall (rocks are low-albedo)
  diffuseColor.rgb *= 1.0 + 0.4 * aCraters(vDet * 2.4); // darken inside crater bowls
}
`;
const GLSL_SSS = `
{
  float fres = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 3.0);
  vec3 ice = vec3(0.42, 0.6, 0.9);
  totalEmissiveRadiance += ice * fres * 0.28;
  reflectedLight.indirectDiffuse += ice * 0.07;
}
`;

// type -> material. Darker albedos overall; iron is dark + sharp + reflective so it READS as metal.
const TYPES = {
  silicate: { rough: 0.97, metal: 0.0, env: 0, ice: false, hue: [0.06, 0.04], sat: [0.03, 0.06], lit: [0.24, 0.12] },
  tholin:   { rough: 0.95, metal: 0.0, env: 0, ice: false, hue: [0.02, 0.05], sat: [0.45, 0.25], lit: [0.10, 0.08] },
  ice:      { rough: 0.20, metal: 0.0, env: 0.45, ice: true, hue: [0.55, 0.07], sat: [0.10, 0.15], lit: [0.5, 0.16] },
  iron:     { rough: 0.28, metal: 1.0, env: 1.4, ice: false, hue: [0.6, 0.04], sat: [0.05, 0.06], lit: [0.32, 0.10] },
};
function tintFor(type, rng) { const T = TYPES[type]; return new THREE.Color().setHSL(T.hue[0] + rng() * T.hue[1], T.sat[0] + rng() * T.sat[1], T.lit[0] + rng() * T.lit[1]); }
function makeMaterial(type) {
  const T = TYPES[type];
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: T.rough, metalness: T.metal });
  if (T.env) mat.envMapIntensity = T.env;
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vDet;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vDet = transformed;');
    let f = shader.fragmentShader
      .replace('#include <common>', GLSL_NOISE + '\n#include <common>')
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n' + GLSL_BUMP)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + GLSL_ALBEDO);
    if (T.ice) f = f.replace('#include <lights_fragment_end>', GLSL_SSS + '\n#include <lights_fragment_end>');
    shader.fragmentShader = f;
  };
  return mat;
}

export function createAsteroidField(scene, opts = {}) {
  const vfx = opts.vfx || null;
  const camera = opts.camera || null;
  const isMobile = !!opts.isMobile;
  const count = opts.count || (isMobile ? 70 : 200);
  const getQuality = opts.getQuality || null; // () -> the quality controller (reads .pressure)
  const loDetail = opts.loDetail != null ? opts.loDetail : (isMobile ? 1 : 2);
  const medDetail = opts.medDetail != null ? opts.medDetail : (isMobile ? 2 : 4);
  const HI_MIN = isMobile ? 3 : 4, HI_MAX = isMobile ? 4 : 6;     // hi-LOD subdivision range the autoscaler may pick
  let hiDetail = Math.min(HI_MAX, Math.max(HI_MIN, opts.startHi != null ? opts.startHi : (isMobile ? 3 : 5)));
  const nVariants = opts.variants || (isMobile ? 8 : 14);
  const center = new THREE.Vector3().fromArray(opts.center || [0, 0, -1500]);
  const half = new THREE.Vector3().fromArray(opts.halfExtents || [1300, 450, 1000]);
  const SPAWN_CLEAR = opts.spawnClear || 450;
  const seed = opts.seed || 1337;
  const _camPos = new THREE.Vector3();

  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);

  // Per variant: fixed med + lo geometry, and a SWAPPABLE hi geometry whose subdivision the autoscaler
  // tweaks (same vseed at any detail -> same shape, different resolution). Hi geos are cached per detail so
  // each level is built at most once.
  const rng = makeRng(seed);
  const vseeds = [], geoMed = [], geoLo = [], variantType = [];
  const pickType = () => { const r = rng(); return r < 0.55 ? 'silicate' : r < 0.77 ? 'tholin' : r < 0.92 ? 'ice' : 'iron'; };
  for (let i = 0; i < nVariants; i++) {
    const vseed = (seed * 2654435761 + i * 40503) >>> 0;
    vseeds.push(vseed);
    geoMed.push(buildVariant(medDetail, makeRng(vseed)));
    geoLo.push(buildVariant(loDetail, makeRng(vseed)));
    variantType.push(pickType());
  }
  const hiCache = new Map(); // detail -> [geo per variant]
  function buildHiSet(d) { if (!hiCache.has(d)) hiCache.set(d, vseeds.map((vs) => buildVariant(d, makeRng(vs)))); return hiCache.get(d); }
  let geoHi = buildHiSet(hiDetail);
  const materials = {}; for (const t of Object.keys(TYPES)) materials[t] = makeMaterial(t);

  // bodies; mass ∝ volume (radius³)
  const bodies = [];
  const perVariant = new Array(nVariants).fill(0);
  const _u = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const roll = rng();
    const scale = roll < 0.68 ? 6 + rng() * 12 : roll < 0.93 ? 18 + rng() * 22 : 40 + rng() * 30;
    const p = new THREE.Vector3((rng() * 2 - 1), (rng() * 2 - 1), (rng() * 2 - 1));
    if (p.lengthSq() > 1) p.normalize().multiplyScalar(0.35 + 0.65 * rng());
    p.multiply(half).add(center);
    if (p.lengthSq() < SPAWN_CLEAR * SPAWN_CLEAR) p.setLength(SPAWN_CLEAR + rng() * 250);
    const variant = (rng() * nVariants) | 0;
    const radius = scale * 1.05;
    perVariant[variant]++;
    bodies.push({
      pos: p, home: p.clone(),
      vel: new THREE.Vector3((rng() * 2 - 1), (rng() * 2 - 1), (rng() * 2 - 1)).multiplyScalar(2 + rng() * 5),
      quat: new THREE.Quaternion().setFromAxisAngle(randUnit(rng, _u), rng() * Math.PI * 2),
      spin: new THREE.Vector3((rng() * 2 - 1), (rng() * 2 - 1), (rng() * 2 - 1)).multiplyScalar(0.3),
      radius, mass: radius * radius * radius, variant, scale, hitCd: 0, color: tintFor(variantType[variant], rng),
    });
  }

  // INSTANCED LOD: per variant, one InstancedMesh per LOD (each sized to the variant's body count). Filled
  // per frame by distance bucketing in writeMatrices().
  const mkIM = (g, vi) => { const im = new THREE.InstancedMesh(g, materials[variantType[vi]], Math.max(1, perVariant[vi])); im.count = 0; im.castShadow = false; im.receiveShadow = false; im.frustumCulled = false; im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); group.add(im); return im; };
  const meshes = geoMed.map((medG, vi) => [mkIM(geoHi[vi], vi), mkIM(medG, vi), mkIM(geoLo[vi], vi)]); // [hi, med, lo]
  const counters = meshes.map(() => [0, 0, 0]);
  // swap the HI geometry to a new subdivision (cheap — the instance matrices/colours live on the InstancedMesh)
  function setHiDetail(d) {
    d = Math.max(HI_MIN, Math.min(HI_MAX, d | 0));
    if (d === hiDetail) return;
    hiDetail = d; geoHi = buildHiSet(d);
    for (let vi = 0; vi < meshes.length; vi++) meshes[vi][0].geometry = geoHi[vi];
  }
  let qAcc = 0, qUp = 0, qDown = 0, qCool = 0; // detail-autoscaler state

  // --- scratch ---
  const grid = createSpatialGrid(90);
  const _m = new THREE.Matrix4(), _s = new THREE.Vector3(), _dq = new THREE.Quaternion(), _axis = new THREE.Vector3();
  const _n = new THREE.Vector3(), _rel = new THREE.Vector3(), _imp = new THREE.Vector3(), _rr = new THREE.Vector3(), _tq = new THREE.Vector3();
  const _cp = new THREE.Vector3(), _bs = new THREE.Vector3(), _seg = new THREE.Vector3(), _toC = new THREE.Vector3(), _cl = new THREE.Vector3();
  let MAXR = 0; for (const b of bodies) MAXR = Math.max(MAXR, b.radius);

  function segDistSq(a, end, c) {
    _seg.copy(end).sub(a); const len2 = _seg.lengthSq();
    let t = len2 > 1e-9 ? _toC.copy(c).sub(a).dot(_seg) / len2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
    _cl.copy(a).addScaledVector(_seg, t); return _cl.distanceToSquared(c);
  }
  function applyImpulse(b, impulse, contact) {
    b.vel.addScaledVector(impulse, 1 / b.mass);
    _rr.copy(contact).sub(b.pos); _tq.crossVectors(_rr, impulse);
    b.spin.addScaledVector(_tq, 1 / (0.4 * b.mass * b.radius * b.radius));
    const w = b.spin.length(); if (w > MAX_SPIN) b.spin.multiplyScalar(MAX_SPIN / w);
  }
  function collideShip(b, sp, sr, sv, shipMass) {
    _n.copy(b.pos).sub(sp); const d = _n.length(); const overlap = (b.radius + sr) - d;
    if (overlap <= 0 || d < 1e-3) return -1;
    _n.multiplyScalar(1 / d);
    const inv = 1 / (shipMass + b.mass);
    b.pos.addScaledVector(_n, overlap * shipMass * inv);
    sp.addScaledVector(_n, -overlap * b.mass * inv);
    _cp.copy(sp).addScaledVector(_n, sr);
    const rvN = sv ? _rel.copy(b.vel).sub(sv).dot(_n) : b.vel.dot(_n);
    if (rvN < 0) { _imp.copy(_n).multiplyScalar(-(1 + REST) * rvN / (1 / shipMass + 1 / b.mass)); applyImpulse(b, _imp, _cp); }
    return Math.max(0, -rvN);
  }

  // distance-bucket every rock into its variant's hi/med/lo InstancedMesh + write matrix + colour
  function writeMatrices() {
    if (camera) _camPos.copy(camera.position);
    for (const c of counters) { c[0] = 0; c[1] = 0; c[2] = 0; }
    for (const b of bodies) {
      const dist = camera ? _camPos.distanceTo(b.pos) : 9999;
      const rr = dist / b.radius;
      const lod = rr < LOD_HI_R ? 0 : rr < LOD_MED_R ? 1 : 2;
      const im = meshes[b.variant][lod];
      const idx = counters[b.variant][lod]++;
      _s.setScalar(b.scale); _m.compose(b.pos, b.quat, _s);
      im.setMatrixAt(idx, _m);
      im.setColorAt(idx, b.color);
    }
    for (let vi = 0; vi < meshes.length; vi++) for (let l = 0; l < 3; l++) {
      const im = meshes[vi][l]; im.count = counters[vi][l];
      im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }
  function setVisible(on) { group.visible = !!on; if (on) reset(); }
  function reset() {
    for (const b of bodies) {
      b.pos.copy(b.home);
      b.vel.set((Math.random() * 2 - 1), (Math.random() * 2 - 1), (Math.random() * 2 - 1)).multiplyScalar(2 + Math.random() * 5);
      b.spin.set((Math.random() * 2 - 1), (Math.random() * 2 - 1), (Math.random() * 2 - 1)).multiplyScalar(0.3);
      b.hitCd = 0;
    }
    writeMatrices();
  }

  function update(dt, ctx = {}) {
    if (!group.visible) return;
    const flying = ctx.mode === 'flying';

    // detail autoscaler: the hi-LOD subdivision is a structural lever (rebuild is dear -> debounced + cached)
    // driven by the SHARED GPU pressure. Climbs toward HI_MAX (6) when there's headroom, drops on load. Runs
    // even where the global structural tier is pinned (desktop), since it reads pressure directly.
    if (getQuality && flying) {
      qAcc += dt;
      if (qAcc >= 0.25) {
        qAcc = 0;
        const q = getQuality(); const p = q && q.pressure != null ? q.pressure : 0;
        if (qCool > 0) qCool--;
        else if (p < 0.28 && hiDetail < HI_MAX) { qDown = 0; if (++qUp >= 8) { setHiDetail(hiDetail + 1); qUp = 0; qCool = 16; } }
        else if (p > 0.8 && hiDetail > HI_MIN) { qUp = 0; if (++qDown >= 4) { setHiDetail(hiDetail - 1); qDown = 0; qCool = 16; } }
        else { qUp = 0; qDown = 0; }
      }
    }

    for (const b of bodies) {
      b.pos.addScaledVector(b.vel, dt);
      _rel.copy(b.home).sub(b.pos); const hd = _rel.length();
      if (hd > 1) b.vel.addScaledVector(_rel.multiplyScalar(1 / hd), Math.min(hd, 60) * 0.02 * dt);
      b.vel.multiplyScalar(1 - 0.02 * dt);
      const w = b.spin.length();
      if (w > 1e-5) { _dq.setFromAxisAngle(_axis.copy(b.spin).multiplyScalar(1 / w), w * dt); b.quat.premultiply(_dq); b.quat.normalize(); }
      b.spin.multiplyScalar(1 - 0.04 * dt);
      if (b.hitCd > 0) b.hitCd -= dt;
    }

    grid.begin();
    for (const b of bodies) grid.insert(b.pos.x, b.pos.y, b.pos.z, b);

    for (let i = 0; i < bodies.length; i++) bodies[i]._i = i;
    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i];
      grid.query(a.pos.x, a.pos.y, a.pos.z, a.radius + MAXR, (b) => {
        if (b._i <= i) return;
        _n.copy(b.pos).sub(a.pos); const d = _n.length(); const overlap = (a.radius + b.radius) - d;
        if (overlap <= 0 || d < 1e-3) return;
        _n.multiplyScalar(1 / d);
        const inv = 1 / (a.mass + b.mass);
        a.pos.addScaledVector(_n, -overlap * (b.mass * inv));
        b.pos.addScaledVector(_n, overlap * (a.mass * inv));
        const rvN = _rel.copy(b.vel).sub(a.vel).dot(_n);
        if (rvN < 0) {
          _imp.copy(_n).multiplyScalar(-(1 + REST) * rvN / (1 / a.mass + 1 / b.mass));
          _cp.copy(a.pos).addScaledVector(_n, a.radius);
          applyImpulse(b, _imp, _cp);
          _imp.negate(); applyImpulse(a, _imp, _cp);
        }
      });
    }

    if (flying) {
      const pl = ctx.player;
      if (pl && pl.pos) grid.query(pl.pos.x, pl.pos.y, pl.pos.z, (pl.radius || 5) + MAXR, (b) => {
        const closing = collideShip(b, pl.pos, pl.radius || 5, pl.vel, SHIP_MASS);
        if (closing >= 0 && b.hitCd <= 0 && ctx.damage) {
          ctx.damage.applyHit(_cp.clone(), Math.min(45, 5 + closing * 0.5 + b.scale * 0.4), b.pos);
          if (vfx) vfx.firework(_cp.clone(), 0.5);
          b.hitCd = HIT_CD;
        }
      });
      const en = ctx.enemies;
      if (en) for (const e of en) {
        if (!e.alive) continue;
        grid.query(e.pos.x, e.pos.y, e.pos.z, (e.radius || 2.2) + MAXR, (b) => {
          const closing = collideShip(b, e.pos, e.radius || 2.2, e.vel, ENEMY_MASS);
          if (closing >= 0 && b.hitCd <= 0) {
            if (vfx) vfx.spark(_cp.clone(), 0xffd0a0);
            e.hp -= Math.min(e.maxHp || 30, 12 + b.scale * 0.5);
            if (e.hp <= 0 && ctx.enemyMgr) ctx.enemyMgr.kill(e);
            b.hitCd = HIT_CD;
          }
        });
      }
      const pr = ctx.projectiles;
      if (pr && pr.live) {
        const bolts = pr.live;
        for (let i = bolts.length - 1; i >= 0; i--) {
          const bo = bolts[i];
          _bs.copy(bo.pos).addScaledVector(bo.vel, -dt);
          let hitB = null;
          grid.query(bo.pos.x, bo.pos.y, bo.pos.z, bo.radius + MAXR, (b) => {
            if (hitB) return; const rr = b.radius + bo.radius;
            if (segDistSq(_bs, bo.pos, b.pos) <= rr * rr) hitB = b;
          });
          if (hitB) {
            const v = bo.vel.length(); if (v > 1e-3) { _imp.copy(bo.vel).multiplyScalar(BOLT_IMPULSE / v); applyImpulse(hitB, _imp, bo.pos); }
            if (vfx) vfx.spark(bo.pos.clone(), 0xffe0b0);
            pr.kill(bo);
          }
        }
      }
    }

    writeMatrices();
  }

  function dispose() {
    for (const lods of meshes) for (const im of lods) { group.remove(im); im.dispose(); }
    for (const g of geoMed) g.dispose();
    for (const g of geoLo) g.dispose();
    for (const set of hiCache.values()) for (const g of set) g.dispose();
    for (const t of Object.keys(materials)) materials[t].dispose();
    scene.remove(group);
  }

  return { group, setVisible, update, reset, dispose, setHiDetail, get count() { return bodies.length; }, get hiDetail() { return hiDetail; } };
}
