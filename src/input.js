// Unified control source: merges keyboard + Gamepad API into normalized signals that flight.js and
// weapons.js read each frame. Call poll() once per frame (it mutates the returned object). Keyboard
// keeps the existing mapping; gamepad uses the "standard" layout.
//
//   left stick   -> pitch / yaw          right trigger -> fire
//   LB / RB      -> roll left / right     LT            -> boost
//   right stick X-> gun aim (gimbal)      B button      -> brake
//   Y / View btn -> eject (hold)
//
// Sign conventions match flight.js: pitch -1 = nose down (W), yaw +1 = yaw left (A), roll +1 = roll
// left (Q).

const DEADZONE = 0.12;
const dz = (v) => (Math.abs(v) < DEADZONE ? 0 : v);
const clamp1 = (v) => (v < -1 ? -1 : v > 1 ? 1 : v);

export function createInput() {
  const keys = new Set();
  const isFormEl = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'BUTTON' || t.tagName === 'TEXTAREA');
  const onDown = (e) => {
    if (isFormEl(e.target)) return;
    keys.add(e.code);
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault(); // no page scroll while firing
  };
  const onUp = (e) => keys.delete(e.code);
  window.addEventListener('keydown', onDown);
  window.addEventListener('keyup', onUp);

  const input = {
    pitch: 0,
    yaw: 0,
    roll: 0,
    boost: false,
    brake: false,
    fire: 0,
    gunAimX: 0,
    ejectHeld: false,
    gamepad: false,
    keys,
    poll,
    dispose,
  };

  const axisKey = (neg, pos) => (keys.has(neg) ? -1 : 0) + (keys.has(pos) ? 1 : 0);

  function firstPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) if (p && p.connected !== false) return p;
    return null;
  }

  function poll() {
    // keyboard (same mapping/signs as the original flight.js)
    let pitch = axisKey('KeyW', 'KeyS') + axisKey('ArrowUp', 'ArrowDown'); // W/Up = nose down (-1)
    let yaw = axisKey('KeyD', 'KeyA') + axisKey('ArrowRight', 'ArrowLeft'); // A/Left = yaw left (+1)
    let roll = axisKey('KeyE', 'KeyQ'); // Q = roll left (+1)
    let boost = keys.has('ShiftLeft') || keys.has('ShiftRight');
    let brake = keys.has('ControlLeft') || keys.has('ControlRight');
    let fire = keys.has('Space') ? 1 : 0;
    let eject = keys.has('KeyJ');
    let gunAimX = 0;

    const gp = firstPad();
    input.gamepad = !!gp;
    if (gp) {
      const ax = gp.axes || [];
      const bt = gp.buttons || [];
      const btn = (i) => (bt[i] ? bt[i].value || (bt[i].pressed ? 1 : 0) : 0);
      pitch += dz(ax[1] || 0); // stick forward (negative) = nose down -> matches W (-1)
      yaw += dz(-(ax[0] || 0)); // stick left (negative) = yaw left (+1)
      roll += (btn(4) > 0.5 ? 1 : 0) + (btn(5) > 0.5 ? -1 : 0); // LB roll left, RB roll right
      fire = Math.max(fire, btn(7)); // right trigger
      boost = boost || btn(6) > 0.3; // left trigger
      brake = brake || btn(1) > 0.5; // B
      gunAimX = dz(ax[2] || 0); // right stick X -> gun gimbal
      eject = eject || btn(3) > 0.5 || btn(8) > 0.5; // Y or View/Back
    }

    input.pitch = clamp1(pitch);
    input.yaw = clamp1(yaw);
    input.roll = clamp1(roll);
    input.boost = boost;
    input.brake = brake;
    input.fire = fire;
    input.gunAimX = clamp1(gunAimX);
    input.ejectHeld = eject;
    return input;
  }

  function dispose() {
    window.removeEventListener('keydown', onDown);
    window.removeEventListener('keyup', onUp);
  }

  return input;
}
