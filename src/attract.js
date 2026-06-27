import * as THREE from 'three';
import { createThrusters } from './thruster.js';
import { createDebris } from './debris.js';
import { createAlly } from './ally.js';
import { createRcs } from './rcs.js';

// Attract mode: a self-running cinematic dogfight — 3 AI Hammerheads (createAlly) vs looping waves of 12
// Chigs (the existing enemyMgr), no human player. Owns the auto-cutting camera, the Chig target split
// (each Chig chases its nearest ally), the combat friendlies list, and the wave loop. The only attract-aware
// module; everything it drives (ally.js, enemyMgr, combat, vfx, debris) is reused as-is.

const UP = new THREE.Vector3(0, 1, 0);
const ZERO = new THREE.Vector3();

export function createAttract(scene, camera, { ship, thrusters, chigKit, enemyMgr, projectiles, vfx, debris, lighting, showRcs }) {
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
  for (const off of [
    new THREE.Vector3(-16, 0, 9), new THREE.Vector3(16, 0, 9),
    new THREE.Vector3(-34, 3, 20), new THREE.Vector3(34, 3, 20), new THREE.Vector3(0, -4, 22),
  ]) {
    const align = ship.align.clone(true);
    align.traverse((o) => { if (o.isMesh) o.castShadow = false; }); // 6 detailed Hammerheads is heavy -> clones don't cast shadows (still lit + receive)
    const pv = new THREE.Group();
    pv.add(align);
    pv.position.copy(off);
    scene.add(pv);
    const thr = createThrusters(pv, ship.nozzles, ship.rearDir, ship.radius);
    lighting.attachThrusters(pv, ship.nozzles, ship.rearDir, ship.radius);
    lighting.registerTree(pv); // idempotent (basePatch guard) — re-adds the shared materials
    allies.push(makeAlly(pv, align, ship.engineMaterials, thr));
  }

  // ?attract&thrusters: give each ally its own maneuvering (RCS) jets — they fire from the ally's actual
  // rotation each frame (pitch/roll as it banks), exactly like the player's.
  const allyRcs = showRcs ? allies.map((a) => createRcs(scene, { pivot: a.pivot })) : null;

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
  const spawnQueue = [];
  let spawnTimer = 0;
  function spawnOneFormation(i, c) {
    const ang = (i / 6) * Math.PI * 2 + 0.4;
    const dir = new THREE.Vector3(Math.cos(ang), (Math.random() - 0.5) * 0.3, Math.sin(ang)).normalize();
    const pos = c.clone().addScaledVector(dir, 410);
    const heading = c.clone().sub(pos).normalize();
    enemyMgr.spawnFormation({ pattern: 'vee', count: 4, pos, heading, difficulty });
    vfx.firework(pos, 1.0); // warp-in flash
  }
  // Stagger the 12 Chigs across a few frames: cloning all 12 meshes (+ 3 fireworks) in one frame was the
  // hitch. The first wave spawns immediately (during the fade-in, before the shader pre-warm).
  function spawnWave(stagger) {
    updateFocus();
    const c = focus.pos.clone();
    if (stagger) { for (let i = 0; i < 6; i++) spawnQueue.push({ i, c }); spawnTimer = 0; }
    else for (let i = 0; i < 6; i++) spawnOneFormation(i, c);
  }
  function processSpawnQueue(dt) {
    if (!spawnQueue.length) return;
    spawnTimer -= dt;
    if (spawnTimer > 0) return;
    spawnTimer = 0.5; // one 4-ship formation every ~0.5s
    const it = spawnQueue.shift();
    spawnOneFormation(it.i, it.c);
  }
  function maybeRespawn(dt) {
    processSpawnQueue(dt);
    if (enemyMgr.count() > 0 || spawnQueue.length) { respawnTimer = 0; return; }
    respawnTimer += dt;
    if (respawnTimer >= 2.0) { // let the last death animate
      respawnTimer = 0;
      for (const a of allies) a.patch(); // top the allies back up (revives a downed one)
      downAlly = false;
      difficulty = Math.min(1, difficulty + 0.03); // gentle escalation per loop
      spawnWave(true); // staggered respawn -> no 12-clone spike
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

  // --- cinematic camera -----------------------------------------------------
  // Driven by QUATERNION SLERP, never per-frame lookAt -> no gimbal-lock flips (the "hard jerks"). Each
  // shot computes an eye + look + up; we build a target orientation once and slerp the camera toward it
  // (great-circle, always smooth) while the position dollies. Shots CUT cleanly on change. Follows allies
  // AND Chigs up close, shoots down a Hammerhead's line of fire, and cuts to explosion fly-bys on kills.
  let shot = 'orbit', shotT = 0, shotDur = 6, subject = null, killTarget = null, killCd = 0, orbitAng = 0, snap = true, camInit = false;
  const _eye = new THREE.Vector3(), _look = new THREE.Vector3(), _up = new THREE.Vector3();
  const _f = new THREE.Vector3(), _u = new THREE.Vector3(), _side = new THREE.Vector3();
  const _mid = new THREE.Vector3(), _bc = new THREE.Vector3();
  const _mLook = new THREE.Matrix4(), _qTarget = new THREE.Quaternion();

  function battleCenter(out) {
    out.set(0, 0, 0); let n = 0;
    for (const a of allies) if (a.alive) { out.add(a.pos); n++; }
    for (const e of enemyMgr.enemies) if (e.alive) { out.add(e.pos); n++; }
    if (n) out.multiplyScalar(1 / n); else out.copy(focus.pos);
    return out;
  }
  function engagedAlly() {
    let best = null, bd = Infinity;
    for (const a of allies) {
      if (!a.alive) continue;
      if (!best) best = a;
      if (a.target && a.target.alive) { const d = a.pos.distanceToSquared(a.target.pos); if (d < bd) { bd = d; best = a; } }
    }
    return best;
  }
  // an ally actively gunning a target (for the down-the-line shot) — prefer its LOWEST-hp target (about to die)
  function gunningAlly() {
    let best = null, bhp = Infinity;
    for (const a of allies) {
      if (!a.alive || !a.target || !a.target.alive) continue;
      if (a.pos.distanceTo(a.target.pos) < 240 && a.target.hp < bhp) { bhp = a.target.hp; best = a; }
    }
    return best;
  }
  // a Chig being hunted (some ally's target) — for an up-close Chig chase
  function heroChig() {
    for (const a of allies) if (a.alive && a.target && a.target.alive) return a.target;
    return null;
  }
  // a Chig mid SPIN-OUT death with a big blast still coming — the dramatic explosion to fly by
  function dyingChig() {
    let best = null, bestRem = 0;
    for (const e of enemyMgr.enemies) {
      if (e.alive || !e.death || e.death.done || e.death.type !== 'spinout') continue;
      const rem = (e.death.dur || 0) - e.death.t;
      if (rem > 0.25 && rem < 1.7 && rem > bestRem) { bestRem = rem; best = e; }
    }
    return best;
  }

  function pickShot() {
    const r = Math.random();
    let s = r < 0.26 ? 'chase' : r < 0.46 ? 'lineOfFire' : r < 0.66 ? 'chaseChig' : r < 0.84 ? 'duel' : 'orbit';
    if (s === shot && s !== 'orbit') s = 'chase';
    subject = s === 'chaseChig' ? heroChig() : s === 'lineOfFire' ? gunningAlly() : engagedAlly();
    if (!subject) { s = 'orbit'; subject = engagedAlly(); }
    shot = s; shotT = 0; shotDur = 5 + Math.random() * 3; snap = true;
    orbitAng = Math.random() * Math.PI * 2;
  }

  function updateCamera(dt) {
    killCd -= dt;
    // opportunistic explosion fly-by: cut to a dramatic dying Chig (rate-limited so it isn't too cutty)
    if (shot !== 'killcam' && killCd <= 0) {
      const dc = dyingChig();
      if (dc) { shot = 'killcam'; killTarget = dc; shotT = 0; shotDur = 1.8; snap = true; killCd = 5; }
    }
    shotT += dt;
    const killDone = shot === 'killcam' && (!killTarget || !killTarget.death || killTarget.death.done);
    const subjDead = shot !== 'killcam' && subject && subject.alive === false;
    if (shotT >= shotDur || killDone || subjDead) pickShot();

    _up.copy(UP);
    if (shot === 'killcam' && killTarget) { // close, side-on, on the tumbling/exploding Chig
      _side.copy(killTarget.vel).cross(UP); if (_side.lengthSq() < 1e-4) _side.set(1, 0, 0); _side.normalize();
      _eye.copy(killTarget.pos).addScaledVector(_side, 17).addScaledVector(UP, 6);
      _look.copy(killTarget.pos);
    } else if (shot === 'chase' && subject && subject.alive) {
      _f.set(0, 0, -1).applyQuaternion(subject.quat); _u.set(0, 1, 0).applyQuaternion(subject.quat);
      _eye.copy(subject.pos).addScaledVector(_f, -14).addScaledVector(_u, 5.5);
      if (subject.target && subject.target.alive) _look.copy(subject.pos).add(subject.target.pos).multiplyScalar(0.5);
      else _look.copy(subject.pos).addScaledVector(_f, 8);
      _up.copy(UP).lerp(_u, 0.7).normalize(); // bank with the ship, tempered so the horizon doesn't whip
    } else if (shot === 'lineOfFire' && subject && subject.alive && subject.target) {
      _f.set(0, 0, -1).applyQuaternion(subject.quat); _u.set(0, 1, 0).applyQuaternion(subject.quat);
      _eye.copy(subject.pos).addScaledVector(_f, -6).addScaledVector(_u, 2.6); // just behind + above the gun
      _look.copy(subject.target.pos); // straight down the line of fire to the doomed Chig (watch it die)
      _up.copy(UP).lerp(_u, 0.7).normalize();
    } else if (shot === 'chaseChig' && subject && subject.alive) {
      _f.copy(subject.vel); if (_f.lengthSq() < 1e-4) _f.set(0, 0, -1); _f.normalize();
      _eye.copy(subject.pos).addScaledVector(_f, -10).addScaledVector(UP, 3.5); // tight behind a Chig
      _look.copy(subject.pos).addScaledVector(_f, 14);
    } else if (shot === 'duel' && subject && subject.alive && subject.target && subject.target.alive) {
      _mid.copy(subject.pos).add(subject.target.pos).multiplyScalar(0.5);
      _side.copy(subject.target.pos).sub(subject.pos).cross(UP); if (_side.lengthSq() < 1e-4) _side.set(1, 0, 0); _side.normalize();
      _eye.copy(_mid).addScaledVector(_side, 22).addScaledVector(UP, 6);
      _look.copy(_mid);
    } else { // orbit the furball centre (allies + Chigs)
      battleCenter(_bc);
      orbitAng += dt * 0.3;
      _eye.set(Math.cos(orbitAng) * 44, 17, Math.sin(orbitAng) * 44).add(_bc);
      _look.copy(_bc);
    }

    _mLook.lookAt(_eye, _look, _up); // Matrix4.lookAt handles the look||up degenerate case internally
    _qTarget.setFromRotationMatrix(_mLook);
    if (snap || !camInit) { camera.position.copy(_eye); camera.quaternion.copy(_qTarget); snap = false; camInit = true; }
    else {
      camera.position.lerp(_eye, 1 - Math.exp(-3.0 * dt));        // smooth dolly within a shot
      camera.quaternion.slerp(_qTarget, 1 - Math.exp(-3.5 * dt)); // smooth, gimbal-lock-free orientation
    }
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

  spawnWave(false); // arm the first fight immediately (hidden by the fade-in)

  function update(dt) {
    updateFocus();
    for (const a of allies) a.update(dt, { enemies: enemyMgr.enemies, friends: allies });
    if (allyRcs) for (let i = 0; i < allyRcs.length; i++) allyRcs[i].update(dt, allies[i].alive);
    maybeDramaDeath(dt);
    maybeRespawn(dt);
    if (hullDebris) hullDebris.update(dt, null, enemyMgr.enemies);
    updateCamera(dt);
  }

  return { update, focus, targetFor, friendlies, allies };
}
