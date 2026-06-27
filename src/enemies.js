import * as THREE from 'three';
import { spawnChig } from './enemyShip.js';
import { formationSlots } from './formations.js';

// Enemy Chig manager: spawns formations, runs the two-phase AI, and fires blue pulses.
//   Phase A — strafing pass: the formation flies as a unit on runs toward the player (ingress) then
//             past (egress); members hold their slots relative to the anchor.
//   Phase B — dogfight: after `passesBeforeDogfight` runs OR the first loss, members break formation
//             and individually pursue the player.
// Enemies orient nose (-Z) along their velocity. `enemies` is exposed for collision + the LIDAR.

export function createEnemyManager(scene, chigKit, projectiles, opts = {}) {
  const params = {
    speed: 40,
    turnRate: 2.2, // velocity easing toward the desired heading
    passDist: 70, // ingress -> egress switch distance
    egressTime: 1.6,
    passesBeforeDogfight: 2,
    fireRate: 1.3, // pulses/sec per enemy
    fireRange: 240,
    fireConeCos: Math.cos(0.26),
    pulseSpeed: 230,
    pulseDamage: 10,
    hp: 30,
    color: 0x5fb0ff, // blue pulse
  };
  Object.assign(params, opts.params || {});

  const enemies = [];
  const formations = [];

  const FWD = new THREE.Vector3(0, 0, -1);
  const UP = new THREE.Vector3(0, 1, 0);
  const ZERO = new THREE.Vector3();
  const desired = new THREE.Vector3();
  const look = new THREE.Vector3();
  const mat = new THREE.Matrix4();
  const bf = new THREE.Vector3();
  const br = new THREE.Vector3();
  const bu = new THREE.Vector3();
  const st = new THREE.Vector3();
  const toP = new THREE.Vector3();
  const efwd = new THREE.Vector3();
  const muzzle = new THREE.Vector3();
  const evel = new THREE.Vector3();

  function spawnFormation({ pattern = 'vee', count = 4, pos, heading }) {
    const slots = formationSlots(pattern, count, 8);
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
      };
      obj.position.copy(e.pos);
      scene.add(obj);
      enemies.push(e);
      f.members.push(e);
    }
    formations.push(f);
    return f;
  }

  function orient(e) {
    look.copy(e.vel).normalize();
    mat.lookAt(ZERO, look, UP); // -Z (nose) along velocity
    e.obj.quaternion.setFromRotationMatrix(mat);
  }

  function steer(e, target, dt, speed) {
    desired.copy(target).sub(e.pos);
    if (desired.lengthSq() > 1e-6) desired.setLength(speed);
    e.vel.lerp(desired, 1 - Math.exp(-params.turnRate * dt));
    if (e.vel.lengthSq() > 1e-6) e.vel.setLength(speed);
    e.pos.addScaledVector(e.vel, dt);
    e.obj.position.copy(e.pos);
    orient(e);
  }

  function tryFire(e, player, dt) {
    e.fireCd -= dt;
    if (e.fireCd > 0) return;
    toP.copy(player.pos).sub(e.pos);
    const dist = toP.length();
    if (dist > params.fireRange) return;
    efwd.copy(FWD).applyQuaternion(e.obj.quaternion);
    toP.multiplyScalar(1 / dist); // normalize
    if (efwd.dot(toP) < params.fireConeCos) return;
    e.fireCd = 1 / params.fireRate;
    muzzle.copy(efwd).multiplyScalar(e.radius * 1.2).add(e.pos);
    evel.copy(player.pos).sub(e.pos).normalize().multiplyScalar(params.pulseSpeed);
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
        f.dogfight = true;
        for (const m of f.members) m.mode = 'dogfight';
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
      if (e.mode === 'formation') {
        const a = e.formation.anchor;
        bf.copy(a.vel).normalize();
        br.crossVectors(bf, UP).normalize();
        bu.crossVectors(br, bf).normalize();
        st.copy(a.pos)
          .addScaledVector(br, e.slot.x)
          .addScaledVector(bu, e.slot.y)
          .addScaledVector(bf, -e.slot.z); // +z slot = behind the leader
        steer(e, st, dt, params.speed);
      } else {
        steer(e, player.pos, dt, params.speed * 1.05);
      }
      tryFire(e, player, dt);
    }
  }

  function prune() {
    for (let i = enemies.length - 1; i >= 0; i--) {
      if (!enemies[i].alive) {
        scene.remove(enemies[i].obj);
        enemies.splice(i, 1);
      }
    }
  }

  function count() {
    return enemies.length;
  }

  return { spawnFormation, update, prune, count, enemies, formations, params };
}
