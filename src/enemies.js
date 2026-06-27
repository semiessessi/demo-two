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
    pulseSpeed: 290, // faster bolts -> less lead error, harder to outrun
    pulseDamage: 10,
    hp: 30,
    color: 0xffffff, // pure white-hot bolts that bloom hard
    rollRate: 4.0, // rad/s of barrel-rolling when not aiming
    wingSpacing: 12, // how far a wingman trails its point
    avoidDist: 34, // start peeling away from the player inside this range
    avoidStrength: 1.4, // how hard they veer off to avoid ramming
    pursueDist: 42, // dogfight: how far behind the player a hunter tries to sit (their six)
    pursueFlank: 22, // lateral fan so multiple hunters don't all stack on the exact tail
    maxSpread: 0.09, // rad — fire-cone spread for a totally inaccurate pilot (accuracy 0)
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
    // Lead the player so the bolt arrives where they'll be (the bolt does NOT inherit enemy velocity):
    // t ~ range/speed, then aim at player.pos + player.vel * t (one refinement). This is what makes
    // them actually connect against a moving target instead of always shooting behind.
    const S = params.pulseSpeed;
    let t = toLead.copy(player.pos).sub(muzzle).length() / S;
    if (player.vel) {
      leadPt.copy(player.pos).addScaledVector(player.vel, t);
      t = leadPt.distanceTo(muzzle) / S;
      leadPt.copy(player.pos).addScaledVector(player.vel, t);
    } else {
      leadPt.copy(player.pos);
    }
    fireDir.copy(leadPt).sub(muzzle).normalize();
    // accuracy: precise pilots fire dead on the lead; sloppy ones spray within a cone around it
    const spread = params.maxSpread * (1 - e.p.accuracy);
    if (spread > 0.001) {
      eright.crossVectors(fireDir, UP).normalize();
      eup.crossVectors(eright, fireDir).normalize();
      fireDir
        .addScaledVector(eright, (Math.random() * 2 - 1) * spread)
        .addScaledVector(eup, (Math.random() * 2 - 1) * spread)
        .normalize();
    }
    evel.copy(fireDir).multiplyScalar(S);
    projectiles.spawn({ pos: muzzle, vel: evel, color: params.color, team: 'enemy', damage: params.pulseDamage, life: 2.6, radius: 0.7, scale: 1.35 });
  }

  function update(dt, player) {
    if (player.quat) pfwd.set(0, 0, -1).applyQuaternion(player.quat);
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
        flank.crossVectors(pfwd, UP).normalize(); // player's right
        st.copy(player.pos)
          .addScaledVector(pfwd, -params.pursueDist)
          .addScaledVector(flank, Math.cos(e.attackAngle || 0) * params.pursueFlank)
          .addScaledVector(UP, Math.sin(e.attackAngle || 0) * params.pursueFlank * 0.5);
      }

      // evasive weave — evasive pilots juke sideways, harder when the player's nose is on them
      if (e.mode !== 'formation' && e.p.evasion > 0.02) {
        awayDir.copy(e.pos).sub(player.pos).normalize();
        const threat = player.quat ? Math.max(0, pfwd.dot(awayDir)) : 0; // 1 = player aiming at it
        e.jinkPhase += dt * (3 + e.p.evasion * 5);
        jinkAxis.crossVectors(e.vel, UP).normalize();
        st.addScaledVector(jinkAxis, Math.sin(e.jinkPhase) * params.jinkStrength * e.p.evasion * (0.5 + threat));
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
