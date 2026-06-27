// Per-frame collision coordinator: sphere–sphere checks between bolts and ships.
//   player bolts  x enemy spheres        -> damage enemy, spark; on death -> explosion
//   enemy pulses  x player hit/zone      -> spark; route damage to the damage model (Phase 5)
// O(bolts x enemies) over small counts. `onPlayerHit(worldPoint, damage)` is set by main once the
// damage model exists.

export function createCombat(projectiles, enemyMgr, vfx, opts = {}) {
  const getPlayerPos = opts.getPlayerPos;
  const params = { playerHitRadius: opts.playerHitRadius || 4.5 };
  let onPlayerHit = opts.onPlayerHit || null;

  function update() {
    const bolts = projectiles.live;
    for (let i = bolts.length - 1; i >= 0; i--) {
      const b = bolts[i];

      if (b.team === 'player') {
        for (const e of enemyMgr.enemies) {
          if (!e.alive) continue;
          const rr = e.radius + b.radius;
          if (b.pos.distanceToSquared(e.pos) <= rr * rr) {
            e.hp -= b.damage;
            vfx.spark(b.pos, 0xffd27a);
            projectiles.kill(b);
            if (e.hp <= 0) {
              e.alive = false;
              vfx.explosion(e.pos, 1);
            }
            break;
          }
        }
      } else if (b.team === 'enemy' && getPlayerPos) {
        const pp = getPlayerPos();
        const rr = params.playerHitRadius + b.radius;
        if (b.pos.distanceToSquared(pp) <= rr * rr) {
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
