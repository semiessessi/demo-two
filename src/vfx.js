import * as THREE from 'three';

// Pooled, short-lived additive sprites for combat VFX: explosions (enemy death), hit sparks, and
// muzzle-ish flashes. update(dt) animates scale + fade and retires finished ones.

function radialTexture(stops) {
  const s = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  for (const [o, c] of stops) g.addColorStop(o, c);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const MAX = 140;

export function createVfx(scene) {
  const fireTex = radialTexture([
    [0.0, 'rgba(255,255,240,1)'],
    [0.3, 'rgba(255,200,110,0.9)'],
    [0.65, 'rgba(255,110,40,0.35)'],
    [1.0, 'rgba(180,40,10,0)'],
  ]);
  const sparkTex = radialTexture([
    [0.0, 'rgba(255,255,255,1)'],
    [0.5, 'rgba(200,225,255,0.6)'],
    [1.0, 'rgba(120,160,255,0)'],
  ]);

  const pool = [];
  for (let i = 0; i < MAX; i++) {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: fireTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    sprite.visible = false;
    sprite.frustumCulled = false;
    scene.add(sprite);
    pool.push({ sprite, alive: false, life: 0, maxLife: 1, from: 1, to: 1, vel: new THREE.Vector3() });
  }
  const live = [];

  function emit(tex, color, pos, { life, from, to, vel }) {
    let p = null;
    for (const x of pool) if (!x.alive) { p = x; break; }
    if (!p) return;
    p.alive = true;
    p.life = life;
    p.maxLife = life;
    p.from = from;
    p.to = to;
    if (vel) p.vel.copy(vel);
    else p.vel.set(0, 0, 0);
    p.sprite.material.map = tex;
    p.sprite.material.color.set(color);
    p.sprite.material.opacity = 1;
    p.sprite.material.rotation = Math.random() * Math.PI * 2;
    p.sprite.position.copy(pos);
    p.sprite.scale.setScalar(from);
    p.sprite.visible = true;
    live.push(p);
  }

  function explosion(pos, scale = 1) {
    emit(fireTex, 0xffe0a0, pos, { life: 0.4, from: 1.5 * scale, to: 10 * scale });
    emit(fireTex, 0xff7a30, pos, { life: 0.6, from: 3 * scale, to: 16 * scale });
  }
  function spark(pos, color = 0xaad4ff) {
    emit(sparkTex, color, pos, { life: 0.22, from: 3, to: 0.4 });
  }

  function update(dt) {
    for (let i = live.length - 1; i >= 0; i--) {
      const p = live[i];
      p.life -= dt;
      if (p.life <= 0) {
        p.alive = false;
        p.sprite.visible = false;
        live.splice(i, 1);
        continue;
      }
      const k = p.life / p.maxLife; // 1 -> 0
      const t = 1 - k;
      p.sprite.scale.setScalar(p.from + (p.to - p.from) * t);
      p.sprite.material.opacity = k;
      if (p.vel.lengthSq() > 0) p.sprite.position.addScaledVector(p.vel, dt);
    }
  }

  return { explosion, spark, update };
}
