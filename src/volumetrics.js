import * as THREE from 'three';

// GPU raymarched volumetric VFX — explosions and smoke puffs/trails.
//
// Each effect is ONE icosahedron mesh used purely as a bounding proxy; the look is a fragment-shader
// raymarch through an FBM density field (the hash/value-noise/fbm is the same one the nebula uses).
// The density is multiplied by a SPHERE falloff so it dies well before the icosahedron faces — the
// noise is fully "contained" in the volume with no hard clipping at the hull. Integration is the
// classic emission–absorption model with premultiplied front-to-back accumulation, so the same
// material does hot emissive fireballs (rgb > 1 -> feeds bloom) and absorptive grey smoke just by
// changing uniforms. Output is premultiplied RGBA composited with CustomBlending "over".
//
// Explosions = one expanding emissive->cooling volume. Smoke puffs = longer-lived, drifting, lumpy
// (multi-blob) volumes; a trail is a managed stream of puffs. Across volumes we composite by sorting
// the live meshes far->near each frame and assigning renderOrder, so the "over" blend is correct.

const vertexShader = /* glsl */ `
varying vec3 vWorldPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const fragmentShader = /* glsl */ `
precision highp float;
varying vec3 vWorldPos;
// cameraPosition is provided by three.js for ShaderMaterial
uniform vec3 uCenter;
uniform float uRadius;
uniform float uTime;
uniform float uSeed;
uniform float uDensity;
uniform float uEmissive;
uniform float uNoiseScale;
uniform float uDrift;
uniform float uSteps;
uniform vec3 uColHot;
uniform vec3 uColMid;
uniform vec3 uColSmoke;
uniform vec4 uBlobs[4]; // xyz = unit offset from centre, w = weight
uniform int uBlobCount;

// hash / value noise / fbm — lifted from the nebula backdrop (cheap, good enough for a volume)
float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
                 mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                 mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.02; a *= 0.5; }
  return v;
}

const int MAX_STEPS = 64;

// p is the sample point relative to uCenter, in world units.
float densityAt(vec3 p) {
  float r = length(p) / uRadius;
  float fall = 1.0 - smoothstep(0.45, 1.0, r); // SPHERE fadeoff -> 0 before the hull
  if (fall <= 0.0) return 0.0;
  // lumpiness: smooth-union (max) of a few offset blobs so one puff reads as several overlaps
  float blob = (uBlobCount > 0) ? 0.0 : 1.0;
  for (int k = 0; k < 4; k++) {
    if (k >= uBlobCount) break;
    vec3 off = uBlobs[k].xyz * uRadius;
    float d = length(p - off) / uRadius;
    blob = max(blob, uBlobs[k].w * (1.0 - smoothstep(0.0, 0.8, d)));
  }
  vec3 q = (p / uRadius) * uNoiseScale + vec3(uSeed) + vec3(0.0, uTime * uDrift, uSeed * 0.37);
  float n = fbm(q);
  return max((n - 0.42) * 1.9, 0.0) * fall * blob * uDensity;
}

void main() {
  vec3 ro = cameraPosition;
  vec3 rd = normalize(vWorldPos - cameraPosition);
  // ray vs the falloff sphere — march only the interval that can hold density
  vec3 oc = ro - uCenter;
  float b = dot(oc, rd);
  float c = dot(oc, oc) - uRadius * uRadius;
  float disc = b * b - c;
  if (disc < 0.0) discard;
  float sq = sqrt(disc);
  float t0 = max(-b - sq, 0.0); // camera may be inside the volume -> start at itself
  float t1 = -b + sq;
  if (t1 <= t0) discard;

  float steps = clamp(uSteps, 4.0, float(MAX_STEPS));
  float dt = (t1 - t0) / steps;
  float jitter = hash(vec3(gl_FragCoord.xy, uTime)); // dither the start -> kills low-step banding
  float t = t0 + dt * jitter;

  vec4 acc = vec4(0.0); // premultiplied
  for (int i = 0; i < MAX_STEPS; i++) {
    if (float(i) >= steps || acc.a > 0.99) break;
    vec3 p = ro + rd * t - uCenter;
    float d = densityAt(p);
    if (d > 0.001) {
      float heat = clamp(d * uEmissive, 0.0, 1.0);
      vec3 col = mix(uColSmoke, uColMid, smoothstep(0.0, 0.5, d));
      col = mix(col, uColHot, smoothstep(0.35, 1.0, heat));
      vec3 emit = uColHot * heat * 2.5; // pushes > 1 in HDR -> bloom
      float a = 1.0 - exp(-d * dt * 1.6); // Beer-Lambert
      vec3 src = col + emit;
      acc.rgb += (1.0 - acc.a) * src * a;
      acc.a += (1.0 - acc.a) * a;
    }
    t += dt;
  }
  if (acc.a < 0.004) discard;
  gl_FragColor = acc;
}`;

const COL = {
  explHot: new THREE.Color(0xfff2d0),
  explMid: new THREE.Color(0xff7a30),
  explSmoke: new THREE.Color(0x47403a),
  smokeHot: new THREE.Color(0x9aa0a8),
  smokeMid: new THREE.Color(0x595e66),
  smokeLow: new THREE.Color(0x7b818a),
};

export function createVolumetrics(scene, camera) {
  const geo = new THREE.IcosahedronGeometry(1, 1); // detail 1: a tight icosphere bound on the falloff sphere

  function makeMaterial() {
    return new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uCenter: { value: new THREE.Vector3() },
        uRadius: { value: 1 },
        uTime: { value: 0 },
        uSeed: { value: 0 },
        uDensity: { value: 1 },
        uEmissive: { value: 0 },
        uNoiseScale: { value: 2.4 },
        uDrift: { value: 0.3 },
        uSteps: { value: 32 },
        uColHot: { value: new THREE.Color() },
        uColMid: { value: new THREE.Color() },
        uColSmoke: { value: new THREE.Color() },
        uBlobs: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
        uBlobCount: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.BackSide,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendEquationAlpha: THREE.AddEquation,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
  }

  function makePool(n) {
    const arr = [];
    for (let i = 0; i < n; i++) {
      const mat = makeMaterial();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.frustumCulled = true;
      mesh.renderOrder = 10;
      scene.add(mesh);
      arr.push({ mesh, mat, alive: false, kind: 'expl', age: 0, maxLife: 1, baseScale: 1, seed: 0, drift: new THREE.Vector3() });
    }
    return arr;
  }

  const EXPL_MAX = 8;
  const PUFF_MAX = 40;
  const explPool = makePool(EXPL_MAX);
  const puffPool = makePool(PUFF_MAX);

  let elapsed = 0;
  let quality = 'high';
  const tunable = { explSteps: 56, puffSteps: 28, densityMul: 1 };

  function pick(pool) {
    for (const s of pool) if (!s.alive) return s;
    // steal the oldest live slot so trails stay continuous instead of gapping
    let oldest = pool[0];
    for (const s of pool) if (s.age / s.maxLife > oldest.age / oldest.maxLife) oldest = s;
    return oldest;
  }

  function explosion(pos, scale = 1) {
    const s = pick(explPool);
    s.alive = true;
    s.kind = 'expl';
    s.age = 0;
    s.maxLife = 1.7;
    s.baseScale = 9 * scale;
    s.seed = Math.random() * 100;
    s.drift.set(0, 0.6 * scale, 0);
    const u = s.mat.uniforms;
    u.uCenter.value.copy(pos);
    u.uSeed.value = s.seed;
    u.uNoiseScale.value = 2.2;
    u.uDrift.value = 0.55;
    u.uColHot.value.copy(COL.explHot);
    u.uColMid.value.copy(COL.explMid);
    u.uColSmoke.value.copy(COL.explSmoke);
    u.uBlobCount.value = 0;
    s.mesh.position.copy(pos);
    s.mesh.visible = true;
    stepExplosion(s, 0);
  }

  const _blobTmp = new THREE.Vector3();
  function puff(pos, opts = {}) {
    const s = pick(puffPool);
    s.alive = true;
    s.kind = 'puff';
    s.age = 0;
    s.maxLife = opts.life ?? 3.0;
    s.baseScale = (opts.radius ?? 3.5);
    s.seed = Math.random() * 100;
    s.densMul = opts.density ?? 1;
    s.drift.copy(opts.drift ?? _blobTmp.set(0, 1.2, 0));
    const u = s.mat.uniforms;
    u.uCenter.value.copy(pos);
    u.uSeed.value = s.seed;
    u.uNoiseScale.value = 2.7;
    u.uDrift.value = 0.4;
    u.uColHot.value.copy(opts.colorHot ? _colTmp.set(opts.colorHot) : COL.smokeHot);
    u.uColMid.value.copy(COL.smokeMid);
    u.uColSmoke.value.copy(COL.smokeLow);
    const nb = opts.blobs ?? 3;
    u.uBlobCount.value = nb;
    for (let k = 0; k < 4; k++) {
      const v = u.uBlobs.value[k];
      if (k < nb) v.set((Math.random() - 0.5) * 0.7, (Math.random() - 0.5) * 0.7, (Math.random() - 0.5) * 0.7, 0.7 + Math.random() * 0.3);
      else v.set(0, 0, 0, 0);
    }
    s.mesh.position.copy(pos);
    s.mesh.visible = true;
    stepPuff(s, 0);
  }
  const _colTmp = new THREE.Color();

  function stepExplosion(s, dt) {
    s.age += dt;
    if (s.age >= s.maxLife) { retire(s); return; }
    const age = s.age;
    const grow = 0.25 + 0.75 * (1 - Math.exp(-age * 6));
    const cur = s.baseScale * grow;
    s.mesh.scale.setScalar(cur);
    s.mesh.position.addScaledVector(s.drift, dt);
    const u = s.mat.uniforms;
    u.uCenter.value.copy(s.mesh.position);
    u.uRadius.value = cur * 0.78;
    u.uDensity.value = 1.6 * Math.exp(-age * 1.4) * tunable.densityMul;
    u.uEmissive.value = Math.max(0, 1 - age / 0.6); // white-hot ~0.6s, then cools to dark smoke
    u.uTime.value = elapsed;
    u.uSteps.value = quality === 'low' ? 26 : tunable.explSteps;
  }

  function stepPuff(s, dt) {
    s.age += dt;
    if (s.age >= s.maxLife) { retire(s); return; }
    const k = s.age / s.maxLife;
    const grow = 0.6 + 0.7 * (1 - Math.exp(-s.age * 1.6));
    const cur = s.baseScale * grow;
    s.mesh.scale.setScalar(cur);
    s.mesh.position.addScaledVector(s.drift, dt);
    const u = s.mat.uniforms;
    u.uCenter.value.copy(s.mesh.position);
    u.uRadius.value = cur * 0.78;
    const fadeIn = THREE.MathUtils.smoothstep(k, 0, 0.08);
    const fadeOut = 1 - THREE.MathUtils.smoothstep(k, 0.7, 1.0);
    u.uDensity.value = 0.95 * s.densMul * fadeIn * fadeOut * tunable.densityMul;
    u.uEmissive.value = 0;
    u.uTime.value = elapsed;
    // LOD: fewer steps for distant / old puffs
    const distSq = s.mesh.position.distanceToSquared(camera.position);
    let st = quality === 'low' ? 12 : tunable.puffSteps;
    if (distSq > 140 * 140) st = quality === 'low' ? 9 : 14;
    else if (distSq > 70 * 70) st = quality === 'low' ? 11 : 20;
    if (k > 0.6) st = Math.max(9, st - 6);
    u.uSteps.value = st;
  }

  function retire(s) {
    s.alive = false;
    s.mesh.visible = false;
  }

  // A trail emitter: spawns puffs as the source moves (by distance) or over time (so a near-still
  // source still wisps). Returns { update, stop }. getPos/getVel return live Vector3s.
  function createTrail(opts = {}) {
    const getPos = opts.getPos;
    const getVel = opts.getVel ?? (() => _zero);
    const spawnDist = opts.spawnDist ?? 3.0;
    const spawnInterval = opts.spawnInterval ?? 0.14;
    const life = opts.life ?? 3.0;
    const radius = opts.radius ?? 3.2;
    const density = opts.density ?? 1;
    const last = new THREE.Vector3();
    let started = false;
    let accT = 0;
    let stopped = false;
    const _drift = new THREE.Vector3();
    const _p = new THREE.Vector3();
    return {
      update(dt) {
        if (stopped) return;
        const pos = getPos();
        if (!pos) return;
        if (!started) { last.copy(pos); started = true; }
        accT += dt;
        const moved = _p.copy(pos).sub(last).length();
        if (moved >= spawnDist || accT >= spawnInterval) {
          accT = 0;
          last.copy(pos);
          const vel = getVel() || _zero;
          _drift.copy(vel).multiplyScalar(0.3);
          _drift.y += 1.0; // buoyancy
          _drift.x += (Math.random() - 0.5) * 1.2;
          _drift.z += (Math.random() - 0.5) * 1.2;
          puff(pos, { life, radius, drift: _drift, blobs: 3, density });
        }
      },
      stop() { stopped = true; },
    };
  }
  const _zero = new THREE.Vector3();

  // collected each frame for the back-to-front sort
  const _liveAll = [];
  function update(dt) {
    elapsed += dt;
    for (let i = 0; i < explPool.length; i++) if (explPool[i].alive) stepExplosion(explPool[i], dt);
    for (let i = 0; i < puffPool.length; i++) if (puffPool[i].alive) stepPuff(puffPool[i], dt);

    // "render carefully in order": sort live volumes far->near, assign renderOrder so premultiplied
    // "over" composites correctly across overlapping volumes.
    _liveAll.length = 0;
    for (const s of explPool) if (s.alive) _liveAll.push(s);
    for (const s of puffPool) if (s.alive) _liveAll.push(s);
    for (const s of _liveAll) s._d = s.mesh.position.distanceToSquared(camera.position);
    _liveAll.sort((a, b) => b._d - a._d);
    for (let i = 0; i < _liveAll.length; i++) _liveAll[i].mesh.renderOrder = 10 + i;
  }

  function setQuality(q) { quality = q; }
  function setDepth(/* tex, w, h */) { /* Phase 3 */ }

  return { explosion, puff, createTrail, update, setQuality, setDepth, tunable };
}
