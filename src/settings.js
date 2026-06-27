// Pre-game ("AI Skirmish") settings: ship customisation + loadout + difficulty + environment.
// Persisted to localStorage, loaded on boot, applied on Launch. Pure data — no DOM, no THREE.

const KEY = 'd2.skirmish.v1';

export const DEFAULTS = {
  difficulty: 'veteran', // recruit | veteran | ace
  environment: 'nebula', // key into ENVIRONMENT
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

// Environment presets -> nebula uniforms + sun direction/colour.
export const ENVIRONMENT = {
  nebula: { label: 'Tycho Nebula', nebula: { uColorA: 0x04050f, uColorB: 0x223080, uColorC: 0xd8401f, uBrightness: 0.10, uSaturation: 0.32, uMilkyWay: 0.12 }, sun: { dir: [-55, 30, -30], color: 0xffb070 } },
  deepspace: { label: 'Deep Space', nebula: { uColorA: 0x02030a, uColorB: 0x10183a, uColorC: 0x3a4a80, uBrightness: 0.06, uSaturation: 0.50, uMilkyWay: 0.20 }, sun: { dir: [-40, 20, -60], color: 0xbfd0ff } },
  ember: { label: 'Ember Field', nebula: { uColorA: 0x0a0402, uColorB: 0x5a2410, uColorC: 0xff6a20, uBrightness: 0.14, uSaturation: 0.40, uMilkyWay: 0.08 }, sun: { dir: [-30, 40, -20], color: 0xff9050 } },
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
