import * as THREE from 'three';
import { createDamageModel } from './damage.js';

// A reusable AI-flown FRIENDLY Hammerhead. It knows nothing about attract mode — feed it {enemies, friends}
// each frame and it picks the nearest enemy, flies a heavy banked gun-run at its intercept lead, and fires
// boresight team:'player' bolts (so combat.js kills those enemies for free). It takes damage through a real
// per-ship damage model (sparks/smoke, and canards/wings blow off for drama). With mortal:false it can never
// die (lethal zones self-revive); with mortal:true a lethal hit triggers destroy() (cockpit ejects + the
// hull fractures via the caller's onDestroy). This is the same agent co-op will spawn alongside the player.

const FWD = new THREE.Vector3(0, 0, -1);
const UP = new THREE.Vector3(0, 1, 0);
const ZAX = new THREE.Vector3(0, 0, 1);

const HEAL_DELAY = 1.5; // attract auto-repair: seconds without a hit before a ship starts mending
const HEAL_RATE = 0.3; // fraction of max HP mended per second (so lulls clear the smoke)

const DEFAULT_TUNE = {
  speed: 40, // cruise (energy-managed: brakes into hard turns, opens up when lined up)
  brakeSpeed: 22, // slow into a hard turn -> tighter circle (circle = speed / turnRate)
  boostSpeed: 56, // open up when lined up / extending
  turnRate: 0.85, // lazy, heavy arcs (< Chig 1.4)
  aimTurnRate: 1.6, // sharper when lined up, but still can't pivot on a dime (< Chig 2.8)
  fireRange: 220,
  fireRate: 21, // cinematic bursts, 3x (was 7)
  aimCone: Math.cos(0.6), // steer harder when the target is within ~34deg of the nose
  gimbalCone: Math.cos(0.42), // gun gimbal: fire when the intercept LEAD is within ~24deg (auto-track)
  boltSpeed: 380, // == weapons boltSpeed
  damage: 9, // == player bolt
  bankGain: 3.0, // how readily a turn becomes roll (higher = visibly banks on even lazy turns)
  maxBank: 1.0, // steepest bank (rad, ~57deg) — aircraft-like
  bankResp: 2.6, // how fast roll eases toward the target bank
  sepDist: 26,
  sepStrength: 1.1, // stay off the other allies
  avoidDist: 22,
  avoidStrength: 1.3, // don't ram the target
  hpFloorFrac: 0.4, // immortal revive: lethal zones come back at this fraction
};

export function createAlly(scene, opts) {
  const {
    pivot,
    model,
    radius = 5,
    engineMaterials = [],
    thrusters = null,
    projectiles,
    vfx,
    lighting = null,
    team = 'player',
    mortal = false,
    onDestroy = null, // mortal hull fracture (attract supplies a convex-debris burst)
  } = opts;
  const T = Object.assign({}, DEFAULT_TUNE, opts.tune || {});
  const damageModel = opts.damageModel || createDamageModel({ pivot });
  let healWait = 0; // attract auto-repair countdown (reset on every hit)

  // live refs into the pivot transform + per-instance scratch (NEVER share vectors across allies — see the
  // aliasing bug noted in debris.js).
  const pos = pivot.position;
  const quat = pivot.quaternion;
  const vel = new THREE.Vector3(0, 0, -1).multiplyScalar(T.speed);
  const st = new THREE.Vector3();
  const _toT = new THREE.Vector3();
  const _aim = new THREE.Vector3();
  const _lead = new THREE.Vector3();
  const _away = new THREE.Vector3();
  const _dir = new THREE.Vector3();
  const _right = new THREE.Vector3();
  const _fwd = new THREE.Vector3();
  const _desired = new THREE.Vector3();
  const _look = new THREE.Vector3();
  const _out = new THREE.Vector3();
  const _up = new THREE.Vector3();
  const _zero = new THREE.Vector3();
  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  let curSpeed = T.speed; // energy-managed flight speed (brakes into turns)

  const ally = {
    pivot, model, radius, pos, quat, vel, alive: true,
    fireCd: Math.random() * 0.5,
    roll: 0,
    target: null,
    damageModel,
    update, applyHit, hit: applyHit, patch, destroy,
  };

  // drama: canard/wing torn off -> blow it off as debris but KEEP FLYING (no eject/tumble like the player).
  damageModel.setCallbacks({
    onCanardLost: (zone, node, pt) => blowOff(zone, node, pt, 0xcfe8ff, 0.5, 10, 4),
    onWingLost: (zone, node, pt) => blowOff(zone, node, pt, 0xffd27a, 0.8, 16, 6),
    // onEject/onDestroyed/onFuelRupture intentionally unset: the applyHit revive loop is the immortal net.
  });

  function blowOff(zone, node, pt, color, fwScale, outKick, upKick) {
    if (node) node.visible = false;
    const sign = zone.center.x < 0 ? -1 : 1;
    // wings fracture into chunks (shared pools, burst at this ally's transform); intact clone is the fallback
    const fractured = zone.kind === 'wing' && vfx.fractureWing && vfx.fractureWing(sign < 0 ? 'L' : 'R', { pos, obj: pivot, vel });
    if (!fractured) {
      _out.set(sign, 0, 0).applyQuaternion(quat);
      _up.set(0, 1, 0).applyQuaternion(quat);
      const v = vel.clone().addScaledVector(_out, outKick).addScaledVector(_up, upKick);
      const av = new THREE.Vector3((Math.random() * 2 - 1) * 8, (Math.random() * 2 - 1) * 8, (Math.random() * 2 - 1) * 8);
      if (node) vfx.spawnDebris(node, { vel: v, angVel: av, life: 2.4 });
    }
    vfx.firework(pt, fwScale);
    vfx.spark(pt, color);
  }

  function pickTarget(enemies) {
    let best = null, bd = Infinity;
    for (const e of enemies) {
      if (!e.alive) continue;
      const d = pos.distanceToSquared(e.pos);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  function update(dt, ctx) {
    if (!ally.alive) return;
    const enemies = ctx.enemies || [];
    const friends = ctx.friends || null;

    if (!ally.target || !ally.target.alive) ally.target = pickTarget(enemies);
    const tgt = ally.target;

    // build the steer point
    if (tgt) {
      const dist = pos.distanceTo(tgt.pos) || 1;
      // iterated constant-velocity intercept lead (same shape as the Chig AI), so the nose tracks the shot
      let tHit = dist / T.boltSpeed;
      const tvel = tgt.vel || _zero.set(0, 0, 0);
      for (let k = 0; k < 3; k++) { _lead.copy(tgt.pos).addScaledVector(tvel, tHit); tHit = _lead.distanceTo(pos) / T.boltSpeed; }
      st.copy(_lead);
      if (dist < T.avoidDist) { _away.copy(pos).sub(tgt.pos).normalize(); st.addScaledVector(_away, ((T.avoidDist - dist) / T.avoidDist) * T.avoidStrength * T.avoidDist); }
    } else {
      st.copy(pos).addScaledVector(vel, 2); // no target -> cruise straight
    }
    // separation from other allies so they fan out instead of stacking
    if (friends) for (const o of friends) {
      if (o === ally || !o.alive) continue;
      const d = pos.distanceTo(o.pos);
      if (d > 1e-3 && d < T.sepDist) { _away.copy(pos).sub(o.pos).multiplyScalar(1 / d); st.addScaledVector(_away, (T.sepDist - d) * T.sepStrength); }
    }

    // how on-target are we? (drives both the sharper steer and the energy management)
    _fwd.copy(FWD).applyQuaternion(quat);
    let aiming = false, onAxis = 1;
    if (tgt) {
      _toT.copy(tgt.pos).sub(pos);
      const dist = _toT.length() || 1;
      onAxis = _fwd.dot(_toT.multiplyScalar(1 / dist)); // 1 = nose dead on the target
      aiming = dist < T.fireRange && onAxis > T.aimCone;
    }
    // ENERGY MANAGEMENT: brake into hard turns (target off the nose) for a tighter circle, open up when
    // lined up / extending. circle = speed / turnRate, so slowing literally tightens the turn.
    const spdTarget = THREE.MathUtils.lerp(T.boostSpeed, T.brakeSpeed, THREE.MathUtils.clamp((1 - onAxis) * 1.3, 0, 1));
    curSpeed += (spdTarget - curSpeed) * (1 - Math.exp(-2.5 * dt));

    // bank like an aircraft: project the steer direction onto the ship's right axis -> how hard we're
    // turning, amplify it, and roll INTO the turn (so even gentle, lazy turns produce a visible bank).
    _dir.copy(st).sub(pos);
    if (_dir.lengthSq() > 1e-6) _dir.normalize();
    _right.copy(_fwd).cross(UP);
    if (_right.lengthSq() > 1e-6) _right.normalize();
    const turn = THREE.MathUtils.clamp(_dir.dot(_right) * T.bankGain, -1, 1); // +1 = turning hard right
    const bankTarget = -turn * T.maxBank; // roll into the turn
    ally.roll += (bankTarget - ally.roll) * (1 - Math.exp(-T.bankResp * dt));

    steer(dt, aiming ? T.aimTurnRate : T.turnRate);
    orient();

    // AUTO-TRACKING gun (like the player's gimballed cannon): aim the bolt at the target's intercept LEAD
    // within a cone of the nose -> they actually connect, and keep firing even when the nose is a bit off.
    ally.fireCd -= dt;
    if (tgt && ally.fireCd <= 0) {
      _fwd.copy(FWD).applyQuaternion(quat); // post-orient nose
      const muzzle = _out.copy(_fwd).multiplyScalar(radius * 0.95).add(pos);
      _aim.copy(_lead).sub(muzzle);
      const ad = _aim.length() || 1;
      _aim.multiplyScalar(1 / ad);
      if (ad < T.fireRange && _fwd.dot(_aim) > T.gimbalCone) {
        ally.fireCd = 1 / T.fireRate;
        const bvel = _up.copy(_aim).multiplyScalar(T.boltSpeed).add(vel); // fire AT the lead, not down the nose
        projectiles.spawn({ pos: muzzle, vel: bvel, color: 0xffffff, team, damage: T.damage, life: 2.0, radius: 0.4, scale: 0.5 });
        if (lighting) lighting.muzzleFlash(muzzle);
      }
    }

    if (thrusters) thrusters.update(0.85, dt);
    for (const m of engineMaterials) m.emissiveIntensity = 1.8 + 0.85 * 3.2;
    // ATTRACT auto-repair: slowly mend damaged zones during lulls so the smoke isn't perpetual (and blown
    // canards/wings regrow). Every hit resets the timer, so a ship under sustained fire keeps smoking.
    if (!mortal) {
      healWait -= dt;
      if (healWait <= 0) for (const z of damageModel.zones) {
        if (z.hp >= z.maxHp) continue;
        z.hp = Math.min(z.maxHp, z.hp + z.maxHp * HEAL_RATE * dt);
        if (!z.alive && z.hp >= z.maxHp * 0.5) { z.alive = true; if (z.node) z.node.visible = true; } // regrow a blown part
      }
    }
    damageModel.update(dt, vfx); // per-zone smoke/embers (auto-stops once a zone heals back above the smoke threshold)
  }

  // lerp velocity toward (st - pos) at `turn`, then advance (mirrors enemies.steer)
  function steer(dt, turn) {
    _desired.copy(st).sub(pos);
    if (_desired.lengthSq() > 1e-6) _desired.setLength(curSpeed);
    vel.lerp(_desired, 1 - Math.exp(-turn * dt));
    if (vel.lengthSq() > 1e-6) vel.setLength(curSpeed);
    pos.addScaledVector(vel, dt);
  }

  // nose (-Z) along velocity + the eased bank roll about the nose axis
  function orient() {
    _look.copy(vel).normalize();
    _m.lookAt(_zero.set(0, 0, 0), _look, UP);
    quat.setFromRotationMatrix(_m);
    _q.setFromAxisAngle(ZAX, ally.roll);
    quat.multiply(_q);
  }

  function applyHit(worldPoint, dmg, fromPoint) {
    if (!ally.alive) return null;
    healWait = HEAL_DELAY; // took a hit -> hold off the auto-repair
    const zone = damageModel.applyHit(worldPoint, dmg, fromPoint);
    const lethal = (z) => z && (z.kind === 'cockpit' || z.kind === 'fuselage' || z.kind === 'fuel');
    if (!mortal) {
      // immortal: revive any lethal zone the hit just killed (nothing fatal can fire), AND the GUN so an
      // ally never gets disarmed — it keeps smoking but keeps shooting.
      for (const z of damageModel.zones) {
        if (!z.alive && (lethal(z) || z.kind === 'gun')) {
          z.alive = true;
          z.hp = z.maxHp * T.hpFloorFrac;
          vfx.spark(worldPoint, 0xcfe8ff);
          vfx.ember(worldPoint, 0.25);
        }
      }
    } else if (lethal(zone) && !zone.alive) {
      destroy(worldPoint);
    }
    return zone;
  }

  // STRETCH: eject the cockpit (canopy flies clear) then let the caller fracture the hull. Marks the ally
  // out of the fight; patch() (wave reset) brings it back.
  function destroy() {
    if (!ally.alive) return;
    ally.alive = false;
    ejectCockpit();
    vfx.explosion(pos, 2.4);
    if (onDestroy) onDestroy(ally); // attract: burst the convex Hammerhead debris at this transform
    if (model) model.visible = false;
  }

  function ejectCockpit() {
    let canopy = null;
    pivot.traverse((o) => { if (!canopy && /canopy/i.test(o.name)) canopy = o; });
    _look.copy(FWD).applyQuaternion(quat); // nose
    _up.set(0, 1, 0).applyQuaternion(quat);
    const v = vel.clone().addScaledVector(_up, 22).addScaledVector(_look, -8); // pop up + back, riding momentum
    if (canopy) vfx.spawnDebris(canopy, { vel: v, angVel: new THREE.Vector3(2, 3, 1), life: 3.2 });
    vfx.spark(pos, 0xcfe8ff);
    vfx.firework(pos, 0.6);
  }

  function patch() {
    damageModel.reset(); // restores zone hp + re-shows blown-off canard/wing/canopy nodes
    ally.alive = true;
    ally.roll = 0;
    if (model) model.visible = true;
  }

  return ally;
}
