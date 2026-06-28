import * as THREE from 'three';
import { createThrusters } from '../thruster.js';
import { createAlly } from '../ally.js';
import { createRcs } from '../rcs.js';

// Mission runtime: the frame-ticked engine for one campaign mission. Owns the AI wingmen, the scripted
// beat/trigger evaluation, scripted enemy spawns, the nav waypoints, and win/lose resolution. While a
// mission is live this REPLACES waves.update in the main loop (see main.js frame()). It also ticks comms
// + missionHud each frame so main only needs the one mission.update(dt, player) call.
//
// world = { scene, camera, ship, enemyMgr, projectiles, vfx, lighting, hullDebris, comms, missionHud,
//           onComplete, onFail }

export function createMission(def, world) {
  const { scene, ship, enemyMgr, projectiles, vfx, lighting, comms, missionHud } = world;
  const wingmen = [];          // { id, speaker, slot, mode, ally, pivot, thr, rcs }
  const wpVec = {};            // waypoint id -> THREE.Vector3 (world)
  const firedAt = {};          // beat id -> mission-clock time it fired (drives {after})
  const objState = {};         // objective id -> state (drives {objective:..,is:..})
  let clock = 0;
  let state = 'running';       // 'running' | 'complete' | 'failed'
  let lastPlayer = null;       // latest player {pos,quat,vel} (targetFor runs before update each frame)
  let enemySpawned = false;
  let activeWp = null;

  const _off = new THREE.Vector3();

  // --- wingmen (the attract.js staging recipe, mortal by default) ---
  function spawnWingmen() {
    const startPos = new THREE.Vector3().fromArray((def.player && def.player.start && def.player.start.pos) || [0, 0, 0]);
    for (const w of (def.wingmen || [])) {
      const align = ship.align.clone(true);
      align.traverse((o) => { if (o.isMesh) o.castShadow = false; }); // clones don't cast shadows (perf)
      const pv = new THREE.Group();
      pv.add(align);
      scene.add(pv);
      const thr = createThrusters(pv, ship.nozzles, ship.rearDir, ship.radius);
      lighting.attachThrusters(pv, ship.nozzles, ship.rearDir, ship.radius);
      lighting.registerTree(pv); // idempotent — re-adds the shared CSM materials
      const rc = createRcs(scene, { pivot: pv });
      const ally = createAlly(scene, {
        pivot: pv, model: align, radius: ship.radius, engineMaterials: ship.engineMaterials, thrusters: thr,
        projectiles, vfx, lighting, team: 'player', mortal: w.mortal !== false,
        onDestroy: (a) => { if (world.hullDebris) world.hullDebris.burst({ pos: a.pos, obj: a.pivot, vel: a.vel }, 1.3); },
      });
      _off.fromArray(w.slot || [0, 0, 0]);
      ally.pos.copy(startPos).add(_off); // pos IS pivot.position — places the clone immediately
      wingmen.push({ id: w.id, speaker: w.speaker, slot: w.slot || [0, 0, 0], mode: w.mode || 'formate', ally, pivot: pv, thr, rcs: rc });
    }
  }

  function start() {
    clock = 0;
    state = 'running';
    for (const k of Object.keys(def.waypoints || {})) wpVec[k] = new THREE.Vector3().fromArray(def.waypoints[k]);
    spawnWingmen();
    if (comms) comms.load(def.vo, def.lines || {});
    if (missionHud) { missionHud.clearObjectives(); missionHud.setWaypoint(null); missionHud.show(); }
  }

  // enemies target the nearest of [player, alive wingmen] (used by combat missions; M1 has no enemies)
  function targetFor(e) {
    let best = lastPlayer, bestD = lastPlayer ? e.pos.distanceToSquared(lastPlayer.pos) : Infinity;
    for (const w of wingmen) {
      const a = w.ally;
      if (a && a.alive) { const d = e.pos.distanceToSquared(a.pos); if (d < bestD) { bestD = d; best = a; } }
    }
    return best;
  }
  // alive wingmen as combat friendlies ({pos, radius, hit}) so enemy bolts can hit them
  function friendlies() {
    const out = [];
    for (const w of wingmen) if (w.ally.alive) out.push({ pos: w.ally.pos, radius: w.ally.radius * 0.85, hit: w.ally.hit });
    return out;
  }

  // --- trigger evaluation ---
  function evalTrigger(t) {
    if (!t) return false;
    if (t.and) return t.and.every(evalTrigger);
    if (t.or) return t.or.some(evalTrigger);
    if (t.not) return !evalTrigger(t.not);
    if (t.t != null) return clock >= t.t;
    if (t.after != null) { const f = firedAt[t.after]; return f != null && clock >= f + (t.delay || 0); }
    if (t.waypoint != null) { const v = wpVec[t.waypoint]; return !!(v && lastPlayer && lastPlayer.pos.distanceTo(v) <= (t.radius || 200)); }
    if (t.commsDone != null) return comms ? comms.isDone(t.commsDone) : true;
    if (t.allEnemiesDead) return enemySpawned && !enemyMgr.enemies.some((e) => e.alive);
    if (t.allyDied != null) { const wm = wingmen.find((x) => x.id === t.allyDied); return !!(wm && !wm.ally.alive); }
    if (t.objective != null) return objState[t.objective] === (t.is || 'complete');
    if (t.playerDamaged != null) return false; // needs a damage ref — wired with combat missions
    return false;
  }

  function runAction(a) {
    if (!a) return;
    if (a.comms && comms) comms.play(a.comms);
    if (a.objective) {
      const o = a.objective;
      objState[o.id] = o.state || 'active';
      if (missionHud) missionHud.setObjective(o.id, { label: o.label, state: o.state });
    }
    if (a.waypoint) {
      const wp = a.waypoint;
      if (wp.hide || wp.id == null) { activeWp = null; if (missionHud) missionHud.setWaypoint(null); }
      else { activeWp = wp.id; if (missionHud) missionHud.setWaypoint(wpVec[wp.id], wp.id); }
    }
    if (a.spawn) {
      const s = a.spawn;
      enemyMgr.spawnFormation({
        pattern: s.pattern || 'vee', count: s.count || 4,
        pos: new THREE.Vector3().fromArray(s.at || [0, 0, -400]),
        heading: new THREE.Vector3().fromArray(s.heading || [0, 0, 1]),
        difficulty: s.difficulty || 0,
      });
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
    // wingmen
    const friends = wingmen.filter((x) => x.ally.alive).map((x) => x.ally);
    for (const w of wingmen) {
      if (!w.ally.alive) continue;
      if (w.mode === 'engage') {
        w.ally.update(dt, { enemies: enemyMgr.enemies, friends }); // AI flies + ticks its own thrusters
      } else { // formate on the player's wing
        _off.fromArray(w.slot).applyQuaternion(player.quat);
        w.ally.pos.copy(player.pos).add(_off);
        w.ally.quat.copy(player.quat);
        w.ally.vel.copy(player.vel);
        w.thr.update(0.7, dt);
      }
      if (w.rcs) w.rcs.update(dt, true);
    }
    if (comms) comms.update(dt);
    if (missionHud) missionHud.update({ camera: world.camera, playerPos: player.pos });
    if (state !== 'running') return; // resolved — overlay is up; stop firing beats
    // beats (in order; allow chains within a frame)
    for (const b of def.script || []) {
      if (firedAt[b.id] != null) continue;
      if (evalTrigger(b.when)) {
        firedAt[b.id] = clock;
        for (const a of (b.do || [])) runAction(a);
        if (state !== 'running') break;
      }
    }
  }

  function onPlayerOut(reason) { resolve('fail', { title: 'MISSION FAILED', sub: reason || 'You were lost.' }); }

  function dispose() {
    for (const w of wingmen) {
      try {
        w.ally.alive = false;
        scene.remove(w.pivot);
        if (w.rcs && w.rcs.group) scene.remove(w.rcs.group);
      } catch (_) { /* best effort */ }
    }
    wingmen.length = 0;
    if (comms) comms.clear();
    if (missionHud) { missionHud.hide(); missionHud.clearObjectives(); }
  }

  return {
    start, update, targetFor, friendlies, dispose, onPlayerOut,
    get state() { return state; },
  };
}
