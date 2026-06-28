// Gamepad navigation for the DOM menus. A focus highlight moves between the active menu's focusable controls
// (d-pad up/down or the left stick); A activates a button; left/right nudges a slider (or moves between
// buttons); B goes back. It also unlocks audio on the first BUTTON press — a real user-activation gesture,
// unlike gamepadconnected — so controller users get sound the moment they press anything.
//
// Standard-mapping button indices: 0=A 1=B 12=Up 13=Down 14=Left 15=Right. Axes: 0=LX 1=LY.

const FOCUSABLE = 'button:not([disabled]), input[type=range], input[type=text], input[type=color]';

let styleInjected = false;
function injectStyle() {
  if (styleInjected) return;
  styleInjected = true;
  const s = document.createElement('style');
  s.textContent = '.gp-focus { outline: 2px solid #9ec7ff !important; outline-offset: 2px;'
    + ' box-shadow: 0 0 14px rgba(120,170,255,0.55) !important; }';
  document.head.appendChild(s);
}

export function createGamepadMenu({ onFirstButton } = {}) {
  injectStyle();
  let container = null;
  let onBack = null;
  let items = [];
  let idx = -1;
  const prev = [];        // per-button edge state
  let repeatT = 0;        // hold-repeat timer for navigation
  let everPressed = false;

  function clearHighlight() { if (items[idx]) items[idx].classList.remove('gp-focus'); }
  function setFocus(i) {
    clearHighlight();
    idx = i;
    const it = items[idx];
    if (it) { it.classList.add('gp-focus'); try { it.focus({ preventScroll: false }); } catch (_) {} }
  }
  function refresh() {
    clearHighlight();
    items = container ? Array.from(container.querySelectorAll(FOCUSABLE)).filter((e) => e.offsetParent !== null) : [];
    idx = items.length ? 0 : -1;
    if (idx >= 0) setFocus(0);
  }
  function setMenu(el, opts = {}) {
    container = el || null;
    onBack = opts.onBack || null;
    refresh();
  }
  function clear() { clearHighlight(); container = null; onBack = null; items = []; idx = -1; }
  function move(delta) {
    if (!items.length) { refresh(); if (!items.length) return; }
    setFocus((idx + delta + items.length) % items.length);
  }

  function activePad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  function poll(dt) {
    const p = activePad();
    if (!p) return;
    const b = p.buttons, ax = p.axes || [];
    const down = (i) => !!(b[i] && b[i].pressed);
    const edge = (i) => { const now = down(i); const was = prev[i]; prev[i] = now; return now && !was; };

    // first real button press -> unlock audio (valid user activation)
    let anyDown = false;
    for (let i = 0; i < b.length; i++) if (down(i)) anyDown = true;
    if (anyDown && !everPressed) { everPressed = true; if (onFirstButton) onFirstButton(); }

    // keep the edge state current even when no menu is active (so we don't fire a stale edge on open)
    if (!container) { for (let i = 0; i < b.length; i++) prev[i] = down(i); return; }
    if (!items.length) refresh();

    if (edge(0)) { const it = items[idx]; if (it && it.tagName === 'BUTTON') it.click(); } // A: activate
    if (edge(1) && onBack) onBack();                                                       // B: back

    const up = down(12) || ax[1] < -0.55;
    const dn = down(13) || ax[1] > 0.55;
    const lf = down(14) || ax[0] < -0.55;
    const rt = down(15) || ax[0] > 0.55;
    repeatT -= dt;
    if (up || dn || lf || rt) {
      if (repeatT <= 0) {
        repeatT = 0.16; // ~6 steps/s on hold
        if (up) move(-1);
        else if (dn) move(1);
        else {
          const it = items[idx];
          if (it && it.type === 'range') { // left/right nudges a slider
            const step = (Number(it.step) || 1) * 4 * (rt ? 1 : -1);
            const v = Math.max(Number(it.min), Math.min(Number(it.max), Number(it.value) + step));
            it.value = String(v);
            it.dispatchEvent(new Event('input', { bubbles: true }));
          } else {
            move(rt ? 1 : -1); // on buttons, left/right also walks the list
          }
        }
      }
    } else {
      repeatT = 0;
    }
  }

  return { setMenu, clear, refresh, poll };
}
