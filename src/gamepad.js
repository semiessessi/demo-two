// Shared Gamepad API helpers. The game targets the W3C "standard" mapping. Non-standard pads — notably the
// Nintendo Switch Pro Controller / Joy-Cons over Bluetooth, and most pads in Firefox/Safari — expose their
// buttons & axes in a different order and commonly report the D-PAD as a single HAT AXIS (axes[9]) instead of
// buttons 12-15. These helpers prefer a properly-mapped pad, decode the hat as a d-pad fallback, and
// summarise a pad for logging. (When a pad is fully non-standard, its sticks/triggers are also re-indexed —
// that needs the actual id/button dump to remap, which padSummary() logs on connect.)

// The first connected pad, preferring one that reports the standard mapping if several are attached.
export function activePad() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  let any = null;
  for (const p of pads) {
    if (!p || p.connected === false) continue;
    if (p.mapping === 'standard') return p;
    if (!any) any = p;
  }
  return any;
}

export function isNintendo(pad) {
  return !!pad && /057e|pro controller|joy-?con|nintendo/i.test(pad.id || '');
}

// Standard-layout button index -> raw index on a NON-STANDARD Nintendo Switch Pro / Joy-Con. Handles the
// common layout where A/B and X/Y are swapped vs the standard order and the d-pad sits on buttons 14-17;
// the triggers/shoulders/sticks already line up. Applied ONLY when the pad is non-standard AND Nintendo, so
// standard pads + other controllers are untouched. (If a given pad differs, ?gamepad reveals the real map.)
const NINTENDO_BTN = { 0: 1, 1: 0, 2: 3, 3: 2, 12: 14, 13: 15, 14: 16, 15: 17 };
function isNonStdNintendo(pad) { return !!pad && pad.mapping !== 'standard' && isNintendo(pad); }

// Read button `stdIndex` (standard layout) as a 0..1 value, remapping for non-standard Nintendo pads.
export function padBtn(pad, stdIndex) {
  if (!pad) return 0;
  const i = (isNonStdNintendo(pad) && NINTENDO_BTN[stdIndex] != null) ? NINTENDO_BTN[stdIndex] : stdIndex;
  const bt = (pad.buttons || [])[i];
  return bt ? (bt.value || (bt.pressed ? 1 : 0)) : 0;
}

// D-pad state from buttons 12-15, plus a HAT-AXIS fallback for non-standard pads (axes[9]). The W3C hat
// convention encodes 8 directions on one axis: -1 = up, then clockwise in steps of 2/7, ~1.286 = released.
// The fallback is only attempted for non-standard mappings, so standard pads are never affected by it.
export function dpad(pad) {
  const o = { up: false, dn: false, lf: false, rt: false };
  if (!pad) return o;
  const ax = pad.axes || [];
  o.up = padBtn(pad, 12) > 0.5; o.dn = padBtn(pad, 13) > 0.5; o.lf = padBtn(pad, 14) > 0.5; o.rt = padBtn(pad, 15) > 0.5;
  if (pad.mapping !== 'standard' && ax.length > 9) {
    const h = ax[9];
    const dir = Math.round((h + 1) * 3.5); // 0=N 1=NE 2=E 3=SE 4=S 5=SW 6=W 7=NW; released -> 8 (ignored)
    if (h >= -1.001 && dir >= 0 && dir <= 7) {
      if (dir === 7 || dir === 0 || dir === 1) o.up = true;
      if (dir === 1 || dir === 2 || dir === 3) o.rt = true;
      if (dir === 3 || dir === 4 || dir === 5) o.dn = true;
      if (dir === 5 || dir === 6 || dir === 7) o.lf = true;
    }
  }
  return o;
}

// One-line description for the console (so a user can read it off a deployed build and report it back).
export function padSummary(pad) {
  if (!pad) return 'no gamepad';
  return `id="${pad.id}" mapping="${pad.mapping || '(non-standard)'}" buttons=${(pad.buttons || []).length} axes=${(pad.axes || []).length}`;
}
