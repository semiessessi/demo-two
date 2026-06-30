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

// D-pad state from buttons 12-15, plus a HAT-AXIS fallback for non-standard pads (axes[9]). The W3C hat
// convention encodes 8 directions on one axis: -1 = up, then clockwise in steps of 2/7, ~1.286 = released.
// The fallback is only attempted for non-standard mappings, so standard pads are never affected by it.
export function dpad(pad) {
  const o = { up: false, dn: false, lf: false, rt: false };
  if (!pad) return o;
  const b = pad.buttons || [], ax = pad.axes || [];
  const down = (i) => !!(b[i] && b[i].pressed);
  o.up = down(12); o.dn = down(13); o.lf = down(14); o.rt = down(15);
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
