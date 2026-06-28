import { detectDevice } from './device.js';

// Framerate-driven quality controller. Owns the single shadow/VFX "tier ladder" and nudges it up or
// down based on smoothed FPS (with hysteresis + a cooldown so the rare recompiles/CSM rebuilds a tier
// change triggers never land on the hot path). Seeded from a device guess so phones start shadow-free.
//
// Each tier sets, in one place:
//   • the sun shadows (CSM on/off, resolution 1024..4096, cascade count)   -> lighting.setSunShadow
//   • how many dynamic shadow-casting lights are live (3..0)               -> lighting.setTransientBudget
//   • whether smoke casts shadows onto the ships                           -> vfx.setSmokeShadows
//   • the volumetric/sprite VFX quality                                    -> vfx.setQuality
//
// Ladder (high -> low). "transient" is the number of proximity shadow spotlights (engines/shots);
// "scale" is the internal render-resolution multiplier (on top of the 1.3 device-pixel-ratio cap) —
// the cheapest lever for this fill-rate-bound demo, so it drops first as the tier falls.
//   5 ultra : scale 1.0 · CSM 4096/3 · transient 3 · smoke-cast · vfx high
//   4 high  : scale 1.0 · CSM 2048/3 · transient 2 · smoke-cast · vfx high
//   3 med   : scale 0.9 · CSM 2048/3 · transient 1 ·            · vfx high
//   2 low   : scale 0.8 · CSM 1024/3 · transient 0 ·            · vfx high
//   1 vlow  : scale 0.7 · NO sun shadows (plain sun) · transient 0 · vfx high
//   0 potato: scale 0.6 · NO shadows at all · transient 0 · vfx low (sprite fallback)

const TIERS = [
  { name: 'potato', scale: 0.6, csm: false, size: 1024, casc: 2, transient: 0, smokeCast: false, vfx: 'low' },
  { name: 'vlow', scale: 0.7, csm: false, size: 1024, casc: 2, transient: 0, smokeCast: false, vfx: 'high' },
  { name: 'low', scale: 0.8, csm: true, size: 1024, casc: 3, transient: 0, smokeCast: false, vfx: 'high' },
  { name: 'med', scale: 0.9, csm: true, size: 2048, casc: 3, transient: 1, smokeCast: false, vfx: 'high' },
  { name: 'high', scale: 1.0, csm: true, size: 2048, casc: 3, transient: 2, smokeCast: false, vfx: 'high' }, // default desktop tier: 2048/3 (was 4096 — 4x less shadow fill, ~identical look)
  { name: 'ultra', scale: 1.0, csm: true, size: 4096, casc: 3, transient: 3, smokeCast: false, vfx: 'high' }, // only the top tier pays for 4096; cascades capped at 3
];

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function deviceStartTier() {
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  const small = Math.min(window.innerWidth, window.innerHeight) < 560;
  // Phones / tiny viewports start shadow-free (vlow); desktop starts High and the controller settles it
  // up to Ultra or down as the measured framerate dictates.
  return mobile || small ? 1 : 4;
}

// STRUCTURAL-tier cadence + hysteresis. The tier is sampled at a fixed ~100ms tick; it only moves when
// `pressure` (below) sits past a threshold for several consecutive ticks, then holds a cooldown. The
// asymmetric holds (fast down, slow up) + the wide pressure dead-zone (UP_PRESS..DOWN_PRESS) are the
// anti-ping-pong guard so the expensive CSM rebuild / render-target resize never thrash.
const TICK = 0.1;       // structural-tier decision cadence (~10x/sec)
const DOWN_HOLD = 3;    // ticks of pinned pressure before stepping a tier DOWN (~0.3s — react fast)
const UP_HOLD = 12;     // ticks of headroom before stepping a tier UP (~1.2s — climb slowly)
const COOLDOWN = 20;    // ticks to wait after any change (~2s) so recompiles/CSM rebuilds settle

// Per-frame GPU-budget controller — the fast reactive layer ON TOP of the tier ladder. A continuous
// `pressure` (0..1), measured from real GPU ms (timer query) when available else wall-clock, drives the
// CHEAP uniform levers (volumetric raymarch steps) EVERY frame, so a transient spike (an explosion) is
// absorbed without a tier change. The structural TIER only moves on SUSTAINED pressure.
const { isMobile: IS_MOBILE } = detectDevice();
const BUDGET_MS = IS_MOBILE ? 14 : 13; // target GPU ms (under the ~16.7ms 60Hz vsync window, with margin)
const WALL_TARGET_MS = 1000 / 57;      // wall-clock fallback (~57fps): only engages on REAL drops (vsync hides GPU headroom)
const DEAD_MS = 1.0;                    // dead-band so we don't chase noise
const ATTACK = 6.0;                     // pressure gain OVER budget  -> rises fast (relieve in a few frames)
const RELEASE = 1.2;                    // pressure gain UNDER budget -> falls slow (climb back cautiously)
const DOWN_PRESS = 0.85;                // tier steps DOWN when pressure stays pinned this high (cheap levers exhausted)
const UP_PRESS = 0.30;                  // tier steps UP when pressure stays this low (real structural headroom)
const AUTO_MAX = TIERS.length - 2;      // auto climbs only to 'high' (2048); 'ultra' (4096) is manual-only — stay lean

export function createQuality({ lighting, vfx, debris, setRenderScale, gpuFrameMs, startTier } = {}) {
  let current = startTier != null ? clamp(startTier, 0, TIERS.length - 1) : deviceStartTier();
  let acc = 0;          // time accumulator -> fires a structural decision every TICK
  let downTicks = 0;
  let upTicks = 0;
  let cooldownTicks = 0;
  let manual = false; // a manual override pins the tier (debug GUI)
  let pressure = 0;     // 0 = lots of GPU headroom, 1 = pegged over the ms budget
  let emaWallMs = 16.7; // wall-clock fallback, seeded at ~60fps

  function apply(i) {
    current = clamp(i, 0, TIERS.length - 1);
    const t = TIERS[current];
    if (setRenderScale) setRenderScale(t.scale);
    lighting.setSunShadow({ enabled: t.csm, size: t.size, casc: t.casc });
    lighting.setTransientBudget(t.transient);
    if (vfx.setSmokeShadows) vfx.setSmokeShadows(t.smokeCast);
    vfx.setQuality(t.vfx);
    if (debris) debris.setQuality(t.vfx); // 'low' (potato) -> no fracture chunks on death
  }

  apply(current);

  // Two-rate controller, run every frame:
  //   1. CHEAP lever (volumetric raymarch steps) follows a continuous `pressure` derived from GPU ms —
  //      absorbs transient spikes (explosions) instantly, no tier change.
  //   2. STRUCTURAL tier (render scale / CSM / transient budget) only snaps on SUSTAINED pressure, after
  //      the cheap levers are exhausted (down) or there's real headroom (up). Debounced + cooled down so
  //      the expensive CSM rebuild / render-target resize never thrash.
  function update(dt) {
    if (dt > 0.2) return; // skip a giant load/hitch frame (would spike pressure spuriously)
    emaWallMs += (dt * 1000 - emaWallMs) * 0.1;
    const gpu = gpuFrameMs ? gpuFrameMs() : 0;
    const useGpu = gpu > 0.05;
    const ms = useGpu ? gpu : emaWallMs;
    const target = useGpu ? BUDGET_MS : WALL_TARGET_MS;
    const err = ms - target;
    if (err > DEAD_MS) pressure += ATTACK * (err - DEAD_MS) * dt;       // over budget -> rise fast
    else if (err < -DEAD_MS) pressure += RELEASE * (err + DEAD_MS) * dt; // under budget -> fall slow
    pressure = clamp(pressure, 0, 1);
    if (vfx && vfx.setLoad) vfx.setLoad(pressure); // the per-frame cheap lever

    if (manual) return;
    acc += dt;
    if (acc < TICK) return;
    acc = 0;
    if (cooldownTicks > 0) { cooldownTicks--; return; }
    if (pressure >= DOWN_PRESS && current > 0) {
      downTicks++;
      upTicks = 0;
      if (downTicks >= DOWN_HOLD) { apply(current - 1); downTicks = 0; cooldownTicks = COOLDOWN; }
    } else if (pressure <= UP_PRESS && current < AUTO_MAX) {
      upTicks++;
      downTicks = 0;
      if (upTicks >= UP_HOLD) { apply(current + 1); upTicks = 0; cooldownTicks = COOLDOWN; }
    } else {
      downTicks = 0; // in the pressure dead-zone -> hold
      upTicks = 0;
    }
  }

  return {
    update,
    get tier() { return current; },
    get tierName() { return TIERS[current].name; },
    get pressure() { return pressure; },
    get gpuMs() { return gpuFrameMs ? gpuFrameMs() : 0; },
    get renderScale() { return TIERS[current].scale; },
    get budget() { return BUDGET_MS; },
    get auto() { return !manual; },
    set auto(v) { manual = !v; },
    setTier(i) { manual = true; apply(i); }, // pin via the debug GUI
    setAuto() { manual = false; },
    tierCount: TIERS.length,
  };
}
