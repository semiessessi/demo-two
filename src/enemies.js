import * as THREE from 'three';
import { spawnChig } from './enemyShip.js';
import { formationSlots } from './formations.js';

// Enemy Chig manager: spawns formations, runs the two-phase AI, and fires blue pulses.
//   Phase A — strafing pass: the formation flies as a unit on runs toward the player (ingress) then
//             past (egress); members hold their slots relative to the anchor.
//   Phase B — dogfight: after `passesBeforeDogfight` runs OR the first loss, the formation SCATTERS
//             into 2-ship elements (a point + a wingman — finger-four style). Points weave/flank the
//             player from different angles; wingmen stay on their point's wing.
// Chigs barrel-roll a lot when not lined up to fire, and level out to take a shot. Enemies orient
// nose (-Z) along velocity. `enemies` is exposed for collision + the LIDAR.

export function createEnemyManager(scene, chigKit, projectiles, opts = {}) {
  const params = {
    speed: 40,
    turnRate: 1.4, // lower = can't perfectly stick to the player's tail (overshoots, makes passes)
    passDist: 70,
    egressTime: 2.0, // longer break-off after a run -> looser, easier to catch
    passesBeforeDogfight: 3, // spend more time in formation strafing runs before breaking up
    formationSpacing: 14, // looser formation
    fireRate: 1.2,
    fireRange: 260,
    fireConeCos: Math.cos(0.32),
    pulseSpeed: 230,
    pulseDamage: 10,
    hp: 30,
    color: 0x5fb0ff,
    rollRate: 4.0, // rad/s of barrel-rolling when not aiming
    wingSpacing: 12, // how far a wingman trails its point
    avoidDist: 34, // start peeling away from the player inside this range
    avoidStrength: 1.4, // how hard they veer off to avoid ramming
  };
  Object.assign(params, opts.params || {});

  const enemies = [];
  const formations = [];
  let kills = 0;

  const FWD = new THREE.Vector3(0, 0, -1);
  const ZAX = new THREE.Vector3(0, 0, 1);
  const UP = new THREE.Vector3(0, 1, 0);
  const ZERO = new THREE.Vector3();
  const desired = new THREE.Vector3();
  const look = new THREE.Vector3();
  const mat = new THREE.Matrix4();
  const rollQ = new THREE.Quaternion();
  const bf = new THREE.Vector3();
  const br = new THREE.Vector3();
  const bu = new THREE.Vector3();
  const st = new THREE.Vector3();
  const toP = new THREE.Vector3();
  const efwd = new THREE.Vector3();
  const eright = new THREE.Vector3();
  const muzzle = new THREE.Vector3();
  const evel = new THREE.Vector3();
  const flank = new THREE.Vector3();
  const awayDir = new THREE.Vector3();

  function spawnFormation({ pattern = 'vee', count = 4, pos, heading }) {
    const slots = formationSlots(pattern, count, params.formationSpacing);
    const anchor = { pos: pos.clone(), vel: heading.clone().setLength(params.speed), phase: 'ingress', egress: 0, passes: 0 };
    const f = { anchor, members: [], slots, initialCount: count, dogfight: false };
    for (let i = 0; i < count; i++) {
      const obj = spawnChig(chigKit.template);
      const e = {
        obj,
        pos: pos.clone(),
        vel: heading.clone().setLength(params.speed),
        hp: params.hp,
        radius: chigKit.radius,
        fireCd: Math.random(),
        formation: f,
        slot: new THREE.Vector3(slots[i].x, slots[i].y, slots[i].z),
        mode: 'formation',
        alive: true,
        roll: Math.random() * Math.PI * 2,
        rollVel: 0,
        rollTimer: 0,
        role: 'point',
        wingOf: null,
        wingSide: i % 2 === 0 ? 1 : -1,
        phase: 'ingress', // per-enemy attack-run state in the dogfight
        egress: 0,
      };
      obj.position.copy(e.pos);
      scene.add(obj);
      enemies.push(e);
      f.members.push(e);
    }
    formations.push(f);
    return f;
  }

  function intoDogfight(f) {
    f.dogfight = true;
    // break into 2-ship elements: point + wingman, each element scattered to a different flank angle
    const m = f.members;
    const elements = Math.ceil(m.length / 2);
    for (let i = 0; i < m.length; i++) {
      const e = m[i];
      e.mode = 'dogfight';
      if (i % 2 === 0) {
        e.role = 'point';
        e.wingOf = null;
        e.attackAngle = (i / 2) * ((Math.PI * 2) / elements) + Math.random() * 0.6;
      } else {
        e.role = 'wing';
        e.wingOf = m[i - 1];
        e.wingSide = i % 4 === 1 ? 1 : -1;
      }
    }
  }

  function orient(e) {
    look.copy(e.vel).normalize();
    mat.lookAt(ZERO, look, UP); // -Z (nose) along velocity
    e.obj.quaternion.setFromRotationMatrix(mat);
    rollQ.setFromAxisAngle(ZAX, e.roll); // barrel roll about the forward axis
    e.obj.quaternion.multiply(rollQ);
  }

  function steer(e, target, dt, speed) {
    desired.copy(target).sub(e.pos);
    if (desired.lengthSq() > 1e-6) desired.setLength(speed);
    e.vel.lerp(desired, 1 - Math.exp(-params.turnRate * dt));
    if (e.vel.lengthSq() > 1e-6) e.vel.setLength(speed);
    e.pos.addScaledVector(e.vel, dt);
    e.obj.position.copy(e.pos);
  }

  function updateRoll(e, aiming, dt) {
    if (aiming) {
      // level out to take the shot
      e.rollVel += (0 - e.rollVel) * (1 - Math.exp(-7 * dt));
      e.roll += (0 - e.roll) * (1 - Math.exp(-5 * dt));
    } else {
      e.rollTimer -= dt;
      if (e.rollTimer <= 0) {
        e.rollVel = (Math.random() * 2 - 1) * params.rollRate;
        e.rollTimer = 0.35 + Math.random() * 1.1;
      }
      e.roll += e.rollVel * dt;
    }
  }

  function tryFire(e, player, aiming) {
    if (!aiming || e.fireCd > 0) return;
    e.fireCd = 1 / params.fireRate;
    muzzle.copy(efwd).multiplyScalar(e.radius * 1.2).add(e.pos);
    evel.copy(efwd).multiplyScalar(params.pulseSpeed); // fire straight ahead (where the nose points)
    projectiles.spawn({ pos: muzzle, vel: evel, color: params.color, team: 'enemy', damage: params.pulseDamage, life: 2.6, radius: 0.7 });
  }

  function update(dt, player) {
    for (let fi = formations.length - 1; fi >= 0; fi--) {
      const f = formations[fi];
      f.members = f.members.filter((m) => m.alive);
      if (f.members.length === 0) {
        formations.splice(fi, 1);
        continue;
      }
      if (!f.dogfight && (f.anchor.passes >= params.passesBeforeDogfight || f.members.length < f.initialCount)) {
        intoDogfight(f);
      }
      if (!f.dogfight) {
        const a = f.anchor;
        if (a.phase === 'ingress') {
          desired.copy(player.pos).sub(a.pos).setLength(params.speed);
          a.vel.lerp(desired, 1 - Math.exp(-params.turnRate * 0.8 * dt));
          a.vel.setLength(params.speed);
          a.pos.addScaledVector(a.vel, dt);
          if (a.pos.distanceTo(player.pos) < params.passDist) {
            a.phase = 'egress';
            a.egress = params.egressTime;
          }
        } else {
          a.pos.addScaledVector(a.vel, dt);
          a.egress -= dt;
          if (a.egress <= 0) {
            a.passes++;
            a.phase = 'ingress';
          }
        }
      }
    }

    for (const e of enemies) {
      if (!e.alive) continue;
      const distP = e.pos.distanceTo(player.pos);

      // choose a steering target
      if (e.mode === 'formation') {
        const a = e.formation.anchor;
        bf.copy(a.vel).normalize();
        br.crossVectors(bf, UP).normalize();
        bu.crossVectors(br, bf).normalize();
        st.copy(a.pos)
          .addScaledVector(br, e.slot.x)
          .addScaledVector(bu, e.slot.y)
          .addScaledVector(bf, -e.slot.z);
      } else if (e.role === 'wing' && e.wingOf && e.wingOf.alive) {
        // stay on the point's wing: trail behind + to one side
        const p = e.wingOf;
        bf.copy(p.vel).normalize();
        br.crossVectors(bf, UP).normalize();
        st.copy(p.pos).addScaledVector(bf, -params.wingSpacing).addScaledVector(br, e.wingSide * params.wingSpacing * 0.7);
      } else {
        // point (or orphaned wingman): solo attack RUNS — bore in at the player (so they pass in
        // front and can be shot head-on), break off when close, coast, then come round for another.
        if (!e.wingOf) e.role = 'point';
        if (e.phase === 'egress') {
          st.copy(e.pos).addScaledVector(e.vel, 1); // hold heading -> fly past / break off
          e.egress -= dt;
          if (e.egress <= 0) e.phase = 'ingress';
        } else {
          st.copy(player.pos); // bore in
          if (distP < params.passDist) {
            e.phase = 'egress';
            e.egress = params.egressTime;
          }
        }
      }

      // collision avoidance — peel away when too close so they don't ram the player
      if (distP < params.avoidDist) {
        awayDir.copy(e.pos).sub(player.pos).normalize();
        const push = (params.avoidDist - distP) / params.avoidDist; // 0..1
        st.addScaledVector(awayDir, push * params.avoidStrength * params.avoidDist);
      }

      // Move + orient FIRST, then decide aiming with the CURRENT nose, so the firing test and the
      // bolt direction use the same forward (otherwise bolts appear to fire off the line of travel).
      e.fireCd -= dt;
      steer(e, st, dt, e.mode === 'formation' ? params.speed : params.speed * 1.05);
      orient(e);
      efwd.copy(FWD).applyQuaternion(e.obj.quaternion);
      toP.copy(player.pos).sub(e.pos);
      const dist = toP.length() || 1;
      const aiming = dist < params.fireRange && efwd.dot(toP.multiplyScalar(1 / dist)) > params.fireConeCos;
      updateRoll(e, aiming, dt);
      tryFire(e, player, aiming);
    }
  }

  function prune() {
    for (let i = enemies.length - 1; i >= 0; i--) {
      if (!enemies[i].alive) {
        scene.remove(enemies[i].obj);
        enemies.splice(i, 1);
        kills++; // enemies only go !alive when destroyed
      }
    }
  }

  function count() {
    return enemies.length;
  }

  function reset() {
    for (const e of enemies) scene.remove(e.obj);
    enemies.length = 0;
    formations.length = 0;
    kills = 0;
  }

  return {
    spawnFormation,
    update,
    prune,
    count,
    reset,
    enemies,
    formations,
    params,
    get kills() {
      return kills;
    },
  };
}
