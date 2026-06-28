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

// touchRead (optional) is a getter returning normalized on-screen-control signals (see touch.js), merged
// in alongside keyboard + gamepad so flight/gun read one unified source. Returns null on non-touch devices.
export function createInput(touchRead) {
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
    gunAimY: 0,
    lockPressed: false, // edge: target lock pressed this frame (X / right-stick click)
    ejectHeld: false,
    gamepad: false,
    invertKeys: false, // invert keyboard pitch (W/S) — set from Options
    invertStick: false, // invert gamepad stick pitch — set from Options
    keys,
    poll,
    dispose,
  };
  let lockPrev = false;

  const axisKey = (neg, pos) => (keys.has(neg) ? -1 : 0) + (keys.has(pos) ? 1 : 0);

  function firstPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) if (p && p.connected !== false) return p;
    return null;
  }

  function poll() {
    // keyboard — WASD flies (arrows now drive the gun, not flight)
    let pitch = axisKey('KeyW', 'KeyS') * (input.invertKeys ? -1 : 1); // W = nose down (-1); invertKeys flips it
    let yaw = axisKey('KeyD', 'KeyA'); // A = yaw left (+1)
    let roll = axisKey('KeyE', 'KeyQ'); // Q = roll left (+1)
    let boost = keys.has('ShiftLeft') || keys.has('ShiftRight');
    let brake = keys.has('ControlLeft') || keys.has('ControlRight');
    let fire = keys.has('Space') ? 1 : 0;
    let eject = keys.has('KeyJ');
    // arrow keys aim the front gun: left/right swing, down depresses (up is clamped out — gun is down-only)
    let gunAimX = axisKey('ArrowLeft', 'ArrowRight');
    let gunAimY = axisKey('ArrowUp', 'ArrowDown');
    let lock = keys.has('KeyX'); // X = lock / cycle target

    const gp = firstPad();
    input.gamepad = !!gp;
    if (gp) {
      const ax = gp.axes || [];
      const bt = gp.buttons || [];
      const btn = (i) => (bt[i] ? bt[i].value || (bt[i].pressed ? 1 : 0) : 0);
      pitch += dz(ax[1] || 0) * (input.invertStick ? -1 : 1); // stick forward = nose down; invertStick flips it
      yaw += dz(-(ax[0] || 0)); // stick left (negative) = yaw left (+1)
      roll += (btn(4) > 0.5 ? 1 : 0) + (btn(5) > 0.5 ? -1 : 0); // LB roll left, RB roll right
      fire = Math.max(fire, btn(7)); // right trigger
      boost = boost || btn(6) > 0.3; // left trigger
      brake = brake || btn(1) > 0.5; // B
      gunAimX = dz(ax[2] || 0) || gunAimX; // right stick X -> gun gimbal (yaw); falls back to arrows
      gunAimY = dz(ax[3] || 0) || gunAimY; // right stick Y -> gun gimbal (pitch)
      lock = lock || btn(10) > 0.5; // right-stick click (R3) = lock target
      eject = eject || btn(3) > 0.5 || btn(8) > 0.5; // Y or View/Back
    }

    // on-screen touch controls (mobile/tablet) — additive, same conventions as the gamepad
    const tch = touchRead ? touchRead() : null;
    if (tch) {
      pitch += tch.pitch || 0;
      yaw += tch.yaw || 0;
      roll += tch.roll || 0;
      fire = Math.max(fire, tch.fire || 0);
      boost = boost || tch.boost;
      brake = brake || tch.brake;
      gunAimX = gunAimX || (tch.gunAimX || 0);
      gunAimY = gunAimY || (tch.gunAimY || 0);
      lock = lock || tch.lock;
    }

    input.pitch = clamp1(pitch);
    input.yaw = clamp1(yaw);
    input.roll = clamp1(roll);
    input.boost = boost;
    input.brake = brake;
    input.fire = fire;
    input.gunAimX = clamp1(gunAimX);
    input.gunAimY = clamp1(gunAimY);
    input.lockPressed = lock && !lockPrev; // rising edge only
    lockPrev = lock;
    input.ejectHeld = eject;
    return input;
  }

  function dispose() {
    window.removeEventListener('keydown', onDown);
    window.removeEventListener('keyup', onUp);
  }

  return input;
}
