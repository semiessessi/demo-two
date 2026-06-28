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

export function createAttract(scene, camera, { ship, thrusters, chigKit, enemyMgr, projectiles, vfx, debris, lighting, rcs }) {
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
  const allyThrusters = [thrusters]; // per-ally thrusters, ticked by hand during the scripted intro fly-in

  // allies #2,#3: clone the align subtree (shares geometry + CSM-registered materials so they stay lit/
  // shadowed), wrap a fresh pivot, give each its own thrusters + engine light spill.
  const cloneRigs = []; // cloned pivots + home offsets (menu backdrop hide/show + re-arm)
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
    allyThrusters.push(thr);
    lighting.attachThrusters(pv, ship.nozzles, ship.rearDir, ship.radius);
    lighting.registerTree(pv); // idempotent (basePatch guard) — re-adds the shared materials
    allies.push(makeAlly(pv, align, ship.engineMaterials, thr));
    cloneRigs.push({ pivot: pv, off: off.clone() });
  }

  // each ally gets its own maneuvering (RCS) jets — they fire from the ally's actual rotation each frame
  // (pitch/roll/yaw as it banks) + deceleration, exactly like the player's.
  // ally #0 IS the player's own ship -> reuse the player's RCS (when provided by main) instead of building
  // a second rig on the same pivot (that caused doubled/frozen maneuvering jets after launch).
  const allyRcs = allies.map((a, i) => (i === 0 && rcs) ? rcs : createRcs(scene, { pivot: a.pivot }));

  // --- cinematic intro: the Hammerheads sweep in as a formation, then the Chigs do, THEN the chaos ----
  // Reuse the existing spawn offsets AS the formation shape (ship at origin + each clone's offset).
  const introSlots = allies.map((a) => a.pos.clone());
  let phase = 'introAllies'; // 'introAllies' -> 'introChigs' -> 'battle'
  let phaseT = 0;
  const TA = 5.0, TC = 6.5; // intro shot durations (s) — longer Chig phase so both formations read before they close
  const introSpeed = 40; // == DEFAULT_TUNE.speed so the handoff to combat AI has no acceleration pop
  const introHeading = new THREE.Vector3(0, 0, -1); // formation sweeps toward -Z (where the camera waits)
  const introCenter = new THREE.Vector3(34, -5, 360); // starts far back + off to one side; arrives near origin
  const _ir = new THREE.Vector3(), _iu = new THREE.Vector3(), _ifw = new THREE.Vector3();
  const _im = new THREE.Matrix4(), _iq = new THREE.Quaternion();

  // Drive the allies' live refs along a tight straight formation (NOT a.update — their separation would
  // tear the formation apart, and they'd auto-target the instant Chigs exist). The camera does the sweep.
  function flyInAllies(dt) {
    introCenter.addScaledVector(introHeading, introSpeed * dt);
    _ifw.copy(introHeading).normalize();
    _ir.crossVectors(_ifw, UP); if (_ir.lengthSq() < 1e-6) _ir.set(1, 0, 0); _ir.normalize();
    _iu.crossVectors(_ir, _ifw).normalize();
    _im.lookAt(ZERO, _ifw, UP); _iq.setFromRotationMatrix(_im); // nose (-Z) along heading, roll 0
    for (let i = 0; i < allies.length; i++) {
      const a = allies[i]; if (!a.alive) continue;
      const s = introSlots[i];
      a.pos.copy(introCenter).addScaledVector(_ir, s.x).addScaledVector(_iu, s.y).addScaledVector(_ifw, -s.z);
      // gentle per-ship wobble on the way in (phase off the continuously-advancing runway depth, so no seam)
      const wob = introCenter.z * 0.07 + i * 1.9;
      a.pos.addScaledVector(_ir, Math.sin(wob) * 3.0).addScaledVector(_iu, Math.sin(wob * 0.6 + 1.3) * 2.2);
      a.vel.copy(_ifw).multiplyScalar(introSpeed); // primes a.update's steer/orient at the handoff
      a.quat.copy(_iq);
      allyThrusters[i].update(0.9, dt);
    }
    for (const m of ship.engineMaterials) m.emissiveIntensity = 1.8 + 0.85 * 3.2;
    if (allyRcs) for (let i = 0; i < allyRcs.length; i++) allyRcs[i].update(dt, allies[i].alive);
  }

  function chigCentroid(out) {
    out.set(0, 0, 0); let n = 0;
    for (const e of enemyMgr.enemies) if (e.alive) { out.add(e.pos); n++; }
    if (n) out.multiplyScalar(1 / n); else out.copy(focus.pos).addScaledVector(introHeading, 200);
    return out;
  }

  flyInAllies(0); // place the formation at the start of the runway now, so frame-1 focus + camera are correct

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
  // `key` is either a formation index (ring spread, used by looping respawns) or an explicit Vector3 bearing
  // (used by the intro to cluster the wave on one side).
  function spawnOneFormation(key, c, dist) {
    let dir;
    if (key && key.isVector3) dir = key;
    else { const ang = (key / 3) * Math.PI * 2 + 0.4; dir = new THREE.Vector3(Math.cos(ang), (Math.random() - 0.5) * 0.3, Math.sin(ang)).normalize(); }
    const pos = c.clone().addScaledVector(dir, dist || 410);
    const heading = c.clone().sub(pos).normalize();
    enemyMgr.spawnFormation({ pattern: 'vee', count: 4, pos, heading, difficulty });
    vfx.firework(pos, 1.0); // warp-in flash
  }
  // Stagger the wave across a few frames: cloning all the meshes (+ fireworks) in one frame was the hitch.
  function spawnWave(stagger) {
    updateFocus();
    const c = focus.pos.clone();
    if (stagger) { for (let i = 0; i < 3; i++) spawnQueue.push({ key: i, c, dist: 410 }); spawnTimer = 0; }
    else for (let i = 0; i < 3; i++) spawnOneFormation(i, c, 410);
  }
  // Intro variant: cluster the whole wave on ONE random bearing (~±35°) so the reveal shot frames them as a
  // single incoming wall, warping in one group at a time.
  function spawnIntroWave() {
    updateFocus();
    const c = focus.pos.clone();
    const base = Math.random() * Math.PI * 2;
    for (let i = 0; i < 3; i++) {
      const off = ((i - 1) / 3) * 1.0; // spread ~±0.33 rad around the bearing
      const dir = new THREE.Vector3(Math.cos(base + off), (Math.random() - 0.5) * 0.2, Math.sin(base + off)).normalize();
      spawnQueue.push({ key: dir, c, dist: 1000 }); // warp in FAR -> you see both formations fly in; the fight starts as they close
    }
    spawnTimer = 0;
  }
  function processSpawnQueue(dt) {
    if (!spawnQueue.length) return;
    spawnTimer -= dt;
    if (spawnTimer > 0) return;
    spawnTimer = 0.5; // one 4-ship formation every ~0.5s
    const it = spawnQueue.shift();
    spawnOneFormation(it.key, it.c, it.dist);
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
  let shot = 'orbit', shotT = 0, shotDur = 6, subject = null, killTarget = null, killCd = 0, orbitAng = 0, snap = true, camInit = false, killLinger = 0;
  const MIN_SHOT = 3.0; // don't re-cut a battle shot before this even if the subject dies (kills the choppiness)
  const _eye = new THREE.Vector3(), _look = new THREE.Vector3(), _up = new THREE.Vector3();
  const _f = new THREE.Vector3(), _u = new THREE.Vector3(), _side = new THREE.Vector3();
  const _mid = new THREE.Vector3(), _bc = new THREE.Vector3();
  const _killPos = new THREE.Vector3(), _killVel = new THREE.Vector3(); // frozen so the kill-cam linger survives prune()
  const _qFrame = new THREE.Quaternion(), _frameAx = new THREE.Vector3(0, 1, 0);
  let menuFraming = true, frameSide = 1; // rule-of-thirds: push the action onto a third so the centred menu doesn't cover it (flips per shot)
  // Yaw the target orientation ~1/6 of the horizontal FOV so the subject sits on a third (clear of the menu).
  function applyFraming() {
    if (!menuFraming) return;
    const hfov = 2.0 * Math.atan(Math.tan(camera.fov * 0.5 * Math.PI / 180.0) * camera.aspect);
    _qFrame.setFromAxisAngle(_frameAx, (hfov / 6.0) * frameSide);
    _qTarget.multiply(_qFrame); // yaw around the camera's local up -> shifts the subject sideways on screen
  }
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
  // a Chig actively PRESSING AN ATTACK — engaging (not still in formation/scatter) and bearing down on an
  // ally; the one closest to an ally wins (most in-the-action). The camera prefers this over a random Chig.
  function attackingChig() {
    let best = null, bd = 220 * 220;
    for (const e of enemyMgr.enemies) {
      if (!e.alive || e.mode === 'formation' || e.mode === 'scatter') continue;
      for (const a of allies) {
        if (!a.alive) continue;
        const d = e.pos.distanceToSquared(a.pos);
        if (d < bd) { bd = d; best = e; }
      }
    }
    return best;
  }
  const chigSubject = () => attackingChig() || heroChig(); // prefer an attacking Chig, else any hunted one
  // a Chig mid death with a big blast still coming — the dramatic explosion to fly by. Covers SPIN-OUT
  // (final blast at dur) and CHAINED (biggest blast ~t=0.5); 'instant' has nothing to follow.
  function dyingChig() {
    let best = null, bestRem = -1;
    for (const e of enemyMgr.enemies) {
      if (e.alive || !e.death || e.death.done) continue;
      let rem;
      if (e.death.type === 'spinout') rem = (e.death.dur || 0) - e.death.t;
      else if (e.death.type === 'chained') rem = 0.50 - e.death.t;
      else continue;
      if (rem > 0.2 && rem < 1.8 && rem > bestRem) { bestRem = rem; best = e; }
    }
    return best;
  }

  // Re-acquire a fresh subject of the CURRENT shot type without cutting (keeps the camera rolling when the
  // framed ship dies early). Falls back to a normal cut if nothing fresh is available.
  function reSubject() {
    const prev = subject;
    subject = shot === 'chaseChig' ? chigSubject() : shot === 'lineOfFire' ? gunningAlly() : engagedAlly();
    if (!subject || subject === prev) { pickShot(); return; }
    snap = false; // no cut — just follow a new ship of the same kind
  }

  function pickShot() {
    const r = Math.random();
    // weighted toward FOLLOWING ATTACKING CHIGS (chaseChig now the dominant shot) over the ally/orbit shots
    let s = r < 0.44 ? 'chaseChig' : r < 0.62 ? 'chase' : r < 0.78 ? 'lineOfFire' : r < 0.92 ? 'duel' : 'orbit';
    if (s === shot && s !== 'orbit') s = s === 'chaseChig' ? 'chase' : 'chaseChig'; // avoid an immediate repeat
    subject = s === 'chaseChig' ? chigSubject() : s === 'lineOfFire' ? gunningAlly() : engagedAlly();
    if (!subject) { s = 'chaseChig'; subject = chigSubject(); }
    if (!subject) { s = 'orbit'; subject = engagedAlly(); }
    shot = s; shotT = 0; shotDur = 7 + Math.random() * 4; snap = true; // longer shots (7-11s) — fewer, more deliberate cuts
    orbitAng = Math.random() * Math.PI * 2;
    frameSide = -frameSide; // alternate which third the action sits on, each cut
  }

  // wide establishing orbit as "chaos erupts", slerping out of the intro pose (no jarring cut at handoff)
  function beginBattle() {
    shot = 'orbit'; subject = engagedAlly(); killTarget = null; shotT = 0; shotDur = 9; snap = false;
    battleCenter(_bc);
    orbitAng = Math.atan2(camera.position.z - _bc.z, camera.position.x - _bc.x); // continue the orbit from where the camera is
  }

  // Intro camera: two continuous, eased, gimbal-safe sweeps (one per intro phase) on the existing slerp rig.
  function updateIntroCamera(dt) {
    _up.copy(UP);
    if (phase === 'introAllies') {
      const p = THREE.MathUtils.clamp(phaseT / TA, 0, 1);
      _f.copy(introHeading).normalize();
      _side.crossVectors(_f, UP).normalize();
      const C = focus.pos;
      // crane + lateral sweep, always AHEAD of the formation (look-eye never nears world-up -> no 180° whip)
      const ahead = THREE.MathUtils.lerp(95, 30, p);
      const side = THREE.MathUtils.lerp(70, -8, p);
      const up = THREE.MathUtils.lerp(34, 10, p);
      _eye.copy(C).addScaledVector(_f, ahead).addScaledVector(_side, side).addScaledVector(UP, up);
      _look.copy(C).addScaledVector(_f, 8);
    } else { // introChigs: two-army reveal — allies foreground, Chigs sweeping in beyond
      const p = THREE.MathUtils.clamp(phaseT / TC, 0, 1);
      const A = focus.pos;
      chigCentroid(_mid); // E
      _f.copy(_mid).sub(A);
      const span = Math.max(1, _f.length());
      _f.normalize();
      _side.crossVectors(_f, UP).normalize();
      _bc.copy(A).addScaledVector(_f, span * 0.35); // anchor biased toward the allies (they read as foreground)
      const s = THREE.MathUtils.lerp(72, 46, p);
      const h = THREE.MathUtils.lerp(30, 16, p);
      _eye.copy(_bc).addScaledVector(_side, s).addScaledVector(UP, h);
      _look.copy(A).lerp(_mid, THREE.MathUtils.lerp(0.32, 0.55, p)); // framing drifts toward the incoming Chigs
    }
    _mLook.lookAt(_eye, _look, _up);
    _qTarget.setFromRotationMatrix(_mLook); applyFraming();
    if (!camInit) { camera.position.copy(_eye); camera.quaternion.copy(_qTarget); camInit = true; }
    else {
      camera.position.lerp(_eye, 1 - Math.exp(-4.0 * dt));
      camera.quaternion.slerp(_qTarget, 1 - Math.exp(-4.0 * dt));
    }
  }

  function updateCamera(dt) {
    if (phase !== 'battle') { updateIntroCamera(dt); return; }
    killCd -= dt;
    // opportunistic explosion fly-by: cut to a dramatic dying Chig (rate-limited so it isn't too cutty)
    if (shot !== 'killcam' && killCd <= 0) {
      const dc = dyingChig();
      if (dc) { shot = 'killcam'; killTarget = dc; shotT = 0; snap = true; killCd = 8 + Math.random() * 4; killLinger = 0; _killPos.copy(dc.pos); _killVel.copy(dc.vel); } // ~8-12s between explosion cuts (was 4 — too cutty)
    }
    shotT += dt;
    if (shot === 'killcam') {
      // track the Chig until its death sequence finishes, then HOLD on the smoke/debris a beat before cutting
      const done = !killTarget || !killTarget.death || killTarget.death.done;
      if (!done && killTarget) { _killPos.copy(killTarget.pos); _killVel.copy(killTarget.vel); }
      if (done) killLinger += dt;
      if (killLinger >= 1.4 || shotT >= 4.0) pickShot(); // (4s backstop if a death never resolves)
    } else {
      const subjDead = subject && subject.alive === false;
      if (subjDead && shotT < MIN_SHOT) reSubject();          // died early -> follow a new ship, no cut
      else if (shotT >= shotDur || subjDead) pickShot();
    }

    _up.copy(UP);
    if (shot === 'killcam') { // close, side-on, on the tumbling/exploding Chig (frozen pos survives prune())
      _side.copy(_killVel).cross(UP); if (_side.lengthSq() < 1e-4) _side.set(1, 0, 0); _side.normalize();
      _eye.copy(_killPos).addScaledVector(_side, 20).addScaledVector(UP, 8);
      _look.copy(_killPos);
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
      orbitAng += dt * 0.18; // slower drift — more deliberate
      _eye.set(Math.cos(orbitAng) * 44, 17, Math.sin(orbitAng) * 44).add(_bc);
      _look.copy(_bc);
    }

    _mLook.lookAt(_eye, _look, _up); // Matrix4.lookAt handles the look||up degenerate case internally
    _qTarget.setFromRotationMatrix(_mLook); applyFraming();
    if (snap || !camInit) { camera.position.copy(_eye); camera.quaternion.copy(_qTarget); snap = false; camInit = true; }
    else {
      camera.position.lerp(_eye, 1 - Math.exp(-2.0 * dt));        // floatier dolly within a shot
      camera.quaternion.slerp(_qTarget, 1 - Math.exp(-2.2 * dt)); // slower, gimbal-lock-free orientation
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

  // No immediate spawn now — the intro sequence flies the allies in first, then warps the Chigs in.

  function update(dt) {
    phaseT += dt;
    updateFocus();
    if (phase === 'introAllies') {
      flyInAllies(dt);
      if (phaseT >= TA) { phase = 'introChigs'; phaseT = 0; camInit = false; spawnIntroWave(); } // one intentional cut: "the enemy arrives"
    } else if (phase === 'introChigs') {
      flyInAllies(dt);
      processSpawnQueue(dt); // drain the staggered Chig warp-ins during the reveal
      if (phaseT >= TC) { phase = 'battle'; beginBattle(); }
    } else {
      for (const a of allies) a.update(dt, { enemies: enemyMgr.enemies, friends: allies });
      if (allyRcs) for (let i = 0; i < allyRcs.length; i++) allyRcs[i].update(dt, allies[i].alive);
      maybeDramaDeath(dt);
      maybeRespawn(dt);
    }
    if (hullDebris) hullDebris.update(dt, null, enemyMgr.enemies);
    updateCamera(dt);
  }

  // --- menu-backdrop lifecycle (when attract runs behind the pre-game screen) ---
  // Hide/show the two CLONED allies (ally #1 is the player's own ship, owned by main). The clones
  // vanish during the player's sortie and reappear in the menu.
  function setVisible(on) { for (const r of cloneRigs) r.pivot.visible = on; }

  // Re-arm the cinematic battle when the player returns to the menu: reposition + heal the allies and
  // spawn a fresh Chig wave (main has already reset the world / cleared the previous enemies).
  function resume() {
    for (const r of cloneRigs) { r.pivot.position.copy(r.off); r.pivot.quaternion.identity(); r.pivot.visible = true; }
    for (const a of allies) a.patch();
    downAlly = false;
    difficulty = 0.4;
    snap = true; // hard-cut the camera back to the action
    // Restart the cinematic INTRO: the Hammerheads sweep in FIRST, then the Chigs arrive (the intro state
    // machine spawns them via spawnIntroWave). Do NOT dump a full wave up front — that put Chigs everywhere
    // shooting from frame one.
    phase = 'introAllies'; phaseT = 0; camInit = false;
    introCenter.set(34, -5, 360); // back to the start of the fly-in runway
    spawnQueue.length = 0; // drop any pending warp-ins
    flyInAllies(0); // place the formation at the runway start
  }

  return { update, focus, targetFor, friendlies, allies, setVisible, resume, setMenuFraming(on) { menuFraming = on; } };
}
