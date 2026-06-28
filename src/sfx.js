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
  explosions: ['/sfx/explosion1', '/sfx/explosion2', '/sfx/explosion3'],
  engine: '/sfx/engine',
  cannon: '/sfx/cannon',
};
const EXTS = ['.mp3', '.ogg', '.wav'];

const MAX_VOICES = 12;
const REF_DIST = 30; // full volume within this range of the camera
const MAX_DIST = 600; // silent beyond this
const ENGINE_LEVEL = 0.6; // overall engine-hum ceiling — kept low so it sits under the music
const DEFAULT_MASTER = 0.9;

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

export function createSfx({ getContext, camera, masterGain = DEFAULT_MASTER } = {}) {
  let ctx = null;
  let unlocked = false;
  let master = masterGain;

  // raw bytes, loaded up front (decode needs a live context -> deferred to unlock())
  let rawExplosions = [];
  let rawEngine = null;
  let rawCannon = null;

  // decoded buffers + graph nodes (built in unlock())
  let expBuffers = [];
  let engineBuf = null;
  let cannonBuf = null;
  let busGain = null;
  let engineSrc = null;
  let engineGain = null;
  let voices = 0;

  const _camPos = new THREE.Vector3();
  const _camRight = new THREE.Vector3();
  const _toSrc = new THREE.Vector3();

  // probe + load everything we ship with; resolves to how many sounds are present
  const ready = (async () => {
    const [exp, eng, can] = await Promise.all([
      Promise.all(MANIFEST.explosions.map(fetchFirst)),
      fetchFirst(MANIFEST.engine),
      fetchFirst(MANIFEST.cannon),
    ]);
    rawExplosions = exp.filter(Boolean);
    rawEngine = eng;
    rawCannon = can;
    return rawExplosions.length + (rawEngine ? 1 : 0) + (rawCannon ? 1 : 0);
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
    const comp = ctx.createDynamicsCompressor(); // tame stacked blasts
    busGain.connect(comp);
    comp.connect(ctx.destination);

    await ready;
    expBuffers = (await Promise.all(rawExplosions.map(decode))).filter(Boolean);
    engineBuf = rawEngine ? await decode(rawEngine) : null;
    cannonBuf = rawCannon ? await decode(rawCannon) : null;

    if (engineBuf) {
      engineSrc = ctx.createBufferSource();
      engineSrc.buffer = engineBuf;
      engineSrc.loop = true;
      engineGain = ctx.createGain();
      engineGain.gain.value = 0; // silent until engine() raises it
      engineSrc.connect(engineGain).connect(busGain);
      try { engineSrc.start(); } catch (_) {}
    }
  }

  function spatialGain(pos, base) {
    _camPos.copy(camera.position);
    const d = pos.distanceTo(_camPos);
    const g = (REF_DIST / Math.max(REF_DIST, d)) * clamp01((MAX_DIST - d) / MAX_DIST);
    return g * base; // master is applied at the bus, not per-voice
  }

  function spatialPan(pos) {
    _camRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
    _toSrc.copy(pos).sub(camera.position);
    if (_toSrc.lengthSq() > 1e-6) _toSrc.normalize();
    return clamp(_camRight.dot(_toSrc), -1, 1) * 0.8;
  }

  // one-shot voice through optional stereo pan -> bus
  function playOneShot(buffer, pos, base, rateLo, rateRange) {
    if (!ctx || ctx.state !== 'running' || !buffer) return;
    if (voices >= MAX_VOICES) return;
    const g = spatialGain(pos, base);
    if (g < 0.01) return;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rateLo + Math.random() * rateRange;
    const gn = ctx.createGain();
    gn.gain.value = g;
    const pn = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    src.connect(gn);
    if (pn) { pn.pan.value = spatialPan(pos); gn.connect(pn); pn.connect(busGain); }
    else gn.connect(busGain);
    voices++;
    src.onended = () => { voices--; try { src.disconnect(); gn.disconnect(); if (pn) pn.disconnect(); } catch (_) {} };
    try { src.start(); } catch (_) { voices--; }
  }

  function onExplosion(pos, scale = 1) {
    try {
      if (!expBuffers.length) return;
      playOneShot(expBuffers[(Math.random() * expBuffers.length) | 0], pos, 0.6 + 0.5 * scale, 0.82, 0.36);
    } catch (_) { /* never throw into the render loop */ }
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
    const target = (0.12 + 0.5 * t) * ENGINE_LEVEL;
    try {
      engineGain.gain.setTargetAtTime(target, ctx.currentTime, 0.12);
      if (engineSrc) engineSrc.playbackRate.setTargetAtTime(0.85 + 0.4 * t, ctx.currentTime, 0.15);
    } catch (_) {
      engineGain.gain.value = target;
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
    weaponFire,
    engine,
    setMasterGain,
    get isUnlocked() { return unlocked; },
  };
}
