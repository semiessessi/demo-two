import { detectDevice } from './device.js';

// On-screen flight controls for touch devices: a left thumb-stick (pitch / yaw) and right-hand action
// buttons (FIRE / BOOST / BRAKE / LOCK). Built with Pointer Events and per-element pointer capture so
// several fingers work at once (e.g. steering on the stick while holding FIRE). The overlay is created
// only on touch-capable devices and stays hidden until main toggles it on for flight.
//
// read() returns the same normalized signals input.js already merges from keyboard + gamepad, so flight
// and the gun read one unified source:
//   pitch -1 = nose down · yaw +1 = yaw left  (matches the gamepad: stick forward = nose down, left = yaw left)

const CSS = `
#touch { position:fixed; inset:0; z-index:40; pointer-events:none; display:none; touch-action:none;
  -webkit-user-select:none; user-select:none; }
#touch.show { display:block; }
#touch .stick { position:absolute; left:max(22px, env(safe-area-inset-left)); bottom:max(26px, env(safe-area-inset-bottom));
  width:138px; height:138px; border-radius:50%; pointer-events:auto; touch-action:none;
  background:radial-gradient(circle, rgba(20,26,40,0.30) 0%, rgba(20,26,40,0.16) 70%, rgba(20,26,40,0) 72%);
  border:1px solid rgba(150,180,255,0.18); }
#touch .knob { position:absolute; left:50%; top:50%; width:62px; height:62px; margin:-31px 0 0 -31px; border-radius:50%;
  background:rgba(150,180,255,0.22); border:1px solid rgba(188,210,255,0.5); transition:transform 0.06s ease-out; }
#touch .btns { position:absolute; right:max(22px, env(safe-area-inset-right)); bottom:max(26px, env(safe-area-inset-bottom));
  display:grid; grid-template-columns:repeat(2, 80px); grid-auto-rows:80px; gap:14px; pointer-events:none; }
#touch .btn { pointer-events:auto; touch-action:none; border-radius:50%; display:flex; align-items:center; justify-content:center;
  font:700 15px/1 ui-sans-serif,system-ui,sans-serif; letter-spacing:0.04em; color:#cdd8ef;
  background:rgba(20,26,40,0.34); border:1px solid rgba(150,180,255,0.22); }
#touch .btn.fire { background:rgba(70,20,24,0.40); border-color:rgba(255,120,90,0.45); color:#ffd0c0; grid-column:2; }
#touch .btn.press { background:rgba(150,180,255,0.40); border-color:rgba(210,230,255,0.8); color:#fff; }
#touch .btn.fire.press { background:rgba(190,50,40,0.6); border-color:rgba(255,180,150,0.9); }
`;

export function createTouchControls() {
  const { isMobile, touch } = detectDevice();
  const state = { pitch: 0, yaw: 0, roll: 0, fire: 0, boost: false, brake: false, gunAimX: 0, gunAimY: 0, lock: false };
  // Phones + tablets (incl. desktop-UA iPad, detected via touch) get the overlay; desktops — including
  // touchscreen laptops, which have a keyboard — don't, so we gate on isMobile rather than bare touch.
  if (!isMobile && !(touch && /[?&]touch\b/.test(location.search))) {
    // Non-mobile device: a no-op stub so callers don't have to branch. (?touch forces it on for testing.)
    return { read: () => null, setVisible() {}, dispose() {}, active: false };
  }

  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'touch';
  root.innerHTML = `
    <div class="stick"><div class="knob"></div></div>
    <div class="btns">
      <div class="btn boost" data-act="boost">BOOST</div>
      <div class="btn fire" data-act="fire">FIRE</div>
      <div class="btn lock" data-act="lock">LOCK</div>
      <div class="btn brake" data-act="brake">BRAKE</div>
    </div>`;
  document.body.appendChild(root);

  // --- thumb-stick: one captured pointer, value = offset-from-centre / radius (clamped to the ring) ---
  const stick = root.querySelector('.stick');
  const knob = root.querySelector('.knob');
  let stickId = null;
  const R = 56; // travel radius (px)
  function setStick(clientX, clientY) {
    const r = stick.getBoundingClientRect();
    let dx = clientX - (r.left + r.width / 2);
    let dy = clientY - (r.top + r.height / 2);
    const len = Math.hypot(dx, dy) || 1;
    if (len > R) { dx *= R / len; dy *= R / len; }
    const nx = dx / R; // +right
    const ny = dy / R; // +down (screen)
    state.yaw = -nx;   // drag left -> yaw left (+1), matching the gamepad
    state.pitch = ny;  // drag up (ny<0) -> nose down (-1), matching stick-forward = nose down
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
  }
  function resetStick() {
    state.yaw = 0; state.pitch = 0;
    knob.style.transform = 'translate(0px, 0px)';
  }
  stick.addEventListener('pointerdown', (e) => {
    if (stickId !== null) return;
    stickId = e.pointerId;
    stick.setPointerCapture(e.pointerId);
    setStick(e.clientX, e.clientY);
    e.preventDefault();
  });
  stick.addEventListener('pointermove', (e) => {
    if (e.pointerId !== stickId) return;
    setStick(e.clientX, e.clientY);
    e.preventDefault();
  });
  const endStick = (e) => {
    if (e.pointerId !== stickId) return;
    stickId = null;
    resetStick();
  };
  stick.addEventListener('pointerup', endStick);
  stick.addEventListener('pointercancel', endStick);

  // --- action buttons: each tracks its own pointer so multi-touch (stick + button) works ---
  function bindButton(el) {
    const act = el.dataset.act;
    let id = null;
    const press = () => {
      el.classList.add('press');
      if (act === 'fire') state.fire = 1;
      else if (act === 'boost') state.boost = true;
      else if (act === 'brake') state.brake = true;
      else if (act === 'lock') state.lock = true; // a momentary edge; read() clears it after one poll
    };
    const release = () => {
      el.classList.remove('press');
      if (act === 'fire') state.fire = 0;
      else if (act === 'boost') state.boost = false;
      else if (act === 'brake') state.brake = false;
    };
    el.addEventListener('pointerdown', (e) => { id = e.pointerId; el.setPointerCapture(e.pointerId); press(); e.preventDefault(); });
    const end = (e) => { if (e.pointerId !== id) return; id = null; release(); };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }
  root.querySelectorAll('.btn').forEach(bindButton);

  let visible = false;
  function setVisible(on) {
    on = !!on;
    if (on === visible) return;
    visible = on;
    root.classList.toggle('show', on);
    if (!on) { stickId = null; resetStick(); root.querySelectorAll('.btn.press').forEach((b) => b.classList.remove('press')); state.fire = 0; state.boost = false; state.brake = false; }
  }

  // Snapshot for input.poll(). LOCK is a one-shot: clear it after it's been read once so it fires a single
  // rising edge (input.js turns lock into lockPressed itself).
  function read() {
    const snap = { pitch: state.pitch, yaw: state.yaw, roll: state.roll, fire: state.fire, boost: state.boost, brake: state.brake, gunAimX: state.gunAimX, gunAimY: state.gunAimY, lock: state.lock };
    state.lock = false;
    return snap;
  }

  function dispose() {
    root.remove();
    style.remove();
  }

  return { read, setVisible, dispose, active: true };
}
