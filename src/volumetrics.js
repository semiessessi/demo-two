import * as THREE from 'three';

// GPU raymarched volumetric VFX — thick fire + smoke explosions and occluding smoke trails.
//
// Each effect is ONE icosphere mesh used purely as a bounding proxy; the look is a fragment-shader
// raymarch through an FBM density field (same hash/value-noise as the nebula). Density is multiplied
// by a SPHERE falloff so it dies before the hull (contained, no hard clipping).
//
// Shading is a proper emission–absorption volume with TWO coupled components (like demo-1's clouds +
// a fire model):
//   • SMOKE  — absorptive. Lit by a key light via a short SELF-SHADOW light-march (Beer-Lambert) so
//     it reads as a thick, 3D, occluding volume rather than a flat haze; Beer-Powder darkens edges.
//   • FIRE   — emissive. A temperature field (hot in the dense core, cooling outward + with age) maps
//     through a blackbody ramp; emission is added on top and pushes >1 in HDR so it blooms.
// Extinction (uSigma) is high so smoke builds opacity fast and OCCLUDES what's behind it. Output is
// premultiplied RGBA composited with CustomBlending "over"; live volumes are sorted far->near each
// frame (renderOrder) so the "over" blend is correct across overlaps.

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
uniform float uDensity;   // density multiplier
uniform float uSigma;     // extinction coefficient -> thickness / occlusion
uniform float uEmissive;  // 0 = pure smoke; >0 = hot fire amount (explosions, fades with age)
uniform float uNoiseScale;
uniform float uDrift;
uniform float uSteps;
uniform float uSelfShadow; // 1 = run the per-step self-shadow march; 0 = read fully lit (distant/low tier)
uniform vec3 uColSmoke;   // smoke albedo (gets lit)
uniform vec3 uLightDir;   // toward the key light (normalized)
uniform vec3 uLightColor;
uniform vec3 uAmbient;
uniform vec4 uBlobs[4];   // xyz = unit offset from centre, w = weight
uniform int uBlobCount;
// occlusion pre-pass: opaque scene depth (half-res), used to skip puffs hidden behind ships
uniform sampler2D uDepthTex;
uniform vec2 uResolution;
uniform vec3 uCamFwd;
uniform float uCamNear;
uniform float uCamFar;
uniform float uOcclude;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float vnoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
                 mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                 mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm5(vec3 p) { float v=0.0,a=0.5; for(int i=0;i<5;i++){ v+=a*vnoise(p); p*=2.02; a*=0.5; } return v; }
float fbm3(vec3 p) { float v=0.0,a=0.5; for(int i=0;i<3;i++){ v+=a*vnoise(p); p*=2.02; a*=0.5; } return v; }

const int MAX_STEPS = 80;

float fall(vec3 p) { return 1.0 - smoothstep(0.40, 1.0, length(p) / uRadius); }
float blobMask(vec3 p) {
  float b = (uBlobCount > 0) ? 0.0 : 1.0;
  for (int k = 0; k < 4; k++) {
    if (k >= uBlobCount) break;
    vec3 off = uBlobs[k].xyz * uRadius;
    b = max(b, uBlobs[k].w * (1.0 - smoothstep(0.0, 0.8, length(p - off) / uRadius)));
  }
  return b;
}
// full-detail density (main march)
float densityFull(vec3 p) {
  float f = fall(p);
  if (f <= 0.0) return 0.0;
  vec3 q = (p / uRadius) * uNoiseScale + vec3(uSeed) + vec3(0.0, uTime * uDrift, uSeed * 0.37);
  return max((fbm5(q) - 0.40) * 2.0, 0.0) * f * blobMask(p) * uDensity;
}
// cheaper density for the shadow light-march (3 octaves)
float densityLite(vec3 p) {
  float f = fall(p);
  if (f <= 0.0) return 0.0;
  vec3 q = (p / uRadius) * uNoiseScale + vec3(uSeed) + vec3(0.0, uTime * uDrift, uSeed * 0.37);
  return max((fbm3(q) - 0.40) * 2.0, 0.0) * f * blobMask(p) * uDensity;
}

// blackbody-ish fire ramp: deep red -> orange -> yellow -> white
vec3 fireRamp(float t) {
  vec3 c = mix(vec3(0.65, 0.05, 0.0), vec3(1.0, 0.32, 0.05), smoothstep(0.0, 0.35, t));
  c = mix(c, vec3(1.0, 0.74, 0.30), smoothstep(0.35, 0.65, t));
  c = mix(c, vec3(1.0, 0.97, 0.88), smoothstep(0.65, 1.0, t));
  return c;
}

void main() {
  vec3 ro = cameraPosition;
  vec3 rd = normalize(vWorldPos - cameraPosition);
  vec3 oc = ro - uCenter;
  float b = dot(oc, rd);
  float c = dot(oc, oc) - uRadius * uRadius;
  float disc = b * b - c;
  if (disc < 0.0) discard;
  float sq = sqrt(disc);
  float t0 = max(-b - sq, 0.0);
  float t1 = -b + sq;
  if (t1 <= t0) discard;

  // occlusion cull: if the puff's FRONT (t0) is behind the opaque scene depth on this ray, the whole
  // puff is hidden -> skip the expensive march entirely. Depth comes from the half-res opaque pre-pass.
  if (uOcclude > 0.5) {
    float sd = texture2D(uDepthTex, gl_FragCoord.xy / uResolution).x;
    if (sd < 0.999999) { // <1 == something opaque was drawn here
      float ndc = sd * 2.0 - 1.0;
      float vz = (2.0 * uCamNear * uCamFar) / (uCamFar + uCamNear - ndc * (uCamFar - uCamNear)); // eye-Z dist
      if (t0 > vz / max(dot(rd, uCamFwd), 0.2)) discard; // /cos -> distance along THIS ray
    }
  }

  float steps = clamp(uSteps, 4.0, float(MAX_STEPS));
  float dt = (t1 - t0) / steps;
  float jitter = hash(vec3(gl_FragCoord.xy, uTime));
  float t = t0 + dt * jitter;
  float lstep = uRadius * 0.22; // shadow tap spacing

  vec3 scat = vec3(0.0);
  float T = 1.0; // transmittance
  for (int i = 0; i < MAX_STEPS; i++) {
    if (float(i) >= steps || T < 0.02) break;
    vec3 p = ro + rd * t - uCenter;
    float d = densityFull(p);
    if (d > 0.002) {
      float ext = d * uSigma;
      float dT = exp(-ext * dt);

      // --- smoke: self-shadow toward the key light (3-tap Beer-Lambert) ---
      // Gated: distant / low-tier puffs skip the 3 extra fbm marches per step and read fully lit. The
      // self-shadow reads as 3D thickness up close but is barely legible far away, so it's cheap to drop.
      float lit = 1.0;
      if (uSelfShadow > 0.5) {
        float sh = 0.0;
        for (int j = 1; j <= 3; j++) sh += densityLite(p + uLightDir * lstep * float(j));
        lit = exp(-sh * lstep * uSigma * 1.1);
      }
      vec3 smoke = uColSmoke * (uAmbient + uLightColor * lit);
      smoke *= 1.0 - 0.55 * exp(-d * 3.0); // Beer-Powder: darker thin edges

      // --- fire: temperature field -> blackbody emission (only when uEmissive > 0) ---
      vec3 emit = vec3(0.0);
      if (uEmissive > 0.001) {
        float rc = clamp(1.0 - length(p) / uRadius, 0.0, 1.0); // hotter toward the core
        float heat = clamp(uEmissive * clamp(d * 1.3, 0.0, 1.0) * (0.4 + 0.6 * rc), 0.0, 1.0);
        emit = fireRamp(heat) * (0.3 + heat * heat * 5.5);
      }

      vec3 S = smoke + emit;
      scat += T * (1.0 - dT) * S;
      T *= dT;
    }
    t += dt;
  }

  float a = 1.0 - T;
  if (a < 0.004) discard;
  gl_FragColor = vec4(scat, a); // premultiplied
}`;

const COL = {
  explSmoke: new THREE.Color(0x4a423a), // warm dark smoke for explosions
  trailSmoke: new THREE.Color(0x6a6f76), // greyer smoke for damage trails
  light: new THREE.Color(0xfff0d8),
  ambient: new THREE.Color(0x12161f),
};
const LIGHT_DIR = new THREE.Vector3(0.4, 0.85, 0.3).normalize();

export function createVolumetrics(scene, camera, opts = {}) {
  const geo = new THREE.IcosahedronGeometry(1, 1);
  // self-shadow light direction: align with the scene's real sun when provided (otherwise a default)
  const lightDir = (opts.lightDir ? opts.lightDir.clone() : LIGHT_DIR.clone()).normalize();
  let smokeShadows = false; // tier-gated: smoke casts a soft (dithered) shadow onto the ships

  // Occlusion uniforms are SHARED across every pooled material (one object referenced by all) so the
  // per-frame camera/depth update touches one set, not 56 materials.
  const occ = {
    uDepthTex: { value: null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uCamFwd: { value: new THREE.Vector3(0, 0, -1) },
    uCamNear: { value: 0.5 },
    uCamFar: { value: 12000 },
    uOcclude: { value: 0 },
  };

  // Soft volumetric shadow caster: a packed-depth material that stochastically discards fragments by
  // the puff's coverage, so the icosa proxy throws a noisy, soft blob shadow (PCF smooths the stipple)
  // into the CSM / spot shadow maps. Each pooled mesh gets its own so coverage can be per-puff.
  function makeDepthMat() {
    const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.FrontSide });
    const cov = { value: 0 };
    m.userData.cov = cov;
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uCov = cov;
      sh.fragmentShader =
        'uniform float uCov;\nfloat _dh(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }\n' +
        sh.fragmentShader.replace('void main() {', 'void main() {\n\tif (_dh(gl_FragCoord.xy) >= uCov) discard;');
    };
    return m;
  }

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
        uSigma: { value: 2.5 },
        uEmissive: { value: 0 },
        uNoiseScale: { value: 2.4 },
        uDrift: { value: 0.3 },
        uSteps: { value: 32 },
        uSelfShadow: { value: 1 },
        uColSmoke: { value: new THREE.Color() },
        uLightDir: { value: lightDir.clone() },
        uLightColor: { value: COL.light.clone() },
        uAmbient: { value: COL.ambient.clone() },
        uBlobs: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
        uBlobCount: { value: 0 },
        uDepthTex: occ.uDepthTex,
        uResolution: occ.uResolution,
        uCamFwd: occ.uCamFwd,
        uCamNear: occ.uCamNear,
        uCamFar: occ.uCamFar,
        uOcclude: occ.uOcclude,
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
      const depthMat = makeDepthMat();
      mesh.customDepthMaterial = depthMat; // used when the puff casts a shadow (castShadow toggled per frame)
      mesh.castShadow = false;
      scene.add(mesh);
      arr.push({ mesh, mat, depthMat, alive: false, kind: 'expl', age: 0, maxLife: 1, baseScale: 1, seed: 0, densMul: 1, sigma: 2.5, drift: new THREE.Vector3() });
    }
    return arr;
  }

  const EXPL_MAX = 12;
  const PUFF_MAX = 44;
  const explPool = makePool(EXPL_MAX);
  const puffPool = makePool(PUFF_MAX);

  let elapsed = 0;
  let quality = 'high';
  const tunable = { explSteps: 48, puffSteps: 22, densityMul: 1, fireSigma: 2.2, smokeSigma: 3.6 };
  let load = 0; // 0..1 autoscaler pressure (set per frame): trims raymarch steps + drops self-shadow under GPU load

  function pick(pool) {
    for (const s of pool) if (!s.alive) return s;
    let oldest = pool[0];
    for (const s of pool) if (s.age / s.maxLife > oldest.age / oldest.maxLife) oldest = s;
    return oldest;
  }

  const _tmp = new THREE.Vector3();

  // Configure one explosion volume (a solid noisy fireball) on a pooled slot — no recursion.
  function configExpl(s, cpos, cscale) {
    s.alive = true;
    s.kind = 'expl';
    s.age = 0;
    s.maxLife = 1.7 + Math.random() * 0.3;
    s.baseScale = 9 * cscale;
    s.seed = Math.random() * 100;
    s.densMul = 1;
    s.drift.set(0, 0.7 * cscale, 0);
    const u = s.mat.uniforms;
    u.uCenter.value.copy(cpos);
    u.uSeed.value = s.seed;
    u.uNoiseScale.value = 2.4; // finer detail
    u.uDrift.value = 0.5;
    u.uColSmoke.value.copy(COL.explSmoke);
    u.uBlobCount.value = 0;
    s.mesh.position.copy(cpos);
    s.mesh.visible = true;
    stepExplosion(s, 0);
  }

  function explosion(pos, scale = 1) {
    configExpl(pick(explPool), pos, scale); // primary fireball
    if (quality !== 'low') {
      // satellite lobes -> a richer, lumpier blast
      for (let i = 0; i < 3; i++) {
        _tmp.copy(pos).add(new THREE.Vector3((Math.random() - 0.5) * 5 * scale, (Math.random() - 0.5) * 4 * scale, (Math.random() - 0.5) * 5 * scale));
        configExpl(pick(explPool), _tmp, scale * 0.45);
      }
    }
    // lingering thick smoke left behind after the fireball cools
    const puffN = quality === 'low' ? 2 : 4;
    for (let i = 0; i < puffN; i++) {
      _tmp.copy(pos).add(new THREE.Vector3((Math.random() - 0.5) * 5 * scale, (Math.random() - 0.5) * 3 * scale, (Math.random() - 0.5) * 5 * scale));
      puff(_tmp, { life: 3.0, radius: 4.0 * scale, density: 1.1, drift: new THREE.Vector3((Math.random() - 0.5) * 1.5, 1.6, (Math.random() - 0.5) * 1.5), blobs: 3 });
    }
  }

  function puff(pos, opts = {}) {
    const s = pick(puffPool);
    s.alive = true;
    s.kind = 'puff';
    s.age = 0;
    s.maxLife = opts.life ?? 3.0;
    s.baseScale = opts.radius ?? 3.5;
    s.seed = Math.random() * 100;
    s.densMul = opts.density ?? 1;
    s.drift.copy(opts.drift ?? _tmp.set(0, 1.2, 0));
    const u = s.mat.uniforms;
    u.uCenter.value.copy(pos);
    u.uSeed.value = s.seed;
    u.uNoiseScale.value = 2.7;
    u.uDrift.value = 0.35;
    u.uColSmoke.value.copy(COL.trailSmoke);
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
    u.uDensity.value = 1.7 * Math.exp(-age * 1.2) * tunable.densityMul;
    u.uEmissive.value = Math.max(0, 1.25 - age / 0.5); // white-hot core flash, then cools to thick smoke
    u.uSigma.value = tunable.fireSigma;
    u.uTime.value = elapsed;
    // distance/occlusion cheapening (like the smoke puffs): a furball spawns many explosions at once, and
    // a distant or engulfing blast doesn't need full steps + self-shadow. Close "hero" blasts stay full.
    const distSq = s.mesh.position.distanceToSquared(camera.position);
    const near = distSq < cur * cur;
    let st = quality === 'low' ? 24 : tunable.explSteps;
    if (distSq > 160 * 160) st = quality === 'low' ? 14 : 20;
    else if (distSq > 80 * 80) st = quality === 'low' ? 18 : 26;
    if (near) st = quality === 'low' ? 10 : 16;
    u.uSteps.value = load > 0 ? Math.max(8, Math.round(st * (1 - 0.4 * load))) : st; // autoscaler trims steps under GPU load
    u.uSelfShadow.value = (quality === 'low' || near || distSq > 130 * 130 || load > 0.6) ? 0 : 1;
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
    const fadeIn = THREE.MathUtils.smoothstep(k, 0, 0.1);
    const fadeOut = 1 - THREE.MathUtils.smoothstep(k, 0.7, 1.0);
    u.uDensity.value = 1.15 * s.densMul * fadeIn * fadeOut * tunable.densityMul;
    u.uEmissive.value = 0; // pure smoke
    u.uSigma.value = tunable.smokeSigma;
    u.uTime.value = elapsed;
    // soft shadow cast onto the ships (tier-gated): coverage tracks the puff's density
    const cov = Math.min(0.8, u.uDensity.value * 0.9);
    s.depthMat.userData.cov.value = cov;
    s.mesh.castShadow = smokeShadows && cov > 0.05;
    const distSq = s.mesh.position.distanceToSquared(camera.position);
    // camera inside / right on top of the puff: it fills the whole screen, so a full-step self-shadowed
    // raymarch (×many puffs in a smoke cloud) tanks the framerate. When engulfed you can't read fine 3D
    // detail anyway -> cap steps hard + drop the (expensive) self-shadow. This is the fly-through case.
    const near = distSq < cur * cur;
    let st = quality === 'low' ? 12 : tunable.puffSteps;
    if (distSq > 140 * 140) st = quality === 'low' ? 9 : 14;
    else if (distSq > 70 * 70) st = quality === 'low' ? 11 : 18;
    if (near) st = quality === 'low' ? 6 : 10;
    if (k > 0.6) st = Math.max(8, st - 5);
    u.uSteps.value = load > 0 ? Math.max(6, Math.round(st * (1 - 0.4 * load))) : st; // autoscaler trims steps under GPU load
    // Self-shadow is the per-step 3-tap fbm march — easily the puff's heaviest cost. Drop it on low tier,
    // for distant puffs (illegible far away), when the camera is inside the puff, or under GPU load.
    u.uSelfShadow.value = (quality === 'low' || near || distSq > 110 * 110 || load > 0.5) ? 0 : 1;
  }

  function retire(s) {
    s.alive = false;
    s.mesh.visible = false;
    s.mesh.castShadow = false;
  }

  // Each of spawnDist/spawnInterval/life/radius/density/blobs may be a number OR a live getter — so a
  // caller (e.g. the damage model) can ramp the smoke denser + faster as a subsystem's HP falls.
  function createTrail(opts = {}) {
    const getPos = opts.getPos;
    const getVel = opts.getVel ?? (() => _zero);
    const ev = (v, d) => (typeof v === 'function' ? v() : v != null ? v : d);
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
        if (moved >= ev(opts.spawnDist, 3.0) || accT >= ev(opts.spawnInterval, 0.14)) {
          accT = 0;
          last.copy(pos);
          const vel = getVel() || _zero;
          _drift.copy(vel).multiplyScalar(0.3);
          _drift.y += 1.0;
          _drift.x += (Math.random() - 0.5) * 1.2;
          _drift.z += (Math.random() - 0.5) * 1.2;
          puff(pos, { life: ev(opts.life, 3.0), radius: ev(opts.radius, 3.2), drift: _drift, blobs: Math.round(ev(opts.blobs, 3)), density: ev(opts.density, 1) });
        }
      },
      stop() { stopped = true; },
    };
  }
  const _zero = new THREE.Vector3();

  const _liveAll = [];
  function update(dt) {
    elapsed += dt;
    for (let i = 0; i < explPool.length; i++) if (explPool[i].alive) stepExplosion(explPool[i], dt);
    for (let i = 0; i < puffPool.length; i++) if (puffPool[i].alive) stepPuff(puffPool[i], dt);

    _liveAll.length = 0;
    for (const s of explPool) if (s.alive) _liveAll.push(s);
    for (const s of puffPool) if (s.alive) _liveAll.push(s);
    for (const s of _liveAll) s._d = s.mesh.position.distanceToSquared(camera.position);
    _liveAll.sort((a, b) => b._d - a._d);
    for (let i = 0; i < _liveAll.length; i++) _liveAll[i].mesh.renderOrder = 10 + i;
  }

  function setQuality(q) { quality = q; }
  function setLoad(p) { load = p < 0 ? 0 : p > 1 ? 1 : p; } // per-frame autoscaler pressure (0..1)

  // --- occlusion pre-pass plumbing ---
  function setOcclusion(depthTex, near, far) {
    occ.uDepthTex.value = depthTex;
    if (near != null) occ.uCamNear.value = near;
    if (far != null) occ.uCamFar.value = far;
    occ.uOcclude.value = depthTex ? 1 : 0;
  }
  function updateOcclusion(cam, w, h) {
    occ.uCamFwd.value.set(0, 0, -1).applyQuaternion(cam.quaternion);
    occ.uResolution.value.set(w, h);
  }
  // hide/restore all pooled puffs so the depth pre-pass renders only opaque occluders (not the smoke)
  function setHiddenForDepth(hidden) {
    for (const s of explPool) s.mesh.visible = hidden ? false : s.alive;
    for (const s of puffPool) s.mesh.visible = hidden ? false : s.alive;
  }
  // Tier-gated: enable/disable smoke casting soft shadows onto the ships.
  function setSmokeShadows(on) {
    smokeShadows = !!on;
    if (!smokeShadows) for (const s of puffPool) s.mesh.castShadow = false;
  }

  return { explosion, puff, createTrail, update, setQuality, setLoad, setOcclusion, updateOcclusion, setHiddenForDepth, setSmokeShadows, tunable };
}
