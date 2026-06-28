import * as THREE from 'three';

// Per-frame collision coordinator: SWEPT sphere checks between bolts and ships.
//   player bolts  x enemy spheres        -> damage enemy, spark; on death -> explosion
//   enemy pulses  x player hit/zone      -> spark; route damage to the damage model
// Bolts move many units per frame (a player bolt at 380 u/s steps ~6 units at 60fps) while the hit
// radius is only ~2.6, so a point check at the bolt's current position tunnels straight past the
// target. We instead test the SEGMENT the bolt travelled this frame against each target sphere.
// `onPlayerHit(worldPoint, damage)` is set by main once the damage model exists.

export function createCombat(projectiles, enemyMgr, vfx, opts = {}) {
  const getPlayerPos = opts.getPlayerPos;
  const params = { playerHitRadius: opts.playerHitRadius || 4.5 };
  let onPlayerHit = opts.onPlayerHit || null;
  // attract/co-op: when set, enemy bolts route to whichever of these friendly ships they hit. Each entry is
  // { pos, radius, hit(worldPoint, dmg, segStart) }. When null, the single-player path below is used instead.
  let getFriendlies = opts.getFriendlies || null;
  // co-op: when set, a player bolt hitting an enemy calls this instead of mutating e.hp/killing —
  // host applies + may kill + broadcasts; joiner reports the hit. null = single-player (local hp).
  let onEnemyHit = null;

  const seg = new THREE.Vector3();
  const toC = new THREE.Vector3();
  const closest = new THREE.Vector3();
  const segStart = new THREE.Vector3();

  // squared distance from sphere centre `c` to the segment [a -> end]
  function segDistSq(a, end, c) {
    seg.copy(end).sub(a);
    const len2 = seg.lengthSq();
    let t = len2 > 1e-9 ? toC.copy(c).sub(a).dot(seg) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    closest.copy(a).addScaledVector(seg, t);
    return closest.distanceToSquared(c);
  }

  // Progressive battle damage: a wounded enemy trails LIGHT smoke once it's ~2 hits in, HEAVY at ~3
  // (sparks fly on every impact; the 4th is the kill, whose blast enemyMgr owns).
  function enemyDamageTrail(e, heavy) {
    return vfx.createTrail({
      getPos: () => e.pos,
      getVel: () => e.vel,
      life: heavy ? 2.2 : 1.6,
      radius: heavy ? 2.0 : 1.1,
      spawnDist: heavy ? 3.5 : 6.0,
      spawnInterval: heavy ? 0.28 : 0.5,
      density: heavy ? 1.1 : 0.45,
      blobs: heavy ? 4 : 2,
    });
  }

  function update(dt = 0) {
    const bolts = projectiles.live;
    for (let i = bolts.length - 1; i >= 0; i--) {
      const b = bolts[i];
      segStart.copy(b.pos).addScaledVector(b.vel, -dt); // where the bolt was at the start of the frame

      if (b.team === 'player') {
        for (const e of enemyMgr.enemies) {
          if (!e.alive) continue;
          const rr = e.radius + b.radius;
          if (segDistSq(segStart, b.pos, e.pos) <= rr * rr) {
            vfx.spark(b.pos, 0xffd27a);
            projectiles.kill(b);
            if (onEnemyHit) {
              // co-op: the host owns enemy hp. Host's cb applies damage + may kill + broadcast; a
              // joiner's cb just reports the hit (ehit) and shows the spark — never mutates hp/kills.
              onEnemyHit(e, b.damage, b.pos);
            } else {
              e.hp -= b.damage;
              if (e.hp <= 0) enemyMgr.kill(e); // death sequence (instant / spin-out / chained) owns the blast
            }
            break;
          }
        }
      } else if (b.team === 'enemy' && getFriendlies) {
        // attract/co-op: test the bolt against every friendly ship; the first one hit takes the damage.
        for (const f of getFriendlies()) {
          const rr = f.radius + b.radius;
          if (segDistSq(segStart, b.pos, f.pos) <= rr * rr) {
            vfx.spark(b.pos, 0x9fd0ff);
            f.hit(b.pos, b.damage, segStart);
            projectiles.kill(b);
            break;
          }
        }
      } else if (b.team === 'enemy' && getPlayerPos) {
        const pp = getPlayerPos();
        const rr = params.playerHitRadius + b.radius;
        if (segDistSq(segStart, b.pos, pp) <= rr * rr) {
          vfx.spark(b.pos, 0x9fd0ff);
          if (onPlayerHit) onPlayerHit(b.pos, b.damage, segStart); // segStart = bolt path start, for direct-hit (segment) routing
          projectiles.kill(b);
        }
      }
    }

    // progressive battle-damage smoke on wounded enemies (light once ~2 hits in, heavy at ~3); the
    // per-impact sparks above and the 4th-hit kill blast (enemyMgr) bracket it. Skipped on low quality.
    const useTrails = vfx.quality !== 'low';
    for (const e of enemyMgr.enemies) {
      if (!useTrails || !e.alive || e.death) {
        if (e.trail) { e.trail.stop(); e.trail = null; e.smokeLvl = 0; }
        continue;
      }
      const lvl = e.hp <= e.maxHp * 0.2 ? 2 : e.hp <= e.maxHp * 0.5 ? 1 : 0;
      if (lvl !== (e.smokeLvl || 0)) {
        if (e.trail) e.trail.stop();
        e.trail = lvl > 0 ? enemyDamageTrail(e, lvl === 2) : null;
        e.smokeLvl = lvl;
      }
      if (e.trail) e.trail.update(dt);
    }
  }

  return {
    update,
    params,
    setOnPlayerHit(fn) {
      onPlayerHit = fn;
    },
    setFriendlies(fn) {
      getFriendlies = fn;
    },
    setOnEnemyHit(fn) {
      onEnemyHit = fn;
    },
  };
}
