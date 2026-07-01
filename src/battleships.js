import * as THREE from 'three';

// Skirmish capital-ship spawner. Warps a Chig battleship in at wave 3 and another at wave 5, then keeps TWO
// alive — a destroyed one is replaced. Battleship kills DON'T touch the wave count (that's the wave manager's).
// Once one is present it is the spawn point for new fighter waves (see waves.js `spawnOrigin`).
//
// `template` is the loaded battleship Group (already scaled to ~30x the fighter). Instances are clones, which
// share the geometry + the ShaderMaterial — so they all animate together off the one material's uTime (advanced
// by chigBattleship.update() in main).
export function createBattleships(scene, { template, worldHeight, vfx, getWave, getPlayer }) {
  const list = []; // { obj, alive }
  const H = worldHeight || 60;
  const _fwd = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _right = new THREE.Vector3();

  const targetCount = () => { const w = getWave(); return w >= 5 ? 2 : w >= 3 ? 1 : 0; };
  const aliveCount = () => list.reduce((n, b) => n + (b.alive ? 1 : 0), 0);

  function spawnOne() {
    const p = getPlayer();
    const obj = template.clone(true); // shares geometry + shader material
    obj.visible = true;
    _fwd.set(0, 0, -1).applyQuaternion(p.quat);
    _right.crossVectors(_fwd, _up).normalize();
    const side = (list.length % 2 === 0) ? 1 : -1; // alternate sides so two don't overlap
    obj.position.copy(p.pos)
      .addScaledVector(_fwd, H * 5)
      .addScaledVector(_right, H * 1.2 * side)
      .addScaledVector(_up, H * 0.25);
    obj.lookAt(p.pos);
    scene.add(obj);
    list.push({ obj, alive: true });
    if (vfx) vfx.firework(obj.position, 2.5); // warp-in flash
  }

  // Maintain the target count (also replaces a destroyed one). Called each frame.
  function update() {
    let guard = 0;
    while (aliveCount() < targetCount() && guard++ < 4) spawnOne();
  }

  // The live spawn point for fighter waves (first live battleship), or null before wave 3.
  function spawnOrigin() {
    for (const b of list) if (b.alive) return b.obj.position;
    return null;
  }

  // Destruction hook (no capital-ship damage yet): mark one dead + remove; update() spawns a replacement.
  function destroy(b) {
    if (!b || !b.alive) return;
    b.alive = false;
    if (vfx) vfx.explosion(b.obj.position, 4.0);
    scene.remove(b.obj);
  }

  function reset() {
    for (const b of list) scene.remove(b.obj);
    list.length = 0;
  }

  return { update, spawnOrigin, destroy, reset, list };
}
