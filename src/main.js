import * as THREE from 'three';
import GUI from 'lil-gui';
import { createRenderer } from './renderer.js';
import { createLighting } from './lighting.js';
import { createQuality } from './quality.js';
import { detectDevice } from './device.js';
import { createNebula } from './nebula.js';
import { buildStarfield } from './starfield.js';
import { loadShip } from './ship.js';
import { loadChig, layoutChigGlows, chigThruster } from './enemyShip.js';
import { createThrusters } from './thruster.js';
import { createFlight } from './flight.js';
import { createAudioManager } from './audio.js';
import { createSfx } from './sfx.js';
import { creditsHtml } from './credits.js';
import { createReactive } from './reactive.js';
import { createInput } from './input.js';
import { createTouchControls } from './touch.js';
import { createProjectiles } from './projectiles.js';
import { createPlayerCannon } from './weapons.js';
import { createEnemyManager } from './enemies.js';
import { createWaveManager } from './waves.js';
import { createVfx } from './vfx.js';
import { createCombat } from './combat.js';
import { createDamageModel } from './damage.js';
import { createHud } from './hud.js';
import { createTargetDisplay } from './targetDisplay.js';
import { createGameState } from './gameState.js';
import { createDebug } from './debug.js';
import { createRcs } from './rcs.js';
import { createEditor } from './editor.js';
import { createDebris } from './debris.js';
import { createPregame } from './pregame.js';
import { applyLoadout } from './loadout.js';
import { loadSettings, DIFFICULTY, ENVIRONMENT } from './settings.js';
import { createAttract } from './attract.js';
import { createAttractMenu } from './attractMenu.js';
import { createOptions } from './options.js';
import { createGamepadMenu } from './gamepadMenu.js';
import { createJupiter, createBlackHole, createCloudPlanet, createHabitablePlanet, createRingedPlanet } from './celestial.js';
import { createPeerTransport } from './net/peer.js';
import { createNetGame } from './net/netgame.js';
import { peerJsWorksHere } from './net/webrtc-detect.js';
import { refreshMe, onSessionChange, isSignedIn } from './social/auth.js';
import { submitRun } from './social/leaderboard.js';

// Debug tooling (the lil-gui tuning panel, FPS overlay, window.__dbg) is local-dev only —
// shown on the Vite dev server and any localhost origin. It can also be opted into on the deployed
// site with a ?debug query param (off by default) so the live build can be inspected / tuned.
const DEBUG =
  import.meta.env.DEV ||
  ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname) ||
  /[?&]debug\b/.test(window.location.search);

// Attract mode: a self-running cinematic AI-vs-AI dogfight (no player). On ?attract we build the attract
// orchestrator instead of the player flight/cannon/HUD/gameState and run a separate, leaner render frame.
const ATTRACT = /[?&]attract\b/.test(window.location.search);
// Skirmish setup: the pre-game customisation menu + the cinematic attract battle behind it. Gated behind
// ?skirmish so the DEFAULT boot is light (no menu, no 6-Hammerhead attract battle built up front) and
// drops straight into flight — matching the base game's fast load.
const ROOM = new URLSearchParams(window.location.search).get('room'); // co-op join code -> auto-join as joiner
// The MENU is the default experience now: build the full menu stack (player systems + cinematic backdrop +
// pregame + title menu) unless it's the pure ?attract screensaver. No ?skirmish needed — plain / just works.
const SKIRMISH = !ATTRACT;
// ?skirmish / ?room jump straight to the Multiplayer pane; otherwise we open on the title menu.
const STRAIGHT_TO_MP = ROOM != null || /[?&]skirmish\b/.test(window.location.search);

// Sound effects (explosions, weapons, flybys, Chig fire) are ON by default now; ?nosound mutes them all.
// (?sound is still accepted as a harmless no-op so old links keep working.) The engine synth is the lone
// exception — still rough — so it stays gated behind ?engine below. Music (audio.js / track.mp3) is separate.
const SOUND = !/[?&]nosound\b/.test(window.location.search);
// The engine synth still sounds rough, so it's gated SEPARATELY behind ?engine — off by default even though
// the rest of the SFX are now on.
const ENGINE_SFX = /[?&]engine\b/.test(window.location.search);

// --- renderer + scene ------------------------------------------------------
// Full-screen fallback notice for browsers that can't run the demo (no WebGL2). Inline-styled so it
// doesn't depend on any app CSS having loaded, and a function declaration so it's hoisted above its use.
function showUnsupported(container, msg) {
  const el = document.createElement('div');
  el.style.cssText =
    'position:fixed;inset:0;display:flex;flex-direction:column;gap:10px;align-items:center;justify-content:center;' +
    'text-align:center;padding:24px;background:#030308;color:#8a93a6;z-index:9999;' +
    'font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;font-size:16px;line-height:1.5';
  el.innerHTML =
    '<div style="font-size:20px;font-weight:700;color:#bcd2ff">SA-43: Hammerhead</div>' +
    '<div>' + msg + '</div>' +
    '<div style="opacity:.7;font-size:13px">Try the latest Chrome, Edge, Firefox, or Safari on a desktop, phone, or tablet.</div>';
  (container || document.body).appendChild(el);
}

const app = document.getElementById('app');
// WebGL2 is required (HDR half-float targets, depth textures, the raymarch shaders). Locked-down / old
// browsers (some console + TV browsers) lack it and three throws on context creation — catch that and
// show a readable message instead of a blank black screen, then stop booting.
let _renderApi;
try {
  _renderApi = createRenderer(app);
} catch (e) {
  showUnsupported(app, 'This demo needs a WebGL2-capable browser.');
  throw e;
}
const { renderer, scene, camera, composer, bloom, render, setRenderScale, renderDepthOnly, drawingBufferSize, depthTexture, gpuFrameMs } = _renderApi;

// On-screen diagnostics: a black screen on a phone/tablet gives no console to read, so surface the actual
// failure. On mobile (or anywhere with ?diag) we catch uncaught errors, promise rejections, and WebGL
// context loss and paint them over the canvas — turning "it's just black" into a reportable message.
const DIAG = detectDevice().isMobile || /[?&]diag\b/.test(window.location.search);
if (DIAG) {
  let shownErr = false;
  const showError = (title, detail) => {
    if (shownErr) return; // first error is the useful one; don't bury it under cascades
    shownErr = true;
    const el = document.createElement('div');
    el.style.cssText =
      'position:fixed;left:0;right:0;bottom:0;z-index:10000;max-height:55vh;overflow:auto;padding:14px 16px;' +
      'background:rgba(40,10,12,0.92);color:#ffd6cc;border-top:1px solid rgba(255,120,90,0.5);' +
      'font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;word-break:break-word';
    el.textContent = '⚠ ' + title + '\n' + (detail || '');
    document.body.appendChild(el);
  };
  window.addEventListener('error', (e) => showError(e.message || 'Script error', `${e.filename || ''}:${e.lineno || ''}:${e.colno || ''}\n${(e.error && e.error.stack) || ''}`));
  window.addEventListener('unhandledrejection', (e) => showError('Unhandled promise rejection', String((e.reason && (e.reason.stack || e.reason.message)) || e.reason || '')));
  renderer.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); showError('WebGL context lost', 'The GPU dropped the rendering context — usually out of memory on mobile, or a driver fault under load. Reloading may help; a lighter environment (try ?nobodies or ?nobloom) uses less.'); });
  // A shader that fails to COMPILE/LINK (iOS GLSL ES is stricter — a prime "renders black" suspect) is
  // logged by three but never throws, so it wouldn't reach the handlers above. This hook surfaces the GLSL
  // info-log on screen so we can see exactly which shader and why.
  renderer.debug.onShaderError = (gl, program, vs, fs) => {
    const log = `${gl.getShaderInfoLog(vs) || ''}\n${gl.getShaderInfoLog(fs) || ''}\n${gl.getProgramInfoLog(program) || ''}`;
    showError('Shader compile/link failed', log.trim().slice(0, 700));
  };
}
// ?safe — one switch to strip the heaviest/most-fragile passes (bloom in renderer.js, the depth pre-pass,
// and all backdrop bodies) for quick black-screen triage on a device with no console. If ?safe renders
// but the default is black, the culprit is one of those; narrow it with the individual flags below.
const SAFE = /[?&]safe\b/.test(window.location.search);
// Smoke occlusion: an opaque depth pre-pass lets the smoke raymarch skip puffs hidden behind ships.
// On by default; ?noocclude (or ?safe) disables it (escape hatch).
const OCCLUDE = !SAFE && !/[?&]noocclude\b/.test(window.location.search);
// Diagnostic switch: ?nobodies (or ?safe) hides every celestial backdrop body (cloud planet / black hole /
// Saturn / Jupiter / Ixion) to isolate the "angle-dependent everything-goes-black" bug to a body shader.
const NOBODIES = SAFE || /[?&]nobodies\b/.test(window.location.search);
const IS_MOBILE = detectDevice().isMobile; // perf scaling: leaner debris pools (and quality.js adaptive tier) on phones

// Lighting: a warm orange "sun" as the main light, a cool rim from the opposite side for separation,
// and a dim hemisphere fill so shadowed sides aren't pure black.
// The warm "sun" main light is now a cascaded-shadow-casting rig (CSM) owned by lighting.js, so it
// self-shadows the hull and lets ships shadow each other.
const sunDir = new THREE.Vector3(-55, 30, -30).normalize(); // direction the sunlight comes FROM
const rim = new THREE.DirectionalLight(0xb8b8b8, 0.7); // neutral grey back-light, fill only (no shadow)
rim.position.set(45, -8, 40);
scene.add(rim);
scene.add(new THREE.HemisphereLight(0x6e6e74, 0x141414, 0.95)); // neutral grey fill
const lighting = createLighting(scene, camera, renderer, { sunColor: 0xffb070, sunDir, sunIntensity: 2.6, sunMult: 7 });
window.addEventListener('resize', () => lighting.onResize());

// Visible sun disc in the sky, in the sun's direction, kept at infinity (moved with the camera).
// Bright + warm so it blooms.
const sun = makeSprite(sunGradient, 560, -5, 512); // the bright disc
const sunGlow = makeSprite(glowGradient, 2900, -6, 1024); // soft warm corona, ~5x the disc diameter
const sunHalo = makeSprite(haloGradient, 7600, -7, 2048); // huge faint wash that fills the view -> most res
scene.add(sunHalo);
scene.add(sunGlow);
scene.add(sun);
// the warm baked disc + a whiter disc, swapped per environment (distant Sol reads white, not orange)
const sunDiscWarm = sun.material.map;
const sunDiscWhite = makeCanvasTex(sunGradientWhite);

// binary companion star (Groombridge): a dim second disc+glow opposite the primary, + a fill light.
const companionDisc = makeSprite(sunGradientWhite, 230, -5);
const companionGlow = makeSprite(glowGradient, 1500, -6);
companionDisc.visible = companionGlow.visible = false;
scene.add(companionGlow);
scene.add(companionDisc);
const companionDir = sunDir.clone().negate(); // opposite side of the sky from the primary
const companionLight = new THREE.DirectionalLight(0xffffff, 0);
companionLight.position.copy(companionDir).multiplyScalar(200);
scene.add(companionLight);

function makeCanvasTex(paint, size = 1024) {
  // The sun sprites are HUGE on screen (the halo fills the view), so a small texture magnified that much
  // shows its texels / 8-bit banding. Render the gradient at high res + dither it (below).
  const s = size;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  paint(g);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  // dither: per-pixel noise breaks up the 8-bit concentric colour banding in the sun glow
  const img = ctx.getImageData(0, 0, s, s);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 11;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
function sunGradient(g) {
  g.addColorStop(0.0, 'rgba(255,250,238,1)');
  g.addColorStop(0.13, 'rgba(255,212,150,1)');
  g.addColorStop(0.32, 'rgba(255,140,60,0.7)');
  g.addColorStop(0.65, 'rgba(255,96,34,0.16)');
  g.addColorStop(1.0, 'rgba(255,70,24,0)');
}
// A white/pale-yellow disc for a distant Sol (vs the warm close-in star) — stays white, not orange.
function sunGradientWhite(g) {
  g.addColorStop(0.0, 'rgba(255,255,253,1)');
  g.addColorStop(0.30, 'rgba(255,253,242,1)');
  g.addColorStop(0.55, 'rgba(255,247,220,0.5)');
  g.addColorStop(0.80, 'rgba(255,242,205,0.10)');
  g.addColorStop(1.0, 'rgba(255,240,200,0)');
}
function glowGradient(g) {
  // soft, wide warm halo — fades gently to nothing at the edge
  g.addColorStop(0.0, 'rgba(255,150,70,0.5)');
  g.addColorStop(0.18, 'rgba(255,120,50,0.28)');
  g.addColorStop(0.45, 'rgba(240,90,38,0.12)');
  g.addColorStop(0.75, 'rgba(210,70,30,0.04)');
  g.addColorStop(1.0, 'rgba(180,60,26,0)');
}
function haloGradient(g) {
  // huge, very faint warm wash filling ~1/3 of the sky around the sun (additive, sub-bloom)
  g.addColorStop(0.0, 'rgba(255,150,80,0.13)');
  g.addColorStop(0.25, 'rgba(245,120,60,0.07)');
  g.addColorStop(0.55, 'rgba(225,95,45,0.025)');
  g.addColorStop(1.0, 'rgba(200,80,40,0)');
}
function makeSprite(paint, scale, order, size = 1024) {
  const spr = new THREE.Sprite(
    // depthTest true so the ship occludes the sun when it passes in front (and so the sun, like the
    // stars, doesn't paint over the opaque hull in the transparent pass).
    new THREE.SpriteMaterial({ map: makeCanvasTex(paint, size), blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true, transparent: true }),
  );
  spr.scale.setScalar(scale);
  spr.renderOrder = order;
  spr.frustumCulled = false;
  return spr;
}

// --- backdrop --------------------------------------------------------------
const nebula = createNebula();
scene.add(nebula.mesh);
// per-environment background bodies (shown/hidden by applyEnvironment), kept at infinity in the loop
// Background bodies are built LAZILY (only the selected environment's one) — building all four at boot
// compiled 4+ shaders (incl. the heavy black-hole raymarch) + loaded the 2 MB Jupiter texture up front,
// which slowed the load badly. ensureBody() creates + caches on first selection.
let jupiter = null, blackhole = null, cloudplanet = null, habitable = null, saturn = null;
function ensureBody(kind) {
  if (kind === 'jupiter' && !jupiter) { jupiter = createJupiter(renderer, sunDir); scene.add(jupiter.group); }
  else if (kind === 'blackhole' && !blackhole) { blackhole = createBlackHole(); scene.add(blackhole.group); }
  else if (kind === 'cloudplanet' && !cloudplanet) { cloudplanet = createCloudPlanet(); scene.add(cloudplanet.group); }
  else if (kind === 'habitable' && !habitable) { habitable = createHabitablePlanet(); scene.add(habitable.group); }
  else if (kind === 'saturn' && !saturn) { saturn = createRingedPlanet(renderer, sunDir); scene.add(saturn.group); }
}
// Jupiter Trojans sit at Jupiter's L4/L5 Lagrange point — the Sun, Jupiter and the Trojan camp form an
// EQUILATERAL triangle, so from here the Sun and Jupiter are exactly 60° apart in the sky. Build JUP_DIR
// as the direction 60° off the sun, in the plane toward a chosen viewing side.
const JUP_DIR = (() => {
  const fwd = new THREE.Vector3(0.5, 0.0, -0.86); // where we'd like Jupiter (forward-right)
  const perp = fwd.clone().addScaledVector(sunDir, -fwd.dot(sunDir)).normalize(); // component ⟂ to the sun
  const a = THREE.MathUtils.degToRad(60);
  return new THREE.Vector3().addScaledVector(sunDir, Math.cos(a)).addScaledVector(perp, Math.sin(a)).normalize();
})();
const BH_DIR = new THREE.Vector3(0.40, 0.18, -0.90).normalize();
const CLOUD_DIR = new THREE.Vector3(0.30, 0.15, -0.94).normalize();
// Cerberus ringed planet: OPPOSITE the black hole (BH_DIR), away from the blue/purple nebula patch (the
// "non-blue region"), lit ~side-on by the sun for a dramatic terminator. Tweakable.
const SATURN_DIR = new THREE.Vector3(-0.40, 0.22, 0.89).normalize();
// Ixion sits toward the sun (blend of forward + sunDir) so it's strongly back-lit -> a thin crescent,
// with the sun ~40deg off to the side (not directly behind).
const IXION_DIR = new THREE.Vector3(0, 0, -1).addScaledVector(sunDir, 0.6).normalize();
function updateBackdropBodies(dt) {
  if (companionDisc.visible) { // keep the binary companion at infinity, opposite the primary
    companionDisc.position.copy(camera.position).addScaledVector(companionDir, 3600);
    companionGlow.position.copy(camera.position).addScaledVector(companionDir, 3650);
  }
  if (jupiter && jupiter.group.visible) {
    jupiter.group.position.copy(camera.position).addScaledVector(JUP_DIR, 3400);
    jupiter.update(dt); // spin Jupiter + orbit Io/Ganymede
  }
  if (cloudplanet && cloudplanet.group.visible) {
    cloudplanet.group.position.copy(camera.position).addScaledVector(CLOUD_DIR, 3000); // pushed back 2x (was 1500) -> large but no longer fills the sky
    cloudplanet.mat.uniforms.uTime.value += dt; // animate the swirling clouds
    cloudplanet.planet && (cloudplanet.planet.rotation.y += 0.004 * dt);
  }
  if (saturn && saturn.group.visible) {
    saturn.group.position.copy(camera.position).addScaledVector(SATURN_DIR, 3000); // big ringed world on the far side
    saturn.update(dt); // spin + keep the ring's planet-shadow centre current
  }
  if (habitable && habitable.group.visible) {
    habitable.group.position.copy(camera.position).addScaledVector(IXION_DIR, 2500); // big + close
    habitable.mat.uniforms.uTime.value += dt;
    habitable.planet.rotation.y += 0.005 * dt; // spin under the fixed crescent terminator
  }
  if (blackhole && blackhole.group.visible) {
    blackhole.group.position.copy(camera.position); // sky-pass sphere centred on the camera (no billboard)
    const u = blackhole.mat.uniforms;
    u.uCamPos.value.copy(camera.position);
    u.uCenter.value.copy(camera.position).addScaledVector(BH_DIR, 3600); // the hole sits in the BH_DIR sky direction
    u.uTime.value += dt;
  }
}
// Backdrop bodies sit at infinity (3000+ units); the foreground smoke is always nearer, so they NEVER
// occlude it — yet the smoke-occlusion DEPTH pre-pass was re-rendering them (incl. the 150-step black-hole
// raymarch + the fullscreen cloud planet), a second full pass that doubled their cost and overloaded the
// GPU in Cerberus/Tartarus -> WebGL context loss -> "keeps going black + no ship". Skip them in that pass.
function bodiesForDepth(hide) {
  for (const b of [jupiter, blackhole, cloudplanet, habitable, saturn]) {
    if (!b) continue;
    if (hide) { b._depthWas = b.group.visible; b.group.visible = false; }
    else if (b._depthWas) b.group.visible = true;
  }
}
const starUniforms = {
  uTime: { value: 0 },
  uStarSize: { value: 1.2 }, // halved max sprite size (user request)
  uStarTwinkle: { value: 0.0 }, // no twinkle — it's space
};

const reactive = createReactive();
const audio = createAudioManager();
const sfx = createSfx({ getContext: audio.ensureContext, camera, enabled: SOUND }); // shares audio's AudioContext; opt-in via ?sound
const touchControls = createTouchControls(); // on-screen flight controls (touch devices only; no-op stub otherwise)
const input = createInput(touchControls.read);

// combat systems (created once the ship is loaded)
let projectiles = null;
let cannon = null;
let vfx = null;
let combat = null;
let damage = null;
let hud = null;
let targetDisplay = null;
let gameState = null;
const playerVel = new THREE.Vector3();
const playerFwd = new THREE.Vector3();
const tmpV = new THREE.Vector3();
const aimPoint = new THREE.Vector3();

// Move the HUD crosshair to the gun's aim direction and the reticle onto the locked target.
function updateAimHud(aim) {
  const W = window.innerWidth;
  const H = window.innerHeight;
  aimPoint.copy(ship.pivot.position).addScaledVector(aim.aimDir, 250);
  tmpV.copy(aimPoint).project(camera);
  hud.setAim(tmpV.z < 1 ? (tmpV.x * 0.5 + 0.5) * W : null, (-tmpV.y * 0.5 + 0.5) * H);
  const t = aim.target;
  if (t && t.alive) {
    tmpV.copy(t.pos).project(camera);
    hud.setTarget((tmpV.x * 0.5 + 0.5) * W, (-tmpV.y * 0.5 + 0.5) * H, tmpV.z < 1);
  } else {
    hud.setTarget(0, 0, false);
  }
}

let ship = null;
let thrusters = null;
let rcs = null;
let debris = null;
let debrisPlayer = null;
let playerDebris = null;
let pregame = null;
const settings = loadSettings(); // AI Skirmish setup (ship/loadout/difficulty/environment), persisted
applyVolumes(settings.volume); // apply the saved audio mix up front (after settings + sfx + audio exist)
let flight = null;
let stars = null;
let chigKit = null;
let enemyMgr = null;
let waves = null;
let debug = null;
let quality = null;
let attract = null;
let attractMenu = null; // title-screen menu overlay (logo + New Game / Multiplayer / Controls / Options)
let options = null; // audio-mix options overlay
const menuGamepad = createGamepadMenu({ onFirstButton: () => firstGesture() }); // d-pad/stick menu nav + audio unlock
let net = null; // co-op netplay (null = single-player)
let runSubmitted = false; // leaderboard: submit a run once when it ends

// Re-arm a fresh fight after a mission ends (called by gameState.restart()).
function restartWorld() {
  runSubmitted = false; // a fresh run -> allow one leaderboard submit when it ends
  ship.pivot.position.set(0, 0, 0);
  ship.pivot.quaternion.identity();
  if (damage) damage.reset();
  enemyMgr.reset();
  projectiles.reset();
  if (waves) waves.reset();
  if (debris) debris.reset();
  if (playerDebris) playerDebris.reset();
  if (ship.model) ship.model.visible = true; // re-show the hull after a destroyed cutscene
  flight.setSpeedScale(1);
  flight.setRollScale(1);
  flight.setPitchScale(1);
  if (vfx.clearDebris) vfx.clearDebris();
}

// --- AI Skirmish: apply pre-game settings to the live systems --------------
function applyDifficulty(s) {
  const d = DIFFICULTY[s.difficulty] || DIFFICULTY.veteran;
  if (waves && waves.params) Object.assign(waves.params, d.waves);
  if (enemyMgr && enemyMgr.params) Object.assign(enemyMgr.params, d.enemy);
}
function applyEnvironment(s) {
  const e = ENVIRONMENT[s.environment] || ENVIRONMENT.groombridge34;
  const u = nebula.uniforms;
  u.uColorA && u.uColorA.value.setHex(e.nebula.uColorA);
  u.uColorB && u.uColorB.value.setHex(e.nebula.uColorB);
  u.uColorC && u.uColorC.value.setHex(e.nebula.uColorC);
  if (u.uBrightness) u.uBrightness.value = e.nebula.uBrightness;
  if (u.uSaturation) u.uSaturation.value = e.nebula.uSaturation;
  if (u.uMilkyWay) u.uMilkyWay.value = e.nebula.uMilkyWay;
  // big localized nebula patch (Cerberus): a broad blue/purple cloud around the black hole
  if (u.uPatchBright) u.uPatchBright.value = e.patch ? e.patch.bright : 0;
  if (e.patch) {
    if (u.uPatchColor) u.uPatchColor.value.setHex(e.patch.color);
    if (u.uPatchDir) u.uPatchDir.value.copy(BH_DIR);
  }
  lighting.setSunIntensity(e.sunMult != null ? e.sunMult : 7); // intensity matches the star (Sol@5AU dim, etc.)
  lighting.setSunColor(e.sun.light != null ? e.sun.light : 0xffffff); // cast light colour matches the star type
  applySun(e.sun);
  applyCompanion(e); // binary second star (Groombridge), else off
  applyBody(e.body);
  // optional SECOND background body (Tartarus pairs the cyan cloud planet with a grey ringed planet)
  ensureBody(e.body2);
  if (saturn) saturn.group.visible = !NOBODIES && e.body2 === 'saturn';
}
// Binary companion star: a dim second disc+glow on the opposite side of the sky + a fill light at its colour.
function applyCompanion(e) {
  const c = e.companion;
  const on = !!c;
  companionDisc.visible = companionGlow.visible = on;
  companionLight.intensity = on ? 2.6 * (e.sunMult != null ? e.sunMult : 7) * c.mult : 0;
  if (on) {
    companionDisc.scale.setScalar(c.disc); companionGlow.scale.setScalar(c.glow);
    companionDisc.material.color.setHex(c.color); companionGlow.material.color.setHex(c.color);
    companionLight.color.setHex(c.color);
  }
}
// Retune the existing sun sprites per environment (size/tint/glow/whiteness) — not the light direction.
function applySun(c) {
  if (!c) return;
  sun.material.map = c.white ? sunDiscWhite : sunDiscWarm; sun.material.needsUpdate = true; // whiter disc for distant Sol
  sun.scale.setScalar(c.disc); sun.material.color.setHex(c.color != null ? c.color : 0xffffff);
  sunGlow.scale.setScalar(c.glow || 1); sunGlow.material.opacity = c.glowAlpha != null ? c.glowAlpha : 1;
  sunGlow.visible = (c.glow || 0) > 0 && sunGlow.material.opacity > 0.001;
  sunHalo.scale.setScalar(c.halo || 1); sunHalo.material.opacity = c.haloAlpha != null ? c.haloAlpha : 1;
  sunHalo.visible = (c.halo || 0) > 0 && sunHalo.material.opacity > 0.001;
}
// Show the environment's background body (Jupiter / black hole / cloud planet / Ixion / none),
// building it on first use (lazy) so unused envs cost nothing.
function applyBody(kind) {
  if (NOBODIES) kind = 'none'; // diagnostic: force all bodies off
  ensureBody(kind);
  if (jupiter) jupiter.group.visible = kind === 'jupiter';
  if (blackhole) blackhole.group.visible = kind === 'blackhole';
  if (cloudplanet) cloudplanet.group.visible = kind === 'cloudplanet';
  if (habitable) habitable.group.visible = kind === 'habitable';
}
function applySettings(s) {
  applyDifficulty(s);
  applyEnvironment(s);
  applyLoadout(ship, s.loadout); // show/hide detachable ordnance (fuel tanks; missiles/laser later)
  // Phase 2 hook: applyLivery(ship, s.livery, s.skin);
}

// Arm the cinematic menu battle as the backdrop (the ship is ally #1), no player flight. Run on boot and
// after a MISSION OVER — NOT on a title<->Multiplayer toggle (those just swap the overlay so the dogfight
// keeps rolling underneath). gameState stays 'menu' so the loop draws the cinematic frame.
function armMenuBattle() {
  applyEnvironment({ ...settings, environment: 'cerberus' }); // the menu showcases Cerberus
  applyLoadout(ship, settings.loadout); // reflect the saved loadout on the menu/preview ship
  if (ship.model) ship.model.visible = true;
  if (flight) flight.setEnabled(false);
  restartWorld(); // clean slate before the backdrop battle re-arms
  if (attract) {
    attract.resume(); // reposition + heal allies, spawn a fresh Chig wave
    attract.setVisible(true);
    if (combat) combat.setFriendlies(attract.friendlies); // enemy bolts hit the allies, not the player
  }
  if (hud) hud.setVisible(false);
  if (targetDisplay) targetDisplay.setVisible(false); // the TARGET panel is flight-only (don't leave a black square on the menu)
}
// In-page overlay swaps (no reload, battle keeps running):
function showTitle() { if (pregame) pregame.hide(); if (options) options.hide(); if (attractMenu) attractMenu.show(); menuGamepad.setMenu(attractMenu && attractMenu.el); }
function showMultiplayer() { if (attractMenu) attractMenu.hide(); if (options) options.hide(); if (pregame) pregame.show(); menuGamepad.setMenu(pregame && pregame.root, { onBack: showTitle }); }
function showOptions() { if (attractMenu) attractMenu.hide(); if (pregame) pregame.hide(); if (options) options.show(); menuGamepad.setMenu(options && options.el, { onBack: showTitle }); }
// Apply the saved audio mix: master scales everything; effects -> SFX bus, music -> music. (voice reserved.)
function applyVolumes(v) {
  if (!v) return;
  const m = v.master != null ? v.master : 1;
  if (sfx.setMasterGain) sfx.setMasterGain(m * (v.effects != null ? v.effects : 1));
  if (audio.setVolume) audio.setVolume(m * (v.music != null ? v.music : 0.7));
}
// Full menu entry (boot / mission-over): arm the battle, open on the title menu.
function enterMenu() { armMenuBattle(); showTitle(); }
// Start (or join) a co-op session from the lobby. role 'host' mints a room code; 'joiner' connects to
// `code`. Returns the room code (host's own, or the joined one). The match itself begins on LAUNCH
// (host broadcasts `start`; both peers run coopLaunch).
function startCoop(role, code) {
  if (net) net.end();
  const transport = createPeerTransport({ role, code });
  net = createNetGame(scene, {
    transport, role, ship, enemyMgr, projectiles, vfx, combat, lighting,
    getLocalPlayer: () => ({ pos: ship.pivot.position, quat: ship.pivot.quaternion, vel: playerVel }),
    localName: (settings.livery && settings.livery.callsign) || 'Pilot',
    localLivery: settings.livery,
    getSettings: () => ({ difficulty: settings.difficulty, environment: settings.environment }),
    getWave: () => (waves && typeof waves.wave === 'number' ? waves.wave : 0),
    onSettings: (s) => { if (s) { settings.difficulty = s.difficulty; settings.environment = s.environment; applyEnvironment(settings); } },
    onStart: (s) => coopLaunch(s),
    onRoster: (r) => { if (pregame && pregame.setRoster) pregame.setRoster(r, net.isHost ? transport.code : code); },
    onDisconnect: () => { if (gameState.mode === 'flying') gameState.toMenu(); },
  });
  transport.start();
  return net.isHost ? transport.code : code;
}
// Co-op match start (host on LAUNCH, joiner on the host's `start` event): adopt the shared settings + fly.
function coopLaunch(s) {
  if (s) { settings.difficulty = s.difficulty || settings.difficulty; settings.environment = s.environment || settings.environment; }
  applySettings(settings);
  if (attract) attract.setVisible(false);
  if (combat) combat.setFriendlies(null);
  restartWorld();
  if (pregame) pregame.hide();
  if (hud) hud.setVisible(true);
  if (targetDisplay) targetDisplay.setVisible(true);
  firstGesture();
  gameState.launch();
}
// Launch button: hide the attract clones, drop friendlies, apply settings, reset the world, fly.
function launchSkirmish(s) {
  if (net && net.isHost) { net.broadcastStart(s); coopLaunch(s); return; } // co-op host: tell joiners, then fly
  if (net && !net.isHost) return; // co-op joiner: only the host can launch
  applySettings(s);
  if (attract) attract.setVisible(false); // the two ally clones leave; ally #1 becomes the player
  if (combat) combat.setFriendlies(null); // single-player: enemy bolts hit the PLAYER (not the menu-only allies)
  restartWorld();
  if (pregame) pregame.hide();
  if (hud) hud.setVisible(true);
  if (targetDisplay) targetDisplay.setVisible(true);
  firstGesture(); // the launch click is a user gesture -> unlock + start audio (autoplay policy)
  gameState.launch();
}
// Default (non-skirmish) start: no menu, no attract backdrop — apply the saved settings and drop straight
// into flight. Also serves as gameState.onMenu so a finished mission restarts back into flight (not a menu).
function bootFlight() {
  applySettings(settings);
  restartWorld();
  if (hud) hud.setVisible(true);
  if (targetDisplay) targetDisplay.setVisible(true);
  if (gameState.mode === 'menu') gameState.launch(); // menu -> flying (audio unlocks on first input)
}
// Fade to black, THEN hard-navigate. The next screen re-boots its whole stack (heavy), so masking it as a
// deliberate fade reads far better than the frozen-frame hitch of an abrupt reload.
function fadeToAndNavigate(url) {
  if (fadeEl) { fadeEl.style.transition = 'opacity 0.34s ease'; fadeEl.classList.remove('gone'); }
  setTimeout(() => { location.href = url; }, 360);
}

// Pure ?attract screensaver: cinematic only, no menu, no player systems. (The MENU is the default boot now;
// see enterMenu/armMenuBattle.)
function bootAttract() {
  applyEnvironment({ ...settings, environment: 'cerberus' }); // attract showcases the Cerberus black hole by default
  if (attract) { attract.resume(); attract.setVisible(true); }
}

async function init() {
  stars = await buildStarfield(starUniforms);
  scene.add(stars);

  // Reflections: bake the nebula + stars into an environment map (from the origin) so the metal
  // hull picks up the space around it. Far plane must reach past the backdrop spheres.
  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envRT = pmrem.fromScene(scene, 0.04, 1, 10000);
    scene.environment = envRT.texture;
    pmrem.dispose();
  } catch (e) {
    console.warn('[env] PMREM build failed; metal will rely on lights only', e);
  }

  ship = await loadShip();
  scene.add(ship.pivot);
  thrusters = createThrusters(ship.pivot, ship.nozzles, ship.rearDir, ship.radius);
  lighting.attachThrusters(ship.pivot, ship.nozzles, ship.rearDir, ship.radius); // real engine light spill
  if (!ATTRACT) {
    rcs = createRcs(scene, ship);
    flight = createFlight(ship.pivot, camera, renderer.domElement, input);
  }

  projectiles = createProjectiles(scene);
  if (!ATTRACT) {
    cannon = createPlayerCannon(scene, ship, projectiles, {
      getEnemies: () => (enemyMgr ? enemyMgr.enemies : []),
      canFire: () => !damage || damage.canFire(), // gun subsystem destroyed -> cannon offline
      onFire: (pos) => { lighting.muzzleFlash(pos); sfx.weaponFire(pos); sfx.gunFiring(); }, // muzzle-flash light pulse + cannon loop sustain (+ optional one-shot if /sfx/cannon.* exists)
    });
  }

  chigKit = await loadChig();
  // register the lit hull materials so the cascaded sun shadows fall on them (self + ship-to-ship)
  lighting.registerTree(ship.pivot);
  lighting.registerTree(chigKit.template);
  enemyMgr = createEnemyManager(scene, chigKit, projectiles, { onFire: (pos) => sfx.chigShot(pos) });
  if (!ATTRACT) waves = createWaveManager(enemyMgr); // attract owns its own wave loop
  vfx = createVfx(scene, camera, { lightDir: sunDir, onExplosion: (p, s) => sfx.onExplosion(p, s) }); // align smoke self-shadow with the real sun; SFX boom on every explosion
  if (OCCLUDE) vfx.setOcclusion(depthTexture(), camera.near, camera.far); // feed the smoke the opaque depth
  enemyMgr.setVfx(vfx); // death sequences (explosions/smoke) need VFX
  debris = createDebris(scene, { template: chigKit.template, material: chigKit.material, vfx, count: IS_MOBILE ? 24 : 64, cap: IS_MOBILE ? 96 : 240 });
  enemyMgr.setDebris(debris); // ship-fracture chunks on death
  if (!ATTRACT) {
    debrisPlayer = { pos: ship.pivot.position, radius: ship.radius, vel: playerVel };
    playerDebris = createDebris(scene, { template: ship.pivot, convex: true, vfx, count: IS_MOBILE ? 6 : 12, cap: IS_MOBILE ? 72 : 160 }); // player Hammerhead (171k verts/45 meshes) -> convex-hull proxy, shatters when destroyed
  }
  quality = createQuality({ lighting, vfx, debris, setRenderScale, gpuFrameMs }); // GPU-ms two-rate autoscaler: per-frame volumetric steps + debounced tier (render scale, CSM, shadow budget, smoke, vfx)
  combat = createCombat(projectiles, enemyMgr, vfx, {
    getPlayerPos: () => ship.pivot.position,
    playerHitRadius: ship.radius * 0.85,
  });
  if (ATTRACT) {
    // attract mode: build the cinematic AI-vs-AI dogfight instead of the player combat stack.
    attract = createAttract(scene, camera, { ship, thrusters, chigKit, enemyMgr, projectiles, vfx, debris, lighting, rcs });
    combat.setFriendlies(attract.friendlies); // enemy bolts route to whichever ally ship they hit
  } else {
  damage = createDamageModel(ship);
  // only route hits to the player while actually flying — in the menu the ship is an immortal attract
  // ally (handled via combat friendlies), so enemy bolts must not damage the player's real hull.
  combat.setOnPlayerHit((pt, dmg, from) => { if (gameState.mode === 'flying') damage.applyHit(pt, dmg, from); });

  hud = createHud(damage, { getKills: () => enemyMgr.kills, onRestart: () => gameState.restart() });
  targetDisplay = createTargetDisplay(chigKit.template);
  // ?skirmish -> return to the menu after a mission; default -> drop straight back into flight.
  gameState = createGameState({ ship, camera, flight, hud, vfx, debris: playerDebris, playerVel, onRestart: restartWorld, onMenu: enterMenu }); // mission over -> back to the title menu
  if (SKIRMISH) {
    pregame = createPregame({
      settings, onLaunch: launchSkirmish,
      onChange: (s) => { applyEnvironment(s); applyLoadout(ship, s.loadout); },
      onHost: () => startCoop('host'),
      onJoin: (code) => { startCoop('joiner', code); },
      onQuickMatch: (role, code) => { startCoop(role, code); }, // quick-match assigns the role + room code

      onBack: showTitle, // in-page: back to the title menu (no reload)
    });
    options = createOptions({
      settings, onChange: applyVolumes, onBack: showTitle,
      invertPitch: { show: touchControls.active, initial: touchControls.invertPitch, onChange: (on) => touchControls.setInvertPitch(on) },
    });
    attractMenu = createAttractMenu({
      onMultiplayer: showMultiplayer, // in-page: swap to the Multiplayer pane (no reload)
      onControls: () => infoEl?.classList.toggle('open'), // same toggle as Tab
      onOptions: showOptions, // in-page: the audio-mix options pane
    });
  }
  damage.setCallbacks({
    onEject: () => gameState.eject(),
    onDestroyed: () => gameState.destroyed(),
    onFuelRupture: () => gameState.destroyed(), // tank rupture -> fireball + ship lost
    onCanardLost: (zone, node, pt) => {
      // blow the canard off as tumbling debris (inherits ship velocity + an outboard/up kick), then a
      // burst at the break; the sparking stub is handled per-frame in damage.update().
      const sign = zone.center.x < 0 ? -1 : 1;
      const out = new THREE.Vector3(sign, 0, 0).applyQuaternion(ship.pivot.quaternion);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(ship.pivot.quaternion);
      const vel = playerVel.clone().addScaledVector(out, 10).addScaledVector(up, 4);
      const angVel = new THREE.Vector3((Math.random() * 2 - 1) * 6, (Math.random() * 2 - 1) * 6, (Math.random() * 2 - 1) * 6);
      vfx.spawnDebris(node, { vel, angVel, life: 2.0 });
      vfx.firework(pt, 0.5);
      vfx.spark(pt, 0xcfe8ff);
    },
    onWingLost: (zone, node, pt) => {
      // tear the wing off as tumbling debris (bigger kick than a canard) + a meaty burst, then the ship
      // snaps into an uncontrollable tumble — the only out is to eject.
      const sign = zone.center.x < 0 ? -1 : 1;
      const out = new THREE.Vector3(sign, 0, 0).applyQuaternion(ship.pivot.quaternion);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(ship.pivot.quaternion);
      const vel = playerVel.clone().addScaledVector(out, 18).addScaledVector(up, 6);
      const angVel = new THREE.Vector3((Math.random() * 2 - 1) * 9, (Math.random() * 2 - 1) * 9, (Math.random() * 2 - 1) * 9);
      vfx.spawnDebris(node, { vel, angVel, life: 2.6 });
      vfx.firework(pt, 0.8);
      vfx.spark(pt, 0xffd27a);
      gameState.tumble('WING TORN OFF — EJECTED');
    },
  });
  // Cinematic battle behind both the title menu (default) and the pre-game/co-op menu (?skirmish):
  // the player ship is ally #1 (reusing the player's own RCS so there's no doubled jet rig), plus clones
  // vs looping Chigs.
  attract = createAttract(scene, camera, { ship, thrusters, chigKit, enemyMgr, projectiles, vfx, debris, lighting, rcs });
  }

  if (DEBUG && !ATTRACT) {
    // debug handle + live-tuning GUI — local dev only, never on the deployed site
    window.__dbg = { align: ship.align, pivot: ship.pivot, camera, ship, thrusters, flight, enemyMgr, waves, damage, cannon, gameState, targetDisplay, vfx };
    debug = createDebug({
      renderer, scene, camera, render, bloom,
      ship, chigKit, flight, thrusters,
      lights: { rim }, lighting, sun, sunGlow, nebula, stars,
    });
    window.__dbg.debug = debug;
    buildTweakGui();
    setStats(true); // show the FPS counter by default in debug
  }

  // Pre-warm every material's shader program once now (during the fade-in) so the FIRST explosion /
  // death-debris / muzzle flash doesn't pay a compile stall mid-fight.
  try { renderer.compile(scene, camera); } catch (e) { console.warn('[prewarm] compile skipped', e); }

  // hydrate the signed-in pilot's identity into the livery (used for the co-op `hello` + display)
  const applyProfile = (p) => {
    if (!p) return;
    if (p.callsign) settings.livery.callsign = p.callsign;
    if (p.squadron) settings.livery.squadron = p.squadron;
    if (p.livery_color) settings.livery.color = p.livery_color;
  };
  refreshMe().then(applyProfile);
  onSessionChange(applyProfile);

  if (ATTRACT) bootAttract(); // pure cinematic screensaver (?attract)
  else { enterMenu(); if (STRAIGHT_TO_MP) showMultiplayer(); } // DEFAULT: title menu (?skirmish/?room jump to the Multiplayer pane)
  if (ROOM && pregame) { startCoop('joiner', ROOM.toUpperCase()); if (pregame.setRoster) pregame.setRoster([], ROOM.toUpperCase()); } // ?room -> auto-join
  startLoop();
  reveal();
}

// --- render loop -----------------------------------------------------------
const clock = new THREE.Timer(); // THREE.Clock is deprecated -> Timer (update() each frame, then getDelta())
let fps = 60;

// Chig flyby whoosh: when a Chig sweeps PAST the camera (its distance stops shrinking and starts growing =
// closest approach, and that closest point was within range while it was moving fast) play one doppler-ish
// whoosh. Per-enemy _flyPrevD catches the approach→recede turn; _flyCd debounces so one pass = one whoosh.
const FLYBY_DIST = 32;      // closest approach must come within this many units of the camera
const FLYBY_MIN_SPEED = 14; // and the Chig must be moving at least this fast (units/s)
function updateFlybys(dt) {
  if (!enemyMgr) return;
  const cp = camera.position;
  for (const e of enemyMgr.enemies) {
    if (!e.alive || !e.pos) continue;
    if (e._flyCd > 0) e._flyCd -= dt;
    const d = e.pos.distanceTo(cp);
    const pd = e._flyPrevD === undefined ? d : e._flyPrevD;
    e._flyPrevD = d;
    if (d > pd && pd < FLYBY_DIST && !(e._flyCd > 0)) { // just passed closest approach, and it was close
      const spd = e.vel ? e.vel.length() : 0;
      if (spd > FLYBY_MIN_SPEED) { sfx.flyby(e.pos, Math.min(1, spd / 110)); e._flyCd = 0.7; }
    }
  }
}

// Attract mode frame: drive the AI dogfight + cinematic camera, reusing the shared combat/vfx/debris/
// lighting pipeline but none of the player systems (flight/cannon/HUD/gameState are never created here).
function attractFrame(dt) {
  attract.update(dt); // AI Hammerheads + cinematic camera + Chig target split + wave loop
  enemyMgr.update(dt, attract.focus, attract.targetFor); // Chigs each chase their nearest ally
  projectiles.update(dt);
  combat.update(dt); // ally (player-team) bolts kill Chigs; enemy bolts -> ally friendlies
  vfx.update(dt);
  if (debris) debris.update(dt, null, enemyMgr.enemies);
  enemyMgr.prune();
  // keep the backdrop centred on the camera so it sits at infinity (copied from the player loop)
  nebula.mesh.position.copy(camera.position);
  stars.position.copy(camera.position);
  sun.position.copy(camera.position).addScaledVector(sunDir, 3600);
  sunGlow.position.copy(camera.position).addScaledVector(sunDir, 3650);
  sunHalo.position.copy(camera.position).addScaledVector(sunDir, 3700);
  updateBackdropBodies(dt); // keep the environment's background body at infinity (+ animate it)
  nebula.uniforms.uTime.value += dt;
  starUniforms.uTime.value += dt;
  lighting.update(dt, { player: attract.focus, thrust: 0.8, projectiles, enemies: enemyMgr.enemies }); // cascades fit to the camera; dynamic lights around the action
  if (ENGINE_SFX) sfx.engine(0.85); // steady engine hum (allies cruise ~0.85) — ?engine only
  updateFlybys(dt); // Chig whooshes past the cinematic camera
  if (OCCLUDE) { // smoke occlusion: the furball is the heaviest case, so cull hidden puffs here too
    nebula.mesh.visible = false;
    stars.visible = false;
    vfx.setHiddenForDepth(true);
    bodiesForDepth(true); // keep the heavy backdrop bodies (black hole / cloud planet) out of the depth pass
    const db = drawingBufferSize();
    renderDepthOnly(scene, camera);
    vfx.updateOcclusion(camera, db.x, db.y);
    nebula.mesh.visible = true;
    stars.visible = true;
    vfx.setHiddenForDepth(false);
    bodiesForDepth(false);
  }
  render();
  fps += (1 / Math.max(dt, 1e-3) - fps) * 0.1;
  quality.update(dt); // auto-scale shadow/VFX tier (6 Hammerheads + 24 Chigs is heavy)
  if (statsOn) statsEl.textContent = `${fps.toFixed(0)} fps · ${(1000 / Math.max(fps, 1)).toFixed(1)} ms${gpuFrameMs() > 0 ? ' · ' + gpuFrameMs().toFixed(1) + ' gpu' : ''}\n${quality.tierName}${quality.auto ? '' : ' (man)'} · P${Math.round(quality.pressure * 100)} · ×${quality.renderScale.toFixed(2)}`;
}

// A background clock: a Web Worker firing ~30 Hz regardless of window focus/visibility, so the co-op
// sim + netcode keep running when requestAnimationFrame is throttled (hidden/occluded/unfocused window).
// Falls back to a main-thread interval (which the browser throttles harder, but still beats freezing).
function startBgClock(tick) {
  try {
    const w = new Worker(URL.createObjectURL(new Blob(['setInterval(function(){postMessage(0)},33)'], { type: 'text/javascript' })));
    w.onmessage = tick;
  } catch (e) {
    setInterval(tick, 33);
  }
}

function startLoop() {
  let lastFrame = 0;
  // The sim + netcode live in frame(). rAF drives it when visible; the background clock drives it when
  // rAF is throttled AND co-op is live, so a backgrounded peer (the host especially) keeps simulating
  // and sending instead of freezing. Single-player is unaffected (the bg clock only fires frame when net).
  function frame() {
    lastFrame = performance.now();
    clock.update(); // THREE.Timer — advance before getDelta()
    const dt = Math.min(clock.getDelta(), 0.1);
    if (DEBUG && debug && debug.frame(dt)) return; // debug viewer modes own the frame
    if (!(gameState && gameState.mode === 'flying')) menuGamepad.poll(dt); // gamepad menu nav (+ audio unlock); skipped in flight so it never fights the flight controls
    if (ATTRACT) { attractFrame(dt); return; } // standalone ?attract: a leaner, player-less frame
    if (attract && gameState.mode === 'menu') { touchControls.setVisible(false); attractFrame(dt); return; } // cinematic battle behind the menu (hide touch controls)

    input.poll(); // keyboard + gamepad + touch -> shared signals (read by flight + cannon)
    const flying = gameState.mode === 'flying';
    touchControls.setVisible(flying); // show the on-screen stick/buttons only while actually flying
    let res = { throttle: 0, speed: 0, boosting: false };
    if (flying) {
      flight.setSpeedScale(damage.speedScale()); // engine damage cuts top speed
      flight.setRollScale(damage.rollScale()); // canard loss saps roll authority
      flight.setPitchScale(damage.pitchScale()); // canard loss saps pitch authority
      res = flight.update(dt);
    }

    // player transform for the combat systems
    playerFwd.set(0, 0, -1).applyQuaternion(ship.pivot.quaternion);
    playerVel.copy(playerFwd).multiplyScalar(res.speed);
    const player = { pos: ship.pivot.position, quat: ship.pivot.quaternion, vel: playerVel };
    if (flying) updateAimHud(cannon.update(dt, input, player));
    else hud.setTarget(0, 0, false);
    // co-op: send own ship state, then interpolate remote ships/enemies before AI/targeting reads them
    if (net && flying) net.captureLocal(player, { dt, throttle: res.throttle, firing: (input.fire || 0) > 0.5 });
    if (net) net.applyRemotes(dt);
    if (net && !net.isHost) enemyMgr.stepDeaths(dt); // joiner: enemies are host-driven proxies, no local AI
    else enemyMgr.update(dt, player, net ? net.targetFor : undefined);
    if (gameState.mode === 'flying' && (!net || net.isHost)) waves.update(dt, player); // host owns waves
    projectiles.update(dt);
    combat.update(dt);
    if (flying) damage.update(dt, vfx);
    vfx.update(dt);
    if (debris) debris.update(dt, debrisPlayer, enemyMgr.enemies); // enemy debris: drift, bounce, cull
    if (playerDebris) playerDebris.update(dt, null, enemyMgr.enemies); // player wreck debris (no self-collide)
    enemyMgr.prune();
    gameState.update(dt, input);
    if (gameState.mode === 'over' && !runSubmitted) { // record the run for the leaderboard (once)
      runSubmitted = true;
      if (net) net.localDead(); // co-op: peers remove our ship proxy instead of freezing it
      if (isSignedIn()) submitRun({ wave: (waves && waves.wave) || 0, kills: net ? net.myKills : enemyMgr.kills, deaths: 1, difficulty: settings.difficulty, environment: settings.environment, coop: !!net });
    }
    hud.update({ waves, enemies: enemyMgr.enemies, player, ejectProgress: gameState.ejectProgress });
    targetDisplay.update(cannon.target, ship.pivot.quaternion, ship.pivot.position, cannon.locked);

    const amp = audio.getAmplitude();
    const bands = audio.getBands();
    const r = reactive.update(
      { amp, bands, throttle: res.throttle, boosting: res.boosting },
      { bloom, nebula: nebula.uniforms, starUniforms },
      dt,
    );

    for (const m of ship.engineMaterials) m.emissiveIntensity = 1.8 + r.thrust * 3.2;
    thrusters.update(r.thrust, dt);
    if (ENGINE_SFX) sfx.engine(r.thrust); // engine rises with thrust/boost — ?engine only (still rough)
    sfx.gunTick(dt); // gate the cannon fire-loop (gunFiring() is pulsed per shot from the cannon's onFire)
    updateFlybys(dt); // Chig whooshes past the player
    if (rcs) rcs.update(dt, flying); // maneuvering jets — fire from the ship's actual rotation + deceleration

    // keep the backdrop centred on the camera so it sits at infinity (no parallax)
    nebula.mesh.position.copy(camera.position);
    stars.position.copy(camera.position);
    sun.position.copy(camera.position).addScaledVector(sunDir, 3600);
    sunGlow.position.copy(camera.position).addScaledVector(sunDir, 3650);
    sunHalo.position.copy(camera.position).addScaledVector(sunDir, 3700);
  updateBackdropBodies(dt); // keep the environment's background body at infinity (+ animate it)
    nebula.uniforms.uTime.value += dt;
    starUniforms.uTime.value += dt;

    lighting.update(dt, { player, thrust: r.thrust, projectiles, enemies: enemyMgr.enemies, cannon }); // fit cascades to the camera (+ dynamic lights, later phases)

    if (OCCLUDE) {
      // capture opaque depth (nebula/stars/smoke toggled off) so the smoke raymarch can cull hidden puffs
      nebula.mesh.visible = false;
      stars.visible = false;
      vfx.setHiddenForDepth(true);
      bodiesForDepth(true); // keep the heavy backdrop bodies (black hole / cloud planet) out of the depth pass
      const db = drawingBufferSize();
      renderDepthOnly(scene, camera);
      vfx.updateOcclusion(camera, db.x, db.y);
      nebula.mesh.visible = true;
      stars.visible = true;
      vfx.setHiddenForDepth(false);
      bodiesForDepth(false);
    }

    render();

    fps += (1 / Math.max(dt, 1e-3) - fps) * 0.1;
    quality.update(dt); // GPU-measured two-rate autoscaler
    if (statsOn) statsEl.textContent = `${fps.toFixed(0)} fps · ${(1000 / Math.max(fps, 1)).toFixed(1)} ms${gpuFrameMs() > 0 ? ' · ' + gpuFrameMs().toFixed(1) + ' gpu' : ''}\n${quality.tierName}${quality.auto ? '' : ' (man)'} · P${Math.round(quality.pressure * 100)} · ×${quality.renderScale.toFixed(2)}`;
  }
  renderer.setAnimationLoop(() => { if (!document.hidden) frame(); });
  // co-op only: if rAF hasn't run in >40ms (window hidden/throttled), the bg clock keeps frame() going
  startBgClock(() => { if (net && performance.now() - lastFrame > 40) frame(); });
}

// --- UI --------------------------------------------------------------------
const fadeEl = document.getElementById('fade');
const startEl = document.getElementById('start');
const toastEl = document.getElementById('toast');
const infoEl = document.getElementById('info');
const statsEl = document.getElementById('stats');
const playBtn = document.getElementById('playToggle');
const muteBtn = document.getElementById('muteToggle');
const volEl = document.getElementById('volume');

// Asset attribution — rendered from the single source of truth in credits.js (a dedicated About screen
// can reuse the same data later).
const creditsEl = document.getElementById('credits');
if (creditsEl) creditsEl.innerHTML = creditsHtml();

let revealed = false;
function reveal() {
  if (revealed) return;
  revealed = true;
  fadeEl?.classList.add('gone');
}
setTimeout(reveal, 8000); // safety net if a frame never lands

// Controls panel starts HIDDEN now; just slide in a brief hint toast. On desktop it's "press Tab"; on
// touch there's no keyboard/Tab pane, so swap in a flight hint for the on-screen controls instead.
if (toastEl && detectDevice().isMobile) toastEl.innerHTML = '<span>Drag to fly · <b>FIRE</b> to shoot</span>';
setTimeout(() => toastEl?.classList.add('show'), 2400);
setTimeout(() => toastEl?.classList.remove('show'), 8400);

let statsOn = false;
function setStats(on) {
  statsOn = on;
  if (statsEl) statsEl.style.display = on ? 'block' : 'none';
}

function setPlayIcon() {
  if (playBtn) playBtn.textContent = audio.isPaused ? '▶' : '⏸';
}
function setMuteIcon() {
  if (muteBtn) muteBtn.textContent = audio.isMuted ? '🔇' : '🔊';
}

playBtn?.addEventListener('click', () => {
  audio.resumeContext();
  audio.toggle();
  setTimeout(setPlayIcon, 60);
});
muteBtn?.addEventListener('click', () => {
  audio.toggleMute();
  setMuteIcon();
});
volEl?.addEventListener('input', () => audio.setVolume(volEl.value / 100));
audio.setVolume((volEl?.value ?? 70) / 100);

// First user gesture unlocks + starts audio (browser autoplay policy).
let gestured = false;
function firstGesture() {
  if (gestured) return;
  gestured = true;
  audio.ensureContext(); // build the shared ctx even when there's no music track...
  audio.resumeContext();
  sfx.unlock(); // ...so SFX can decode + play off it too (one gesture unlocks both)
  if (audio.isAvailable !== false) audio.play().then(setPlayIcon);
  startEl?.classList.add('hidden');
}
window.addEventListener('pointerdown', firstGesture);
window.addEventListener('keydown', firstGesture, { once: false });
// Controller-only devices: optimistically TRY to unlock on gamepad connect (some console browsers allow it).
// gamepadconnected is NOT a user-activation gesture though, so this resume is usually a no-op — and crucially
// it must NOT run firstGesture(), because that flips `gestured` and would swallow the user's first REAL click,
// leaving audio permanently silent (the "no sound" regression). So attempt the unlock WITHOUT the flag; a
// later pointer/key still unlocks for certain.
window.addEventListener('gamepadconnected', () => { audio.ensureContext(); audio.resumeContext(); sfx.unlock(); });

// Reveal the "click for sound" prompt only if there is actually a track to play.
audio.ready.then((ok) => {
  if (ok && !gestured) startEl?.classList.remove('hidden');
  if (!ok) {
    // no MP3 present — make the audio controls clearly inert
    if (playBtn) playBtn.style.opacity = '0.4';
    const label = document.getElementById('label');
    if (label) label.textContent = 'SA-43: Hammerhead · (drop an MP3 for music)';
  }
});

window.addEventListener('keydown', (e) => {
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON')) return;
  if (e.code === 'Tab') {
    e.preventDefault();
    infoEl?.classList.toggle('open');
  } else if (e.code === 'KeyP') {
    audio.resumeContext();
    audio.toggle();
    setTimeout(setPlayIcon, 60);
  } else if (e.code === 'KeyF') {
    setStats(!statsOn); // FPS / frame-time counter — toggle it ANYWHERE (not just ?debug)
  }
});

window.addEventListener('pagehide', () => flight?.dispose?.(), { once: true });

// Live tuning panel (lil-gui): hand-align the two thrusters and tweak the chase camera.
function buildTweakGui() {
  const gui = new GUI({ title: 'Tuning' });
  debug?.attachGui(gui); // move panel top-left + add the View (mode-switch) folder

  // Sun brightness — live multiplier (1x..10x the base 2.6) so a better value can be dialled in on d2.
  const sunParams = { brightness: lighting.sunMult };
  const sunf = gui.addFolder('Sun');
  sunf.add(sunParams, 'brightness', 1, 10, 0.1).name('brightness ×').onChange((v) => lighting.setSunIntensity(v));
  // Engine light spill — real PointLights at the nozzles (peak = full throttle, idle = at rest).
  const el = lighting.thrusterParams;
  const elf = gui.addFolder('Engine Lights');
  elf.add(el, 'peak', 0, 80, 1).name('peak intensity');
  elf.add(el, 'idle', 0, 20, 0.5).name('idle intensity');
  elf.add(el, 'distance', 2, 60, 0.5).name('reach').onChange(() => lighting.setThrusterParams({}));
  elf.addColor(el, 'color').name('color').onChange(() => lighting.setThrusterParams({}));
  elf.close();

  // Shadows / quality — the FPS-driven tier (0=all shadows off .. 5=ultra) with a manual override.
  const qf = gui.addFolder('Shadows / Quality');
  const qParams = { auto: true, tier: quality.tier };
  qf.add(qParams, 'auto').name('auto-scale (FPS)').onChange((v) => { if (v) quality.setAuto(); });
  qf.add(qParams, 'tier', 0, quality.tierCount - 1, 1).name('tier (manual)').onChange((v) => { qParams.auto = false; quality.setTier(v); });
  qf.add(lighting.transientParams, 'intensity', 0, 400, 5).name('transient light');
  qf.close();

  const tp = thrusters.params;
  const relayout = () => thrusters.setParams({});
  const tf = gui.addFolder('Thrusters');
  tf.add(tp, 'offsetX', 0, 6, 0.01).name('offset ±X').onChange(relayout);
  tf.add(tp, 'offsetY', -3, 3, 0.01).name('offset Y').onChange(relayout);
  tf.add(tp, 'offsetZ', -5, 5, 0.01).name('offset Z').onChange(relayout);
  tf.add(tp, 'length', 0.2, 3, 0.01);
  tf.add(tp, 'width', 0.2, 3, 0.01);
  tf.add(tp, 'intensity', 0, 2, 0.01);
  const cf = gui.addFolder('Camera');
  cf.add(flight, 'camDist', 6, 50, 0.5).name('distance (wheel)').listen();
  cf.add(flight, 'heightRatio', 0, 1, 0.02).name('height ratio');

  // Chig thrusters — tweaks the 3 rear glows on the template + every live enemy.
  const relayoutChig = () => {
    if (chigKit) layoutChigGlows(chigKit.template, chigThruster);
    if (enemyMgr) for (const e of enemyMgr.enemies) layoutChigGlows(e.obj, chigThruster);
  };
  const ct = gui.addFolder('Chig Thrusters');
  ct.add(chigThruster, 'x', 0, 2, 0.02).name('base half-width').onChange(relayoutChig);
  ct.add(chigThruster, 'y', -1.5, 1, 0.02).name('offset Y').onChange(relayoutChig);
  ct.add(chigThruster, 'z', 0, 3, 0.02).name('offset Z').onChange(relayoutChig);
  ct.add(chigThruster, 'topZ', -2, 2, 0.02).name('top extra Z').onChange(relayoutChig);
  ct.add(chigThruster, 'size', 0.05, 1.5, 0.01).name('glow size').onChange(relayoutChig);
  const rimU = chigKit && chigKit.material && chigKit.material.userData.rimUniforms;
  if (rimU) {
    ct.add(rimU.uRimStrength, 'value', 0, 1.5, 0.05).name('rim strength');
    ct.add(rimU.uRimPower, 'value', 0.5, 6, 0.1).name('rim power');
  }
  ct.close();

  // Player cannon — fire rate, gimbal, and the gun exit point (muzzle).
  if (cannon) {
    const gf = gui.addFolder('Cannon');
    gf.add(cannon.params, 'fireRate', 3, 40, 1).name('rounds/sec');
    gf.add(cannon.params, 'gimbalMax', 0, 1.2, 0.02).name('gimbal yaw');
    gf.add(cannon.params, 'gimbalMaxV', 0, 1, 0.02).name('gimbal down');
    gf.add(cannon.params, 'gimbalUp', 0, 0.8, 0.02).name('gimbal up');
    gf.add(cannon.params, 'switchMargin', 0, 0.5, 0.01).name('target switch');
    gf.add(cannon.params, 'autoTrack').name('auto-track');
    gf.add(cannon.params, 'lead').name('auto-lead');
    gf.add(cannon.params, 'targetRange', 60, 400, 10).name('acquire range');
    gf.add(cannon.params, 'boltScale', 0.2, 2, 0.05).name('bolt size');
    gf.add(cannon.params.muzzle, 'x', -3, 3, 0.05).name('muzzle X');
    gf.add(cannon.params.muzzle, 'y', -3, 3, 0.05).name('muzzle Y');
    gf.add(cannon.params.muzzle, 'z', -8, 0, 0.05).name('muzzle Z');
    gf.close();
  }

  // Enemies + waves
  const ef = gui.addFolder('Enemies');
  ef.add(enemyMgr.params, 'speed', 10, 90, 1);
  ef.add(enemyMgr.params, 'turnRate', 0.5, 4, 0.1).name('turn rate');
  ef.add(enemyMgr.params, 'aimTurnRate', 0.5, 8, 0.1).name('aim turn rate');
  ef.add(enemyMgr.params, 'fireRate', 0.2, 5, 0.1).name('base fire rate');
  ef.add(enemyMgr.params, 'fireRange', 80, 500, 10).name('fire range');
  ef.add(enemyMgr.params, 'passesBeforeDogfight', 0, 5, 1).name('passes->dogfight');
  ef.add(enemyMgr.params, 'maxSpread', 0, 0.5, 0.01).name('inaccuracy spread');
  ef.add(enemyMgr.params, 'jinkStrength', 0, 40, 1).name('evasion jink');
  ef.add(enemyMgr.params, 'persSpread', 0, 1.2, 0.05).name('personality spread');
  ef.close();
  const wf = gui.addFolder('Waves');
  wf.add(waves.params, 'gap', 0, 12, 0.5).name('gap after clear (s)');
  wf.add(waves.params, 'minSize', 1, 8, 1).name('min size');
  wf.add(waves.params, 'maxSize', 1, 12, 1).name('max size');
  wf.add(waves.params, 'spawnDist', 150, 700, 10).name('spawn dist');
  wf.add(waves.params, 'rampRate', 0, 0.3, 0.01).name('difficulty/wave');
  wf.close();

  // Sky — Milky Way band
  const sf = gui.addFolder('Sky');
  sf.add(nebula.uniforms.uMilkyWay, 'value', 0, 0.4, 0.01).name('milky way');
  // (the band orientation is now fixed to the real galactic plane via uMwPole — no tilt slider)
  sf.close();

  // VFX — trigger + tune the volumetric explosions/smoke
  const vf = gui.addFolder('VFX');
  const vfxTest = {
    explode: () => vfx.explosion(ship.pivot.position, 1.4),
    smoke: () => vfx.smoke(ship.pivot.position),
  };
  vf.add(vfxTest, 'explode').name('explosion at ship');
  vf.add(vfxTest, 'smoke').name('smoke puff at ship');
  if (vfx._vol) {
    vf.add(vfx._vol.tunable, 'explSteps', 8, 80, 1).name('expl steps');
    vf.add(vfx._vol.tunable, 'puffSteps', 8, 48, 1).name('puff steps');
    vf.add(vfx._vol.tunable, 'densityMul', 0.2, 3, 0.05).name('density');
    vf.add(vfx._vol.tunable, 'fireSigma', 0.5, 6, 0.1).name('fire thickness');
    vf.add(vfx._vol.tunable, 'smokeSigma', 0.5, 8, 0.1).name('smoke thickness');
  }
  vf.close();

  // Deaths — spawn a chig just ahead and trigger a death sequence so you can watch it (flight only).
  const df = gui.addFolder('Deaths (test)');
  const _fwd = new THREE.Vector3();
  const _rt = new THREE.Vector3();
  function testDeath(type) {
    if (!enemyMgr) return;
    _fwd.set(0, 0, -1).applyQuaternion(ship.pivot.quaternion);
    _rt.set(1, 0, 0).applyQuaternion(ship.pivot.quaternion);
    const pos = ship.pivot.position.clone().addScaledVector(_fwd, 55).addScaledVector(_rt, 6).addScaledVector(THREE.Object3D.DEFAULT_UP, 3);
    const f = enemyMgr.spawnFormation({ count: 1, pos, heading: _fwd.clone(), difficulty: 0.5 });
    if (f.members[0]) enemyMgr.kill(f.members[0], type);
  }
  df.add({ t: () => testDeath('instant') }, 't').name('instant');
  df.add({ t: () => testDeath('spinout') }, 't').name('spin-out (smoking)');
  df.add({ t: () => testDeath('chained') }, 't').name('chained (obliterate)');
  df.add({ t: () => testDeath() }, 't').name('random');
  df.close();

  // Visual placement editor: see/adjust damage zones + RCS ports, log values to bake back into code.
  createEditor(gui, { scene, ship, damage, rcs });
}

init().catch((e) => {
  console.error('[init] failed', e);
  reveal();
});
