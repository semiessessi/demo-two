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
  const spawnQueue = [];
  let spawnTimer = 0;
  function spawnOneFormation(i, c) {
    const ang = (i / 3) * Math.PI * 2 + 0.4;
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
    if (stagger) { for (let i = 0; i < 3; i++) spawnQueue.push({ i, c }); spawnTimer = 0; }
    else for (let i = 0; i < 3; i++) spawnOneFormation(i, c);
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
  // Always frames real ships / the furball (never empty space), smooth-pans between framings (no hard
  // cuts -> no jerks), and smooths the look point so a fast-moving / switching target never whips the
  // camera. Stays close to the action; re-frames every ~6-10s.
  let shot = 'orbit', shotT = 0, shotDur = 7, subject = null, orbitAng = 0, camInit = false;
  const _pos = new THREE.Vector3(), _tgt = new THREE.Vector3(), _up = new THREE.Vector3();
  const _f = new THREE.Vector3(), _side = new THREE.Vector3(), _mid = new THREE.Vector3(), _bc = new THREE.Vector3();
  const camLook = new THREE.Vector3();

  // centre of the whole furball (alive allies + alive Chigs) — what "the action" actually is.
  function battleCenter(out) {
    out.set(0, 0, 0);
    let n = 0;
    for (const a of allies) if (a.alive) { out.add(a.pos); n++; }
    for (const e of enemyMgr.enemies) if (e.alive) { out.add(e.pos); n++; }
    if (n) out.multiplyScalar(1 / n); else out.copy(focus.pos);
    return out;
  }
  // the ally most IN the action (closest to a live target) — never a bystander framing nothing.
  function engagedAlly() {
    let best = null, bd = Infinity;
    for (const a of allies) {
      if (!a.alive) continue;
      if (!best) best = a;
      if (a.target && a.target.alive) { const d = a.pos.distanceToSquared(a.target.pos); if (d < bd) { bd = d; best = a; } }
    }
    return best;
  }
  function pickShot() {
    const r = Math.random();
    let s = r < 0.5 ? 'chase' : r < 0.82 ? 'duel' : 'orbit';
    if (s === shot && s !== 'orbit') s = s === 'chase' ? 'duel' : 'chase';
    shot = s; shotT = 0; shotDur = 6 + Math.random() * 4;
    subject = engagedAlly();
    orbitAng = Math.random() * Math.PI * 2;
  }
  function updateCamera(dt) {
    shotT += dt;
    if (shotT >= shotDur || (subject && !subject.alive)) pickShot();
    const subj = subject && subject.alive ? subject : engagedAlly();
    _up.copy(UP);
    if (shot === 'chase' && subj) {
      _f.set(0, 0, -1).applyQuaternion(subj.quat);
      _up.set(0, 1, 0).applyQuaternion(subj.quat);
      _pos.copy(subj.pos).addScaledVector(_f, -14).addScaledVector(_up, 5.5);
      if (subj.target && subj.target.alive) _tgt.copy(subj.pos).add(subj.target.pos).multiplyScalar(0.5); // frame the run
      else _tgt.copy(subj.pos).addScaledVector(_f, 8); // frame the ally itself, never empty space far ahead
    } else if (shot === 'duel' && subj && subj.target && subj.target.alive) {
      const b = subj.target;
      _mid.copy(subj.pos).add(b.pos).multiplyScalar(0.5);
      _side.copy(b.pos).sub(subj.pos).normalize().cross(UP);
      if (_side.lengthSq() < 1e-4) _side.set(1, 0, 0);
      _side.normalize();
      _pos.copy(_mid).addScaledVector(_side, 24).addScaledVector(UP, 6);
      _tgt.copy(_mid);
    } else { // orbit the furball centre (allies + Chigs) so it's always the action in frame
      battleCenter(_bc);
      orbitAng += dt * 0.3;
      _pos.set(Math.cos(orbitAng) * 46, 18, Math.sin(orbitAng) * 46).add(_bc);
      _tgt.copy(_bc);
    }
    if (!camInit) { camera.position.copy(_pos); camera.up.copy(_up); camLook.copy(_tgt); camInit = true; }
    else {
      const kp = 1 - Math.exp(-3.0 * dt);
      camera.position.lerp(_pos, kp);
      camera.up.lerp(_up, kp).normalize();
      camLook.lerp(_tgt, 1 - Math.exp(-2.6 * dt)); // smooth look -> no whip when the target moves or switches
    }
    camera.lookAt(camLook);
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
    maybeDramaDeath(dt);
    maybeRespawn(dt);
    if (hullDebris) hullDebris.update(dt, null, enemyMgr.enemies);
    updateCamera(dt);
  }

  return { update, focus, targetFor, friendlies, allies };
}
