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

  function buildGraph() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
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
    play,
    pause,
    toggle,
    setVolume,
    setMuted,
    toggleMute,
    resumeContext,
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
