import * as THREE from 'three';
import { FRONT_GUN } from './frontGun.js';

// Player front cannon. Fires while input.fire (Space / right trigger) is held: rate-limited white
// tracers from the gun exit, inheriting ship velocity, with a muzzle flare.
//
// Gimbaled aim with two modes:
//   • Manual — if the right stick is being pushed (gunAimX/Y), the player aims by hand (yaw up to
//     gimbalMax, pitch up to gimbalMaxV), springing back to centre when released.
//   • Auto-track — otherwise the gun locks the enemy nearest the crosshair (within range + a cone)
//     and tracks it within the gimbal limits. Keyboard players (no stick) always get auto-track.
// `aimDir` (world) and `target` are exposed for the HUD crosshair + target reticle.

function flashTexture() {
  const s = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0.0, 'rgba(255,250,210,1)');
  g.addColorStop(0.4, 'rgba(255,200,90,0.7)');
  g.addColorStop(1.0, 'rgba(255,140,40,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const FLASH_TIME = 0.06;
const MANUAL_DEADZONE = 0.1;

export function createPlayerCannon(scene, ship, projectiles, opts = {}) {
  const getEnemies = opts.getEnemies || (() => []);
  const canFire = opts.canFire || (() => true); // false once the Gun subsystem is destroyed
  const onFire = opts.onFire || null; // (muzzleWorld) -> pulse a real muzzle-flash light
  const params = {
    fireRate: 27,
    boltSpeed: 380,
    damage: 9,
    gimbalMax: 0.85, // yaw range (rad, ±)
    gimbalMaxV: 0.5, // pitch DOWN range (rad)
    gimbalUp: 0.3, // pitch UP range (rad) — chin gun mostly depresses; set 0 for strict down-only
    gimbalSpring: 16, // snappy tracking so it stays on a leading solution
    color: 0xffffff,
    boltScale: 0.5,
    ammo: 2400, // front-gun magazine (rounds) — depletes as it fires
    autoTrack: true,
    lead: true, // aim ahead of the target to account for its motion
    maxLead: 0.6, // cap the intercept time (s) so a close jinker doesn't swing the aim wildly
    targetRange: 220, // only auto-acquire within this (so you can't snipe the far spawns)
    switchMargin: 0.12, // hysteresis (rad): only switch target if another is this much nearer the crosshair
    aimMargin: 0.12, // grace (rad) past the gimbal limits before a target is considered unreachable
    lockRange2: 0, // (unused placeholder kept for save compatibility)
    holdRange: 340, // (legacy, unused by the envelope tracker)
    targetCone: 0.5, // (legacy, unused by the envelope tracker)
    holdCone: 1.2, // (legacy, unused by the envelope tracker)
    lockRange: 360, // manual lock can reach further than auto-acquire
    lockCone: 0.7, // half-angle in which a manual lock looks for a target near the crosshair
    muzzle: { x: 0, y: 0, z: -ship.radius * 0.95 }, // gun exit point
  };
  let cooldown = 0;
  let rounds = params.ammo;
  let gimbalYaw = 0;
  let gimbalPitch = 0;
  let flashLife = 0;
  let target = null;
  let locked = false; // manual lock — pins the target until it dies (suppresses auto-acquire)
  const lockList = [];

  const muzzleLocal = new THREE.Vector3();
  const muzzleWorld = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const up = new THREE.Vector3();
  const right = new THREE.Vector3();
  const qYaw = new THREE.Quaternion();
  const qPitch = new THREE.Quaternion();
  const inv = new THREE.Quaternion();
  const local = new THREE.Vector3();
  const toE = new THREE.Vector3();
  const relVel = new THREE.Vector3();
  const leadPos = new THREE.Vector3();
  const ZERO = new THREE.Vector3();
  const vel = new THREE.Vector3();
  const aimDir = new THREE.Vector3(0, 0, -1);

  const flash = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: flashTexture(), color: 0xffe6a0, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
  );
  flash.visible = false;
  flash.frustumCulled = false;
  scene.add(flash);

  function muzzle() {
    // gun mount (ship-local) -> world, then out along the aimed barrel to the tip (flash + bolts spawn here)
    muzzleLocal.set(FRONT_GUN.mount[0], FRONT_GUN.mount[1], FRONT_GUN.mount[2]);
    return muzzleWorld.copy(muzzleLocal).applyQuaternion(ship.pivot.quaternion).add(ship.pivot.position).addScaledVector(aimDir, FRONT_GUN.barrel);
  }

  const selInv = new THREE.Quaternion();
  const selDir = new THREE.Vector3();
  // Pick the enemy the gun can actually engage: among alive enemies within range AND inside the gimbal
  // ENVELOPE (never behind, within the yaw/elevation the mount can reach), the one nearest the crosshair.
  // Light hysteresis (switchMargin) stops jitter but it still switches readily; an out-of-envelope target
  // (incl. anything that slips behind) is dropped so the gun re-centres instead of flailing at its limit.
  function acquireTarget(enemies, shipPos, shipQ) {
    selInv.copy(shipQ).invert();
    const yawLim = params.gimbalMax + params.aimMargin;
    const upLim = params.gimbalUp + params.aimMargin;
    const downLim = params.gimbalMaxV + params.aimMargin;
    const rng2 = params.targetRange * params.targetRange;
    let best = null;
    let bestAng = Infinity;
    let curAng = Infinity;
    for (const e of enemies) {
      if (!e.alive) continue;
      selDir.copy(e.pos).sub(shipPos);
      const d2 = selDir.lengthSq();
      if (d2 > rng2) continue;
      selDir.applyQuaternion(selInv); // into the ship frame (-Z forward)
      if (selDir.z >= 0) continue; // behind the nose
      selDir.normalize();
      const yaw = Math.atan2(-selDir.x, -selDir.z);
      const pitch = Math.atan2(selDir.y, Math.hypot(selDir.x, selDir.z));
      if (Math.abs(yaw) > yawLim || pitch > upLim || pitch < -downLim) continue; // outside the gimbal cone
      const ang = Math.acos(Math.min(1, -selDir.z)) + 0.0004 * Math.sqrt(d2); // angle off the crosshair (+ slight range bias)
      if (e === target) curAng = ang;
      if (ang < bestAng) { bestAng = ang; best = e; }
    }
    // keep the current target unless a clearly-nearer one is available
    if (target && target.alive && curAng < Infinity && curAng - bestAng < params.switchMargin) return target;
    target = best;
    return target;
  }

  // Manual lock/cycle: pick the enemy nearest the crosshair (within a generous cone/range) and pin
  // it; pressing again cycles to the next. Falls back to the nearest enemy anywhere if none are near
  // the crosshair. The pinned target is held until it dies (auto-acquire is suppressed while locked).
  // Ordered in-range targets (crosshair cone + range), nearest-the-crosshair first. Computes a fresh forward
  // so it never depends on update()'s call order (the weapon-select TARGET column reads it before update runs).
  function targetOrder() {
    const shipPos = ship.pivot.position;
    fwd.set(0, 0, -1).applyQuaternion(ship.pivot.quaternion);
    lockList.length = 0;
    for (const e of getEnemies()) {
      if (!e.alive) continue;
      toE.copy(e.pos).sub(shipPos);
      const d = toE.length() || 1;
      if (d > params.lockRange) continue;
      const dot = fwd.dot(toE.multiplyScalar(1 / d));
      if (dot >= Math.cos(params.lockCone)) lockList.push({ e, dot });
    }
    lockList.sort((a, b) => b.dot - a.dot); // nearest the crosshair first
    return lockList.map((c) => c.e);
  }
  // TARGET-column / lock list: falls back to the single nearest enemy anywhere if none are near the crosshair
  // (mirrors the old fallback). Does NOT mutate target/locked.
  function getTargetList() {
    const order = targetOrder();
    if (order.length) return order;
    let best = null, bd = Infinity;
    const shipPos = ship.pivot.position;
    for (const e of getEnemies()) { if (!e.alive) continue; const d = e.pos.distanceToSquared(shipPos); if (d < bd) { bd = d; best = e; } }
    return best ? [best] : [];
  }
  // Cycle the pinned target by dir (+1 next, -1 prev). Held until it dies (auto-acquire suppressed while locked).
  function cycleTarget(dir) {
    const order = getTargetList();
    if (order.length === 0) { target = null; locked = false; return; }
    const idx = order.indexOf(target);
    target = order[(idx + dir + order.length) % order.length];
    locked = true;
  }
  function cycleLock() { cycleTarget(1); } // X / R3 = cycle to the next
  function setTarget(e) { target = e; locked = !!e; }

  function update(dt, input, player) {
    const shipQ = ship.pivot.quaternion;
    up.set(0, 1, 0).applyQuaternion(shipQ);
    right.set(1, 0, 0).applyQuaternion(shipQ);
    fwd.set(0, 0, -1).applyQuaternion(shipQ);

    // --- target resolution (independent of how the gun is being aimed) ---
    if (input?.lockPressed) cycleLock();
    if (locked && (!target || !target.alive)) locked = false; // pinned target gone -> release
    if (!locked) target = params.autoTrack ? acquireTarget(getEnemies(), ship.pivot.position, shipQ) : null;

    // --- aim ---
    const manual = Math.abs(input?.gunAimX || 0) > MANUAL_DEADZONE || Math.abs(input?.gunAimY || 0) > MANUAL_DEADZONE;
    let tYaw = 0;
    let tPitch = 0;
    if (manual) {
      // hand control overrides tracking, but the locked/auto target stays selected for the display
      tYaw = -(input?.gunAimX || 0) * params.gimbalMax; // left aims left
      // mostly depresses, with a little elevation (gimbalUp; 0 = strict down-only)
      tPitch = THREE.MathUtils.clamp(-(input?.gunAimY || 0) * params.gimbalMaxV, -params.gimbalMaxV, params.gimbalUp);
    } else {
      const tgt = target;
      if (tgt) {
        // Linear-intercept lead: aim where the target will be when the bolt arrives. In the player's
        // frame the bolt travels at boltSpeed along aim; the target moves at its velocity relative to
        // the player (the bolt also inherits player velocity). Solve |R + V t| = S t for the soonest
        // hit time t, then aim at tgt.pos + V t.
        muzzle();
        toE.copy(tgt.pos).sub(muzzleWorld); // R
        relVel.copy(tgt.vel || ZERO).sub((player && player.vel) || ZERO); // V
        const S = params.boltSpeed;
        let t = toE.length() / S; // fallback / no-lead value
        if (params.lead) {
          const a = relVel.dot(relVel) - S * S;
          const b = 2 * toE.dot(relVel);
          const c = toE.dot(toE);
          const disc = b * b - 4 * a * c;
          if (disc >= 0 && Math.abs(a) > 1e-5) {
            const sq = Math.sqrt(disc);
            const t1 = (-b - sq) / (2 * a);
            const t2 = (-b + sq) / (2 * a);
            const tp = Math.min(t1 > 0 ? t1 : Infinity, t2 > 0 ? t2 : Infinity);
            if (Number.isFinite(tp)) t = tp;
          }
        } else {
          t = 0;
        }
        t = Math.min(Math.max(t, 0), params.maxLead); // cap the lead so a close jinker doesn't swing the aim
        leadPos.copy(tgt.pos).addScaledVector(relVel, t);
        inv.copy(shipQ).invert();
        local.copy(leadPos).sub(ship.pivot.position).applyQuaternion(inv); // -Z fwd, +X right, +Y up
        if (local.lengthSq() > 1e-4) {
          local.normalize();
          tYaw = THREE.MathUtils.clamp(Math.atan2(-local.x, -local.z), -params.gimbalMax, params.gimbalMax);
          tPitch = THREE.MathUtils.clamp(Math.atan2(local.y, Math.hypot(local.x, local.z)), -params.gimbalMaxV, params.gimbalUp);
        }
      }
    }

    const k = 1 - Math.exp(-params.gimbalSpring * dt);
    gimbalYaw += (tYaw - gimbalYaw) * k;
    gimbalPitch += (tPitch - gimbalPitch) * k;

    qYaw.setFromAxisAngle(up, gimbalYaw);
    aimDir.copy(fwd).applyQuaternion(qYaw);
    qPitch.setFromAxisAngle(right, gimbalPitch);
    aimDir.applyQuaternion(qPitch).normalize();

    cooldown -= dt;
    if ((input?.fire || 0) > 0.5 && cooldown <= 0 && canFire() && rounds > 0) {
      cooldown = 1 / params.fireRate;
      rounds--;
      muzzle();
      vel.copy(aimDir).multiplyScalar(params.boltSpeed);
      if (player?.vel) vel.add(player.vel);
      projectiles.spawn({ pos: muzzleWorld, vel, color: params.color, team: 'player', damage: params.damage, life: 2.0, radius: 0.4, scale: params.boltScale });
      flash.visible = true;
      flashLife = FLASH_TIME;
      if (onFire) onFire(muzzleWorld); // real muzzle-flash light pulse
    }

    if (flashLife > 0) {
      flashLife -= dt;
      flash.position.copy(muzzle());
      const f = Math.max(0, flashLife / FLASH_TIME);
      flash.scale.setScalar(1.6 + 2.4 * f);
      flash.material.opacity = f;
      if (flashLife <= 0) flash.visible = false;
    }

    return { aimDir, target, locked };
  }

  return {
    update,
    params,
    cycleTarget,   // (dir) cycle the pinned target +1/-1 (weapon-select TARGET column)
    getTargetList, // () -> ordered in-range enemies (panel rows; read-only)
    setTarget,     // (e) pin a specific target
    get ammo() { return rounds; },
    reload() { rounds = params.ammo; }, // refill to full (new launch)
    get gimbalYaw() { return gimbalYaw; }, //   the gun mesh (frontGun) pivots by these to match aimDir
    get gimbalPitch() { return gimbalPitch; },
    get aimDir() {
      return aimDir;
    },
    get target() {
      return target;
    },
    get locked() {
      return locked;
    },
  };
}
