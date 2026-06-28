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

// Decision cadence + hysteresis. We sample at a fixed ~100ms tick (not per-frame, so vsync jitter and
// the framerate itself don't change how reactive we are), require the FPS to sit OUTSIDE a dead-zone
// for several consecutive ticks before moving, and hold a cooldown after every change. The dead-zone
// (DOWN_FPS..UP_FPS) is the core anti-ping-pong guard: a tier-down lands near DOWN_FPS, which is still
// below UP_FPS, so it can't immediately bounce back up.
const TICK = 0.1;       // evaluate ~10x/sec
const DOWN_FPS = 45;    // sustained below this -> shed a tier
const UP_FPS = 57;      // sustained above this -> add a tier (dead-zone 45..57 prevents oscillation)
const DOWN_HOLD = 3;    // ticks of sag before stepping down (~0.3s — react fast to relieve pressure)
const UP_HOLD = 12;     // ticks of headroom before stepping up (~1.2s — climb slowly)
const COOLDOWN = 20;    // ticks to wait after any change (~2s) so recompiles/CSM rebuilds settle

export function createQuality({ lighting, vfx, debris, setRenderScale, startTier } = {}) {
  let current = startTier != null ? clamp(startTier, 0, TIERS.length - 1) : deviceStartTier();
  let acc = 0;          // time accumulator -> fires a decision every TICK
  let downTicks = 0;
  let upTicks = 0;
  let cooldownTicks = 0;
  let manual = false; // a manual override pins the tier (debug GUI)

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

  // Step DOWN quickly when FPS sags (relieve pressure); step UP slowly when there's sustained headroom.
  function update(dt, fps) {
    if (manual) return;
    acc += dt;
    if (acc < TICK) return;
    acc = 0;
    if (cooldownTicks > 0) { cooldownTicks--; return; }
    if (fps < DOWN_FPS && current > 0) {
      downTicks++;
      upTicks = 0;
      if (downTicks >= DOWN_HOLD) { apply(current - 1); downTicks = 0; cooldownTicks = COOLDOWN; }
    } else if (fps > UP_FPS && current < TIERS.length - 1) {
      upTicks++;
      downTicks = 0;
      if (upTicks >= UP_HOLD) { apply(current + 1); upTicks = 0; cooldownTicks = COOLDOWN; }
    } else {
      downTicks = 0; // inside the dead-zone -> reset both; no drift toward a change
      upTicks = 0;
    }
  }

  return {
    update,
    get tier() { return current; },
    get tierName() { return TIERS[current].name; },
    get auto() { return !manual; },
    set auto(v) { manual = !v; },
    setTier(i) { manual = true; apply(i); }, // pin via the debug GUI
    setAuto() { manual = false; },
    tierCount: TIERS.length,
  };
}
