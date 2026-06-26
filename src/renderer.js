import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

// Renderer + scene + chase camera + post chain (RenderPass -> UnrealBloom -> OutputPass).
// OutputPass applies tone mapping + sRGB at the end; intermediate passes work in linear HDR so the
// bloom blooms on real brightness (emissive thrusters, star cores).
export function createRenderer(container) {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
    stencil: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x030308);

  // near/far kept to a sane ratio for depth precision (backdrop spheres sit at 3.6k–6k).
  const camera = new THREE.PerspectiveCamera(
    62,
    window.innerWidth / window.innerHeight,
    0.5,
    12000,
  );
  camera.position.set(0, 4, 18);

  // The EffectComposer renders to its OWN target, which bypasses the renderer's antialias. Give it a
  // MULTISAMPLED HDR target so sub-pixel bright features (hull speculars, star points) are resolved
  // before bloom — without this they alias and the bloom flickers as the camera moves. HalfFloat
  // keeps bright (>1) values for the bloom threshold.
  const dpr = renderer.getDrawingBufferSize(new THREE.Vector2());
  const renderTarget = new THREE.WebGLRenderTarget(dpr.x, dpr.y, {
    type: THREE.HalfFloatType,
    samples: 4,
  });
  const composer = new EffectComposer(renderer, renderTarget);
  composer.addPass(new RenderPass(scene, camera));

  // (resolution, strength, radius, threshold). Threshold ~0.7 so only bright stuff (thrusters,
  // star cores, hot specular) blooms — the hull stays crisp. Strength is driven by the music.
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.7,
    0.5,
    0.72,
  );
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  function setSize(w, h) {
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    composer.setSize(w, h);
  }
  window.addEventListener('resize', () => setSize(window.innerWidth, window.innerHeight));

  return { renderer, scene, camera, composer, bloom, render: () => composer.render(), setSize };
}
