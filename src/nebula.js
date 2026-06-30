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
uniform vec3 uPatchDir;    // centre of a big localized nebula patch (e.g. around the Cerberus black hole)
uniform float uPatchBright; // 0 = off; >0 fills a broad swathe of sky around uPatchDir
uniform vec3 uPatchColor;  // patch tint (blue/purple)
uniform vec3 uPatchColor2; // hotter/contrasting tint in the densest cores
uniform float uPatchWarp;  // domain-warp strength -> swirly, organic nebulosity
uniform float uPatchSpeed; // how fast the patch clouds drift / evolve
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

  // Coarse-grained richness: red/orange emission knots + dark dust voids INSIDE the nebula clouds. One
  // field — its peaks read as warm emission knots, its troughs as dark dust voids. Gated by density so
  // they stay in the clouds. Frequency HALVED (55 -> 27) so the knots are bigger + sparser (the small
  // high-freq flecks read as noise); and the emission is dimmed so they're a faint warm glow, not specks.
  float fineN = fbmDetail(dir * 27.0 + 3.0);
  float inClouds = smoothstep(0.12, 0.6, density);
  float knots = smoothstep(0.66, 0.84, fineN) * inClouds; // bright red/orange emission
  float voids = smoothstep(0.30, 0.14, fineN) * inClouds; // dark dust
  // (Removed the cerberus-only red/orange emission knots — they read as ugly red blobs all over the sky.)
  col *= 1.0 - 0.8 * voids; // keep the dark dust voids

  // Milky Way on the REAL galactic plane (perpendicular to uMwPole), with body + wispy high-freq
  // filaments and a thin central dust rift (Great Rift) — tuned to read as a textured band, not a blob.
  float mw = exp(-pow(galLat * 4.0, 2.0));        // band envelope (broad -> bulk)
  float wisp = fbmDetail(dir * 12.0 + vec3(0.0, 0.0, uTime * 0.004));
  float wisp2 = fbmDetail(dir * 28.0 - vec3(0.0, uTime * 0.003, 0.0)); // finer detail on top
  float fil = mix(0.40, 1.2, smoothstep(0.30, 0.85, wisp)) * mix(0.78, 1.12, wisp2);
  float rift = exp(-pow(galLat * 22.0, 2.0)) * smoothstep(0.36, 0.85, wisp) * mix(0.5, 1.0, wisp2);
  vec3 mwTint = mix(vec3(0.62, 0.66, 0.78), uColorC, 0.18);    // warm-grey, a hint of the core colour
  col += mwTint * mw * fil * mix(1.0, 0.42, rift) * uMilkyWay;

  // Big localized nebula patch: a broad blue/purple cloud across ~2/3 of the sky around uPatchDir
  // (Cerberus, surrounding the black hole). Cloudy (fbm) so it reads as nebulosity, not a flat wash.
  // Added after the global dimming so it sits above the ~10% backdrop.
  if (uPatchBright > 0.001) {
    float pd = dot(dir, uPatchDir);
    float cov = smoothstep(-0.4, 0.35, pd);                      // broad cone -> ~2/3 of the sky
    // DOMAIN WARP: offset the cloud lookup by a low-freq noise field -> flowing, swirly nebulosity (not blobs)
    vec3 wb = dir * 1.3 + 9.0;
    vec3 warp = vec3(fbmDetail(wb) - 0.5, fbmDetail(wb + 17.0) - 0.5, fbmDetail(wb + 31.0) - 0.5) * uPatchWarp;
    vec3 pp = dir * 1.9 + warp + vec3(0.0, 0.0, uTime * uPatchSpeed);
    float nb = fbm(pp) * 0.7 + fbmDetail(pp * 3.0 + 5.0) * 0.4; // big cloud + finer wisps, both warped
    float dens = cov * smoothstep(0.30, 0.92, nb);
    vec3 pc = mix(uPatchColor, uPatchColor2, smoothstep(0.55, 0.95, nb)); // two-tone: hotter cores in the densest parts
    col += pc * dens * uPatchBright;
    col += uPatchColor2 * smoothstep(0.85, 0.96, nb) * cov * uPatchBright * 0.7; // a few brighter knots
  }

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
    uPatchDir: { value: new THREE.Vector3(0.40, 0.18, -0.90).normalize() }, // toward the Cerberus black hole
    uPatchBright: { value: 0 }, // per-environment (Cerberus turns it on)
    uPatchColor: { value: new THREE.Color(0x4d2d8c) }, // blue/purple
    uPatchColor2: { value: new THREE.Color(0x9f3753) }, // hotter cores in the densest nebulosity
    uPatchWarp: { value: 0.6 }, // domain-warp strength -> swirly, organic clouds
    uPatchSpeed: { value: 0.006 }, // patch cloud drift speed (per-env)
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
