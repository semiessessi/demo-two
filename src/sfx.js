import * as THREE from 'three';

// Sound effects via Web Audio, sharing audio.js's AudioContext (so ONE user gesture unlocks music + SFX).
// Files live in /public/sfx/. Everything degrades silently if a file is missing — the demo still runs.
//   • explosion1..3.mp3 — random-picked per blast (CC0; bundled)
//   • engine.mp3        — a single looping hum whose gain/pitch rises with thrust (CC0; bundled)
//   • cannon.mp3        — OPTIONAL weapon shot; ships absent so the user can drop in his own authentic sample
// Spatialised cheaply from the CAMERA: ~1/distance gain (hard fade by MAX) + stereo pan from the camera's
// right axis. A voice cap + a master compressor keep stacked chained-death blasts from clipping.

// Each sound is a basename; we try these extensions in order and use the first that's present. That lets
// the bundled CC0 .wav files work today AND lets you drop in a higher-quality .mp3/.ogg later (it wins).
const MANIFEST = {
  explosions: ['/sfx/explosion1', '/sfx/explosion2', '/sfx/explosion3', '/sfx/explosion4', '/sfx/explosion5', '/sfx/explosion6'],
  engine: '/sfx/engine',
  cannon: '/sfx/cannon',
  gun: '/sfx/gun', // the Hammerhead cannon — a short sample looped + gain-gated while the trigger is down
  flybys: ['/sfx/chig-flyby-1', '/sfx/chig-flyby-2'], // Chig whoosh past the camera (random-picked; add more variants here)
  chigShot: '/sfx/chig-shot', // Chig weapon shot — one-shot per enemy bolt (voice-capped so it can't starve booms)
};
const EXTS = ['.wav', '.mp3', '.ogg']; // .wav first (the bundled format) -> no 404 spam probing .mp3/.ogg that aren't there

const MAX_VOICES = 12;
const REF_DIST = 120; // full volume within this range of the camera (was 80 — the furball sat past it -> too quiet)
const ROLLOFF = 0.45; // <1 softens the inverse-distance falloff so the whole furball stays audible
const MAX_DIST = 1400; // gentle fade to silence by here
const ENGINE_LEVEL = 0.85; // overall jet-engine ceiling — present but sits under the action/music
const GUN_LEVEL = 0.5;    // player's own cannon loop — prominent (NOT distance-attenuated; it's at the camera)
const GUN_HOLD = 0.13;    // seconds one shot sustains the loop — bridges inter-shot gaps + leaves a short release tail
const DEFAULT_MASTER = 1.0;

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

// Fetch raw bytes; treat !ok and an SPA-fallback text/html 200 as "missing".
async function fetchBuf(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    if (/text\/html/.test(r.headers.get('content-type') || '')) return null;
    return await r.arrayBuffer();
  } catch (_) {
    return null;
  }
}

// First present file across EXTS for a basename (e.g. '/sfx/engine' -> engine.mp3 || engine.ogg || engine.wav).
async function fetchFirst(base) {
  for (const ext of EXTS) {
    const b = await fetchBuf(base + ext);
    if (b) return b;
  }
  return null;
}

export function createSfx({ getContext, camera, masterGain = DEFAULT_MASTER, enabled = true } = {}) {
  // SFX are opt-in for now (gated by ?sound in main.js). When disabled, return an inert stub so no files
  // are even probed and every call site is a cheap no-op.
  if (!enabled) {
    return {
      ready: Promise.resolve(0),
      unlock() {}, onExplosion() {}, flyby() {}, chigShot() {}, weaponFire() {}, engine() {}, gunFiring() {}, gunTick() {}, setMasterGain() {},
      get isUnlocked() { return false; },
    };
  }

  let ctx = null;
  let unlocked = false;
  let master = masterGain;

  // raw bytes, loaded up front (decode needs a live context -> deferred to unlock())
  let rawExplosions = [];
  let rawEngine = null;
  let rawCannon = null;
  let rawGun = null;
  let rawFlybys = [];
  let rawChigShot = null;

  // decoded buffers + graph nodes (built in unlock())
  let expBuffers = [];
  let flybyBuffers = [];
  let chigShotBuf = null;
  let engineBuf = null;
  let cannonBuf = null;
  let busGain = null;
  let engineSrc = null;
  let engineGain = null;
  let gunSrc = null;
  let gunGain = null;
  let gunHold = 0; // counts down each gunTick; >0 keeps the gun loop audible (refreshed per shot by gunFiring)
  let voices = 0;

  const _camPos = new THREE.Vector3();
  const _camRight = new THREE.Vector3();
  const _toSrc = new THREE.Vector3();

  // probe + load everything we ship with; resolves to how many sounds are present
  const ready = (async () => {
    const [exp, eng, can, gun, fly, cs] = await Promise.all([
      Promise.all(MANIFEST.explosions.map(fetchFirst)),
      fetchFirst(MANIFEST.engine),
      fetchFirst(MANIFEST.cannon),
      fetchFirst(MANIFEST.gun),
      Promise.all(MANIFEST.flybys.map(fetchFirst)),
      fetchFirst(MANIFEST.chigShot),
    ]);
    rawExplosions = exp.filter(Boolean);
    rawEngine = eng;
    rawCannon = can;
    rawGun = gun;
    rawFlybys = fly.filter(Boolean);
    rawChigShot = cs;
    return rawExplosions.length + (rawEngine ? 1 : 0) + (rawCannon ? 1 : 0) + (rawGun ? 1 : 0) + rawFlybys.length + (rawChigShot ? 1 : 0);
  })();

  function decode(ab) {
    return new Promise((res) => {
      try {
        // callback form (universally supported); slice() so the stored bytes aren't detached
        ctx.decodeAudioData(ab.slice(0), (b) => res(b), () => res(null));
      } catch (_) {
        res(null);
      }
    });
  }

  // Called from the first user gesture (after audio.ensureContext()/resumeContext()). Builds the graph and
  // decodes the buffers on the now-live context.
  async function unlock() {
    if (unlocked) return;
    unlocked = true;
    ctx = getContext ? getContext() : null;
    if (!ctx) return;
    busGain = ctx.createGain();
    busGain.gain.value = master;
    const comp = ctx.createDynamicsCompressor(); // gentle glue — tame stacked blasts WITHOUT pumping the gun under every boom
    comp.threshold.value = -8;  // only the loudest peaks engage it -> the mix breathes + explosions punch through (was -16, squashing everything flat)
    comp.knee.value = 18;
    comp.ratio.value = 3.5;     // far gentler than the 12:1 default (which audibly ducked the gun on each explosion)
    comp.attack.value = 0.004;
    comp.release.value = 0.18;
    busGain.connect(comp);
    comp.connect(ctx.destination);

    await ready;
    expBuffers = (await Promise.all(rawExplosions.map(decode))).filter(Boolean);
    flybyBuffers = (await Promise.all(rawFlybys.map(decode))).filter(Boolean);
    chigShotBuf = rawChigShot ? await decode(rawChigShot) : null;
    engineBuf = rawEngine ? await decode(rawEngine) : null;
    cannonBuf = rawCannon ? await decode(rawCannon) : null;
    const gunBuf = rawGun ? await decode(rawGun) : null;

    if (engineBuf) {
      engineSrc = ctx.createBufferSource();
      engineSrc.buffer = engineBuf;
      engineSrc.loop = true;
      engineGain = ctx.createGain();
      engineGain.gain.value = 0; // silent until engine() raises it
      engineSrc.connect(engineGain).connect(busGain);
      try { engineSrc.start(); } catch (_) {}
    }
    if (gunBuf) {
      // one continuously-looping voice, gain-gated by gunTick — the player's own cannon, so no spatialisation
      gunSrc = ctx.createBufferSource();
      gunSrc.buffer = gunBuf;
      gunSrc.loop = true;
      gunGain = ctx.createGain();
      gunGain.gain.value = 0; // silent until the trigger is down
      gunSrc.connect(gunGain).connect(busGain);
      try { gunSrc.start(); } catch (_) {}
    }
  }

  // one-shot voice: gentle inverse-distance gain + distance muffling (far booms lose their highs and become
  // rumble) + stereo pan from the camera's right axis -> bus.
  function playOneShot(buffer, pos, base, rateLo, rateRange, voiceCap = MAX_VOICES) {
    if (!ctx || ctx.state !== 'running' || !buffer) return;
    if (voices >= voiceCap) return; // low-priority sounds (Chig shots) pass a smaller cap -> reserve voices for booms
    _camPos.copy(camera.position);
    const d = pos.distanceTo(_camPos);
    const inv = d <= REF_DIST ? 1 : REF_DIST / (REF_DIST + ROLLOFF * (d - REF_DIST));
    const far = clamp01((MAX_DIST - d) / 300); // only ramps down in the last 300u before MAX
    const g = inv * Math.min(1, far) * base;
    if (g < 0.01) return;
    _camRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
    _toSrc.copy(pos).sub(_camPos);
    if (_toSrc.lengthSq() > 1e-6) _toSrc.normalize();
    const pan = clamp(_camRight.dot(_toSrc), -1, 1) * 0.8;
    const fc = 18000 - 11500 * clamp01((d - REF_DIST) / 1100); // near = full band, far = a gentle ~6.5kHz roll-off (was muffled to ~600Hz -> sounded muted)
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rateLo + Math.random() * rateRange;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = fc;
    const gn = ctx.createGain();
    gn.gain.value = g;
    const pn = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    src.connect(lp).connect(gn);
    if (pn) { pn.pan.value = pan; gn.connect(pn); pn.connect(busGain); }
    else gn.connect(busGain);
    voices++;
    src.onended = () => { voices--; try { src.disconnect(); lp.disconnect(); gn.disconnect(); if (pn) pn.disconnect(); } catch (_) {} };
    try { src.start(); } catch (_) { voices--; }
  }

  function onExplosion(pos, scale = 1) {
    try {
      if (!expBuffers.length) return;
      // rate biased BELOW 1 (0.72-1.0) -> pitched down -> deeper/longer; 6 source variants for variety
      playOneShot(expBuffers[(Math.random() * expBuffers.length) | 0], pos, 1.0 + 0.75 * scale, 0.72, 0.28);
    } catch (_) { /* never throw into the render loop */ }
  }

  // A Chig sweeping past the camera. speed01 (0..1) brightens + slightly pitches up the whoosh (doppler-ish).
  // Spatialised + panned by playOneShot from the Chig's position, so it sweeps across the stereo field.
  function flyby(pos, speed01 = 0.5) {
    try {
      if (!flybyBuffers.length) return;
      const s = clamp01(speed01);
      playOneShot(flybyBuffers[(Math.random() * flybyBuffers.length) | 0], pos, 0.6 + 0.5 * s, 0.92 + 0.22 * s, 0.06);
    } catch (_) {}
  }

  // A Chig firing its pulse cannon — one-shot per bolt, spatialised + panned. Capped at 7 concurrent voices
  // so a swarm's worth of enemy fire can't starve explosions/flybys out of the 12-voice pool.
  function chigShot(pos) {
    try {
      if (!chigShotBuf) return;
      playOneShot(chigShotBuf, pos, 0.7, 0.9, 0.2, 8); // was 0.35 -> too quiet to pick out; cap 8 leaves 4 voices for booms
    } catch (_) {}
  }

  // silent until the user drops a /sfx/cannon.mp3 in — then it just works
  function weaponFire(pos) {
    try {
      if (!cannonBuf) return;
      playOneShot(cannonBuf, pos, 0.5, 0.94, 0.12);
    } catch (_) {}
  }

  // call once per frame with 0..1 thrust; smooths gain + a little pitch lift on boost
  function engine(thrust01) {
    if (!engineGain || !ctx || ctx.state !== 'running') return;
    const t = clamp01(thrust01);
    const target = (0.26 + 0.48 * t) * ENGINE_LEVEL; // audible idle, spools up with thrust
    try {
      engineGain.gain.setTargetAtTime(target, ctx.currentTime, 0.12);
      if (engineSrc) engineSrc.playbackRate.setTargetAtTime(0.85 + 0.4 * t, ctx.currentTime, 0.15);
    } catch (_) {
      engineGain.gain.value = target;
    }
  }

  // The cannon fired a shot this frame — refresh the hold so the loop stays up. Called per bolt (onFire).
  function gunFiring() {
    gunHold = GUN_HOLD;
  }

  // Call once per frame: decay the hold and gate the loop's gain (fast attack so it kicks in on the first
  // shot, slower release so it tails off naturally a beat after the trigger releases).
  function gunTick(dt) {
    if (!gunGain || !ctx || ctx.state !== 'running') return;
    if (gunHold > 0) gunHold = Math.max(0, gunHold - dt);
    const firing = gunHold > 0;
    try {
      gunGain.gain.setTargetAtTime(firing ? GUN_LEVEL : 0, ctx.currentTime, firing ? 0.008 : 0.05);
    } catch (_) {
      gunGain.gain.value = firing ? GUN_LEVEL : 0;
    }
  }

  function setMasterGain(v) {
    master = clamp01(v);
    if (busGain) busGain.gain.value = master;
  }

  return {
    ready,
    unlock,
    onExplosion,
    flyby,
    chigShot,
    weaponFire,
    engine,
    gunFiring,
    gunTick,
    setMasterGain,
    get isUnlocked() { return unlocked; },
  };
}
