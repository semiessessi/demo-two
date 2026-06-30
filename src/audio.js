// Background music via an MP3 (Web Audio). HTMLAudioElement -> MediaElementSource -> Analyser ->
// Gain -> destination. The analyser feeds getAmplitude()/getBands() for the music-reactive visuals.
// Modeled on demo-1's audio manager, but element-sourced (no tracker) so any MP3 dropped at
// /music/track.mp3 works. If that file is missing the manager degrades silently — the demo still runs.

const TRACK_URL = '/music/track.mp3';
const DEFAULT_VOLUME = 0.7;

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

export function createAudioManager() {
  const audioEl = new Audio();
  audioEl.loop = true;
  audioEl.preload = 'auto';
  audioEl.crossOrigin = 'anonymous';
  audioEl.src = TRACK_URL;

  let ctx = null;
  let srcNode = null;
  let analyser = null;
  let gain = null;
  let timeBuf = null;
  let freqBuf = null;

  let available = null; // null = still probing, then true/false
  let started = false;
  let paused = true;
  let muted = false;
  let failed = false;
  let volume = DEFAULT_VOLUME;

  // Probe for the file up front so the UI knows whether to offer audio. Guard against an SPA
  // fallback returning index.html with a 200 (treat HTML as "no track").
  const ready = fetch(TRACK_URL, { method: 'HEAD' })
    .then((r) => {
      const html = /text\/html/.test(r.headers.get('content-type') || '');
      available = r.ok && !html;
      return available;
    })
    .catch(() => {
      available = false;
      return false;
    });
  audioEl.addEventListener('error', () => {
    available = false;
  });

  // Lazily create the shared AudioContext (starts 'suspended' until a user gesture). Split out of
  // buildGraph so SFX can share ONE context even when there's no music track — otherwise ctx would only
  // ever be built by play(), and a missing /music/track.mp3 would leave SFX permanently silent.
  function ensureContext() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
    }
    return ctx;
  }

  function buildGraph() {
    if (srcNode) return;
    ensureContext();
    srcNode = ctx.createMediaElementSource(audioEl);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.8;
    timeBuf = new Uint8Array(analyser.fftSize);
    freqBuf = new Uint8Array(analyser.frequencyBinCount);
    gain = ctx.createGain();
    gain.gain.value = muted ? 0 : volume;
    srcNode.connect(analyser);
    analyser.connect(gain);
    gain.connect(ctx.destination);
  }

  // Must be called inside a user gesture the first time (browser autoplay policy).
  async function play() {
    if (failed) return;
    buildGraph();
    try {
      if (ctx.state === 'suspended') await ctx.resume();
      await audioEl.play();
      paused = false;
      started = true;
    } catch (e) {
      console.warn('[audio] play blocked / unavailable', e);
      if (available === false) failed = true;
    }
  }

  function pause() {
    if (!started) return;
    audioEl.pause();
    paused = true;
  }

  function toggle() {
    if (paused) play();
    else pause();
    return !paused;
  }

  function setVolume(v) {
    volume = clamp01(v);
    if (gain && !muted) gain.gain.value = volume;
  }
  function setMuted(m) {
    muted = m;
    if (gain) gain.gain.value = muted ? 0 : volume;
  }
  function toggleMute() {
    setMuted(!muted);
    return muted;
  }
  function resumeContext() {
    try {
      if (ctx && ctx.state === 'suspended') ctx.resume();
    } catch (_) {
      /* best effort */
    }
  }

  // --- Comms voice (campaign dialogue) ---------------------------------------------------------------
  // Lives here (not sfx.js) so it works regardless of the ?sound SFX gate — dialogue is core to the
  // campaign. A separate 2D voice bus (no spatialisation); the caller scales gain per line.
  const VO_EXTS = ['.mp3', '.ogg', '.wav'];
  let voiceGain = null;
  function voiceBus() {
    ensureContext();
    if (!voiceGain) { voiceGain = ctx.createGain(); voiceGain.gain.value = 1; voiceGain.connect(ctx.destination); }
    return voiceGain;
  }
  // Probe a base path across VO_EXTS, decode the first present one. `base` has NO extension
  // (e.g. '/vo/m1-shakedown/co.checkin'). Returns an AudioBuffer or null (missing -> subtitle-only).
  async function loadVoice(base) {
    ensureContext();
    for (const ext of VO_EXTS) {
      try {
        const r = await fetch(base + ext);
        if (!r.ok) continue;
        if (/text\/html/.test(r.headers.get('content-type') || '')) continue; // SPA fallback = missing
        const ab = await r.arrayBuffer();
        const buf = await new Promise((res) => { try { ctx.decodeAudioData(ab.slice(0), res, () => res(null)); } catch (_) { res(null); } });
        if (buf) return buf;
      } catch (_) { /* try next ext */ }
    }
    return null;
  }
  // Play a decoded voice buffer on the 2D voice bus. Returns a handle {duration, stop, onended}.
  function playVoice(buf, { gain = 1 } = {}) {
    if (!buf) return null;
    ensureContext();
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch (_) {} }
    const bus = voiceBus();
    const src = ctx.createBufferSource(); src.buffer = buf;
    const g = ctx.createGain(); g.gain.value = clamp01(gain);
    src.connect(g).connect(bus);
    let done = false; const cbs = [];
    src.onended = () => { done = true; try { src.disconnect(); g.disconnect(); } catch (_) {} cbs.forEach((c) => c()); };
    try { src.start(); } catch (_) { done = true; }
    return { duration: buf.duration, stop() { try { src.stop(); } catch (_) {} }, onended(cb) { done ? cb() : cbs.push(cb); } };
  }
  // Dip the music under dialogue: multiply the music gain (1 = restore). Smoothed.
  function duck(mult) {
    if (!gain) return;
    const base = muted ? 0 : volume;
    try { gain.gain.setTargetAtTime(base * clamp01(mult), ctx.currentTime, 0.12); } catch (_) { gain.gain.value = base * clamp01(mult); }
  }

  // --- Missile lock tone (synth) ---------------------------------------------------------------------
  // A rising "seeker" beep for the weapon HUD: discrete blips that speed up + climb in pitch as the 3s
  // lock acquires, then a steady solid tone once locked. Lives here (not sfx.js) so it always plays,
  // regardless of the ?sound gate. Caller drives it each frame: progress null/<=0 = off, 0..1 = acquiring,
  // >=1 = locked; `vol` is master×effects.
  let lockGain = null, lockNextBlip = 0, lockSolid = null, lockSolidGain = null;
  function lockBus() {
    ensureContext();
    if (!lockGain) { lockGain = ctx.createGain(); lockGain.gain.value = 1; lockGain.connect(ctx.destination); }
    return lockGain;
  }
  function lockBlip(freq, vol) {
    const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.07);
    o.connect(g).connect(lockBus());
    o.start(t); o.stop(t + 0.085);
    o.onended = () => { try { o.disconnect(); g.disconnect(); } catch (_) {} };
  }
  function lockStopSolid() {
    if (lockSolid) { try { lockSolid.stop(); lockSolid.disconnect(); } catch (_) {} lockSolid = null; }
    if (lockSolidGain) { try { lockSolidGain.disconnect(); } catch (_) {} lockSolidGain = null; }
  }
  function lockTone(progress, vol = 0.22) {
    if (progress == null || progress <= 0) { lockStopSolid(); lockNextBlip = 0; return; }
    ensureContext();
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch (_) {} return; } // needs a gesture first
    const v = clamp01(vol);
    if (progress >= 1) { // locked -> steady solid tone
      if (!lockSolid) {
        lockStopSolid();
        lockSolid = ctx.createOscillator(); lockSolid.type = 'square'; lockSolid.frequency.value = 1380;
        lockSolidGain = ctx.createGain(); lockSolidGain.gain.value = v * 0.8;
        lockSolid.connect(lockSolidGain).connect(lockBus());
        try { lockSolid.start(); } catch (_) {}
      } else if (lockSolidGain) { lockSolidGain.gain.value = v * 0.8; }
      return;
    }
    if (lockSolid) lockStopSolid(); // acquiring -> rising blips
    const now = ctx.currentTime;
    if (now >= lockNextBlip) {
      lockBlip(600 + 760 * progress, v);       // pitch climbs 600 -> ~1360 Hz
      lockNextBlip = now + (0.5 - 0.4 * progress); // interval shortens 0.5s -> 0.1s
    }
  }

  function getAmplitude() {
    if (!analyser) return 0;
    analyser.getByteTimeDomainData(timeBuf);
    let s = 0;
    for (let i = 0; i < timeBuf.length; i++) {
      const v = (timeBuf[i] - 128) / 128;
      s += v * v;
    }
    return Math.sqrt(s / timeBuf.length);
  }

  // [bass, mid, treble], each ~0..1
  const bands = [0, 0, 0];
  function getBands() {
    if (!analyser) {
      bands[0] = bands[1] = bands[2] = 0;
      return bands;
    }
    analyser.getByteFrequencyData(freqBuf);
    const n = freqBuf.length;
    const avg = (a, b) => {
      let s = 0;
      for (let i = a; i < b; i++) s += freqBuf[i];
      return b > a ? s / (b - a) / 255 : 0;
    };
    bands[0] = avg(0, Math.max(1, Math.floor(n * 0.08)));
    bands[1] = avg(Math.floor(n * 0.08), Math.floor(n * 0.35));
    bands[2] = avg(Math.floor(n * 0.35), n);
    return bands;
  }

  return {
    ready,
    ensureContext, // shared AudioContext for SFX (sfx.js) — one user gesture unlocks music + SFX
    play,
    pause,
    toggle,
    setVolume,
    setMuted,
    toggleMute,
    resumeContext,
    loadVoice,
    playVoice,
    duck,
    lockTone, // missile lock seeker tone (rising blips -> solid on lock)
    getAmplitude,
    getBands,
    get isAvailable() {
      return available;
    },
    get isPaused() {
      return paused;
    },
    get isMuted() {
      return muted;
    },
    get isStarted() {
      return started;
    },
    get failed() {
      return failed;
    },
    get volume() {
      return volume;
    },
  };
}
