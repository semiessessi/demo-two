import * as THREE from 'three';

// Campaign HUD layer (sibling of hud.js — leaves it untouched): the objectives panel, the comms
// subtitle line, a projected nav-waypoint marker, and the mission outcome overlay (Continue/Retry/Abort).
// Self-building DOM in the same dark glassy style. Shown only while a mission is live.

function el(tag, css, parent) {
  const e = document.createElement(tag);
  if (css) e.style.cssText = css;
  if (parent) parent.appendChild(e);
  return e;
}

const PANEL = 'background:rgba(12,14,22,0.55);border:1px solid rgba(150,180,255,0.1);border-radius:14px;backdrop-filter:blur(8px);';
const FONT = 'font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#cdd6ea;';

export function createMissionHud() {
  // --- objectives (top-right) ---
  const obj = el('div', `position:fixed;top:12px;right:16px;padding:11px 14px;${PANEL}${FONT}`
    + 'font-size:12px;line-height:1.5;z-index:55;min-width:170px;max-width:280px;display:none;', document.body);
  el('div', 'font-size:10px;letter-spacing:0.14em;color:#9fb0d0;margin-bottom:7px;', obj).textContent = 'OBJECTIVES';
  const objList = el('div', '', obj);
  const objectives = new Map(); // id -> { label, state }

  function renderObjectives() {
    objList.innerHTML = '';
    let shown = 0;
    for (const [, o] of objectives) {
      if (o.state === 'hidden') continue;
      shown++;
      const row = el('div', 'display:flex;align-items:flex-start;gap:7px;margin:3px 0;', objList);
      const done = o.state === 'complete';
      const failed = o.state === 'failed';
      const mark = el('span', `width:12px;flex:none;color:${failed ? '#e7564a' : done ? '#5fd07f' : '#9ec7ff'};`, row);
      mark.textContent = failed ? '✗' : done ? '✓' : '◆';
      const txt = el('span', `flex:1;color:${done || failed ? '#7c879c' : '#e6ecf7'};${done ? 'text-decoration:line-through;' : ''}`, row);
      txt.textContent = o.label;
    }
    obj.style.display = shown ? 'block' : 'none';
  }
  function setObjective(id, { label, state } = {}) {
    const cur = objectives.get(id) || {};
    objectives.set(id, { label: label != null ? label : cur.label || id, state: state || cur.state || 'active' });
    if (visible) renderObjectives();
  }
  function clearObjectives() { objectives.clear(); renderObjectives(); }

  // --- comms subtitle (bottom-centre) — optional speaker portrait + name + text ---
  const sub = el('div', `position:fixed;left:50%;bottom:84px;transform:translateX(-50%);max-width:min(760px,88vw);`
    + `padding:9px 14px;${PANEL}${FONT}z-index:58;display:none;pointer-events:none;align-items:center;gap:12px;`, document.body);
  const subFace = el('img', 'width:54px;height:54px;flex:none;border-radius:8px;object-fit:cover;'
    + 'border:2px solid rgba(150,180,255,0.5);display:none;', sub);
  const subBody = el('div', 'flex:1;min-width:0;text-align:left;', sub);
  const subName = el('div', 'font-size:10px;letter-spacing:0.16em;margin-bottom:3px;', subBody);
  const subText = el('div', 'font-size:14px;line-height:1.4;color:#eef2fb;', subBody);
  // speaker key -> portrait at /faces/<key>.png (missing file -> no portrait, text-only; fully graceful)
  function showSubtitle(name, text, color = '#9ec7ff', key) {
    subName.textContent = name || '';
    subName.style.color = color;
    subText.textContent = text || '';
    if (key) {
      subFace.style.display = 'none';
      subFace.style.borderColor = color;
      subFace.onload = () => { subFace.style.display = 'block'; };
      subFace.onerror = () => { subFace.style.display = 'none'; };
      subFace.src = `/faces/${key}.png`;
    } else { subFace.style.display = 'none'; subFace.removeAttribute('src'); }
    sub.style.display = 'flex';
  }
  function hideSubtitle() { sub.style.display = 'none'; }

  // --- projected markers: nav waypoint (green diamond) + formation slot (blue box) ---
  function makeMarker(shapeCss, color) {
    const wrap = el('div', 'position:fixed;left:0;top:0;transform:translate(-50%,-50%);z-index:54;display:none;'
      + 'pointer-events:none;flex-direction:column;align-items:center;gap:2px;', document.body);
    const mark = el('div', shapeCss, wrap);
    const dist = el('div', `${FONT}font-size:10px;color:${color};text-shadow:0 0 4px #000;`, wrap);
    return { wrap, mark, dist };
  }
  const navM = makeMarker('width:16px;height:16px;border:2px solid rgba(126,208,138,0.9);transform:rotate(45deg);box-shadow:0 0 8px rgba(126,208,138,0.5);', '#7fd08a');
  const slotM = makeMarker('width:24px;height:24px;border:2px solid rgba(120,190,255,0.9);border-radius:3px;box-shadow:0 0 9px rgba(120,190,255,0.5);', '#9ec7ff');
  let waypoint = null; const _wpPos = new THREE.Vector3();
  let slot = null; const _slotPos = new THREE.Vector3();
  function setWaypoint(pos, label) { if (!pos) { waypoint = null; navM.wrap.style.display = 'none'; return; } _wpPos.copy(pos.isVector3 ? pos : new THREE.Vector3().fromArray(pos)); waypoint = { pos: _wpPos, label: label || 'NAV' }; }
  function setSlot(pos, label) { if (!pos) { slot = null; slotM.wrap.style.display = 'none'; return; } _slotPos.copy(pos.isVector3 ? pos : new THREE.Vector3().fromArray(pos)); slot = { pos: _slotPos, label: label || 'FORM UP' }; }

  const _v = new THREE.Vector3();
  function projectMarker(M, data, camera, playerPos) {
    if (!data) { M.wrap.style.display = 'none'; return; }
    _v.copy(data.pos).project(camera);
    let x = _v.x, y = _v.y;
    const behind = _v.z > 1;
    if (behind) { x = -x; y = -y; }
    const off = behind || x < -1 || x > 1 || y < -1 || y > 1;
    if (off) { const k = Math.max(Math.abs(x), Math.abs(y)) || 1; x = (x / k) * 0.94; y = (y / k) * 0.94; }
    M.wrap.style.left = `${(x * 0.5 + 0.5) * window.innerWidth}px`;
    M.wrap.style.top = `${(-y * 0.5 + 0.5) * window.innerHeight}px`;
    M.mark.style.opacity = off ? '0.55' : '1';
    if (playerPos) M.dist.textContent = `${data.label} ${Math.round(data.pos.distanceTo(playerPos))}`;
    M.wrap.style.display = 'flex';
  }
  function update({ camera, playerPos } = {}) {
    if (!visible || !camera) { navM.wrap.style.display = 'none'; slotM.wrap.style.display = 'none'; return; }
    projectMarker(navM, waypoint, camera, playerPos);
    projectMarker(slotM, slot, camera, playerPos);
  }

  // --- outcome overlay (campaign complete/fail) ---
  const over = el('div', 'position:fixed;inset:0;z-index:310;display:none;flex-direction:column;'
    + 'align-items:center;justify-content:center;gap:20px;background:rgba(3,3,8,0.74);backdrop-filter:blur(4px);', document.body);
  const overTitle = el('div', `${FONT}font-size:32px;letter-spacing:0.16em;color:#eaeefc;text-shadow:0 0 18px rgba(120,170,255,0.4);`, over);
  const overSub = el('div', `${FONT}font-size:14px;color:#9fb0d0;text-align:center;max-width:560px;`, over);
  const overBtns = el('div', 'display:flex;gap:12px;margin-top:6px;', over);
  function showOutcome({ title, sub: s, buttons = [] } = {}) {
    overTitle.textContent = title || '';
    overSub.textContent = s || '';
    overBtns.innerHTML = '';
    for (const [label, fn] of buttons) {
      const b = el('button', `${FONT}font-size:14px;color:#eaeefc;cursor:pointer;padding:11px 24px;`
        + 'background:rgba(150,180,255,0.1);border:1px solid rgba(150,180,255,0.3);border-radius:999px;', overBtns);
      b.textContent = label;
      b.onclick = () => fn();
    }
    over.style.display = 'flex';
  }
  function hideOutcome() { over.style.display = 'none'; }

  // --- visibility ---
  let visible = false;
  function show() { visible = true; renderObjectives(); }
  function hide() {
    visible = false;
    obj.style.display = 'none';
    sub.style.display = 'none';
    navM.wrap.style.display = 'none';
    slotM.wrap.style.display = 'none';
    hideOutcome();
  }

  return { setObjective, clearObjectives, showSubtitle, hideSubtitle, setWaypoint, setSlot, update, showOutcome, hideOutcome, show, hide };
}
