import * as THREE from 'three';
import GUI from 'lil-gui';
import { createRenderer } from './renderer.js';
import { createNebula } from './nebula.js';
import { buildStarfield } from './starfield.js';
import { loadShip } from './ship.js';
import { loadChig, layoutChigGlows, chigThruster } from './enemyShip.js';
import { createThrusters } from './thruster.js';
import { createFlight } from './flight.js';
import { createAudioManager } from './audio.js';
import { createReactive } from './reactive.js';
import { createInput } from './input.js';
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

// Debug tooling (the lil-gui tuning panel, FPS overlay, window.__dbg) is local-dev only —
// shown on the Vite dev server and any localhost origin, never on the deployed site.
const DEBUG =
  import.meta.env.DEV ||
  ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);

// --- renderer + scene ------------------------------------------------------
const app = document.getElementById('app');
const { renderer, scene, camera, composer, bloom, render } = createRenderer(app);

// Lighting: a warm orange "sun" as the main light, a cool rim from the opposite side for separation,
// and a dim hemisphere fill so shadowed sides aren't pure black.
const key = new THREE.DirectionalLight(0xffb070, 2.6); // warm sun; now that the hull has diffuse, this reads as proper sunlight
key.position.set(-55, 30, -30); // direction the sunlight comes FROM (front-left so the sun is in view)
scene.add(key);
const rim = new THREE.DirectionalLight(0xb8b8b8, 0.7); // neutral grey back-light (was blue)
rim.position.set(45, -8, 40);
scene.add(rim);
scene.add(new THREE.HemisphereLight(0x6e6e74, 0x141414, 0.95)); // neutral grey fill (was blue-tinted)

// Visible sun disc in the sky, in the key-light's direction, kept at infinity (moved with the
// camera). Bright + warm so it blooms.
const sunDir = new THREE.Vector3().copy(key.position).normalize();
const sun = makeSprite(sunGradient, 560, -5); // the bright disc
const sunGlow = makeSprite(glowGradient, 2900, -6); // soft warm corona, ~5x the disc diameter
const sunHalo = makeSprite(haloGradient, 7600, -7); // huge faint wash over ~1/3 of the sky
scene.add(sunHalo);
scene.add(sunGlow);
scene.add(sun);

function makeCanvasTex(paint) {
  const s = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  paint(g);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
function sunGradient(g) {
  g.addColorStop(0.0, 'rgba(255,250,238,1)');
  g.addColorStop(0.13, 'rgba(255,212,150,1)');
  g.addColorStop(0.32, 'rgba(255,140,60,0.7)');
  g.addColorStop(0.65, 'rgba(255,96,34,0.16)');
  g.addColorStop(1.0, 'rgba(255,70,24,0)');
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
function makeSprite(paint, scale, order) {
  const spr = new THREE.Sprite(
    // depthTest true so the ship occludes the sun when it passes in front (and so the sun, like the
    // stars, doesn't paint over the opaque hull in the transparent pass).
    new THREE.SpriteMaterial({ map: makeCanvasTex(paint), blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true, transparent: true }),
  );
  spr.scale.setScalar(scale);
  spr.renderOrder = order;
  spr.frustumCulled = false;
  return spr;
}

// --- backdrop --------------------------------------------------------------
const nebula = createNebula();
scene.add(nebula.mesh);
const starUniforms = {
  uTime: { value: 0 },
  uStarSize: { value: 1.2 }, // halved max sprite size (user request)
  uStarTwinkle: { value: 0.0 }, // no twinkle — it's space
};

const reactive = createReactive();
const audio = createAudioManager();
const input = createInput();

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
let flight = null;
let stars = null;
let chigKit = null;
let enemyMgr = null;
let waves = null;
let debug = null;

// Re-arm a fresh fight after a mission ends (called by gameState.restart()).
function restartWorld() {
  ship.pivot.position.set(0, 0, 0);
  ship.pivot.quaternion.identity();
  damage.reset();
  enemyMgr.reset();
  projectiles.reset();
  waves.reset();
  flight.setSpeedScale(1);
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
  flight = createFlight(ship.pivot, camera, renderer.domElement, input);

  projectiles = createProjectiles(scene);
  cannon = createPlayerCannon(scene, ship, projectiles, { getEnemies: () => (enemyMgr ? enemyMgr.enemies : []) });

  chigKit = await loadChig();
  enemyMgr = createEnemyManager(scene, chigKit, projectiles);
  waves = createWaveManager(enemyMgr);
  vfx = createVfx(scene);
  combat = createCombat(projectiles, enemyMgr, vfx, {
    getPlayerPos: () => ship.pivot.position,
    playerHitRadius: ship.radius * 0.85,
  });
  damage = createDamageModel(ship);
  combat.setOnPlayerHit((pt, dmg) => damage.applyHit(pt, dmg));

  hud = createHud(damage, { getKills: () => enemyMgr.kills, onRestart: () => gameState.restart() });
  targetDisplay = createTargetDisplay(chigKit.template);
  gameState = createGameState({ ship, camera, flight, hud, vfx, onRestart: restartWorld });
  damage.setCallbacks({ onEject: () => gameState.eject(), onDestroyed: () => gameState.destroyed() });

  if (DEBUG) {
    // debug handle + live-tuning GUI — local dev only, never on the deployed site
    window.__dbg = { align: ship.align, pivot: ship.pivot, camera, ship, thrusters, flight, enemyMgr, waves, damage, cannon, gameState, targetDisplay };
    debug = createDebug({
      renderer, scene, camera, render, bloom,
      ship, chigKit, flight, thrusters,
      lights: { key, rim }, sun, sunGlow, nebula, stars,
    });
    window.__dbg.debug = debug;
    buildTweakGui();
    setStats(true); // show the FPS counter by default in debug
  }

  startLoop();
  reveal();
}

// --- render loop -----------------------------------------------------------
const clock = new THREE.Clock();
let fps = 60;

function startLoop() {
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    if (DEBUG && debug && debug.frame(dt)) return; // debug viewer modes own the frame

    input.poll(); // keyboard + gamepad -> shared signals (read by flight + cannon)
    const flying = gameState.mode === 'flying';
    let res = { throttle: 0, speed: 0, boosting: false };
    if (flying) {
      flight.setSpeedScale(damage.speedScale()); // engine damage cuts top speed
      res = flight.update(dt);
    }

    // player transform for the combat systems
    playerFwd.set(0, 0, -1).applyQuaternion(ship.pivot.quaternion);
    playerVel.copy(playerFwd).multiplyScalar(res.speed);
    const player = { pos: ship.pivot.position, quat: ship.pivot.quaternion, vel: playerVel };
    if (flying) updateAimHud(cannon.update(dt, input, player));
    else hud.setTarget(0, 0, false);
    enemyMgr.update(dt, player);
    if (gameState.mode !== 'over') waves.update(dt, player);
    projectiles.update(dt);
    combat.update();
    if (flying) damage.update(dt, vfx);
    vfx.update(dt);
    enemyMgr.prune();
    gameState.update(dt, input);
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

    // keep the backdrop centred on the camera so it sits at infinity (no parallax)
    nebula.mesh.position.copy(camera.position);
    stars.position.copy(camera.position);
    sun.position.copy(camera.position).addScaledVector(sunDir, 3600);
    sunGlow.position.copy(camera.position).addScaledVector(sunDir, 3650);
    sunHalo.position.copy(camera.position).addScaledVector(sunDir, 3700);
    nebula.uniforms.uTime.value += dt;
    starUniforms.uTime.value += dt;

    render();

    fps += (1 / Math.max(dt, 1e-3) - fps) * 0.1;
    if (statsOn) statsEl.textContent = `${fps.toFixed(0)} fps\n${(res.speed | 0)} u/s`;
  });
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

let revealed = false;
function reveal() {
  if (revealed) return;
  revealed = true;
  fadeEl?.classList.add('gone');
}
setTimeout(reveal, 8000); // safety net if a frame never lands

// show the controls panel briefly on load, then retract
infoEl?.classList.add('open');
setTimeout(() => infoEl?.classList.remove('open'), 6500);
setTimeout(() => toastEl?.classList.add('show'), 7000);
setTimeout(() => toastEl?.classList.remove('show'), 11000);

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
  audio.resumeContext();
  if (audio.isAvailable !== false) audio.play().then(setPlayIcon);
  startEl?.classList.add('hidden');
}
window.addEventListener('pointerdown', firstGesture);
window.addEventListener('keydown', firstGesture, { once: false });

// Reveal the "click for sound" prompt only if there is actually a track to play.
audio.ready.then((ok) => {
  if (ok && !gestured) startEl?.classList.remove('hidden');
  if (!ok) {
    // no MP3 present — make the audio controls clearly inert
    if (playBtn) playBtn.style.opacity = '0.4';
    const label = document.getElementById('label');
    if (label) label.textContent = 'SA-43 Hammerhead · (drop an MP3 for music)';
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
  } else if (DEBUG && e.code === 'KeyF') {
    setStats(!statsOn);
  }
});

window.addEventListener('pagehide', () => flight?.dispose?.(), { once: true });

// Live tuning panel (lil-gui): hand-align the two thrusters and tweak the chase camera.
function buildTweakGui() {
  const gui = new GUI({ title: 'Tuning' });
  debug?.attachGui(gui); // move panel top-left + add the View (mode-switch) folder
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
  sf.add(nebula.uniforms.uMwTilt, 'value', -1.6, 1.6, 0.02).name('mw tilt');
  sf.close();
}

init().catch((e) => {
  console.error('[init] failed', e);
  reveal();
});
