import * as THREE from 'three';

// Pooled additive energy bolts, shared by the player cannon and the enemy guns. Each bolt is a thin
// glowing streak (a small box stretched along its travel direction) with additive blending so it
// blooms. spawn() pulls from a fixed pool; update() advances + expires; `live` is exposed for the
// collision pass.

const MAX = 240;

export function createProjectiles(scene) {
  const geo = new THREE.BoxGeometry(0.22, 0.22, 2.6); // long axis = local +Z
  const pool = [];
  for (let i = 0; i < MAX; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.visible = false;
    mesh.frustumCulled = false;
    scene.add(mesh);
    pool.push({ mesh, alive: false, pos: new THREE.Vector3(), vel: new THREE.Vector3() });
  }

  const live = [];
  const zAxis = new THREE.Vector3(0, 0, 1);
  const dir = new THREE.Vector3();
  const q = new THREE.Quaternion();

  function spawn({ pos, vel, color, team, damage = 20, life = 2.0, radius = 0.6 }) {
    let b = null;
    for (const p of pool) if (!p.alive) { b = p; break; }
    if (!b) return null;
    b.alive = true;
    b.team = team;
    b.damage = damage;
    b.life = life;
    b.radius = radius;
    b.pos.copy(pos);
    b.vel.copy(vel);
    b.mesh.material.color.set(color);
    b.mesh.position.copy(pos);
    b.mesh.visible = true;
    live.push(b);
    return b;
  }

  function kill(b) {
    b.alive = false;
    b.mesh.visible = false;
    const i = live.indexOf(b);
    if (i >= 0) live.splice(i, 1);
  }

  function update(dt) {
    for (let i = live.length - 1; i >= 0; i--) {
      const b = live[i];
      b.life -= dt;
      if (b.life <= 0) {
        kill(b);
        continue;
      }
      b.pos.addScaledVector(b.vel, dt);
      b.mesh.position.copy(b.pos);
      dir.copy(b.vel).normalize();
      q.setFromUnitVectors(zAxis, dir);
      b.mesh.quaternion.copy(q);
    }
  }

  return { spawn, update, kill, live };
}
