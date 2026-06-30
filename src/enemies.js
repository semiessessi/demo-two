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
    speed: 60, // faster than the Hammerhead's cruise so they can reposition + run you down
    turnRate: 1.4, // lower = can't perfectly stick to the player's tail (overshoots, makes passes)
    aimTurnRate: 2.8, // wider turning circle than before (was 5.0): can't pivot on a dime, so they swoop + re-attack
    passDist: 70,
    egressTime: 2.0, // longer break-off after a run -> looser, easier to catch
    passesBeforeDogfight: 3, // spend more time in formation strafing runs before breaking up
    formationSpacing: 14, // looser formation
    fireRate: 1.8, // more bolts in the air
    fireRange: 260,
    fireConeCos: Math.cos(0.32),
    pulseSpeed: 360, // faster bolts -> less lead error, harder to dodge/outrun
    pulseDamage: 10,
    hp: 30,
    color: 0xffffff, // pure white-hot bolts that bloom hard
    rollRate: 4.0, // rad/s of barrel-rolling when not aiming
    wingSpacing: 12, // how far a wingman trails its point
    avoidDist: 34, // start peeling away from the player inside this range
    avoidStrength: 1.4, // how hard they veer off to avoid ramming
    pursueDist: 42, // dogfight: how far behind the player a hunter tries to sit (their six)
    pursueFlank: 22, // lateral fan so multiple hunters don't all stack on the exact tail
    extendDist: 240, // dogfight: how far out a hunter blasts before swinging back for a fresh run
    extendTime: 2.6, // seconds a hunter spends extending out
    attackTime: 3.2, // seconds pressing the attack before breaking off to extend
    maxSpread: 0, // rad — random fire-cone spread (OFF: enemies fire dead on the lead; raise to add spray)
    jinkStrength: 18, // how far an evasive pilot weaves sideways
    persSpread: 0.6, // per-pilot random variation in personality traits (GUI-tunable)
  };
  Object.assign(params, opts.params || {});

  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

  // Roll a pilot personality from the wave difficulty (0..1) plus per-pilot jitter, so a formation is
  // a mix of snipers / brawlers / erratic flyers and the average toughness climbs with the difficulty.
  function makePersonality(diff) {
    const j = () => (Math.random() - 0.5) * params.persSpread;
    const aggression = clamp01(0.32 + diff * 0.5 + j());
    const accuracy = clamp01(0.3 + diff * 0.55 + j());
    const fireMult = THREE.MathUtils.clamp(0.6 + diff * 0.7 + j(), 0.4, 2.0);
    const evasion = clamp01(0.25 + diff * 0.5 + j());
    // aggressive pilots break off close; timid ones hang back and snipe from range
    const standoff = THREE.MathUtils.lerp(params.passDist * 1.8, params.passDist * 0.7, aggression);
    const scatterTime = 1.4 + Math.random() * 1.0 + evasion * 0.8 + (1 - aggression) * 0.6;
    return { aggression, accuracy, fireMult, evasion, standoff, scatterTime };
  }

  const enemies = [];
  const formations = [];
  let kills = 0;
  let serial = 0; // monotonic — gives every Chig a unique trackable hash
  let vfx = null; // set by main once VFX exists — death explosions / smoke
  let debris = null; // set by main — ship-fracture chunks on death
  const DEATH_SCALE = 2.8; // enemy-death blast size (~3x the old)
  function spawnDebris(e) { return debris ? debris.burst(e, 1.0) : false; }

  const FWD = new THREE.Vector3(0, 0, -1);
  const ZAX = new THREE.Vector3(0, 0, 1);
  const UP = new THREE.Vector3(0, 1, 0);
  const ZERO = new THREE.Vector3();
  const desired = new THREE.Vector3();
  const _avoid = new THREE.Vector3(); // asteroid-avoidance steering offset
  let avoidFn = null; // set by main when the asteroid field is active -> Chigs steer around rocks
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
  const eup = new THREE.Vector3();
  const fireDir = new THREE.Vector3();
  const muzzle = new THREE.Vector3();
  const evel = new THREE.Vector3();
  const toLead = new THREE.Vector3();
  const leadPt = new THREE.Vector3();
  const flank = new THREE.Vector3();
  const awayDir = new THREE.Vector3();
  const jinkAxis = new THREE.Vector3();
  const pfwd = new THREE.Vector3();

  function spawnFormation({ pattern = 'vee', count = 4, pos, heading, difficulty = 0 }) {
    const slots = formationSlots(pattern, count, params.formationSpacing);
    const anchor = { pos: pos.clone(), vel: heading.clone().setLength(params.speed), phase: 'ingress', egress: 0, passes: 0 };
    const f = { anchor, members: [], slots, initialCount: count, dogfight: false, scatter: false, scatterTimer: 0, lastCount: count };
    for (let i = 0; i < count; i++) {
      const obj = spawnChig(chigKit.template);
      const e = {
        obj,
        pos: pos.clone(),
        vel: heading.clone().setLength(params.speed),
        hp: params.hp,
        maxHp: params.hp, // for the progressive battle-damage smoke (combat.js)
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
        p: makePersonality(difficulty), // pilot personality
        jinkPhase: Math.random() * Math.PI * 2, // evasive-weave phase
        name: 'Chig Fighter',
        hash: ((serial++ * 0x9e37 + 0x3b9f) & 0xffff).toString(16).toUpperCase().padStart(4, '0'), // unique id
      };
      obj.position.copy(e.pos);
      scene.add(obj);
      enemies.push(e);
      f.members.push(e);
    }
    formations.push(f);
    return f;
  }

  // First loss: the survivors break and scatter outward for a moment so they aren't picked off in a
  // line, then settle into the dogfight.
  function startScatter(f) {
    f.scatter = true;
    f.scatterTimer = 0;
    for (const e of f.members) {
      e.mode = 'scatter';
      f.scatterTimer = Math.max(f.scatterTimer, e.p.scatterTime);
    }
  }

  function intoDogfight(f) {
    f.dogfight = true;
    f.scatter = false;
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

  function steer(e, target, dt, speed, turn) {
    desired.copy(target).sub(e.pos);
    if (desired.lengthSq() > 1e-6) desired.setLength(speed);
    e.vel.lerp(desired, 1 - Math.exp(-(turn || params.turnRate) * dt));
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
        // evasive pilots barrel-roll harder + change up more often
        e.rollVel = (Math.random() * 2 - 1) * params.rollRate * (0.6 + e.p.evasion);
        e.rollTimer = 0.3 + Math.random() * (1.2 - e.p.evasion * 0.7);
      }
      e.roll += e.rollVel * dt;
    }
  }

  function tryFire(e, player, aiming) {
    if (!aiming || e.fireCd > 0) return;
    e.fireCd = 1 / (params.fireRate * e.p.fireMult); // some pilots fire far more/less often
    muzzle.copy(efwd).multiplyScalar(e.radius * 1.2).add(e.pos);
    // Fire BORESIGHT — straight down the nose, so the bolt ALWAYS travels exactly where the ship is
    // pointed and flying. Leading is done by turning the nose onto the player's lead (in the steering),
    // never by angling the bolt off the line of travel.
    evel.copy(efwd).multiplyScalar(params.pulseSpeed);
    // Chig bolts: twice as wide, white-hot, glowing (HDR -> bloom) and crackling with noise.
    projectiles.spawn({ pos: muzzle, vel: evel, color: 0xffffff, team: 'enemy', damage: params.pulseDamage, life: 2.6, radius: 0.7, scale: 2.4, width: 2.4, glow: 2.8, noise: 0.6, round: 1 }); // round fractal-noise streak (visual ~2x; collision radius unchanged)
    if (opts.onFire) opts.onFire(muzzle); // SFX hook — Chig shot sound (muzzle is a shared temp, read synchronously)
  }

  function update(dt, defaultTarget, targetFor) {
    // defaultTarget = the one shared target (the player in normal play, a focus point in attract). Optional
    // targetFor(e) lets each enemy chase a DIFFERENT friendly (attract: nearest ally; co-op later: nearest of
    // player+allies). When targetFor is absent, every enemy uses defaultTarget -> identical to before.
    if (defaultTarget.quat) pfwd.set(0, 0, -1).applyQuaternion(defaultTarget.quat);
    for (let fi = formations.length - 1; fi >= 0; fi--) {
      const f = formations[fi];
      f.members = f.members.filter((m) => m.alive);
      if (f.members.length === 0) {
        formations.splice(fi, 1);
        continue;
      }
      const lostOne = f.members.length < f.lastCount;
      f.lastCount = f.members.length;
      if (!f.dogfight) {
        if (f.scatter) {
          f.scatterTimer -= dt; // scattering — count down, then drop into the dogfight
          if (f.scatterTimer <= 0) intoDogfight(f);
        } else if (lostOne) {
          startScatter(f); // first loss → break and scatter
        } else if (f.anchor.passes >= params.passesBeforeDogfight) {
          intoDogfight(f); // survived the passes → dogfight directly
        }
      }
      if (!f.dogfight && !f.scatter) {
        const a = f.anchor;
        if (a.phase === 'ingress') {
          desired.copy(defaultTarget.pos).sub(a.pos).setLength(params.speed);
          a.vel.lerp(desired, 1 - Math.exp(-params.turnRate * 0.8 * dt));
          a.vel.setLength(params.speed);
          a.pos.addScaledVector(a.vel, dt);
          if (a.pos.distanceTo(defaultTarget.pos) < params.passDist) {
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
      // each enemy may chase its OWN friendly (attract/co-op); falls back to the shared default target. The
      // rest of this loop reads `player`, so per-enemy targeting needs no other change. pfwd is recomputed
      // here so the six-station + threat sense use THIS enemy's target's forward.
      const player = (targetFor && targetFor(e)) || defaultTarget;
      if (player.quat) pfwd.set(0, 0, -1).applyQuaternion(player.quat);
      const distP = e.pos.distanceTo(player.pos);

      // choose a steering target
      if (e.mode === 'scatter') {
        // break outward, away from the player, each peeling to its own side
        awayDir.copy(e.pos).sub(player.pos);
        if (awayDir.lengthSq() < 1e-4) awayDir.copy(e.vel);
        awayDir.normalize();
        jinkAxis.crossVectors(awayDir, UP).normalize();
        st.copy(e.pos).addScaledVector(awayDir, 130).addScaledVector(jinkAxis, e.wingSide * 70);
      } else if (e.mode === 'formation') {
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
        // point (or orphaned wingman): hunt the player's SIX. Slide in behind along their heading and
        // hold station on the tail, fanned out by attackAngle so hunters don't stack. A straight-flying
        // target lets them line up the tail and shred it; turning constantly throws off both their tail
        // position AND their firing lead — manoeuvring is the counter.
        if (!e.wingOf) e.role = 'point';
        if (e.extendT > 0) {
          // EXTEND: blast out clear of the player, then swing back for a fresh run (boom-and-zoom).
          e.extendT -= dt;
          awayDir.copy(e.pos).sub(player.pos);
          if (awayDir.lengthSq() < 1e-4) awayDir.copy(e.vel);
          awayDir.normalize();
          flank.crossVectors(awayDir, UP).normalize();
          st.copy(player.pos).addScaledVector(awayDir, params.extendDist).addScaledVector(flank, (e.wingSide || 1) * params.extendDist * 0.45);
        } else {
          // hunt the player's SIX: slide in behind along their heading, fanned out by attackAngle.
          flank.crossVectors(pfwd, UP).normalize(); // player's right
          st.copy(player.pos)
            .addScaledVector(pfwd, -params.pursueDist)
            .addScaledVector(flank, Math.cos(e.attackAngle || 0) * params.pursueFlank)
            .addScaledVector(UP, Math.sin(e.attackAngle || 0) * params.pursueFlank * 0.5);
          // pressed the attack a while? break off and extend out so the next pass is a fresh run.
          if (distP < params.fireRange) { e.attackT = (e.attackT || 0) + dt; if (e.attackT > params.attackTime) { e.extendT = params.extendTime; e.attackT = 0; } }
          else e.attackT = Math.max(0, (e.attackT || 0) - dt * 0.5);
        }
      }

      // In gun range, point the nose at the player's intercept LEAD so the boresight shot connects AND the
      // ship visibly flies toward where it shoots. The lead is an exact constant-velocity solve (iterated),
      // so a STRAIGHT-flying player gets nailed; manoeuvring breaks the prediction. Out of range the mode
      // station above (six approach / wing slot) sets up the run.
      const inGunRange = e.mode !== 'formation' && e.mode !== 'scatter' && !(e.extendT > 0) && distP < params.fireRange;
      if (inGunRange) {
        let tHit = distP / params.pulseSpeed;
        st.copy(player.pos);
        if (player.vel) for (let k = 0; k < 3; k++) { st.copy(player.pos).addScaledVector(player.vel, tHit); tHit = st.distanceTo(e.pos) / params.pulseSpeed; }
      }

      // evasive weave — evasive pilots juke sideways, harder when the player's nose is on them
      if (e.mode !== 'formation' && e.p.evasion > 0.02) {
        awayDir.copy(e.pos).sub(player.pos).normalize();
        const threat = player.quat ? Math.max(0, pfwd.dot(awayDir)) : 0; // 1 = player aiming at it
        e.jinkPhase += dt * (3 + e.p.evasion * 5);
        jinkAxis.crossVectors(e.vel, UP).normalize();
        st.addScaledVector(jinkAxis, Math.sin(e.jinkPhase) * params.jinkStrength * e.p.evasion * (0.04 + threat * 1.4)); // steady up vs a non-threatening (straight) player; weave hard only when they aim at you
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
      if (avoidFn) st.add(avoidFn(e.pos, e.radius, _avoid)); // steer around asteroids instead of ramming them
      steer(e, st, dt, e.mode === 'formation' ? params.speed : params.speed * 1.05, inGunRange ? params.aimTurnRate : params.turnRate);
      orient(e);
      efwd.copy(FWD).applyQuaternion(e.obj.quaternion);
      toP.copy(player.pos).sub(e.pos);
      const dist = toP.length() || 1;
      const aiming = dist < params.fireRange && efwd.dot(toP.multiplyScalar(1 / dist)) > params.fireConeCos;
      updateRoll(e, aiming, dt);
      tryFire(e, player, aiming);
    }

    stepDeaths(dt); // advance death sequences for dying enemies still tumbling in the scene
  }

  // Advance only the death sequences — the co-op JOINER calls this instead of update(): enemies are
  // host-authoritative proxies (transforms come from the host's snapshot), so the joiner runs no AI,
  // but dying Chigs still need their tumble/blast played out locally.
  function stepDeaths(dt) {
    for (const e of enemies) {
      if (!e.alive && e.death && !e.death.done) advanceDeath(e, dt);
    }
  }

  // Co-op JOINER: create a render-only enemy proxy (no AI/formation fields). netgame writes its
  // transform each frame from the host snapshot; combat reports hits to the host rather than killing it.
  function spawnProxy({ hash, pos, quat }) {
    const obj = spawnChig(chigKit.template);
    const e = {
      obj, hash, proxy: true, alive: true,
      pos: pos ? pos.clone() : new THREE.Vector3(),
      vel: new THREE.Vector3(),
      hp: params.hp, maxHp: params.hp, radius: chigKit.radius,
      name: 'Chig Fighter',
    };
    if (quat) obj.quaternion.copy(quat);
    obj.position.copy(e.pos);
    scene.add(obj);
    enemies.push(e);
    return e;
  }

  // Co-op JOINER: the host says enemy <hash> died -> play its death sequence locally.
  function killByHash(hash, type) {
    for (const e of enemies) if (e.hash === hash && e.alive) { kill(e, type); return e; }
    return null;
  }

  // A killing blow. Enemy leaves combat immediately (alive=false) but stays in the scene running a
  // death SEQUENCE (advanced in update, removed by prune when done). Three flavours:
  //   • instant  — one big blast, gone.
  //   • spin-out — tumbles + trails smoke for a moment, then the final blast.
  //   • chained  — small pop, then two big ones that obliterate it into tiny fragments.
  function kill(e, forceType) {
    if (!e.alive) return;
    e.alive = false;
    kills++;
    const r = Math.random();
    const type = forceType || (r < 0.45 ? 'instant' : r < 0.75 ? 'spinout' : 'chained');
    if (type === 'instant') {
      e.death = { type: 'instant', t: 0, done: true };
      if (vfx) vfx.explosion(e.pos, DEATH_SCALE);
      e.obj.visible = false;
      spawnDebris(e);
    } else if (type === 'spinout') {
      e.death = {
        type: 'spinout', t: 0, dur: 0.9 + Math.random() * 0.9, done: false, smokeAcc: 0,
        spin: new THREE.Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 8),
      };
      if (vfx) vfx.explosion(e.pos, DEATH_SCALE * 0.3); // small initial pop
    } else {
      e.death = { type: 'chained', t: 0, dur: 0.75, done: false, stage: 0 };
      if (vfx) vfx.explosion(e.pos, DEATH_SCALE * 0.4); // small first
    }
  }

  function tinyFragments(pos) {
    // lots of tiny sparks/embers — placeholder until the real mesh-fracture debris lands
    if (!vfx) return;
    for (let i = 0; i < 6; i++) vfx.spark(pos, Math.random() < 0.5 ? 0xffd27a : 0xff8a3a);
    for (let i = 0; i < 12; i++) vfx.ember(pos, 0.15);
  }

  function advanceDeath(e, dt) {
    const d = e.death;
    d.t += dt;
    if (d.type === 'spinout') {
      e.pos.addScaledVector(e.vel, dt);
      e.vel.multiplyScalar(Math.max(0, 1 - 1.0 * dt)); // bleed speed
      e.obj.position.copy(e.pos);
      e.obj.rotateX(d.spin.x * dt); e.obj.rotateY(d.spin.y * dt); e.obj.rotateZ(d.spin.z * dt);
      d.smokeAcc += dt;
      if (d.smokeAcc >= 0.05) {
        d.smokeAcc = 0;
        if (vfx && vfx.smoke) vfx.smoke(e.pos);
        if (vfx && vfx.ember && Math.random() < 0.5) vfx.ember(e.pos, 0.2);
      }
      if (d.t >= d.dur) { if (vfx) vfx.explosion(e.pos, DEATH_SCALE); e.obj.visible = false; spawnDebris(e); d.done = true; }
    } else if (d.type === 'chained') {
      e.pos.addScaledVector(e.vel, dt);
      e.vel.multiplyScalar(Math.max(0, 1 - 0.8 * dt));
      e.obj.position.copy(e.pos);
      e.obj.rotateY(3 * dt);
      if (d.stage === 0 && d.t > 0.22) { d.stage = 1; if (vfx) vfx.explosion(e.pos, DEATH_SCALE * 0.9); }
      else if (d.stage === 1 && d.t > 0.5) { d.stage = 2; if (vfx) vfx.explosion(e.pos, DEATH_SCALE * 1.15); if (!spawnDebris(e)) tinyFragments(e.pos); e.obj.visible = false; }
      if (d.t >= d.dur) d.done = true;
    } else {
      d.done = true;
    }
  }

  function prune() {
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      if (!e.alive && (!e.death || e.death.done)) {
        scene.remove(e.obj);
        enemies.splice(i, 1);
      }
    }
  }

  function count() {
    let n = 0;
    for (const e of enemies) if (e.alive) n++; // dying enemies don't hold up the next wave
    return n;
  }

  function reset() {
    for (const e of enemies) { if (e.trail) e.trail.stop(); scene.remove(e.obj); } // stop battle-damage smoke
    enemies.length = 0;
    formations.length = 0;
    kills = 0;
  }

  return {
    spawnFormation,
    update,
    stepDeaths,   // co-op joiner: advance deaths without running AI
    spawnProxy,   // co-op joiner: render-only host-authoritative enemy
    killByHash,   // co-op joiner: play a death the host reported
    prune,
    count,
    reset,
    kill,
    setVfx(v) { vfx = v; },
    setDebris(d) { debris = d; },
    setAvoid(fn) { avoidFn = fn; }, // asteroid-avoidance provider (null = off)
    enemies,
    formations,
    params,
    get kills() {
      return kills;
    },
  };
}
