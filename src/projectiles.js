import * as THREE from 'three';

// Pooled additive energy bolts. Two looks share one pool:
//   • PLAYER / ally / missile — a lean box streak stretched along its travel (HDR core + soft tips + crackle).
//   • CHIG (round:1)          — a camera-facing BILLBOARD QUAD: a soft round blob modulated by fractal noise
//                               (the primary element) with a tapering fading TRAIL behind it (secondary).
// Each pooled entry owns both meshes; spawn() shows the right one. spawn() pulls from a fixed pool; update()
// advances + expires (and billboards the blob toward the camera); `live` is exposed for the collision pass.

const MAX = 240;

const BOLT_VERT = /* glsl */`
  varying vec3 vLocal;
  void main() { vLocal = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const BOLT_FRAG = /* glsl */`
  precision highp float;
  uniform vec3 uColor; uniform float uTime, uGlow, uNoise, uSeed;
  varying vec3 vLocal;
  float hash(float n) { return fract(sin(n) * 43758.5453123); }
  float vnoise(float x) { float i = floor(x); float f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(hash(i), hash(i + 1.0), f); }
  void main() {
    float zN = vLocal.z / 1.3;
    float taper = 1.0 - smoothstep(0.55, 1.0, abs(zN));   // soft, glowing tips
    float n = vnoise(vLocal.z * 7.0 + uTime * 22.0 + uSeed * 53.0) * vnoise(vLocal.z * 2.3 - uTime * 11.0 + uSeed * 17.0);
    float crackle = 1.0 - uNoise * (1.0 - n);
    gl_FragColor = vec4(uColor * uGlow * crackle, taper * crackle);
  }
`;

// Chig blob: a soft round fbm blob (primary) + a tapering fading trail behind it (secondary). Drawn on a
// camera-facing quad; uAspect (= width/length) keeps the blob round in world space despite the stretch.
const BLOB_VERT = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const BLOB_FRAG = /* glsl */`
  precision highp float;
  uniform vec3 uColor; uniform float uTime, uGlow, uNoise, uSeed, uAspect;
  varying vec2 vUv;
  float h3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float vn3(vec3 x) { vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(h3(i + vec3(0,0,0)), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z); }
  float fbm3(vec3 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * vn3(p); p *= 2.03; a *= 0.5; } return v; }
  void main() {
    float headV = 0.72;                                    // blob sits near the leading end
    vec2 pb = vec2(vUv.x - 0.5, (vUv.y - headV) / max(uAspect, 0.02));
    float bd = length(pb) * 2.67;                          // 2.0 = full, 4.0 = half -> 2.67 ≈ 75% blob diameter
    float blob = 1.0 - smoothstep(0.3, 1.0, bd);           // soft round core
    float n = fbm3(vec3(vUv * 6.0 + uSeed * 30.0, uTime * 3.0));
    n = smoothstep(0.12, 0.85, n);                         // contrast -> clear fractal patches
    float bright = mix(1.0 - uNoise, 1.0, n);              // WHITE modulated by fractal noise (the primary element)
    blob *= bright;
    // secondary trail: a fading, tapering streak behind the blob
    float back = clamp((headV - vUv.y) / headV, 0.0, 1.0); // 0 at blob -> 1 at the tail
    float trailW = mix(0.2, 0.02, back);
    float trail = (1.0 - smoothstep(0.0, trailW, abs(vUv.x - 0.5))) * (1.0 - back) * step(vUv.y, headV) * 0.5 * bright;
    float a = max(blob, trail);
    gl_FragColor = vec4(uColor * uGlow * (0.55 + 0.55 * bright), a);
  }
`;

export function createProjectiles(scene, camera) {
  const boxGeo = new THREE.BoxGeometry(0.22, 0.22, 2.6); // long axis = local +Z
  const quadGeo = new THREE.PlaneGeometry(1, 1);         // billboard for the Chig blob (u across, v along travel)
  const timeU = { value: 0 };
  const pool = [];
  for (let i = 0; i < MAX; i++) {
    const boxMat = new THREE.ShaderMaterial({
      uniforms: { uTime: timeU, uColor: { value: new THREE.Color(0xffffff) }, uGlow: { value: 1.0 }, uNoise: { value: 0.0 }, uSeed: { value: Math.random() } },
      vertexShader: BOLT_VERT, fragmentShader: BOLT_FRAG, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const box = new THREE.Mesh(boxGeo, boxMat);
    const blobMat = new THREE.ShaderMaterial({
      uniforms: { uTime: timeU, uColor: { value: new THREE.Color(0xffffff) }, uGlow: { value: 1.0 }, uNoise: { value: 0.0 }, uSeed: { value: Math.random() }, uAspect: { value: 0.3 } },
      vertexShader: BLOB_VERT, fragmentShader: BLOB_FRAG, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const blob = new THREE.Mesh(quadGeo, blobMat);
    box.visible = blob.visible = false;
    box.frustumCulled = blob.frustumCulled = false;
    scene.add(box); scene.add(blob);
    pool.push({ box, blob, mesh: box, round: false, alive: false, pos: new THREE.Vector3(), vel: new THREE.Vector3() });
  }

  const live = [];
  const zAxis = new THREE.Vector3(0, 0, 1);
  const _dir = new THREE.Vector3(), _toCam = new THREE.Vector3(), _right = new THREE.Vector3(), _nrm = new THREE.Vector3();
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion();

  function spawn({ pos, vel, color, team, damage = 20, life = 2.0, radius = 0.6, scale = 1, width = 1, glow = 1.0, noise = 0, round = 0 }) {
    let b = null;
    for (const p of pool) if (!p.alive) { b = p; break; }
    if (!b) return null;
    b.alive = true;
    b.team = team; b.damage = damage; b.life = life; b.radius = radius;
    b.pos.copy(pos); b.vel.copy(vel);
    b._whizPrevD = undefined; b._whizzed = false; b._whizApproached = false;
    b.round = !!round;
    b.mesh = round ? b.blob : b.box;
    const u = b.mesh.material.uniforms;
    u.uColor.value.set(color); u.uGlow.value = glow; u.uNoise.value = noise; u.uSeed.value = Math.random();
    if (round) {
      const w = scale * width * 0.5;   // blob diameter
      const len = w * 3.2;             // total streak length (blob + trail behind)
      u.uAspect.value = w / len;
      b.blob.scale.set(w, len, 1);
    } else {
      b.box.scale.set(scale * width, scale * width, scale);
    }
    b.mesh.position.copy(pos);
    b.box.visible = !round; b.blob.visible = !!round;
    live.push(b);
    return b;
  }

  function kill(b) {
    b.alive = false;
    b.box.visible = b.blob.visible = false;
    const i = live.indexOf(b);
    if (i >= 0) live.splice(i, 1);
  }

  function update(dt) {
    timeU.value += dt;
    for (let i = live.length - 1; i >= 0; i--) {
      const b = live[i];
      b.life -= dt;
      if (b.life <= 0) { kill(b); continue; }
      b.pos.addScaledVector(b.vel, dt);
      b.mesh.position.copy(b.pos);
      _dir.copy(b.vel); if (_dir.lengthSq() < 1e-8) _dir.set(0, 0, 1); _dir.normalize();
      if (b.round) {
        // cylindrical billboard: long axis (local +Y) along travel, flat face turned toward the camera
        _toCam.copy(camera.position).sub(b.pos);
        _right.crossVectors(_dir, _toCam); if (_right.lengthSq() < 1e-8) _right.set(1, 0, 0); _right.normalize();
        _nrm.crossVectors(_right, _dir).normalize();
        _m.makeBasis(_right, _dir, _nrm);
        b.blob.quaternion.setFromRotationMatrix(_m);
      } else {
        _q.setFromUnitVectors(zAxis, _dir);
        b.box.quaternion.copy(_q);
      }
    }
  }

  function reset() { for (let i = live.length - 1; i >= 0; i--) kill(live[i]); }

  return { spawn, update, kill, reset, live };
}
