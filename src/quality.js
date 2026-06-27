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
// Ladder (high -> low). "transient" is the number of proximity shadow spotlights (engines/shots).
//   5 ultra : CSM 4096/4 · transient 3 · smoke-cast · vfx high
//   4 high  : CSM 4096/3 · transient 2 · smoke-cast · vfx high
//   3 med   : CSM 2048/3 · transient 1 ·            · vfx high
//   2 low   : CSM 1024/3 · transient 0 ·            · vfx high
//   1 vlow  : NO sun shadows (plain sun) · transient 0 · vfx high
//   0 potato: NO shadows at all · transient 0 · vfx low (sprite fallback)

const TIERS = [
  { name: 'potato', csm: false, size: 1024, casc: 2, transient: 0, smokeCast: false, vfx: 'low' },
  { name: 'vlow', csm: false, size: 1024, casc: 2, transient: 0, smokeCast: false, vfx: 'high' },
  { name: 'low', csm: true, size: 1024, casc: 3, transient: 0, smokeCast: false, vfx: 'high' },
  { name: 'med', csm: true, size: 2048, casc: 3, transient: 1, smokeCast: false, vfx: 'high' },
  { name: 'high', csm: true, size: 4096, casc: 3, transient: 2, smokeCast: true, vfx: 'high' },
  { name: 'ultra', csm: true, size: 4096, casc: 4, transient: 3, smokeCast: true, vfx: 'high' },
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

export function createQuality({ lighting, vfx, startTier } = {}) {
  let current = startTier != null ? clamp(startTier, 0, TIERS.length - 1) : deviceStartTier();
  let downAcc = 0;
  let upAcc = 0;
  let cooldown = 0;
  let manual = false; // a manual override pins the tier (debug GUI)

  function apply(i) {
    current = clamp(i, 0, TIERS.length - 1);
    const t = TIERS[current];
    lighting.setSunShadow({ enabled: t.csm, size: t.size, casc: t.casc });
    lighting.setTransientBudget(t.transient);
    if (vfx.setSmokeShadows) vfx.setSmokeShadows(t.smokeCast);
    vfx.setQuality(t.vfx);
  }

  apply(current);

  // Step DOWN quickly when FPS sags (relieve pressure); step UP slowly when there's sustained headroom.
  function update(dt, fps) {
    if (manual) return;
    cooldown -= dt;
    if (cooldown > 0) return;
    if (fps < 45 && current > 0) {
      downAcc += dt;
      upAcc = 0;
      if (downAcc > 1.0) { apply(current - 1); downAcc = 0; cooldown = 2.5; }
    } else if (fps > 57 && current < TIERS.length - 1) {
      upAcc += dt;
      downAcc = 0;
      if (upAcc > 4.0) { apply(current + 1); upAcc = 0; cooldown = 2.5; }
    } else {
      downAcc *= 0.9;
      upAcc *= 0.9;
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
