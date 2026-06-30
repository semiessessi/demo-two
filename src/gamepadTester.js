import { padSummary } from './gamepad.js';

// On-screen gamepad diagnostic (URL flag ?gamepad). Shows the connected pad's id + mapping and a LIVE
// read-out of every button and axis, so a controller that "doesn't work" can be diagnosed without console
// access: press each control, see which raw index lights up, screenshot it. Self-contained (own rAF loop),
// safe to leave running. Use the raw indices it reveals to build an exact remap in gamepad.js.

function el(tag, css, parent) {
  const e = document.createElement(tag);
  if (css) e.style.cssText = css;
  if (parent) parent.appendChild(e);
  return e;
}
const PANEL = 'background:rgba(10,12,20,0.92);border:1px solid rgba(150,180,255,0.25);border-radius:12px;';
const FONT = 'font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#cdd6ea;';

export function createGamepadTester() {
  const root = el('div', `position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:400;width:min(560px,calc(100vw - 24px));max-height:calc(100vh - 28px);overflow:auto;padding:14px 16px;${PANEL}${FONT}`, document.body);
  el('div', 'font-size:15px;letter-spacing:0.12em;color:#eaeefc;margin-bottom:2px;', root).textContent = 'GAMEPAD TESTER';
  el('div', 'font-size:11px;color:#8a96b4;margin-bottom:10px;', root).textContent = 'Press each control and note which number lights up — then screenshot this and send it over.';
  const idLine = el('div', 'font-size:11px;color:#9ec7ff;word-break:break-all;margin-bottom:4px;', root);
  const mapLine = el('div', 'font-size:12px;margin-bottom:10px;', root);
  el('div', 'font-size:10px;letter-spacing:0.14em;color:#9fb0d0;margin-bottom:4px;', root).textContent = 'BUTTONS';
  const btnWrap = el('div', 'display:flex;flex-wrap:wrap;gap:4px;margin-bottom:12px;', root);
  el('div', 'font-size:10px;letter-spacing:0.14em;color:#9fb0d0;margin-bottom:4px;', root).textContent = 'AXES';
  const axWrap = el('div', 'display:flex;flex-direction:column;gap:3px;', root);
  const close = el('button', `${FONT}position:absolute;top:10px;right:12px;font-size:11px;cursor:pointer;padding:4px 9px;background:rgba(150,180,255,0.1);border:1px solid rgba(150,180,255,0.3);border-radius:7px;`, root);
  close.textContent = 'Close';

  const btnCells = [], axRows = [];
  let raf = 0, stopped = false;

  function firstPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) if (p && p.connected !== false) return p;
    return null;
  }

  function frame() {
    if (stopped) return;
    const p = firstPad();
    if (!p) {
      idLine.textContent = 'No gamepad seen yet — press a button on the controller (the browser hides it until you do).';
      mapLine.textContent = '';
    } else {
      idLine.textContent = `id: ${p.id}`;
      const std = p.mapping === 'standard';
      mapLine.innerHTML = `mapping: <b style="color:${std ? '#7fd08a' : '#ff8a5a'}">${p.mapping || '(non-standard)'}</b> · buttons ${p.buttons.length} · axes ${p.axes.length}`;
      const b = p.buttons || [], ax = p.axes || [];
      for (let i = 0; i < b.length; i++) {
        let cell = btnCells[i];
        if (!cell) { cell = el('div', 'width:30px;height:30px;display:flex;align-items:center;justify-content:center;font-size:11px;border-radius:6px;border:1px solid rgba(150,180,255,0.2);', btnWrap); btnCells[i] = cell; }
        const on = b[i].pressed || b[i].value > 0.1;
        cell.textContent = i;
        cell.style.background = on ? '#7fd08a' : 'rgba(255,255,255,0.04)';
        cell.style.color = on ? '#06140a' : '#8a96b4';
      }
      for (let i = 0; i < ax.length; i++) {
        let row = axRows[i];
        if (!row) {
          row = el('div', 'display:flex;align-items:center;gap:8px;font-size:11px;', axWrap);
          row._lbl = el('span', 'width:46px;color:#8a96b4;', row); row._lbl.textContent = `ax ${i}`;
          row._bar = el('div', 'flex:1;height:8px;background:rgba(255,255,255,0.06);border-radius:4px;position:relative;', row);
          row._fill = el('div', 'position:absolute;top:0;bottom:0;left:50%;width:2px;background:#9ec7ff;border-radius:4px;', row._bar);
          row._val = el('span', 'width:48px;text-align:right;color:#cdd6ea;', row);
          axRows[i] = row;
        }
        const v = ax[i] || 0;
        row._fill.style.left = `${(v * 0.5 + 0.5) * 100}%`;
        row._val.textContent = v.toFixed(2);
      }
    }
    raf = requestAnimationFrame(frame);
  }

  close.onclick = () => { stopped = true; cancelAnimationFrame(raf); root.remove(); };
  raf = requestAnimationFrame(frame);
  try { console.log('[gamepad-tester] open'); } catch (_) {}
  return { root, close() { close.onclick(); } };
}
