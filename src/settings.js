// Pre-game ("AI Skirmish") settings: ship customisation + loadout + difficulty + environment.
// Persisted to localStorage, loaded on boot, applied on Launch. Pure data — no DOM, no THREE.

const KEY = 'd2.skirmish.v1';

export const DEFAULTS = {
  difficulty: 'veteran', // recruit | veteran | ace
  environment: 'groombridge34', // key into ENVIRONMENT
  skin: 'default', // key into a skins registry (livery.js)
  livery: { color: '#7a8694', callsign: 'VANSEN', squadron: 'WILDCARDS' },
  // weapon mounts (visual loadout): inner -> fuel, outer -> missile pair, tip -> long-range missile
  loadout: { innerL: 'fuel', innerR: 'fuel', outerL: 'missile-pair', outerR: 'missile-pair', tipL: 'lr-missile', tipR: 'lr-missile' },
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
    label: 'Groombridge 34', body: 'none',
    nebula: { uColorA: 0x04050f, uColorB: 0x223080, uColorC: 0xd8401f, uBrightness: 0.10, uSaturation: 0.32, uMilkyWay: 0.12 },
    sun: { disc: 560, glow: 2900, halo: 7600, color: 0xffffff, glowAlpha: 1.0, haloAlpha: 1.0 }, // white tint = original baked look
  },
  jupiterTrojans: {
    label: 'Jupiter Trojans', body: 'jupiter',
    nebula: { uColorA: 0x03040c, uColorB: 0x14224a, uColorC: 0x6a4a30, uBrightness: 0.05, uSaturation: 0.42, uMilkyWay: 0.18 },
    // Sol seen from ~5 AU: small, yellow-white, and producing far less corona/halo glow.
    sun: { disc: 300, glow: 720, halo: 0, color: 0xfff4e0, glowAlpha: 0.45, haloAlpha: 0.0 },
  },
  cerberus: {
    label: 'Cerberus', body: 'blackhole',
    nebula: { uColorA: 0x05030a, uColorB: 0x1a1030, uColorC: 0x4a1830, uBrightness: 0.04, uSaturation: 0.45, uMilkyWay: 0.06 },
    sun: { disc: 220, glow: 520, halo: 0, color: 0xcdd0ff, glowAlpha: 0.4, haloAlpha: 0.0 },
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
