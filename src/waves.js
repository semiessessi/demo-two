import * as THREE from 'three';
import { FORMATION_PATTERNS } from './formations.js';

// Waves: a new formation arrives only once the previous wave has been fully defeated, after a short
// breather. Spawns ahead of the player; mild escalation in size as the wave number climbs.

export function createWaveManager(enemies, opts = {}) {
  const params = {
    gap: 3, // s after a wave is cleared before the next arrives
    spawnDist: 380,
    minSize: 3,
    maxSize: 5,
    rampRate: 0.08, // difficulty gained per wave (0..1 over ~12 waves)
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
    const difficulty = Math.min(1, (wave - 1) * params.rampRate); // ramps up as waves climb
    enemies.spawnFormation({ pattern, count: size, pos, heading, difficulty });
  }

  function update(dt, player) {
    if (enemies.count() > 0) {
      timer = params.gap; // a wave is still active — hold the next one back
      return;
    }
    timer -= dt; // field is clear — count down the breather, then send the next wave
    if (timer <= 0) {
      spawn(player);
      timer = params.gap;
    }
  }

  function reset() {
    timer = params.gap;
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
