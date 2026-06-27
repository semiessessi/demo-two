import { DIFFICULTY, ENVIRONMENT, saveSettings } from './settings.js';

// Pre-game / "AI Skirmish" setup screen — a self-building DOM overlay (same dark glassy style as the
// HUD). Sections: Markings, Loadout, Environment, Difficulty, and Launch. Edits write through to the
// `settings` object + localStorage and fire onChange (so main can live-preview livery/loadout/env on
// the ship behind the panel). Launch hands the finished settings back to main.

function el(tag, css, parent) {
  const e = document.createElement(tag);
  if (css) e.style.cssText = css;
  if (parent) parent.appendChild(e);
  return e;
}

const PANEL = 'background:rgba(12,14,22,0.62);border:1px solid rgba(150,180,255,0.12);border-radius:14px;backdrop-filter:blur(10px);';
const FONT = 'font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#cdd6ea;';
const LABEL = `${FONT}font-size:10px;letter-spacing:0.16em;color:#9fb0d0;margin:0 0 7px 2px;text-transform:uppercase;`;
const BTN = `${FONT}font-size:12px;cursor:pointer;padding:7px 12px;background:rgba(150,180,255,0.08);`
  + 'border:1px solid rgba(150,180,255,0.22);border-radius:8px;transition:all 0.12s;';
const BTN_ON = 'background:rgba(120,170,255,0.32);border-color:rgba(170,210,255,0.7);color:#fff;box-shadow:0 0 10px rgba(120,170,255,0.3);';

// The six weapon mounts + what each may carry (visual loadout for now).
const MOUNTS = [
  { id: 'innerL', label: 'Inner ·L', opts: ['fuel', 'empty'] },
  { id: 'innerR', label: 'Inner ·R', opts: ['fuel', 'empty'] },
  { id: 'outerL', label: 'Outer ·L', opts: ['missile-pair', 'empty'] },
  { id: 'outerR', label: 'Outer ·R', opts: ['missile-pair', 'empty'] },
  { id: 'tipL', label: 'Tip ·L', opts: ['lr-missile', 'empty'] },
  { id: 'tipR', label: 'Tip ·R', opts: ['lr-missile', 'empty'] },
];
const ORD_LABEL = { fuel: 'Fuel tank', 'missile-pair': 'Missile pair', 'lr-missile': 'LR missile', empty: 'Empty' };

export function createPregame({ settings, onLaunch, onChange }) {
  const fire = () => { saveSettings(settings); if (onChange) onChange(settings); };

  const root = el('div', 'position:fixed;inset:0;z-index:200;display:none;pointer-events:none;', document.body);
  // left console panel (clicks land here; the ship shows to the right / behind)
  const panel = el('div', `position:absolute;left:0;top:0;bottom:0;width:340px;padding:22px 20px;overflow-y:auto;`
    + `pointer-events:auto;${PANEL}${FONT}border-radius:0 16px 16px 0;`
    + 'display:flex;flex-direction:column;gap:18px;box-shadow:0 0 40px rgba(0,0,0,0.5);', root);

  el('div', `${FONT}font-size:22px;letter-spacing:0.22em;color:#eaeefc;text-shadow:0 0 16px rgba(120,170,255,0.4);`, panel)
    .textContent = 'AI SKIRMISH';
  el('div', `${FONT}font-size:11px;color:#8a96b4;margin-top:-12px;`, panel)
    .textContent = 'SA-43 Hammerhead · configure & launch';

  // ---- a segmented single-choice row ----
  function segmented(title, options, getCur, setCur) {
    const wrap = el('div', '', panel);
    el('div', LABEL, wrap).textContent = title;
    const row = el('div', 'display:flex;flex-wrap:wrap;gap:6px;', wrap);
    const btns = [];
    options.forEach((o) => {
      const b = el('button', BTN, row);
      b.textContent = o.label;
      b.onclick = () => { setCur(o.key); paint(); fire(); };
      btns.push({ b, key: o.key });
    });
    function paint() {
      const cur = getCur();
      btns.forEach(({ b, key }) => { b.style.cssText = BTN + (key === cur ? BTN_ON : ''); });
    }
    paint();
    return { paint };
  }

  // ---- Difficulty ----
  segmented('Difficulty',
    Object.keys(DIFFICULTY).map((k) => ({ key: k, label: DIFFICULTY[k].label })),
    () => settings.difficulty, (k) => { settings.difficulty = k; });

  // ---- Environment ----
  segmented('Environment',
    Object.keys(ENVIRONMENT).map((k) => ({ key: k, label: ENVIRONMENT[k].label })),
    () => settings.environment, (k) => { settings.environment = k; });

  // ---- Markings (livery) ----
  const mk = el('div', '', panel);
  el('div', LABEL, mk).textContent = 'Markings';
  const mkRow = (labelText, key, placeholder) => {
    const r = el('div', 'display:flex;align-items:center;gap:8px;margin:4px 0;', mk);
    el('span', 'width:78px;font-size:11px;color:#aeb9d4;', r).textContent = labelText;
    const inp = el('input', `${FONT}flex:1;font-size:12px;padding:6px 8px;background:rgba(255,255,255,0.06);`
      + 'border:1px solid rgba(150,180,255,0.2);border-radius:7px;', r);
    inp.value = settings.livery[key] || '';
    inp.maxLength = 12;
    inp.placeholder = placeholder;
    inp.oninput = () => { settings.livery[key] = inp.value.toUpperCase(); inp.value = settings.livery[key]; fire(); };
    return inp;
  };
  mkRow('Callsign', 'callsign', 'VANSEN');
  mkRow('Squadron', 'squadron', 'WILDCARDS');
  const colorRow = el('div', 'display:flex;align-items:center;gap:8px;margin:4px 0;', mk);
  el('span', 'width:78px;font-size:11px;color:#aeb9d4;', colorRow).textContent = 'Livery';
  const color = el('input', 'width:40px;height:28px;padding:0;border:1px solid rgba(150,180,255,0.2);border-radius:6px;background:none;cursor:pointer;', colorRow);
  color.type = 'color';
  color.value = settings.livery.color || '#7a8694';
  color.oninput = () => { settings.livery.color = color.value; fire(); };

  // ---- Loadout (visual mounts) ----
  const lo = el('div', '', panel);
  el('div', LABEL, lo).textContent = 'Weapon mounts';
  MOUNTS.forEach((m) => {
    const r = el('div', 'display:flex;align-items:center;gap:8px;margin:3px 0;', lo);
    el('span', 'width:66px;font-size:11px;color:#aeb9d4;', r).textContent = m.label;
    const b = el('button', BTN + 'flex:1;text-align:left;', r);
    const paint = () => { b.textContent = ORD_LABEL[settings.loadout[m.id]] || 'Empty'; };
    b.onclick = () => { // cycle through this mount's allowed options
      const cur = settings.loadout[m.id];
      const i = m.opts.indexOf(cur);
      settings.loadout[m.id] = m.opts[(i + 1) % m.opts.length];
      paint(); fire();
    };
    paint();
  });

  // ---- Launch ----
  const launch = el('button', `${FONT}font-size:16px;letter-spacing:0.14em;color:#eaeefc;cursor:pointer;`
    + 'margin-top:auto;padding:14px;background:rgba(120,200,140,0.18);border:1px solid rgba(140,230,170,0.55);'
    + 'border-radius:10px;box-shadow:0 0 16px rgba(120,220,150,0.25);', panel);
  launch.textContent = '▶  LAUNCH';
  launch.onmouseenter = () => { launch.style.background = 'rgba(120,220,150,0.34)'; };
  launch.onmouseleave = () => { launch.style.background = 'rgba(120,200,140,0.18)'; };
  launch.onclick = () => { saveSettings(settings); if (onLaunch) onLaunch(settings); };

  return {
    root,
    show() { root.style.display = 'block'; },
    hide() { root.style.display = 'none'; },
  };
}
