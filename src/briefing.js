// Mission briefing screen — a centred glassy modal (same dark style as the pre-game/attract menus). Shows
// the mission title, location, narrative body, and objective list, with LAUNCH + BACK. Shown while the
// attract cinematic runs behind it; LAUNCH hands the mission def back to main to start the sortie.

function el(tag, css, parent) {
  const e = document.createElement(tag);
  if (css) e.style.cssText = css;
  if (parent) parent.appendChild(e);
  return e;
}

const PANEL = 'background:rgba(12,14,22,0.72);border:1px solid rgba(150,180,255,0.14);border-radius:16px;backdrop-filter:blur(12px);';
const FONT = 'font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#cdd6ea;';
const BTN = `${FONT}font-size:13px;cursor:pointer;padding:9px 20px;background:rgba(150,180,255,0.08);`
  + 'border:1px solid rgba(150,180,255,0.22);border-radius:9px;transition:all 0.12s;';
const BTN_GO = `${FONT}font-size:14px;cursor:pointer;padding:10px 26px;color:#eaffea;`
  + 'background:rgba(120,210,140,0.18);border:1px solid rgba(140,230,160,0.6);border-radius:9px;box-shadow:0 0 12px rgba(120,210,140,0.25);';

export function createBriefing({ onLaunch, onBack } = {}) {
  const root = el('div', 'position:fixed;inset:0;z-index:210;display:none;align-items:center;justify-content:center;'
    + 'pointer-events:none;', document.body);
  const panel = el('div', `position:relative;width:min(560px,92vw);max-height:88vh;overflow-y:auto;padding:26px 28px;`
    + `pointer-events:auto;${PANEL}${FONT}display:flex;flex-direction:column;gap:14px;box-shadow:0 0 50px rgba(0,0,0,0.55);`, root);

  const eyebrow = el('div', 'font-size:10px;letter-spacing:0.22em;color:#9fb0d0;', panel);
  const title = el('div', 'font-size:26px;letter-spacing:0.14em;color:#eaeefc;text-shadow:0 0 16px rgba(120,170,255,0.4);', panel);
  const body = el('div', 'font-size:13px;line-height:1.6;color:#c2ccdf;display:flex;flex-direction:column;gap:8px;', panel);
  el('div', 'font-size:10px;letter-spacing:0.16em;color:#9fb0d0;margin-top:4px;', panel).textContent = 'OBJECTIVES';
  const objs = el('div', 'font-size:12.5px;line-height:1.6;color:#dbe3f2;', panel);

  const rowBtns = el('div', 'display:flex;justify-content:space-between;margin-top:10px;', panel);
  const back = el('button', BTN, rowBtns);
  back.textContent = '‹ Back';
  back.onclick = () => onBack && onBack();
  const launch = el('button', BTN_GO, rowBtns);
  launch.textContent = 'LAUNCH ▸';

  let current = null;
  launch.onclick = () => { if (current && onLaunch) onLaunch(current); };

  function show(def) {
    current = def;
    const b = def.briefing || {};
    eyebrow.textContent = b.location || `MISSION ${def.act || 1}`;
    title.textContent = def.title || 'Mission';
    body.innerHTML = '';
    for (const p of (b.body || [])) el('div', '', body).textContent = p;
    objs.innerHTML = '';
    for (const o of (b.objectives || [])) { const r = el('div', 'display:flex;gap:8px;', objs); el('span', 'color:#9ec7ff;', r).textContent = '◆'; el('span', '', r).textContent = o; }
    root.style.display = 'flex';
  }
  function hide() { root.style.display = 'none'; }

  return { show, hide };
}
