import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { detectDevice } from './device.js';

// Renderer + scene + chase camera + post chain (RenderPass -> UnrealBloom -> OutputPass).
// OutputPass applies tone mapping + sRGB at the end; intermediate passes work in linear HDR so the
// bloom blooms on real brightness (emissive thrusters, star cores).

// This demo is fill-rate bound (fullscreen nebula + raymarched volumetrics), so device-pixel-ratio is
// the single biggest lever: at dpr 2 we shade 4x the fragments. Cap at 1.3 (like demo-1) — ~25% fewer
// fullscreen fragments than 1.5, ~4x cheaper than 2.0, for a slight, mostly-unnoticed softening.
// Mobile is even more fill-bound and has weaker GPUs — cap at 1.0 there (no super-sampling at all).
const { isMobile: IS_MOBILE } = detectDevice();
const MAX_PR = IS_MOBILE ? 1.0 : 1.3;
// Firefox on Linux/Mesa runs the MULTISAMPLED resolve/blit of the EffectComposer HDR target through a
// slow path that tanks even strong GPUs — so on Firefox we drop MSAA (samples 0). We keep the HDR
// HALF-FLOAT format though: it's not the slow part, and an 8-bit intermediate bands hard on the smooth
// low-brightness nebula/bloom gradients. (Without MSAA, bright sub-pixel points alias a little more.)
const IS_FIREFOX = typeof navigator !== 'undefined' && /firefox/i.test(navigator.userAgent || '');

export function createRenderer(container) {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
    stencil: false,
  });
  // renderScale (0.5..1) is the quality controller's fill-rate lever on top of the MAX_PR cap.
  let renderScale = 1;
  let curW = window.innerWidth;
  let curH = window.innerHeight;
  const effectivePR = () => Math.min(window.devicePixelRatio || 1, MAX_PR) * renderScale;
  renderer.setPixelRatio(effectivePR());
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // Shadows: enabled from the start so receiver shaders compile with the shadow chunks. The cascaded
  // sun shadows (and the dynamic light shadows) are driven by lighting.js; the quality controller can
  // still drop individual casters or disable shadows entirely on weak hardware.
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // r185 deprecated PCFSoft (forced->PCF); PCF supports dir+spot+point
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
    type: THREE.HalfFloatType, // always HDR — 8-bit here banded the nebula/bloom gradients badly
    samples: IS_FIREFOX ? 0 : 4, // drop only MSAA on Firefox (its multisampled resolve is the slow path)
  });
  const composer = new EffectComposer(renderer, renderTarget);
  composer.addPass(new RenderPass(scene, camera));

  // (resolution, strength, radius, threshold). Threshold ~0.7 so only bright stuff (thrusters,
  // star cores, hot specular) blooms — the hull stays crisp. Strength is driven by the music.
  // HALF-RES: bloom is a wide blur, so a half-resolution mip chain looks ~identical but pushes ~4x fewer
  // fragments through the multi-pass blur. composer.setSize resets it to full res, so setSize re-halves it.
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(Math.round(window.innerWidth * 0.5), Math.round(window.innerHeight * 0.5)),
    0.7,
    0.5,
    0.72,
  );
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // GPU frame-time via a timer query (EXT_disjoint_timer_query_webgl2): measures ACTUAL GPU render time
  // per frame, INDEPENDENT of vsync, so the quality controller can target a ms budget and see the headroom
  // the vsync-capped wall clock can't. Small ring (results land a frame or two late). No ext (Safari/iOS)
  // -> gpuFrameMs() returns 0 and the controller falls back to wall-clock.
  const gl = renderer.getContext();
  const timerExt = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const TQ = timerExt ? [gl.createQuery(), gl.createQuery(), gl.createQuery()] : null;
  let tqHead = 0, tqTail = 0, tqLen = 0, gpuMs = 0, tqActive = false;
  const gpuTimerBegin = () => { if (!timerExt || tqLen >= TQ.length) { tqActive = false; return; } gl.beginQuery(timerExt.TIME_ELAPSED_EXT, TQ[tqHead]); tqActive = true; };
  const gpuTimerEnd = () => { if (!tqActive) return; gl.endQuery(timerExt.TIME_ELAPSED_EXT); tqHead = (tqHead + 1) % TQ.length; tqLen++; tqActive = false; };
  const gpuTimerPoll = () => {
    while (tqLen > 0) {
      const q = TQ[tqTail];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      if (!gl.getParameter(timerExt.GPU_DISJOINT_EXT)) {
        const ms = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6; // ns -> ms
        gpuMs = gpuMs > 0 ? gpuMs * 0.85 + ms * 0.15 : ms; // smooth
      }
      tqTail = (tqTail + 1) % TQ.length; tqLen--;
    }
  };
  function render() {
    gpuTimerPoll();
    gpuTimerBegin();
    composer.render();
    gpuTimerEnd();
  }

  function setSize(w, h) {
    curW = w;
    curH = h;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(effectivePR());
    renderer.setSize(w, h);
    // EffectComposer caches its own pixelRatio (set at construction) — keep it in sync or its HDR
    // targets render at the wrong resolution after a scale change.
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(w, h);
    bloom.setSize(Math.max(1, Math.round(w * 0.5)), Math.max(1, Math.round(h * 0.5))); // keep bloom half-res (composer.setSize reset it to full)
  }
  window.addEventListener('resize', () => setSize(window.innerWidth, window.innerHeight));

  // Quality controller lever: drop the internal render resolution (0.5..1) under load, then restore it.
  // Cheap and reversible — it just re-sizes the buffers; no shader recompiles.
  function setRenderScale(s) {
    const ns = Math.min(1, Math.max(0.5, s));
    if (ns === renderScale) return;
    renderScale = ns;
    setSize(curW, curH);
  }

  return { renderer, scene, camera, composer, bloom, render, setSize, setRenderScale, gpuFrameMs: () => gpuMs };
}
