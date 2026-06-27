import * as THREE from 'three';
import { createThrusters } from './thruster.js';
import { createDebris } from './debris.js';
import { createAlly } from './ally.js';

// Attract mode: a self-running cinematic dogfight — 3 AI Hammerheads (createAlly) vs looping waves of 12
// Chigs (the existing enemyMgr), no human player. Owns the auto-cutting camera, the Chig target split
// (each Chig chases its nearest ally), the combat friendlies list, and the wave loop. The only attract-aware
// module; everything it drives (ally.js, enemyMgr, combat, vfx, debris) is reused as-is.

const UP = new THREE.Vector3(0, 1, 0);
const ZERO = new THREE.Vector3();

export function createAttract(scene, camera, { ship, thrusters, chigKit, enemyMgr, projectiles, vfx, debris, lighting }) {
  const allies = [];

  // STRETCH: a convex Hammerhead debris pool so a downed ally's hull can fracture (same path the player's
  // gameState.destroyed uses). Optional — null if the fracture worker isn't available.
  let hullDebris = null;
  try { hullDebris = createDebris(scene, { template: ship.pivot, convex: true, vfx, count: 8, cap: 140 }); } catch (e) { console.warn('[attract] hull debris unavailable', e); }

  function makeAlly(pivot, model, engineMaterials, thr) {
    return createAlly(scene, {
      pivot, model, radius: ship.radius, engineMaterials, thrusters: thr,
      projectiles, vfx, lighting, team: 'player', mortal: false,
      onDestroy: (a) => { if (hullDebris) hullDebris.burst({ pos: a.pos, obj: a.pivot, vel: a.vel }, 1.3); },
    });
  }

  // ally #1 reuses the loaded ship (already in scene with thrusters + CSM registration).
  ship.pivot.position.set(0, 0, 0);
  ship.pivot.quaternion.identity();
  allies.push(makeAlly(ship.pivot, ship.model, ship.engineMaterials, thrusters));

  // allies #2,#3: clone the align subtree (shares geometry + CSM-registered materials so they stay lit/
  // shadowed), wrap a fresh pivot, give each its own thrusters + engine light spill.
  for (const off of [new THREE.Vector3(-16, 0, 9), new THREE.Vector3(16, 0, 9)]) {
    const align = ship.align.clone(true);
    const pv = new THREE.Group();
    pv.add(align);
    pv.position.copy(off);
    scene.add(pv);
    const thr = createThrusters(pv, ship.nozzles, ship.rearDir, ship.radius);
    lighting.attachThrusters(pv, ship.nozzles, ship.rearDir, ship.radius);
    lighting.registerTree(pv); // idempotent (basePatch guard) — re-adds the shared materials
    allies.push(makeAlly(pv, align, ship.engineMaterials, thr));
  }

  // focus = allies' centroid; the Chig formation default-target + the player-like object for lighting.
  const focus = { pos: new THREE.Vector3(), quat: allies[0].quat, vel: ZERO };
  function updateFocus() {
    focus.pos.set(0, 0, 0);
    let n = 0;
    for (const a of allies) if (a.alive) { focus.pos.add(a.pos); n++; }
    if (n) focus.pos.multiplyScalar(1 / n); else focus.pos.copy(allies[0].pos);
  }

  // --- Chig waves (12, looping) --------------------------------------------
  let difficulty = 0.4;
  let respawnTimer = 0;
  function spawnWave() {
    updateFocus();
    const c = focus.pos;
    for (let i = 0; i < 3; i++) {
      const ang = (i / 3) * Math.PI * 2 + 0.4;
      const dir = new THREE.Vector3(Math.cos(ang), (Math.random() - 0.5) * 0.3, Math.sin(ang)).normalize();
      const pos = c.clone().addScaledVector(dir, 410);
      const heading = c.clone().sub(pos).normalize();
      enemyMgr.spawnFormation({ pattern: 'vee', count: 4, pos, heading, difficulty });
      vfx.firework(pos, 1.0); // warp-in flash
    }
  }
  function maybeRespawn(dt) {
    if (enemyMgr.count() > 0) { respawnTimer = 0; return; }
    respawnTimer += dt;
    if (respawnTimer >= 2.0) { // let the last death animate
      respawnTimer = 0;
      for (const a of allies) a.patch(); // top the allies back up (revives a downed one)
      downAlly = false;
      difficulty = Math.min(1, difficulty + 0.03); // gentle escalation per loop
      spawnWave();
    }
  }

  // STRETCH: rarely let ONE critically-wounded ally get shot down for drama (cockpit ejects + hull
  // fractures); it returns on the next wave. At most one down at a time so the fight stays 2v12+.
  let downAlly = false;
  function maybeDramaDeath(dt) {
    if (downAlly) return;
    for (const a of allies) {
      if (a.alive && a.damageModel.totalHp() < 0.25 && Math.random() < 0.1 * dt) {
        a.destroy();
        downAlly = true;
        break;
      }
    }
  }

  // --- auto-cutting cinematic camera ---------------------------------------
  const SHOTS = ['chase', 'orbit', 'duel'];
  let shot = 'orbit', shotT = 0, shotDur = 5, subjectIdx = 0, orbitAng = 0, snap = true;
  const _pos = new THREE.Vector3(), _tgt = new THREE.Vector3(), _up = new THREE.Vector3();
  const _f = new THREE.Vector3(), _side = new THREE.Vector3(), _mid = new THREE.Vector3();

  function aliveAlly(i) { return (allies[i] && allies[i].alive) ? allies[i] : allies.find((a) => a.alive) || allies[0]; }
  function pickShot() {
    let s = SHOTS[(Math.random() * SHOTS.length) | 0];
    if (s === shot) s = SHOTS[(SHOTS.indexOf(s) + 1) % SHOTS.length];
    shot = s; shotT = 0; shotDur = 4 + Math.random() * 3; snap = true;
    subjectIdx = (Math.random() * allies.length) | 0;
    orbitAng = Math.random() * Math.PI * 2;
  }

  function updateCamera(dt) {
    shotT += dt;
    if (shotT >= shotDur) pickShot();
    _up.copy(UP);
    if (shot === 'chase') {
      const a = aliveAlly(subjectIdx);
      _f.set(0, 0, -1).applyQuaternion(a.quat);
      _up.set(0, 1, 0).applyQuaternion(a.quat);
      _pos.copy(a.pos).addScaledVector(_f, -16).addScaledVector(_up, 6.7);
      if (a.target && a.target.alive) _tgt.copy(a.target.pos); else _tgt.copy(a.pos).addScaledVector(_f, 26);
    } else if (shot === 'duel') {
      const a = aliveAlly(subjectIdx);
      const b = a.target && a.target.alive ? a.target : null;
      if (b) {
        _mid.copy(a.pos).add(b.pos).multiplyScalar(0.5);
        _side.copy(b.pos).sub(a.pos).normalize().cross(UP);
        if (_side.lengthSq() < 1e-4) _side.set(1, 0, 0);
        _side.normalize();
        _pos.copy(_mid).addScaledVector(_side, 34).addScaledVector(UP, 6);
        _tgt.copy(_mid);
      } else {
        _f.set(0, 0, -1).applyQuaternion(a.quat);
        _pos.copy(a.pos).addScaledVector(_f, -18).addScaledVector(UP, 7);
        _tgt.copy(a.pos);
      }
    } else { // orbit the furball
      orbitAng += dt * 0.25;
      _mid.copy(focus.pos);
      _pos.set(Math.cos(orbitAng) * 70, 22, Math.sin(orbitAng) * 70).add(_mid);
      _tgt.copy(_mid);
    }
    if (snap) { camera.position.copy(_pos); camera.up.copy(_up); snap = false; } // hard cut to the new shot
    else {
      const k = 1 - Math.exp(-4 * dt);
      camera.position.lerp(_pos, k);
      camera.up.lerp(_up, k).normalize();
    }
    camera.lookAt(_tgt);
  }

  // combat / targeting hooks
  function targetFor(e) {
    let best = null, bd = Infinity;
    for (const a of allies) { if (!a.alive) continue; const d = e.pos.distanceToSquared(a.pos); if (d < bd) { bd = d; best = a; } }
    return best || focus;
  }
  function friendlies() {
    const out = [];
    for (const a of allies) if (a.alive) out.push({ pos: a.pos, radius: a.radius * 0.85, hit: a.hit });
    return out;
  }

  spawnWave(); // arm the first fight

  function update(dt) {
    updateFocus();
    for (const a of allies) a.update(dt, { enemies: enemyMgr.enemies, friends: allies });
    maybeDramaDeath(dt);
    maybeRespawn(dt);
    if (hullDebris) hullDebris.update(dt, null, enemyMgr.enemies);
    updateCamera(dt);
  }

  return { update, focus, targetFor, friendlies, allies };
}
