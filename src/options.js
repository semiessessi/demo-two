// Options screen — the audio mix (Master / Effects / Voice / Music). A self-contained glassy panel in the
// same style as the title menu. Each slider writes settings.volume + persists, and calls onChange so main
// can apply the live mix. onBack returns to the title menu.

import { saveSettings } from './settings.js';

let styleInjected = false;
function injectStyle() {
  if (styleInjected) return;
  styleInjected = true;
  const css = `
  #options-menu { position: fixed; inset: 0; z-index: 160; display: none; align-items: center; justify-content: center; pointer-events: none; }
  #options-menu.show { display: flex; }
  #options-menu .om-panel {
    pointer-events: auto; width: min(380px, calc(100vw - 32px)); padding: 24px 26px;
    background: rgba(12, 14, 22, 0.62); border: 1px solid rgba(150, 180, 255, 0.12); border-radius: 18px;
    backdrop-filter: blur(10px); box-shadow: 0 0 50px rgba(0, 0, 0, 0.55);
    display: flex; flex-direction: column; gap: 15px;
    font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; color: #cdd6ea;
  }
  #options-menu .om-title { font-size: 18px; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; color: #eaeefc; }
  #options-menu .om-row { display: flex; align-items: center; gap: 12px; }
  #options-menu .om-row label { flex: 0 0 86px; font-size: 12px; letter-spacing: 0.06em; text-transform: uppercase; color: #9fb0d0; }
  #options-menu .om-row input[type=range] { flex: 1; accent-color: #9ec7ff; cursor: pointer; }
  #options-menu .om-row .om-val { flex: 0 0 34px; text-align: right; font-size: 12px; color: #cdd6ea; font-variant-numeric: tabular-nums; }
  #options-menu .om-note { font-size: 10.5px; color: #6b7488; margin-top: -2px; }
  #options-menu .om-back {
    align-self: flex-start; margin-top: 4px; font-size: 13px; font-weight: 600; letter-spacing: 0.08em;
    color: #cdd6ea; background: rgba(150, 180, 255, 0.08); border: 1px solid rgba(150, 180, 255, 0.2);
    border-radius: 10px; padding: 9px 16px; cursor: pointer;
  }
  #options-menu .om-back:hover { background: rgba(150, 180, 255, 0.16); color: #fff; }
  `;
  const el = document.createElement('style');
  el.id = 'options-menu-css';
  el.textContent = css;
  document.head.appendChild(el);
}

const CHANNELS = [
  { key: 'master', label: 'Master' },
  { key: 'effects', label: 'Effects' },
  { key: 'voice', label: 'Voice' },
  { key: 'music', label: 'Music' },
];

export function createOptions({ settings, onChange, onBack, onInvert, invertPitch } = {}) {
  injectStyle();
  const wrap = document.createElement('div');
  wrap.id = 'options-menu';
  const panel = document.createElement('div');
  panel.className = 'om-panel';
  wrap.appendChild(panel);

  const title = document.createElement('div');
  title.className = 'om-title';
  title.textContent = 'Options';
  panel.appendChild(title);

  const vol = settings.volume || (settings.volume = { master: 1, effects: 1, voice: 0.9, music: 0.7 });
  for (const ch of CHANNELS) {
    const row = document.createElement('div');
    row.className = 'om-row';
    const lab = document.createElement('label');
    lab.textContent = ch.label;
    const range = document.createElement('input');
    range.type = 'range'; range.min = '0'; range.max = '100'; range.step = '1';
    range.value = String(Math.round((vol[ch.key] != null ? vol[ch.key] : 0.9) * 100));
    const val = document.createElement('span');
    val.className = 'om-val';
    val.textContent = range.value;
    range.addEventListener('input', () => {
      val.textContent = range.value;
      vol[ch.key] = range.value / 100;
      saveSettings(settings);
      if (onChange) onChange(vol);
    });
    row.appendChild(lab); row.appendChild(range); row.appendChild(val);
    panel.appendChild(row);
  }

  // Touch-only: invert the on-screen stick's pitch axis (some players want drag-up = climb). Shown only
  // when there are touch controls to apply it to.
  if (invertPitch && invertPitch.show) {
    const row = document.createElement('div');
    row.className = 'om-row';
    const lab = document.createElement('label');
    lab.textContent = 'Invert Pitch';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!invertPitch.initial;
    cb.style.cssText = 'flex:0 0 auto; width:18px; height:18px; accent-color:#9ec7ff; cursor:pointer';
    cb.addEventListener('change', () => { if (invertPitch.onChange) invertPitch.onChange(cb.checked); });
    row.appendChild(lab); row.appendChild(cb);
    panel.appendChild(row);
  }

  // Invert pitch separately for keyboard (W/S) and the gamepad stick.
  const invertRow = (label, getCur, setCur) => {
    const row = document.createElement('div'); row.className = 'om-row';
    const lab = document.createElement('label'); lab.textContent = label; lab.style.flex = '1';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!getCur();
    cb.style.cssText = 'flex:0 0 auto; width:18px; height:18px; accent-color:#9ec7ff; cursor:pointer';
    cb.addEventListener('change', () => setCur(cb.checked));
    row.appendChild(lab); row.appendChild(cb); panel.appendChild(row);
  };
  invertRow('Invert Keys', () => settings.invertKeys, (v) => { settings.invertKeys = v; saveSettings(settings); if (onInvert) onInvert(settings); });
  invertRow('Invert Stick', () => settings.invertStick, (v) => { settings.invertStick = v; saveSettings(settings); if (onInvert) onInvert(settings); });

  const note = document.createElement('div');
  note.className = 'om-note';
  note.textContent = 'Voice is reserved for future comms / callouts.';
  panel.appendChild(note);

  const back = document.createElement('button');
  back.className = 'om-back';
  back.textContent = '‹ Main Menu';
  back.addEventListener('click', () => { if (onBack) onBack(); });
  panel.appendChild(back);

  document.body.appendChild(wrap);
  return {
    el: wrap,
    show() { wrap.classList.add('show'); },
    hide() { wrap.classList.remove('show'); },
  };
}
