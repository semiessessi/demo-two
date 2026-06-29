import * as THREE from 'three';

// In-flight WEAPON & TARGET selection HUD. A vertical STACK (the WEAPON column) navigable up/down, with a
// TARGET column to its left and an OPTIONS column to its right. Navigated by the d-pad (12/13/14/15) or the
// -,=,[,] keys; the selected item is fired/activated with LT / Ctrl (input.selectFire). The front gun stays
// always-on on RT/Space; the afterburner is a stack item (the only way to boost). See the plan for the full
// control scheme.
//
//   = / -  up / down within a column        [ / ]  move column left / right
//   LT / Ctrl  fire / activate selected      (RT / Space still fire the front gun independently)

const PANEL = 'background:rgba(12,14,22,0.55);border:1px solid rgba(150,180,255,0.1);border-radius:14px;backdrop-filter:blur(8px);';
const FONT = 'font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#cdd6ea;';

function el(tag, css, parent) {
  const e = document.createElement(tag);
  if (css) e.style.cssText = css;
  if (parent) parent.appendChild(e);
  return e;
}

let styleInjected = false;
function injectStyle() {
  if (styleInjected) return;
  styleInjected = true;
  const s = document.createElement('style');
  s.textContent =
    `#weapon-select { position:fixed; left:18px; top:50%; transform:translateY(-50%); z-index:50; display:none;` +
    ` ${FONT} }` +
    `#weapon-select.show { display:flex; gap:8px; align-items:flex-start; }` +
    `#weapon-select .ws-col { ${PANEL} padding:8px 10px; min-width:128px; opacity:0.5; transition:opacity 0.12s ease, border-color 0.12s ease; }` +
    `#weapon-select .ws-col.on { opacity:1; border-color:rgba(150,180,255,0.45); }` +
    `#weapon-select .ws-head { font-size:9px; letter-spacing:0.16em; color:#9fb0d0; margin:0 0 6px 2px; }` +
    `#weapon-select .ws-row { font-size:12px; line-height:1.45; padding:3px 7px; margin:1px 0; border-radius:6px; white-space:nowrap; color:#cdd6ea; }` +
    `#weapon-select .ws-row.sel { background:rgba(120,170,255,0.16); }` +
    `#weapon-select .ws-row.cur { outline:2px solid #9ec7ff; outline-offset:-1px; }` +
    `#weapon-select .ws-row.dim { color:#7a86a0; }` +
    `#weapon-select .ws-dot { color:#7fd08a; }`;
  document.head.appendChild(s);
}

const MISSILE_SPEED = 240, MISSILE_TURN = 2.6, MISSILE_DAMAGE = 44;
const REAR_SPEED = 340, REAR_RANGE = 260, REAR_SPREAD = 5; // degrees — rear-gun scatter cone

// Rear-gun muzzle ports (pivot-local frame: forward -Z, up +Y, right +X). Live-editable in
// ?debug -> "Rear Gun Ports (edit)" — drag them, then "log ports -> console" and paste back here.
// `dir` = the straight-back aim used when there's no rear target; fire scatters in a REAR_SPREAD cone.
export const REAR_GUN_PORTS = [
  { name: 'Rear Gun L', pos: [0.15, 0.5, 1.85], dir: [0, 0, 1] },
  { name: 'Rear Gun R', pos: [-0.15, 0.5, 1.85], dir: [0, 0, 1] },
];

export function createWeaponSelect({ scene, ship, projectiles, cannon, getEnemies, settings, applyLoadout, vfx } = {}) {
  injectStyle();

  // --- state ---
  let col = 1;            // 0 = TARGET, 1 = WEAPON (default), 2 = OPTIONS
  let weaponIdx = 0;
  let optionIdx = 0;
  let items = [];
  let repeatT = 0;        // hold-repeat timer for up/down
  let pvel = null;        // player velocity (bolt momentum); refreshed each update — position comes from ship.pivot
  const prevNav = { up: false, dn: false, lf: false, rt: false };
  const missilesLive = []; // { b, item, target } homing records
  let visible = false;

  // temps (no per-frame allocation)
  const _fwd = new THREE.Vector3(), _rear = new THREE.Vector3(), _mpos = new THREE.Vector3();
  const _dir = new THREE.Vector3(), _vel = new THREE.Vector3(), _to = new THREE.Vector3();
  const _t1 = new THREE.Vector3(), _t2 = new THREE.Vector3();

  // --- DOM ---
  const root = el('div', '', document.body);
  root.id = 'weapon-select';
  const colTarget = el('div', '', root); colTarget.className = 'ws-col';
  const colWeapon = el('div', '', root); colWeapon.className = 'ws-col';
  const colOptions = el('div', '', root); colOptions.className = 'ws-col';
  el('div', '', colTarget).className = 'ws-head';  colTarget.firstChild.textContent = 'TARGET';
  el('div', '', colWeapon).className = 'ws-head';  colWeapon.firstChild.textContent = 'WEAPON';
  el('div', '', colOptions).className = 'ws-head'; colOptions.firstChild.textContent = 'OPTIONS';
  const targetRows = el('div', '', colTarget);
  const weaponRows = el('div', '', colWeapon);
  const optionRows = el('div', '', colOptions);

  // --- build the stack from the loadout ---
  function countMounts(type) {
    const L = settings.loadout || {};
    let n = 0;
    for (const k of ['L1', 'L2', 'L3', 'R1', 'R2', 'R3']) if (L[k] === type) n++;
    return n;
  }

  function rebuild() {
    items = [];
    // 1) Front gun — always. Auto-fire / Manual-fire.
    items.push({
      key: 'gun', label: 'FRONT GUN', type: 'gun', modeIdx: 1, cd: 0,
      options: [{ label: 'Auto-fire', kind: 'mode' }, { label: 'Manual-fire', kind: 'mode' }],
      autoTick(ctx) { if (this.modeIdx === 0) ctx.input.fire = Math.max(ctx.input.fire, 1); },
      activate(ctx, ev) { if (ev.held) ctx.input.fire = Math.max(ctx.input.fire, 1); },
    });
    // 2) Rear cannon — always (a working example). Auto = point-defence at rear threats; Manual = fires back.
    items.push({
      key: 'rear', label: 'REAR CANNON', type: 'rear', modeIdx: 1, cd: 0,
      options: [{ label: 'Auto-fire', kind: 'mode' }, { label: 'Manual-fire', kind: 'mode' }],
      autoTick(ctx) { if (this.modeIdx === 0) fireRear(ctx, this, true); },
      activate(ctx, ev) { if (ev.held) fireRear(ctx, this, false); },
    });
    // 3) Missiles, grouped by type (pairs hold 2 each; LR holds 1).
    const mp = countMounts('missile-pair'), lr = countMounts('lr-missile');
    if (mp > 0) items.push(missileItem('missilePair', 'MISSILES', mp * 2));
    if (lr > 0) items.push(missileItem('lrMissile', 'LR MISSILE', lr));
    // 4) Fuel tanks — jettison.
    for (const mount of ['fuelL', 'fuelR']) {
      if ((settings.loadout || {})[mount] === 'fuel') {
        items.push({
          key: mount, label: `FUEL TANK ${mount === 'fuelL' ? 'L' : 'R'}`, type: 'fuel',
          options: [{ label: 'Jettison', kind: 'action', apply: (ctx) => jettison(ctx, mount) }],
        });
      }
    }
    // 5) Afterburner — always; the only boost.
    items.push({
      key: 'afterburner', label: 'AFTERBURNER', type: 'afterburner', options: [],
      activate(ctx, ev) { if (ev.held) ctx.input.boost = true; },
    });

    col = 1;
    weaponIdx = Math.min(weaponIdx, items.length - 1);
    optionIdx = 0;
    missilesLive.length = 0;
    buildWeaponRows();
    buildOptionRows();
  }

  function missileItem(key, label, ammo) {
    return {
      key, label, type: 'missile', modeIdx: 0, ammo, cd: 0,
      options: [{ label: 'Track', kind: 'mode' }, { label: 'No-track', kind: 'mode' }],
      activate(ctx, ev) { if (ev.pressed) fireMissile(ctx, this); },
    };
  }

  // --- firing ---
  function rearTarget() {
    _rear.set(0, 0, 1).applyQuaternion(ship.pivot.quaternion);
    const pos = ship.pivot.position;
    let best = null, bd = Infinity;
    for (const e of getEnemies()) {
      if (!e.alive) continue;
      _to.copy(e.pos).sub(pos);
      const d = _to.length() || 1;
      if (d > REAR_RANGE) continue;
      if (_rear.dot(_to) / d < 0.2) continue; // not behind us
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  // perturb `dir` (in place) to a random direction within a `deg`-degree cone around it
  function scatterDir(dir, deg) {
    const ang = THREE.MathUtils.degToRad(deg) * Math.sqrt(Math.random());
    const az = Math.random() * Math.PI * 2;
    _t1.set(0, 1, 0);
    if (Math.abs(dir.dot(_t1)) > 0.95) _t1.set(1, 0, 0);
    _t2.crossVectors(dir, _t1).normalize();
    _t1.crossVectors(_t2, dir).normalize();
    const s = Math.sin(ang);
    dir.multiplyScalar(Math.cos(ang)).addScaledVector(_t1, Math.cos(az) * s).addScaledVector(_t2, Math.sin(az) * s).normalize();
  }

  // Fire from BOTH rear muzzle ports (REAR_GUN_PORTS, pivot-local), aiming at a rear target if there is one
  // else straight back, scattering each bolt in a REAR_SPREAD-degree cone.
  function fireRear(ctx, item, auto) {
    if (item.cd > 0) return;
    const tgt = rearTarget();
    if (auto && !tgt) return; // auto only fires when something's behind us
    const q = ship.pivot.quaternion, base = ship.pivot.position;
    for (const port of REAR_GUN_PORTS) {
      _mpos.set(port.pos[0], port.pos[1], port.pos[2]).applyQuaternion(q).add(base); // pivot-local muzzle -> world
      if (tgt) { _dir.copy(tgt.pos).sub(_mpos).normalize(); }
      else { _dir.set(port.dir[0], port.dir[1], port.dir[2]).applyQuaternion(q).normalize(); }
      scatterDir(_dir, REAR_SPREAD);
      _vel.copy(_dir).multiplyScalar(REAR_SPEED);
      if (pvel) _vel.add(pvel);
      projectiles.spawn({ pos: _mpos, vel: _vel, color: 0x9fd8ff, team: 'player', damage: 7, life: 1.8, radius: 0.4, scale: 0.5, glow: 1.2 });
    }
    item.cd = auto ? 0.14 : 0.16;
  }

  function fireMissile(ctx, item) {
    if (item.cd > 0 || item.ammo <= 0) return;
    _fwd.set(0, 0, -1).applyQuaternion(ship.pivot.quaternion);
    _mpos.copy(ship.pivot.position).addScaledVector(_fwd, ship.radius);
    const tgt = cannon.target && cannon.target.alive ? cannon.target : null;
    if (tgt) { _dir.copy(tgt.pos).sub(_mpos).normalize(); } else { _dir.copy(_fwd); }
    _vel.copy(_dir).multiplyScalar(MISSILE_SPEED);
    if (pvel) _vel.add(pvel);
    const b = projectiles.spawn({ pos: _mpos, vel: _vel, color: 0xffa040, team: 'player', damage: MISSILE_DAMAGE, life: 4.0, radius: 0.8, scale: 1.2, width: 1.4, glow: 2.2, noise: 0.2 });
    item.ammo--;
    item.cd = 0.5;
    if (b && item.modeIdx === 0 && tgt) missilesLive.push({ b, item, target: tgt }); // Track mode -> homing
  }

  function advanceHoming(dt) {
    for (let i = missilesLive.length - 1; i >= 0; i--) {
      const r = missilesLive[i];
      if (!r.b.alive) { missilesLive.splice(i, 1); continue; }
      const t = (cannon.target && cannon.target.alive) ? cannon.target : (r.target && r.target.alive ? r.target : null);
      if (!t) continue;
      _dir.copy(t.pos).sub(r.b.pos);
      const dist = _dir.length() || 1; _dir.multiplyScalar(1 / dist);
      const speed = r.b.vel.length() || MISSILE_SPEED;
      _vel.copy(r.b.vel).normalize().lerp(_dir, Math.min(1, MISSILE_TURN * dt)).normalize().multiplyScalar(speed);
      r.b.vel.copy(_vel);
    }
  }

  function jettison(ctx, mount) {
    settings.loadout[mount] = 'empty';
    applyLoadout(ship, settings.loadout);
    rebuild(); // the fuel item leaves the stack
  }

  // --- navigation ---
  function activePad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  function moveCol(d) {
    const nc = col + d;
    if (nc < 0 || nc > 2) return;
    if (nc === 2 && !(items[weaponIdx] && items[weaponIdx].options.length)) return; // no options -> can't expand right
    col = nc;
    if (col === 2) { optionIdx = Math.min(items[weaponIdx].modeIdx ?? 0, items[weaponIdx].options.length - 1); buildOptionRows(); }
  }

  function moveRow(d) {
    if (col === 1) {
      const n = items.length; if (!n) return;
      weaponIdx = (weaponIdx + d + n) % n;
      optionIdx = 0;
      buildOptionRows();
    } else if (col === 0) {
      cannon.cycleTarget(d);
    } else if (col === 2) {
      const opts = items[weaponIdx] ? items[weaponIdx].options : [];
      if (opts.length) optionIdx = (optionIdx + d + opts.length) % opts.length;
    }
  }

  // --- per-frame ---
  function update(dt, input, vel) {
    if (vel) pvel = vel;
    if (!visible) { for (const it of items) if (it.cd > 0) it.cd = 0; return; }
    for (const it of items) if (it.cd > 0) it.cd = Math.max(0, it.cd - dt);

    // nav intents: keyboard (-,=,[,]) OR d-pad (12/13/14/15)
    const keys = input.keys;
    const pad = activePad();
    const pb = pad ? pad.buttons : null;
    const pd = (i) => !!(pb && pb[i] && pb[i].pressed);
    const cur = {
      up: keys.has('Equal') || pd(12),
      dn: keys.has('Minus') || pd(13),
      lf: keys.has('BracketLeft') || pd(14),
      rt: keys.has('BracketRight') || pd(15),
    };
    // column moves: edge only
    if (cur.lf && !prevNav.lf) moveCol(-1);
    if (cur.rt && !prevNav.rt) moveCol(1);
    // up/down: edge + hold-repeat
    if (cur.up || cur.dn) {
      const fresh = (cur.up && !prevNav.up) || (cur.dn && !prevNav.dn);
      if (fresh) { repeatT = 0.26; moveRow(cur.up ? -1 : 1); }
      else { repeatT -= dt; if (repeatT <= 0) { repeatT = 0.12; moveRow(cur.up ? -1 : 1); } }
    } else repeatT = 0;
    prevNav.up = cur.up; prevNav.dn = cur.dn; prevNav.lf = cur.lf; prevNav.rt = cur.rt;

    const ctx = { input, cannon, projectiles, scene, ship, getEnemies, settings, applyLoadout, vfx, dt };

    // activation
    if (col === 2) {
      if (input.selectFirePressed) {
        const opt = items[weaponIdx] && items[weaponIdx].options[optionIdx];
        if (opt) { if (opt.kind === 'mode') items[weaponIdx].modeIdx = optionIdx; if (opt.apply) opt.apply(ctx); }
      }
    } else {
      const it = items[weaponIdx];
      if (it && it.activate) it.activate(ctx, { held: !!input.selectFire, pressed: !!input.selectFirePressed });
    }
    // auto-fire weapons run regardless of which item is selected
    for (const it of items) if (it.autoTick) it.autoTick(ctx);

    advanceHoming(dt);
    render();
  }

  // --- rendering ---
  function statusOf(it) {
    if (it.type === 'gun' || it.type === 'rear') return it.modeIdx === 0 ? 'AUTO' : 'MAN';
    if (it.type === 'missile') return `×${it.ammo} · ${it.modeIdx === 0 ? 'TRK' : 'STR'}`;
    return '';
  }

  function buildWeaponRows() {
    weaponRows.textContent = '';
    for (let i = 0; i < items.length; i++) el('div', '', weaponRows).className = 'ws-row';
  }

  function buildOptionRows() {
    optionRows.textContent = '';
    const opts = items[weaponIdx] ? items[weaponIdx].options : [];
    if (!opts.length) { const r = el('div', '', optionRows); r.className = 'ws-row dim'; r.textContent = '— none —'; return; }
    for (const o of opts) el('div', '', optionRows).className = 'ws-row';
  }

  function render() {
    colTarget.classList.toggle('on', col === 0);
    colWeapon.classList.toggle('on', col === 1);
    colOptions.classList.toggle('on', col === 2);

    // weapon rows
    const wr = weaponRows.children;
    for (let i = 0; i < items.length; i++) {
      const it = items[i], row = wr[i];
      if (!row) continue;
      const s = statusOf(it);
      row.textContent = s ? `${it.label} · ${s}` : it.label;
      row.classList.toggle('sel', i === weaponIdx);
      row.classList.toggle('cur', i === weaponIdx && col === 1);
    }

    // option rows
    const it = items[weaponIdx];
    const opts = it ? it.options : [];
    const or = optionRows.children;
    for (let i = 0; i < opts.length; i++) {
      const o = opts[i], row = or[i];
      if (!row) continue;
      const active = o.kind === 'mode' && it.modeIdx === i;
      row.innerHTML = active ? `${o.label} <span class="ws-dot">●</span>` : o.label;
      row.classList.toggle('sel', i === optionIdx);
      row.classList.toggle('cur', i === optionIdx && col === 2);
    }

    // target rows (rebuilt each frame; small N)
    const list = cannon.getTargetList ? cannon.getTargetList() : [];
    targetRows.textContent = '';
    if (!list.length) { const r = el('div', '', targetRows); r.className = 'ws-row dim'; r.textContent = '— no targets —'; }
    const pos = ship.pivot.position;
    for (const e of list) {
      const r = el('div', '', targetRows); r.className = 'ws-row';
      const d = pos ? e.pos.distanceTo(pos) : 0;
      r.textContent = `${e.name} #${e.hash}  ${d.toFixed(0)}`;
      if (e === cannon.target) { r.classList.add('sel'); if (col === 0) r.classList.add('cur'); }
    }
  }

  function setVisible(on) {
    visible = !!on;
    root.classList.toggle('show', visible);
  }

  function dispose() { root.remove(); }

  return { update, rebuild, setVisible, dispose };
}
