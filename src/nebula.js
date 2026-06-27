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
uniform float uMwTilt;   // (legacy) tilt of the band plane (rad)
uniform vec3 uMwNormal;  // galactic pole (band plane normal), derived from the star catalog
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
  // slow drift so the nebula isn't dead-static
  vec3 p = dir * 2.6 + vec3(0.0, 0.0, uTime * 0.012);
  float base = fbm(p);
  float detail = fbmDetail(p * 3.1 + base * 1.5);
  float density = pow(clamp(base * 0.7 + detail * 0.5, 0.0, 1.0), 1.7);

  // colour ramp: base -> mid clouds -> hot cores
  vec3 col = mix(uColorA, uColorB, smoothstep(0.15, 0.6, density));
  col = mix(col, uColorC, smoothstep(0.62, 0.95, density) * 0.85);

  // distance from the galactic plane (uMwNormal = pole derived from the real star catalog, so the
  // band sits where the dense stars are)
  float gy = dot(dir, uMwNormal);
  // a broad, dim band across the galactic plane for some structure
  float band = exp(-pow(gy * 2.3, 2.0));
  col += uColorB * band * 0.18;

  col *= 0.55 + 0.9 * density;
  // desaturate toward luminance — the blue was too rich
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(l), col, uSaturation);
  col *= 1.0 + uPulse * 0.5; // music breath
  col *= uBrightness;        // overall dimmer (user: ~10%)

  // Milky Way: a narrower, brighter band on a tilted plane, broken up by the fbm into dust lanes,
  // tinted warm-grey. Added AFTER the nebula dimming so it sits above the 10% backdrop and reads as
  // the brightest diffuse feature. uMilkyWay scales it; uMwTilt rotates the band plane.
  float mw = exp(-pow(gy * 4.2, 2.0));            // band envelope (Gaussian on the galactic plane)
  // wispy filaments: HIGH-frequency fbm breaks the smooth band into ragged bright streaks + dark gaps
  float wisp = fbmDetail(dir * 12.0 + vec3(0.0, 0.0, uTime * 0.004));
  float wisp2 = fbmDetail(dir * 26.0 - vec3(0.0, uTime * 0.003, 0.0)); // finer detail on top
  float fil = mix(0.06, 1.1, smoothstep(0.34, 0.86, wisp)) * mix(0.6, 1.15, wisp2); // contrasty -> filaments
  // a dark wispy dust lane down the MIDDLE of the band (the Great Rift), also broken up by the noise
  float rift = exp(-pow(gy * 13.0, 2.0)) * smoothstep(0.28, 0.85, wisp);
  vec3 mwTint = mix(vec3(0.62, 0.66, 0.78), uColorC, 0.18);    // warm-grey, a hint of the core colour
  col += mwTint * mw * fil * mix(1.0, 0.06, rift) * uMilkyWay;

  gl_FragColor = vec4(col, 1.0);
}`;

export function createNebula() {
  const uniforms = {
    uTime: { value: 0 },
    uPulse: { value: 0 },
    uBrightness: { value: 0.1 }, // ~10% overall — keep the backdrop subtle
    uSaturation: { value: 0.32 }, // greyer still — the blue was too rich
    uMilkyWay: { value: 0.12 }, // galactic band brightness (sits above the dimmed nebula)
    uMwTilt: { value: 0.6 }, // (legacy, unused now the band uses uMwNormal)
    uMwNormal: { value: new THREE.Vector3(0.9101, 0.4020, -0.1002).normalize() }, // galactic pole from the star-catalog covariance

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
