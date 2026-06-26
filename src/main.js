import * as THREE from 'three';
import GUI from 'lil-gui';
import { createRenderer } from './renderer.js';
import { createNebula } from './nebula.js';
import { buildStarfield } from './starfield.js';
import { loadShip } from './ship.js';
import { createThrusters } from './thruster.js';
import { createFlight } from './flight.js';
import { createAudioManager } from './audio.js';
import { createReactive } from './reactive.js';

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

let ship = null;
let thrusters = null;
let flight = null;
let stars = null;

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
  flight = createFlight(ship.pivot, camera, renderer.domElement);

  // TEMP debug handle for live orientation/thruster tuning
  window.__dbg = { align: ship.align, pivot: ship.pivot, camera, ship, thrusters, flight };
  buildTweakGui();

  startLoop();
  reveal();
}

// --- render loop -----------------------------------------------------------
const clock = new THREE.Clock();
let fps = 60;

function startLoop() {
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);

    const res = flight.update(dt);
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
  } else if (e.code === 'KeyF') {
    setStats(!statsOn);
  }
});

window.addEventListener('pagehide', () => flight?.dispose?.(), { once: true });

// Live tuning panel (lil-gui): hand-align the two thrusters and tweak the chase camera.
function buildTweakGui() {
  const gui = new GUI({ title: 'Tuning' });
  const tp = thrusters.params;
  const relayout = () => thrusters.setParams({});
  const tf = gui.addFolder('Thrusters');
  tf.add(tp, 'offsetX', 0, 6, 0.05).name('offset ±X').onChange(relayout);
  tf.add(tp, 'offsetY', -3, 3, 0.05).name('offset Y').onChange(relayout);
  tf.add(tp, 'offsetZ', -5, 5, 0.05).name('offset Z').onChange(relayout);
  tf.add(tp, 'length', 0.2, 3, 0.05);
  tf.add(tp, 'width', 0.2, 3, 0.05);
  tf.add(tp, 'intensity', 0, 2, 0.05);
  const cf = gui.addFolder('Camera');
  cf.add(flight, 'camDist', 6, 50, 0.5).name('distance (wheel)').listen();
  cf.add(flight, 'heightRatio', 0, 1, 0.02).name('height ratio');
}

init().catch((e) => {
  console.error('[init] failed', e);
  reveal();
});
