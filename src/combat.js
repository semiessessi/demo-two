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
            e.hp -= b.damage;
            vfx.spark(b.pos, 0xffd27a);
            projectiles.kill(b);
            if (e.hp <= 0) enemyMgr.kill(e); // death sequence (instant / spin-out / chained) owns the blast
            break;
          }
        }
      } else if (b.team === 'enemy' && getPlayerPos) {
        const pp = getPlayerPos();
        const rr = params.playerHitRadius + b.radius;
        if (segDistSq(segStart, b.pos, pp) <= rr * rr) {
          vfx.spark(b.pos, 0x9fd0ff);
          if (onPlayerHit) onPlayerHit(b.pos, b.damage);
          projectiles.kill(b);
        }
      }
    }
  }

  return {
    update,
    params,
    setOnPlayerHit(fn) {
      onPlayerHit = fn;
    },
  };
}
