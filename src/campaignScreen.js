// Campaign mission-select — a centred glassy modal listing the missions with locked / unlocked / completed
// state (progress from settings.loadCampaign). Picking an unlocked mission hands its def to main (which
// opens the briefing). Shown while the attract cinematic runs behind it.

import { MISSIONS, isUnlocked } from './campaign/missions.js';
import { loadCampaign } from './settings.js';

function el(tag, css, parent) {
  const e = document.createElement(tag);
  if (css) e.style.cssText = css;
  if (parent) parent.appendChild(e);
  return e;
}

const PANEL = 'background:rgba(12,14,22,0.72);border:1px solid rgba(150,180,255,0.14);border-radius:16px;backdrop-filter:blur(12px);';
const FONT = 'font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#cdd6ea;';
const BTN = `${FONT}font-size:13px;cursor:pointer;padding:8px 18px;background:rgba(150,180,255,0.08);`
  + 'border:1px solid rgba(150,180,255,0.22);border-radius:9px;transition:all 0.12s;';

export function createCampaignScreen({ onSelect, onBack } = {}) {
  const root = el('div', 'position:fixed;inset:0;z-index:210;display:none;align-items:center;justify-content:center;'
    + 'pointer-events:none;', document.body);
  const panel = el('div', `position:relative;width:min(520px,92vw);max-height:88vh;overflow-y:auto;padding:24px 26px;`
    + `pointer-events:auto;${PANEL}${FONT}display:flex;flex-direction:column;gap:14px;box-shadow:0 0 50px rgba(0,0,0,0.55);`, root);

  el('div', 'font-size:10px;letter-spacing:0.22em;color:#9fb0d0;', panel).textContent = 'THE 88TH · "THE LONGSHOTS"';
  el('div', 'font-size:24px;letter-spacing:0.14em;color:#eaeefc;text-shadow:0 0 16px rgba(120,170,255,0.4);', panel).textContent = 'Campaign';
  const list = el('div', 'display:flex;flex-direction:column;gap:8px;margin-top:4px;', panel);

  const back = el('button', BTN + 'align-self:flex-start;margin-top:8px;', panel);
  back.textContent = '‹ Back';
  back.onclick = () => onBack && onBack();

  function render() {
    const prog = loadCampaign();
    list.innerHTML = '';
    MISSIONS.forEach((m, i) => {
      const unlocked = isUnlocked(m.id, prog);
      const done = !!(prog.completed && prog.completed[m.id]);
      const row = el('div', `display:flex;align-items:center;gap:12px;padding:11px 14px;border-radius:11px;`
        + `border:1px solid rgba(150,180,255,${unlocked ? 0.18 : 0.08});background:rgba(150,180,255,${unlocked ? 0.06 : 0.02});`
        + (unlocked ? 'cursor:pointer;' : 'opacity:0.5;'), list);
      const num = el('div', `font-size:11px;color:#9fb0d0;width:26px;`, row);
      num.textContent = `M${i + 1}`;
      const mid = el('div', 'flex:1;', row);
      el('div', `font-size:14px;color:${unlocked ? '#eaeefc' : '#8a93a6'};`, mid).textContent = m.title;
      el('div', 'font-size:11px;color:#8a93a6;', mid).textContent = (m.briefing && m.briefing.location) || '';
      const tag = el('div', `font-size:11px;letter-spacing:0.08em;color:${done ? '#7fd08a' : unlocked ? '#9ec7ff' : '#6b7280'};`, row);
      tag.textContent = done ? '✓ COMPLETE' : unlocked ? 'LAUNCH ▸' : '🔒 LOCKED';
      if (unlocked) row.onclick = () => onSelect && onSelect(m);
    });
  }

  function show() { render(); root.style.display = 'flex'; }
  function hide() { root.style.display = 'none'; }

  return { show, hide };
}
