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

  const HP = 600; // takes sustained fire / a few missiles — tunable

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
    obj.updateMatrixWorld(true);
    // Static collision proxy (it doesn't move): a stack of spheres along the hull's longest world extent, so
    // bolts hit the actual slab rather than a giant enclosing sphere.
    const bb = new THREE.Box3().setFromObject(obj);
    const size = bb.getSize(new THREE.Vector3());
    const cen = bb.getCenter(new THREE.Vector3());
    const dims = [size.x, size.y, size.z];
    const la = dims[0] >= dims[1] && dims[0] >= dims[2] ? 0 : (dims[1] >= dims[2] ? 1 : 2); // longest axis
    const r = Math.max(dims[(la + 1) % 3], dims[(la + 2) % 3]) * 0.55;
    const n = Math.max(3, Math.round(dims[la] / (r * 1.1)));
    const spheres = [];
    for (let k = 0; k < n; k++) {
      const t = n > 1 ? k / (n - 1) - 0.5 : 0;
      const q = cen.clone();
      q.setComponent(la, cen.getComponent(la) + t * (dims[la] - r));
      spheres.push({ pos: q, radius: r });
    }
    const b = { obj, alive: true, hp: HP, maxHp: HP, spheres };
    b.hit = (dmg, point) => {
      if (!b.alive) return;
      b.hp -= dmg;
      if (vfx) vfx.spark(point, 0xff9464);
      if (b.hp <= 0) destroy(b);
    };
    list.push(b);
    if (vfx) vfx.firework(obj.position, 2.5); // warp-in flash
  }

  // Maintain the target count (also replaces a destroyed one). Called each frame.
  function update() {
    let guard = 0;
    while (aliveCount() < targetCount() && guard++ < 4) spawnOne();
  }

  // Live capital-ship targets for combat.js: each is { spheres:[{pos,radius}], hit(dmg, point) }.
  function targets() { return list.filter((b) => b.alive); }

  // The live spawn point for fighter waves (first live battleship), or null before wave 3.
  function spawnOrigin() {
    for (const b of list) if (b.alive) return b.obj.position;
    return null;
  }

  // Death: a string of blasts down the hull, then remove it; update() spawns a replacement.
  function destroy(b) {
    if (!b || !b.alive) return;
    b.alive = false;
    if (vfx) { for (const s of b.spheres) vfx.explosion(s.pos, 3.0); vfx.firework(b.obj.position, 4.0); }
    scene.remove(b.obj);
  }

  function reset() {
    for (const b of list) scene.remove(b.obj);
    list.length = 0;
  }

  return { update, spawnOrigin, targets, destroy, reset, list };
}
