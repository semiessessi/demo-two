import * as THREE from 'three';

// Player front cannon: fires gold bolts from the nose while `input.fire` (Space / right trigger) is
// held, rate-limited, bolts inheriting the ship's velocity. A horizontal **gimbal** (right stick,
// input.gunAimX) swings the aim left/right and springs back to centre when released; bolts launch
// along that gimbaled direction and `aimDir` is exposed for the HUD crosshair. Includes a small
// additive muzzle flash.

function flashTexture() {
  const s = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0.0, 'rgba(255,250,210,1)');
  g.addColorStop(0.4, 'rgba(255,200,90,0.7)');
  g.addColorStop(1.0, 'rgba(255,140,40,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const FLASH_TIME = 0.06;

export function createPlayerCannon(scene, ship, projectiles) {
  const params = {
    fireRate: 9, // rounds/sec
    boltSpeed: 340,
    damage: 24,
    gimbalMax: 0.32, // rad
    gimbalSpring: 9, // spring-back rate
    color: 0xffd27a, // gold
  };
  let cooldown = 0;
  let gimbal = 0;
  let flashLife = 0;

  const muzzleLocal = new THREE.Vector3(0, 0, -ship.radius * 0.95); // nose
  const muzzleWorld = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const up = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const vel = new THREE.Vector3();
  const aimDir = new THREE.Vector3(0, 0, -1);

  const flash = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: flashTexture(), color: params.color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
  );
  flash.visible = false;
  flash.frustumCulled = false;
  scene.add(flash);

  function muzzle() {
    return muzzleWorld.copy(muzzleLocal).applyQuaternion(ship.pivot.quaternion).add(ship.pivot.position);
  }

  function update(dt, input, player) {
    // gimbal aim: right stick, easing back to centre when released
    const target = (input?.gunAimX || 0) * params.gimbalMax;
    gimbal += (target - gimbal) * (1 - Math.exp(-params.gimbalSpring * dt));

    up.set(0, 1, 0).applyQuaternion(ship.pivot.quaternion);
    fwd.set(0, 0, -1).applyQuaternion(ship.pivot.quaternion);
    q.setFromAxisAngle(up, gimbal);
    aimDir.copy(fwd).applyQuaternion(q).normalize();

    cooldown -= dt;
    if ((input?.fire || 0) > 0.5 && cooldown <= 0) {
      cooldown = 1 / params.fireRate;
      muzzle();
      vel.copy(aimDir).multiplyScalar(params.boltSpeed);
      if (player?.vel) vel.add(player.vel);
      projectiles.spawn({ pos: muzzleWorld, vel, color: params.color, team: 'player', damage: params.damage, life: 2.0, radius: 0.6 });
      flash.visible = true;
      flashLife = FLASH_TIME;
    }

    if (flashLife > 0) {
      flashLife -= dt;
      flash.position.copy(muzzle());
      const k = Math.max(0, flashLife / FLASH_TIME);
      flash.scale.setScalar(2.2 + 3.2 * k);
      flash.material.opacity = k;
      if (flashLife <= 0) flash.visible = false;
    }

    return { gimbal, aimDir };
  }

  return {
    update,
    params,
    get gimbal() {
      return gimbal;
    },
    get aimDir() {
      return aimDir;
    },
  };
}
