import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

// Loads the Chig fighter (converted from a geometry-only 3MF) once and returns a template Object3D to
// clone per enemy, plus the shared material and a bounding radius. The 3MF carries no materials, so
// the look is applied here: a **very dark green, near-black** flat-shaded hull whose low-poly facets
// read as armour **panels** (each facet given a slight independent tone), and a **purple thruster
// glow** at the rear (an additive sprite — a glow, no exhaust plume).

const TARGET_RADIUS = 2.2; // a small, nimble fighter (Hammerhead is radius 5)

// Live-tunable layout for the Chig's three rear thruster glows, arranged as an upward equilateral
// triangle (apex/middle on top, two below). `x` is the half-base width; the triangle height is
// derived. Tune in the "Chig Thrusters" GUI folder, then bake the values here.
export const chigThruster = { x: 0.46, y: -0.4, z: 0.52, size: 0.32 };

// Fresnel rim params (tunable): a faint cyan-white edge that catches the dark hull's silhouette so
// the Chigs read against space without losing their near-black panelled look.
export const chigRim = { color: 0x7fd6ff, power: 2.6, strength: 0.55 };

// Position + size the three engine-glow sprites on a chig instance (or the template) from `p`.
export function layoutChigGlows(obj, p = chigThruster) {
  const glows = [];
  obj.traverse((o) => {
    if (o.userData && o.userData.isEngineGlow) glows.push(o);
  });
  const h = Math.sqrt(3) * p.x; // equilateral height
  const slots = [
    [0, p.y + h, p.z], // top / middle (apex)
    [-p.x, p.y, p.z], // bottom-left
    [p.x, p.y, p.z], // bottom-right
  ];
  glows.forEach((g, i) => {
    const s = slots[Math.min(i, slots.length - 1)];
    g.position.set(s[0], s[1], s[2]);
    g.scale.setScalar(p.size);
  });
}

// Orientation so the model's nose points down the template's -Z (three.js forward) — the AI rotates
// the template to aim. The model imports nose-along +Z, so yaw 180° to face -Z (this also puts the
// rear engine glow, placed at template +Z, at the actual tail).
const NOSE_FIX = new THREE.Euler(0, Math.PI, 0);

function glowSprite() {
  const s = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0.0, 'rgba(225,225,255,1)');
  g.addColorStop(0.35, 'rgba(160,140,255,0.7)');
  g.addColorStop(0.7, 'rgba(120,80,255,0.18)');
  g.addColorStop(1.0, 'rgba(90,50,230,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const spr = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, color: 0xb49bff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
  );
  return spr;
}

export async function loadChig() {
  const draco = new DRACOLoader();
  draco.setDecoderPath('/draco/gltf/');
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  const gltf = await loader.loadAsync('/chig.glb');
  const root = gltf.scene;

  // very dark green, near-black; flat-shaded so the low-poly facets read as panels; vertex colours
  // give each facet a slightly different tone for a paneled-hull feel.
  const material = new THREE.MeshStandardMaterial({
    color: 0x3a423c, // dark grey with a green tint — reads against space, not pure black
    metalness: 0.45,
    roughness: 0.45,
    envMapIntensity: 0.7,
    flatShading: true,
    vertexColors: true,
    side: THREE.DoubleSide,
  });

  // Fresnel rim: add a cyan edge glow at grazing angles so the silhouette is legible against the
  // backdrop. Injected after lighting, before tonemapping, using the standard shader's view-space
  // normal + view position. Uniforms are exposed (rimUniforms) so the GUI can tune them live.
  const rimUniforms = {
    uRimColor: { value: new THREE.Color(chigRim.color) },
    uRimPower: { value: chigRim.power },
    uRimStrength: { value: chigRim.strength },
  };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uRimColor = rimUniforms.uRimColor;
    shader.uniforms.uRimPower = rimUniforms.uRimPower;
    shader.uniforms.uRimStrength = rimUniforms.uRimStrength;
    shader.fragmentShader = `uniform vec3 uRimColor;\nuniform float uRimPower;\nuniform float uRimStrength;\n${shader.fragmentShader}`.replace(
      '#include <opaque_fragment>',
      `#include <opaque_fragment>
       float rim = pow(1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0), uRimPower);
       gl_FragColor.rgb += uRimColor * rim * uRimStrength;`,
    );
  };
  material.userData.rimUniforms = rimUniforms;

  root.traverse((o) => {
    if (!o.isMesh) return;
    // non-indexed so every triangle (panel) has its own vertices -> independent per-panel tone
    const geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry;
    const n = geo.attributes.position.count;
    const colors = new Float32Array(n * 3);
    for (let f = 0; f < n; f += 3) {
      const t = 0.6 + Math.random() * 0.8; // per-panel brightness multiplier
      for (let k = 0; k < 3; k++) {
        colors[(f + k) * 3] = t;
        colors[(f + k) * 3 + 1] = t;
        colors[(f + k) * 3 + 2] = t;
      }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    o.geometry = geo;
    o.material = material;
    o.castShadow = o.receiveShadow = false;
  });

  // recenter + scale to a known size (same bbox approach as ship.js)
  const box = new THREE.Box3().setFromObject(root);
  const center = box.getCenter(new THREE.Vector3());
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const scale = TARGET_RADIUS / sphere.radius;
  root.position.sub(center);

  const inner = new THREE.Group();
  inner.add(root);
  inner.scale.setScalar(scale);
  inner.rotation.copy(NOSE_FIX);

  const template = new THREE.Group();
  template.add(inner);

  // Three purple thruster glows at the rear (template +Z, since forward is -Z) — glow only, no
  // exhaust plume. Positioned from the live-tunable chigThruster params.
  for (let i = 0; i < 3; i++) {
    const glow = glowSprite();
    glow.userData.isEngineGlow = true;
    template.add(glow);
  }
  layoutChigGlows(template);

  console.log(
    '[chig] loaded — bbox',
    box.getSize(new THREE.Vector3()).toArray().map((v) => +v.toFixed(2)),
    'scale',
    scale.toFixed(3),
  );
  return { template, material, radius: TARGET_RADIUS };
}

// One enemy instance: a deep clone of the template (geometry + the single material + glows are shared/cloned).
export function spawnChig(template) {
  return template.clone(true);
}
