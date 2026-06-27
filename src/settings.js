// Pre-game ("AI Skirmish") settings: ship customisation + loadout + difficulty + environment.
// Persisted to localStorage, loaded on boot, applied on Launch. Pure data — no DOM, no THREE.

const KEY = 'd2.skirmish.v2'; // v2: renamed environments + new 8-point weapon-mount layout

export const DEFAULTS = {
  difficulty: 'veteran', // recruit | veteran | ace
  environment: 'groombridge34', // key into ENVIRONMENT
  skin: 'default', // key into a skins registry (livery.js)
  livery: { color: '#7a8694', callsign: 'VANSEN', squadron: 'WILDCARDS' },
  // Weapon mounts: per wing = 1 fuel (inner) + 3 outer (inner/mid/tip). Outer mounts choose
  // missile-pair | lr-missile | empty; a long-range missile auto-implies the (single) targeting laser.
  loadout: {
    fuelL: 'fuel', L1: 'missile-pair', L2: 'missile-pair', L3: 'lr-missile',
    fuelR: 'fuel', R1: 'missile-pair', R2: 'missile-pair', R3: 'lr-missile',
  },
};

// Difficulty presets -> drive the existing data knobs in waves.js + enemies.js (params).
export const DIFFICULTY = {
  recruit: { label: 'Recruit', waves: { rampRate: 0.05, minSize: 2, maxSize: 4, gap: 4.0 }, enemy: { hp: 22, fireRate: 1.2, maxSpread: 0.11, speed: 34 } },
  veteran: { label: 'Veteran', waves: { rampRate: 0.08, minSize: 3, maxSize: 5, gap: 3.0 }, enemy: { hp: 30, fireRate: 1.8, maxSpread: 0.06, speed: 40 } },
  ace: { label: 'Ace', waves: { rampRate: 0.12, minSize: 4, maxSize: 6, gap: 2.2 }, enemy: { hp: 40, fireRate: 2.4, maxSpread: 0.03, speed: 46 } },
};

// Environment presets -> nebula backdrop uniforms + sun sprite appearance + a background body.
// `body`: 'none' | 'jupiter' | 'blackhole' (built in celestial.js, shown/hidden per environment).
// `sun`: tweaks the existing sun sprites (disc/glow/halo scale + tint + glow alpha) — NOT the light
// direction (kept fixed so lighting stays simple). We iterate on the exact look later.
export const ENVIRONMENT = {
  groombridge34: {
    label: 'Groombridge 34', body: 'none', sunMult: 7, // close binary -> full, warm sunlight
    nebula: { uColorA: 0x04050f, uColorB: 0x223080, uColorC: 0xd8401f, uBrightness: 0.10, uSaturation: 0.32, uMilkyWay: 0.08 },
    sun: { disc: 560, glow: 2900, halo: 7600, color: 0xffffff, glowAlpha: 1.0, haloAlpha: 1.0 }, // white tint = original baked look
  },
  jupiterTrojans: {
    label: 'Jupiter Trojans', body: 'jupiter', sunMult: 1, // ~5 AU from Sol -> much dimmer scene light
    nebula: { uColorA: 0x03040c, uColorB: 0x14224a, uColorC: 0x6a4a30, uBrightness: 0.05, uSaturation: 0.28, uMilkyWay: 0.11 },
    // Sol seen from ~5 AU: small, white, and producing far less corona/halo glow.
    sun: { disc: 280, glow: 620, halo: 0, color: 0xffffff, glowAlpha: 0.4, haloAlpha: 0.0, white: true },
  },
  cerberus: {
    label: 'Cerberus', body: 'blackhole', sunMult: 2,
    nebula: { uColorA: 0x05030a, uColorB: 0x1a1030, uColorC: 0x4a1830, uBrightness: 0.04, uSaturation: 0.40, uMilkyWay: 0.045 },
    sun: { disc: 220, glow: 520, halo: 0, color: 0xeef0ff, glowAlpha: 0.4, haloAlpha: 0.0, white: true },
  },
  tartarus: {
    label: 'Tartarus', body: 'cloudplanet', sunMult: 0.7, // distant white dwarf -> dim
    nebula: { uColorA: 0x05060f, uColorB: 0x182840, uColorC: 0x40342a, uBrightness: 0.05, uSaturation: 0.35, uMilkyWay: 0.10 },
    sun: { disc: 130, glow: 260, halo: 0, color: 0xffffff, glowAlpha: 0.5, haloAlpha: 0.0, white: true }, // small white-dwarf
  },
  achilles: {
    label: 'Achilles System Outer Edge', body: 'none', sunMult: 0.3, // very distant star, barely illuminating
    // deep space: the blue (uColorB) + red (uColorC) background elements at 25%; the Milky Way is the feature
    nebula: { uColorA: 0x04050f, uColorB: 0x080c20, uColorC: 0x361008, uBrightness: 0.05, uSaturation: 0.40, uMilkyWay: 0.13 },
    sun: { disc: 90, glow: 150, halo: 0, color: 0xffffff, glowAlpha: 0.35, haloAlpha: 0.0, white: true },
  },
  ixion: {
    label: 'Ixion', body: 'habitable', sunMult: 5, // inhabited world -> a sun-like star, decent daylight
    nebula: { uColorA: 0x04050f, uColorB: 0x1e2c66, uColorC: 0x8a4a2a, uBrightness: 0.08, uSaturation: 0.34, uMilkyWay: 0.10 },
    sun: { disc: 480, glow: 2200, halo: 5200, color: 0xfff6e8, glowAlpha: 0.85, haloAlpha: 0.7 }, // warm-white G-type
  },
};

const clone = (o) => JSON.parse(JSON.stringify(o));

export function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && typeof s === 'object') {
      // shallow-merge with nested defaults so new fields appear after an update
      return { ...clone(DEFAULTS), ...s, livery: { ...DEFAULTS.livery, ...(s.livery || {}) }, loadout: { ...DEFAULTS.loadout, ...(s.loadout || {}) } };
    }
  } catch (e) { /* ignore corrupt/unavailable storage */ }
  return clone(DEFAULTS);
}

export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* storage may be unavailable */ }
}
