import * as THREE from 'three';

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
  const params = {
    fireRate: 27,
    boltSpeed: 380,
    damage: 9,
    gimbalMax: 0.7, // yaw range (rad)
    gimbalMaxV: 0.5, // pitch range (rad)
    gimbalSpring: 14, // snappy tracking so it stays on a leading solution
    color: 0xffffff,
    boltScale: 0.5,
    autoTrack: true,
    lead: true, // aim ahead of the target to account for its motion
    targetRange: 200, // only auto-acquire within this (so you can't snipe the far spawns)
    holdRange: 340, // keep tracking a locked target out to here
    targetCone: 0.5, // half-angle to acquire a target near the crosshair
    holdCone: 1.2, // much wider hold so a lock sticks through the target's manoeuvres
    lockRange: 360, // manual lock can reach further than auto-acquire
    lockCone: 0.7, // half-angle in which a manual lock looks for a target near the crosshair
    muzzle: { x: 0, y: 0, z: -ship.radius * 0.95 }, // gun exit point
  };
  let cooldown = 0;
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
    muzzleLocal.set(params.muzzle.x, params.muzzle.y, params.muzzle.z);
    return muzzleWorld.copy(muzzleLocal).applyQuaternion(ship.pivot.quaternion).add(ship.pivot.position);
  }

  function acquireTarget(enemies, shipPos) {
    // keep the current target while it's alive, within the (wider) hold range + cone
    if (target && target.alive) {
      toE.copy(target.pos).sub(shipPos);
      const d = toE.length();
      if (d <= params.holdRange && fwd.dot(toE.multiplyScalar(1 / d)) >= Math.cos(params.holdCone)) return target;
    }
    // otherwise lock the NEAREST enemy that's near the crosshair, within the acquire range + cone
    let best = null;
    let bestD = Infinity;
    const coneCos = Math.cos(params.targetCone);
    for (const e of enemies) {
      if (!e.alive) continue;
      toE.copy(e.pos).sub(shipPos);
      const d = toE.length();
      if (d > params.targetRange) continue;
      if (fwd.dot(toE.multiplyScalar(1 / d)) < coneCos) continue; // must be near the crosshair
      if (d < bestD) {
        bestD = d; // heavily prefer nearer targets
        best = e;
      }
    }
    target = best;
    return target;
  }

  // Manual lock/cycle: pick the enemy nearest the crosshair (within a generous cone/range) and pin
  // it; pressing again cycles to the next. Falls back to the nearest enemy anywhere if none are near
  // the crosshair. The pinned target is held until it dies (auto-acquire is suppressed while locked).
  function cycleLock() {
    const shipPos = ship.pivot.position;
    lockList.length = 0;
    for (const e of getEnemies()) {
      if (!e.alive) continue;
      toE.copy(e.pos).sub(shipPos);
      const d = toE.length() || 1;
      if (d > params.lockRange) continue;
      const dot = fwd.dot(toE.multiplyScalar(1 / d));
      if (dot >= Math.cos(params.lockCone)) lockList.push({ e, dot });
    }
    if (lockList.length === 0) {
      // nothing near the crosshair — lock the nearest enemy anywhere
      let best = null;
      let bd = Infinity;
      for (const e of getEnemies()) {
        if (!e.alive) continue;
        const d = e.pos.distanceToSquared(shipPos);
        if (d < bd) { bd = d; best = e; }
      }
      target = best;
      locked = !!best;
      return;
    }
    lockList.sort((a, b) => b.dot - a.dot); // nearest the crosshair first
    const order = lockList.map((c) => c.e);
    const idx = order.indexOf(target);
    target = order[(idx + 1) % order.length]; // idx === -1 -> first; otherwise cycle to next
    locked = true;
  }

  function update(dt, input, player) {
    const shipQ = ship.pivot.quaternion;
    up.set(0, 1, 0).applyQuaternion(shipQ);
    right.set(1, 0, 0).applyQuaternion(shipQ);
    fwd.set(0, 0, -1).applyQuaternion(shipQ);

    // --- target resolution (independent of how the gun is being aimed) ---
    if (input?.lockPressed) cycleLock();
    if (locked && (!target || !target.alive)) locked = false; // pinned target gone -> release
    if (!locked) target = params.autoTrack ? acquireTarget(getEnemies(), ship.pivot.position) : null;

    // --- aim ---
    const manual = Math.abs(input?.gunAimX || 0) > MANUAL_DEADZONE || Math.abs(input?.gunAimY || 0) > MANUAL_DEADZONE;
    let tYaw = 0;
    let tPitch = 0;
    if (manual) {
      // hand control overrides tracking, but the locked/auto target stays selected for the display
      tYaw = -(input?.gunAimX || 0) * params.gimbalMax; // left aims left
      // the cannon can only depress (aim down), never elevate above level
      tPitch = THREE.MathUtils.clamp(-(input?.gunAimY || 0) * params.gimbalMaxV, -params.gimbalMaxV, 0);
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
          leadPos.copy(tgt.pos).addScaledVector(relVel, t);
        } else {
          leadPos.copy(tgt.pos);
        }
        inv.copy(shipQ).invert();
        local.copy(leadPos).sub(ship.pivot.position).applyQuaternion(inv).normalize(); // -Z fwd, +X right, +Y up
        tYaw = THREE.MathUtils.clamp(Math.atan2(-local.x, -local.z), -params.gimbalMax, params.gimbalMax);
        // down-only: clamp elevation to [-gimbalMaxV, 0] so the gun never points above level
        tPitch = THREE.MathUtils.clamp(Math.atan2(local.y, Math.hypot(local.x, local.z)), -params.gimbalMaxV, 0);
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
    if ((input?.fire || 0) > 0.5 && cooldown <= 0) {
      cooldown = 1 / params.fireRate;
      muzzle();
      vel.copy(aimDir).multiplyScalar(params.boltSpeed);
      if (player?.vel) vel.add(player.vel);
      projectiles.spawn({ pos: muzzleWorld, vel, color: params.color, team: 'player', damage: params.damage, life: 2.0, radius: 0.4, scale: params.boltScale });
      flash.visible = true;
      flashLife = FLASH_TIME;
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
