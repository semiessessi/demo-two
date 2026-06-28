import * as THREE from 'three';

// Deep-space backdrop: a large inverted sphere shaded from the view direction with 3D fbm noise +
// a colour ramp, so it reads as a nebula at infinity. Drawn first, depth-test off, and repositioned
// onto the camera each frame (see main.js) so it never parallaxes — a skybox you can fly inside.
// `uPulse` is nudged by the music for a subtle brightness breath.

const vertexShader = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position); // sphere centred on camera -> local position == view direction
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const fragmentShader = /* glsl */ `
precision highp float;
varying vec3 vDir;
uniform float uTime;
uniform float uPulse;
uniform float uBrightness;
uniform float uSaturation;
uniform float uMilkyWay; // brightness of the Milky Way band
uniform vec3 uMwPole;    // unit galactic NORTH pole (scene coords) — the Milky Way is the great circle perpendicular to it
uniform vec3 uColorA; // deep base
uniform vec3 uColorB; // mid clouds
uniform vec3 uColorC; // hot cores

// hash / value noise / fbm (cheap, tileable enough for a backdrop)
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
// The backdrop fills the screen every frame, so its octave count is a flat per-pixel tax. Base uses 5
// octaves for the large cloud structure; the detail lookup runs at 3x frequency where the extra-fine
// octaves are imperceptible on a dimmed (~10%) backdrop, so it gets a cheaper 3-octave variant.
float fbm(vec3 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.02; a *= 0.5; }
  return v;
}
float fbmDetail(vec3 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) { v += a * noise(p); p *= 2.02; a *= 0.5; }
  return v;
}

void main() {
  vec3 dir = normalize(vDir);
  float galLat = dot(dir, uMwPole); // sine of galactic latitude: 0 on the Milky-Way plane, ±1 at its poles
  // slow drift so the nebula isn't dead-static
  vec3 p = dir * 2.6 + vec3(0.0, 0.0, uTime * 0.012);
  float base = fbm(p);
  float detail = fbmDetail(p * 3.1 + base * 1.5);
  float density = pow(clamp(base * 0.7 + detail * 0.5, 0.0, 1.0), 1.7);

  // colour ramp: base -> mid clouds -> hot cores
  vec3 col = mix(uColorA, uColorB, smoothstep(0.15, 0.6, density));
  col = mix(col, uColorC, smoothstep(0.62, 0.95, density) * 0.85);

  // a broad, dim band across the real galactic plane for some structure
  float band = exp(-pow(galLat * 2.3, 2.0));
  col += uColorB * band * 0.18;

  col *= 0.55 + 0.9 * density;
  // desaturate toward luminance — the blue was too rich
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(l), col, uSaturation);
  col *= 1.0 + uPulse * 0.5; // music breath
  col *= uBrightness;        // overall dimmer (user: ~10%)

  // Milky Way on the REAL galactic plane (perpendicular to uMwPole), with body + wispy high-freq
  // filaments and a thin central dust rift (Great Rift) — tuned to read as a textured band, not a blob.
  float mw = exp(-pow(galLat * 4.0, 2.0));        // band envelope (broad -> bulk)
  float wisp = fbmDetail(dir * 12.0 + vec3(0.0, 0.0, uTime * 0.004));
  float wisp2 = fbmDetail(dir * 28.0 - vec3(0.0, uTime * 0.003, 0.0)); // finer detail on top
  float fil = mix(0.40, 1.2, smoothstep(0.30, 0.85, wisp)) * mix(0.78, 1.12, wisp2);
  float rift = exp(-pow(galLat * 22.0, 2.0)) * smoothstep(0.36, 0.85, wisp) * mix(0.5, 1.0, wisp2);
  vec3 mwTint = mix(vec3(0.62, 0.66, 0.78), uColorC, 0.18);    // warm-grey, a hint of the core colour
  col += mwTint * mw * fil * mix(1.0, 0.42, rift) * uMilkyWay;

  gl_FragColor = vec4(col, 1.0);
}`;

export function createNebula() {
  const uniforms = {
    uTime: { value: 0 },
    uPulse: { value: 0 },
    uBrightness: { value: 0.1 }, // ~10% overall — keep the backdrop subtle
    uSaturation: { value: 0.32 }, // greyer still — the blue was too rich
    uMilkyWay: { value: 0.12 }, // galactic band brightness (sits above the dimmed nebula)
    uMwPole: { value: new THREE.Vector3(0.868, 0.456, -0.198) }, // galactic N pole (real RA 192.86°, Dec +27.13°) -> band through Crux, Cygnus, past Orion
    uColorA: { value: new THREE.Color(0x04050f) }, // deep blue-black base
    uColorB: { value: new THREE.Color(0x223080) }, // blue clouds (dominant)
    uColorC: { value: new THREE.Color(0xd8401f) }, // red hot cores (accent touches)
  };
  const geo = new THREE.SphereGeometry(6000, 48, 32);
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -20; // first, behind the stars (-10) and everything else
  return { mesh, uniforms };
}
