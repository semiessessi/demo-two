import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
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
// MSAA on the EffectComposer's HDR (half-float) target is only safe-and-fast on desktop Chromium:
//   • Firefox/Linux+Mesa runs the multisampled-float resolve/blit through a slow path (tanks strong GPUs).
//   • Apple WebKit (iOS Safari/Chrome AND desktop Safari) can't allocate a multisampled HALF-FLOAT
//     renderbuffer at all — the target comes back INCOMPLETE and the whole canvas renders BLACK. This is
//     exactly why it was black on iPad.
//   • Mobile GPUs are too fill-bound to spend on MSAA regardless.
// So enable MSAA only where it's known-good; everywhere else samples:0. We always keep the HALF-FLOAT
// format (it's not the slow/broken part, and an 8-bit intermediate bands the smooth nebula/bloom badly) —
// dropping back to 8-bit only if the GPU genuinely can't render to float (see HALF_FLOAT_OK below).
const UA = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
const IS_FIREFOX = /firefox/i.test(UA);
const IS_APPLE_WEBKIT = /AppleWebKit/.test(UA) && !/Chrome|Chromium|Edg\//.test(UA); // Safari (desktop + iOS), iOS Chrome
const ALLOW_MSAA = !IS_FIREFOX && !IS_MOBILE && !IS_APPLE_WEBKIT;

export function createRenderer(container) {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
    stencil: false,
  });
  // Can this GPU actually RENDER to a half-float colour buffer? WebGL2 needs EXT_color_buffer_float (or
  // the half-float variant); without it the HDR target is incomplete -> black. Present on iOS 15+ and all
  // modern desktops, so we keep half-float there; only ancient/locked-down browsers fall back to 8-bit.
  const glCaps = renderer.getContext();
  const HALF_FLOAT_OK = !!(glCaps.getExtension('EXT_color_buffer_float') || glCaps.getExtension('EXT_color_buffer_half_float'));
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
    type: HALF_FLOAT_OK ? THREE.HalfFloatType : THREE.UnsignedByteType, // HDR when renderable; 8-bit fallback (bands, but draws)
    samples: ALLOW_MSAA ? 4 : 0, // MSAA only on desktop Chromium; off on Apple/mobile (black) + Firefox (slow)
  });
  const composer = new EffectComposer(renderer, renderTarget);
  composer.addPass(new RenderPass(scene, camera));

  // Sanitize the HDR BEFORE bloom. A body shader (black-hole raymarch, etc.) can spit out a NaN/Inf pixel
  // at certain camera angles; the bloom blur then smears it (Inf × a 0 gaussian weight = NaN) across the
  // ENTIRE frame and tonemaps to black — the "everything goes black at some angle" bug. Zeroing non-finite
  // pixels here means the bloom only ever sees finite values, so a bad pixel stays a single (invisible) dot
  // instead of taking down the whole screen.
  const sanitize = new ShaderPass({
    uniforms: { tDiffuse: { value: null } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: /* glsl */`
      uniform sampler2D tDiffuse; varying vec2 vUv;
      void main(){
        vec4 c = texture2D(tDiffuse, vUv);
        vec3 col = c.rgb;
        col = mix(col, vec3(0.0), vec3(notEqual(col, col)));          // NaN -> 0 (NaN != NaN)
        col = mix(col, vec3(0.0), vec3(greaterThan(col, vec3(1e4)))); // +Inf / absurdly bright -> 0
        col = max(col, vec3(0.0));                                    // -Inf / negatives -> 0
        gl_FragColor = vec4(col, c.a);
      }`,
  });
  composer.addPass(sanitize);

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
  // Diagnostic switch: ?nobloom disables the bloom pass — a bright/NaN body fragment fed through the bloom
  // blur can spread across the whole frame, so this isolates "everything goes black" to the bloom vs not.
  if (typeof location !== 'undefined' && /[?&](nobloom|safe)\b/.test(location.search)) bloom.enabled = false; // ?safe also strips bloom
  composer.addPass(new OutputPass());

  // --- Smoke occlusion depth pre-pass ---------------------------------------------------------------
  // A cheap HALF-RES pass that captures the OPAQUE scene depth (main toggles the nebula/stars/smoke off
  // for it, and those have depthWrite:false anyway). The smoke raymarch samples this to early-out for
  // puffs hidden behind ships — a furball stacks many full-screen volumes, most of them occluded. Half
  // resolution + shadows-off keep the extra pass cheap; the depth is plenty accurate for culling.
  const DEPTH_SCALE = 0.5;
  const _db0 = renderer.getDrawingBufferSize(new THREE.Vector2());
  const depthTex = new THREE.DepthTexture(
    Math.max(1, Math.round(_db0.x * DEPTH_SCALE)),
    Math.max(1, Math.round(_db0.y * DEPTH_SCALE)),
  );
  depthTex.type = THREE.UnsignedIntType;
  depthTex.minFilter = depthTex.magFilter = THREE.NearestFilter;
  const depthTarget = new THREE.WebGLRenderTarget(depthTex.image.width, depthTex.image.height, {
    depthTexture: depthTex,
    depthBuffer: true,
    samples: 0, // single-sample so the depth texture is sampleable in WebGL2
  });
  function renderDepthOnly(scn, cam) {
    const prevShadow = renderer.shadowMap.enabled;
    renderer.shadowMap.enabled = false; // don't re-render the shadow maps for the depth pass
    renderer.setRenderTarget(depthTarget);
    renderer.clear(true, true, false); // depth -> 1.0 (far) where nothing is drawn
    renderer.render(scn, cam);
    renderer.setRenderTarget(null);
    renderer.shadowMap.enabled = prevShadow;
  }
  const _dbv = new THREE.Vector2();
  const drawingBufferSize = () => renderer.getDrawingBufferSize(_dbv);

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
  // NOTE: the GPU timer query (gpuTimerBegin/End/Poll) is DISABLED — EXT_disjoint_timer_query_webgl2 can
  // destabilise the GPU / drop the WebGL context under heavy load on some drivers, which exactly matched a
  // regression where the two heaviest scenes (Cerberus black hole, Tartarus cloud planet) kept going black
  // (independent of render scale — downscaling didn't help — which a timer-query fault explains and raw
  // overload does not). gpuFrameMs() returns 0 -> the quality controller falls back to wall-clock.
  function render() {
    composer.render();
  }
  void gpuTimerPoll; void gpuTimerBegin; void gpuTimerEnd; // kept (unused) so re-enabling is a one-line change

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
    const db = renderer.getDrawingBufferSize(new THREE.Vector2());
    depthTarget.setSize(Math.max(1, Math.round(db.x * DEPTH_SCALE)), Math.max(1, Math.round(db.y * DEPTH_SCALE)));
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

  return {
    renderer, scene, camera, composer, bloom,
    render, // GPU-timed composer.render()
    setSize, setRenderScale,
    renderDepthOnly, drawingBufferSize,
    depthTexture: () => depthTarget.depthTexture,
    gpuFrameMs: () => gpuMs,
  };
}
