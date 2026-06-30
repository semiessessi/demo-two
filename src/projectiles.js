import * as THREE from 'three';

// Pooled additive energy bolts, shared by the player cannon and the enemy guns. Each bolt is a thin
// streak (a small box stretched along its travel) drawn with a tiny additive shader: an HDR-bright core
// that blooms (= the glow), soft-fading tips, and a scrolling noise "crackle". Per-bolt uniforms
// (colour / glow / noise) + a transverse width let the Chig guns fire fat, white-hot, flickering bolts
// while the player's stay lean. spawn() pulls from a fixed pool; update() advances + expires; `live` is
// exposed for the collision pass.

const MAX = 240;

const BOLT_VERT = `
  varying vec3 vLocal;
  void main() {
    vLocal = position;            // unscaled box-local coords; z in [-1.3, 1.3]
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
// HDR-bright (uGlow) so the bloom pass turns it into a glow; tips fade for a streak look; two scrolling
// value-noise bands flicker the brightness (uNoise = how deep the crackle dips).
const BOLT_FRAG = `
  precision highp float;
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uGlow;
  uniform float uNoise;
  uniform float uSeed;
  uniform float uRound; // 0 = lean box bolt (player); 1 = round fractal-noise streak (Chig guns)
  varying vec3 vLocal;
  float hash(float n) { return fract(sin(n) * 43758.5453123); }
  float vnoise(float x) { float i = floor(x); float f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(hash(i), hash(i + 1.0), f); }
  // 3D value-noise + fbm -> the "white modulated with fractal noise" look on the round streak
  float h3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float vn3(vec3 x) { vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(h3(i + vec3(0,0,0)), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z); }
  float fbm3(vec3 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * vn3(p); p *= 2.03; a *= 0.5; } return v; }
  void main() {
    float zN = vLocal.z / 1.3;                            // -1..1 along the bolt
    if (uRound > 0.5) {
      // Chig shot: a round glowing TUBE + a string of bright blobs along the travel axis (motion-blur streak).
      float head = smoothstep(-1.0, 1.0, zN);             // bright leading head, fading tail behind it
      float blobs = 0.5 + 0.5 * sin(zN * 16.0 + uSeed * 30.0);
      blobs = 0.28 + 0.72 * blobs * blobs;                // distinct, rounder blobs; soft floor keeps it contiguous
      float tip = 1.0 - smoothstep(0.9, 1.0, abs(zN));    // soft ends (no hard cut)
      // bright centerline on every box face -> a round cross-section (under the additive bloom it reads spherical)
      float tube = 1.0 - smoothstep(0.1, 1.0, min(abs(vLocal.x), abs(vLocal.y)) / 0.11);
      float fn = fbm3(vLocal * vec3(5.0, 5.0, 1.8) + vec3(uSeed * 40.0) + vec3(0.0, 0.0, uTime * 7.0));
      fn = smoothstep(0.2, 0.85, fn);                     // contrast -> clearer fractal patches
      float bright = mix(1.0 - uNoise, 1.0, fn);          // WHITE broken up by fractal noise
      float a = blobs * mix(0.25, 1.0, head) * tip * bright * tube;
      gl_FragColor = vec4(uColor * uGlow * bright, a);
      return;
    }
    float taper = 1.0 - smoothstep(0.55, 1.0, abs(zN));   // soft, glowing tips
    float n = vnoise(vLocal.z * 7.0 + uTime * 22.0 + uSeed * 53.0)
            * vnoise(vLocal.z * 2.3 - uTime * 11.0 + uSeed * 17.0);
    float crackle = 1.0 - uNoise * (1.0 - n);             // dips toward (1 - uNoise)
    gl_FragColor = vec4(uColor * uGlow * crackle, taper * crackle);
  }
`;

export function createProjectiles(scene) {
  const geo = new THREE.BoxGeometry(0.22, 0.22, 2.6); // long axis = local +Z
  const timeU = { value: 0 }; // one shared clock so update() ticks every bolt's noise at once
  const pool = [];
  for (let i = 0; i < MAX; i++) {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: timeU, // shared reference across all bolts
        uColor: { value: new THREE.Color(0xffffff) },
        uGlow: { value: 1.0 },
        uNoise: { value: 0.0 },
        uSeed: { value: Math.random() },
        uRound: { value: 0 },
      },
      vertexShader: BOLT_VERT,
      fragmentShader: BOLT_FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.visible = false;
    mesh.frustumCulled = false;
    scene.add(mesh);
    pool.push({ mesh, alive: false, pos: new THREE.Vector3(), vel: new THREE.Vector3() });
  }

  const live = [];
  const zAxis = new THREE.Vector3(0, 0, 1);
  const dir = new THREE.Vector3();
  const q = new THREE.Quaternion();

  // width = transverse fatten (x/y only — leaves the length); glow = HDR brightness (more = stronger
  // bloom/glow); noise = crackle depth (0 = steady).
  function spawn({ pos, vel, color, team, damage = 20, life = 2.0, radius = 0.6, scale = 1, width = 1, glow = 1.0, noise = 0, round = 0 }) {
    let b = null;
    for (const p of pool) if (!p.alive) { b = p; break; }
    if (!b) return null;
    b.alive = true;
    b.team = team;
    b.damage = damage;
    b.life = life;
    b.radius = radius;
    b.pos.copy(pos);
    b.vel.copy(vel);
    b._whizPrevD = undefined; b._whizzed = false; b._whizApproached = false; // reset whiz-by tracking for this reuse
    const u = b.mesh.material.uniforms;
    u.uColor.value.set(color);
    u.uGlow.value = glow;
    u.uNoise.value = noise;
    u.uSeed.value = Math.random();
    u.uRound.value = round ? 1 : 0;
    b.mesh.scale.set(scale * width, scale * width, scale); // fatter across, same length
    b.mesh.position.copy(pos);
    b.mesh.visible = true;
    live.push(b);
    return b;
  }

  function kill(b) {
    b.alive = false;
    b.mesh.visible = false;
    const i = live.indexOf(b);
    if (i >= 0) live.splice(i, 1);
  }

  function update(dt) {
    timeU.value += dt; // advances every bolt's noise crackle
    for (let i = live.length - 1; i >= 0; i--) {
      const b = live[i];
      b.life -= dt;
      if (b.life <= 0) {
        kill(b);
        continue;
      }
      b.pos.addScaledVector(b.vel, dt);
      b.mesh.position.copy(b.pos);
      dir.copy(b.vel).normalize();
      q.setFromUnitVectors(zAxis, dir);
      b.mesh.quaternion.copy(q);
    }
  }

  function reset() {
    for (let i = live.length - 1; i >= 0; i--) kill(live[i]);
  }

  return { spawn, update, kill, reset, live };
}
