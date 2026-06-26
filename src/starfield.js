import * as THREE from 'three';

// Real-star background from the Bright Star Catalog (src/stars.json, built for demo-1). Additive
// billboard points on a large celestial sphere, brighter + bigger for lower magnitudes, tinted by
// B-V colour, gently twinkling. Adapted from demo-1 for deep space: the horizon fade is removed so
// stars surround the camera fully (there is no ground).
const STAR_RADIUS = 4000.0; // far out vs the flight volume so parallax is essentially nil

const vertexShader = `
in vec3 position;   // unit direction on the celestial sphere
in float aMag;      // visual magnitude (lower = brighter)
in vec3 aColor;     // star colour (B-V -> RGB)
uniform mat4 modelViewMatrix; // the mesh follows the camera -> stars sit at infinity (no parallax)
uniform mat4 projectionMatrix;
uniform float uTime;
uniform float uStarSize;
uniform float uStarTwinkle;
out vec3 vColor;
out float vBright;
float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
void main() {
  // brighter stars -> bigger + brighter; clamp the huge magnitude dynamic range.
  float b = clamp(pow(2.0, (5.5 - aMag) * 0.5), 0.35, 6.0);
  float tw = 1.0 + uStarTwinkle * sin(uTime * 3.0 + hash11(aMag + position.x * 131.0) * 6.2831);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position * ${STAR_RADIUS.toFixed(1)}, 1.0);
  gl_Position.z = gl_Position.w * 0.999999; // pin to the far plane
  // min ~1.6px: sub-pixel points twinkle/flicker as the camera moves; a slightly larger soft footprint
  // (with MSAA + the round falloff in the fragment shader) stays stable.
  gl_PointSize = max(1.6, uStarSize * b * tw);
  vColor = aColor;
  vBright = b * tw;
}`;

const fragmentShader = `
precision highp float;
in vec3 vColor;
in float vBright;
out vec4 fragColor;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  if (r > 1.0) discard;
  float a = pow(1.0 - r, 2.0); // soft round falloff
  fragColor = vec4(vColor * a * min(vBright, 3.0), 1.0); // additive
}`;

// Async: dynamically imports the ~400 KB catalogue so it's code-split out of the main bundle.
// Resolves to a THREE.Points to add to the scene. `uniforms` is shared so main can drive uTime.
export async function buildStarfield(uniforms) {
  const stars = (await import('./stars.json')).default;

  // Augment the bright catalogue with a dense field of faint, grey procedural stars so deep space
  // reads as full of distant suns rather than a sparse few hundred.
  const EXTRA = 5000;
  const pos = Array.from(stars.pos);
  const mag = Array.from(stars.mag);
  const col = Array.from(stars.col);
  for (let i = 0; i < EXTRA; i++) {
    const u = Math.random() * 2 - 1; // uniform on the sphere
    const th = Math.random() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    pos.push(r * Math.cos(th), u, r * Math.sin(th));
    mag.push(5.2 + Math.random() * 2.6); // faint -> small + dim
    const grey = 0.5 + Math.random() * 0.22; // neutral grey, slight variation
    col.push(grey, grey, grey * 1.03);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aMag', new THREE.Float32BufferAttribute(mag, 1));
  g.setAttribute('aColor', new THREE.Float32BufferAttribute(col, 3));
  const material = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    // MUST depth-test: stars are transparent (additive), so they render in the transparent pass AFTER
    // the opaque ship. Without depth-testing they'd paint over the hull (stars "through" the ship).
    depthTest: true,
  });
  const points = new THREE.Points(g, material);
  points.frustumCulled = false;
  points.renderOrder = -10;
  return points;
}
