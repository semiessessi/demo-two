import * as THREE from 'three';
import { createThrusters } from '../thruster.js';
import { createAlly } from '../ally.js';
import { createRcs } from '../rcs.js';

// Mission runtime: the frame-ticked engine for one campaign mission. Owns a FLYING formation (a moving
// anchor the wingmen steer to hold station on — NOT pinned to the player), the player's formation slot
// (you must fly into it to "form up"), scripted beats/triggers, nav waypoints, an optional home-ship
// marker, scripted enemy spawns, and win/lose. While a mission is live this REPLACES waves.update.
//
// world = { scene, camera, ship, enemyMgr, projectiles, vfx, lighting, hullDebris, comms, missionHud,
//           onComplete, onFail }

const UP = new THREE.Vector3(0, 1, 0);
const ZERO = new THREE.Vector3();

export function createMission(def, world) {
  const { scene, ship, enemyMgr, projectiles, vfx, lighting, comms, missionHud } = world;
  const wingmen = [];          // { id, speaker, slot, mode, ally, pivot, thr, rcs }
  const wpVec = {};            // waypoint id -> THREE.Vector3 (world)
  const firedAt = {};          // beat id -> mission-clock time it fired
  const objState = {};         // objective id -> state
  let clock = 0;
  let state = 'running';       // 'running' | 'complete' | 'failed'
  let lastPlayer = null;
  let enemySpawned = false;

  // formation
  const fdef = def.formation || {};
  const cruise = fdef.cruise || 22;
  const arrive = fdef.arrive || 60;       // anchor eases to a stop this far from its target
  const playerSlot = fdef.playerSlot || [16, -2, 18];
  const anchor = { pos: new THREE.Vector3().fromArray(fdef.anchorStart || [0, 6, -55]), quat: new THREE.Quaternion() };
  let anchorTarget = null;     // THREE.Vector3 the formation flies toward (the active waypoint)
  let formationMoving = false; // form-up holds the formation; set true once we push off
  let slotShown = false;       // is the player's form-up slot marker visible
  let gateMesh = null;         // wormhole ring placeholder

  const _off = new THREE.Vector3();
  const _ps = new THREE.Vector3();
  const _desired = new THREE.Vector3();
  const _toD = new THREE.Vector3();
  const _fwd = new THREE.Vector3();
  const _m = new THREE.Matrix4();

  // quaternion whose nose (-Z) points along `forward`
  function headingQuat(outQ, forward) {
    if (forward.lengthSq() < 1e-8) return;
    _fwd.copy(forward).normalize();
    _m.lookAt(ZERO, _fwd, UP);
    outQ.setFromRotationMatrix(_m);
  }
  // world position of the player's slot in the (possibly turning) formation
  function playerSlotWorld(out) { out.copy(_off.fromArray(playerSlot)).applyQuaternion(anchor.quat).add(anchor.pos); }

  // --- wingmen (attract.js staging recipe; they STEER to their slots, they aren't pinned) ---
  function spawnWingmen() {
    for (const w of (def.wingmen || [])) {
      const align = ship.align.clone(true);
      align.traverse((o) => { if (o.isMesh) o.castShadow = false; });
      const pv = new THREE.Group();
      pv.add(align);
      scene.add(pv);
      const thr = createThrusters(pv, ship.nozzles, ship.rearDir, ship.radius);
      lighting.attachThrusters(pv, ship.nozzles, ship.rearDir, ship.radius);
      lighting.registerTree(pv);
      const rc = createRcs(scene, { pivot: pv });
      const ally = createAlly(scene, {
        pivot: pv, model: align, radius: ship.radius, engineMaterials: ship.engineMaterials, thrusters: thr,
        projectiles, vfx, lighting, team: 'player', mortal: w.mortal !== false,
        onDestroy: (a) => { if (world.hullDebris) world.hullDebris.burst({ pos: a.pos, obj: a.pivot, vel: a.vel }, 1.3); },
      });
      // place at slot immediately (pos IS pivot.position)
      _off.fromArray(w.slot || [0, 0, 0]).applyQuaternion(anchor.quat);
      ally.pos.copy(anchor.pos).add(_off);
      ally.quat.copy(anchor.quat);
      wingmen.push({ id: w.id, speaker: w.speaker, slot: w.slot || [0, 0, 0], mode: w.mode || 'form', ally, pivot: pv, thr, rcs: rc });
    }
  }

  function start() {
    clock = 0;
    state = 'running';
    for (const k of Object.keys(def.waypoints || {})) wpVec[k] = new THREE.Vector3().fromArray(def.waypoints[k]);
    headingQuat(anchor.quat, new THREE.Vector3(0, 0, -1)); // formation faces forward (-Z) at start
    spawnWingmen();
    // wormhole gate — a glowing ring placeholder you jump out through to end the mission
    if (def.gate) {
      const geo = new THREE.TorusGeometry(58, 7, 16, 48);
      const mat = new THREE.MeshStandardMaterial({ color: 0x3a6cff, emissive: 0x2c54ff, emissiveIntensity: 1.6, metalness: 0.2, roughness: 0.4 });
      gateMesh = new THREE.Mesh(geo, mat);
      gateMesh.position.fromArray(def.gate.pos || [0, 0, 160]);
      scene.add(gateMesh);
    }
    if (comms) comms.load(def.vo, def.lines || {});
    if (missionHud) { missionHud.clearObjectives(); missionHud.setWaypoint(null); missionHud.setSlot(null); missionHud.show(); }
  }

  function targetFor(e) {
    let best = lastPlayer, bestD = lastPlayer ? e.pos.distanceToSquared(lastPlayer.pos) : Infinity;
    for (const w of wingmen) { const a = w.ally; if (a && a.alive) { const d = e.pos.distanceToSquared(a.pos); if (d < bestD) { bestD = d; best = a; } } }
    return best;
  }
  function friendlies() {
    const out = [];
    for (const w of wingmen) if (w.ally.alive) out.push({ pos: w.ally.pos, radius: w.ally.radius * 0.85, hit: w.ally.hit });
    return out;
  }

  function evalTrigger(t) {
    if (!t) return false;
    if (t.and) return t.and.every(evalTrigger);
    if (t.or) return t.or.some(evalTrigger);
    if (t.not) return !evalTrigger(t.not);
    if (t.t != null) return clock >= t.t;
    if (t.after != null) { const f = firedAt[t.after]; return f != null && clock >= f + (t.delay || 0); }
    if (t.formedUp != null) { playerSlotWorld(_ps); return !!(lastPlayer && lastPlayer.pos.distanceTo(_ps) <= t.formedUp); }
    if (t.waypoint != null) { const v = wpVec[t.waypoint]; return !!(v && lastPlayer && lastPlayer.pos.distanceTo(v) <= (t.radius || 200)); }
    if (t.commsDone != null) return comms ? comms.isDone(t.commsDone) : true;
    if (t.allEnemiesDead) return enemySpawned && !enemyMgr.enemies.some((e) => e.alive);
    if (t.allyDied != null) { const wm = wingmen.find((x) => x.id === t.allyDied); return !!(wm && !wm.ally.alive); }
    if (t.objective != null) return objState[t.objective] === (t.is || 'complete');
    if (t.playerDamaged != null) return false;
    return false;
  }

  function runAction(a) {
    if (!a) return;
    if (a.comms && comms) comms.play(a.comms);
    if (a.objective) { const o = a.objective; objState[o.id] = o.state || 'active'; if (missionHud) missionHud.setObjective(o.id, { label: o.label, state: o.state }); }
    if (a.slot) { slotShown = !!a.slot.show; if (!slotShown && missionHud) missionHud.setSlot(null); }
    if (a.formation && a.formation.move != null) formationMoving = a.formation.move;
    if (a.waypoint) {
      const wp = a.waypoint;
      if (wp.hide || wp.id == null) { anchorTarget = null; if (missionHud) missionHud.setWaypoint(null); }
      else { anchorTarget = wpVec[wp.id] || null; if (missionHud) missionHud.setWaypoint(wpVec[wp.id], wp.label || wp.id); } // nav diamond + the formation flies there
    }
    if (a.spawn) {
      const s = a.spawn;
      enemyMgr.spawnFormation({ pattern: s.pattern || 'vee', count: s.count || 4, pos: new THREE.Vector3().fromArray(s.at || [0, 0, -400]), heading: new THREE.Vector3().fromArray(s.heading || [0, 0, 1]), difficulty: s.difficulty || 0 });
      enemySpawned = true;
    }
    if (a.wingman) { const wm = wingmen.find((x) => x.id === a.wingman.id); if (wm && a.wingman.mode) wm.mode = a.wingman.mode; }
    if (a.complete) resolve('complete', a.complete);
    if (a.fail) resolve('fail', a.fail);
  }

  function resolve(kind, info) {
    if (state !== 'running') return;
    state = kind === 'complete' ? 'complete' : 'failed';
    if (kind === 'complete') { if (world.onComplete) world.onComplete(def, info || {}); }
    else if (world.onFail) world.onFail(def, (info && info.sub) || 'Mission failed', info || {});
  }

  function update(dt, player) {
    lastPlayer = player;
    clock += dt;

    // move the formation anchor toward its target (eases to a stop near it), heading the way it flies
    if (formationMoving && anchorTarget) {
      _toD.subVectors(anchorTarget, anchor.pos);
      const d = _toD.length();
      if (d > arrive) { headingQuat(anchor.quat, _toD); anchor.pos.addScaledVector(_toD.multiplyScalar(1 / d), Math.min(cruise * dt, d - arrive)); }
    }

    // wingmen steer to their slots on the anchor (catch up when far, settle when close)
    const friends = wingmen.filter((x) => x.ally.alive).map((x) => x.ally);
    for (const w of wingmen) {
      if (!w.ally.alive) continue;
      if (w.mode === 'engage') { w.ally.update(dt, { enemies: enemyMgr.enemies, friends }); continue; }
      _desired.copy(_off.fromArray(w.slot)).applyQuaternion(anchor.quat).add(anchor.pos);
      _toD.subVectors(_desired, w.ally.pos);
      const d = _toD.length();
      const spd = Math.min(72, d * 2.5);
      if (d > 0.02) { _toD.multiplyScalar(1 / d); w.ally.pos.addScaledVector(_toD, Math.min(spd * dt, d)); }
      w.ally.vel.copy(_toD).multiplyScalar(spd);
      if (d > 8 && spd > 3) headingQuat(w.ally.quat, _toD);       // flying to station -> face travel
      else w.ally.quat.slerp(anchor.quat, 1 - Math.exp(-3 * dt)); // settled -> face formation heading
      w.thr.update(Math.min(1, 0.35 + spd / 60), dt);
      if (w.rcs) w.rcs.update(dt, true);
    }

    if (gateMesh) gateMesh.rotation.z += dt * 0.3; // idle spin on the wormhole ring

    // form-up slot marker tracks the live slot
    if (slotShown && missionHud) { playerSlotWorld(_ps); missionHud.setSlot(_ps, 'FORM UP'); }

    if (comms) comms.update(dt);
    if (missionHud) missionHud.update({ camera: world.camera, playerPos: player.pos });
    if (state !== 'running') return;

    for (const b of def.script || []) {
      if (firedAt[b.id] != null) continue;
      if (evalTrigger(b.when)) { firedAt[b.id] = clock; for (const a of (b.do || [])) runAction(a); if (state !== 'running') break; }
    }
  }

  function onPlayerOut(reason) { resolve('fail', { title: 'MISSION FAILED', sub: reason || 'You were lost.' }); }

  function dispose() {
    for (const w of wingmen) {
      try { w.ally.alive = false; scene.remove(w.pivot); if (w.rcs && w.rcs.group) scene.remove(w.rcs.group); } catch (_) { /* best effort */ }
    }
    wingmen.length = 0;
    if (gateMesh) { try { scene.remove(gateMesh); gateMesh.geometry.dispose(); gateMesh.material.dispose(); } catch (_) {} gateMesh = null; }
    if (comms) comms.clear();
    if (missionHud) { missionHud.hide(); missionHud.clearObjectives(); }
  }

  return { start, update, targetFor, friendlies, dispose, onPlayerOut, get state() { return state; } };
}
