import * as THREE from 'three';
import { FORMATION_PATTERNS } from './formations.js';

// Continuous waves: spawns a new formation ahead of the player on an interval (while under the live
// cap) and immediately if the field is clear. Mild escalation in size as the wave number climbs.

export function createWaveManager(enemies, opts = {}) {
  const params = {
    maxEnemies: 16,
    interval: 6, // s between waves while under the cap
    spawnDist: 380,
    minSize: 3,
    maxSize: 5,
  };
  Object.assign(params, opts.params || {});

  let timer = 2.0; // first wave shortly after start
  let wave = 0;

  const fwd = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const heading = new THREE.Vector3();

  function spawn(player) {
    wave++;
    const size = Math.min(params.maxSize, params.minSize + Math.floor(wave / 3));
    const pattern = FORMATION_PATTERNS[(wave - 1) % FORMATION_PATTERNS.length];
    fwd.set(0, 0, -1).applyQuaternion(player.quat);
    right.crossVectors(fwd, up).normalize();
    const ox = (Math.random() * 2 - 1) * 120;
    const oy = (Math.random() * 2 - 1) * 55;
    pos
      .copy(player.pos)
      .addScaledVector(fwd, params.spawnDist)
      .addScaledVector(right, ox)
      .addScaledVector(up, oy);
    heading.copy(player.pos).sub(pos).normalize();
    enemies.spawnFormation({ pattern, count: size, pos, heading });
  }

  function update(dt, player) {
    timer -= dt;
    if (enemies.count() >= params.maxEnemies) return;
    if (timer <= 0 || enemies.count() === 0) {
      spawn(player);
      timer = params.interval;
    }
  }

  function reset() {
    timer = 2.0;
    wave = 0;
  }

  return {
    update,
    params,
    reset,
    get wave() {
      return wave;
    },
  };
}
