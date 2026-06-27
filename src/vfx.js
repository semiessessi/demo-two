import * as THREE from 'three';

// Pooled, short-lived sprites for combat VFX. Two pools:
//   • additive — explosions (enemy death), hit sparks, fire embers (they glow/bloom)
//   • normal-blended — grey smoke puffs from damaged subsystems (so they read as smoke, not glow)
// update(dt) animates scale + fade for both and retires finished ones.

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
const SMOKE_MAX = 48;

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
  const smokeTex = radialTexture([
    [0.0, 'rgba(200,205,215,1)'],
    [0.45, 'rgba(140,146,158,0.65)'],
    [1.0, 'rgba(90,96,108,0)'],
  ]);

  function makePool(n, blending, tex, order) {
    const pool = [];
    for (let i = 0; i < n; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, blending, depthWrite: false }));
      sprite.visible = false;
      sprite.frustumCulled = false;
      if (order != null) sprite.renderOrder = order;
      scene.add(sprite);
      pool.push({ sprite, alive: false, life: 0, maxLife: 1, from: 1, to: 1, peak: 1, vel: new THREE.Vector3() });
    }
    return pool;
  }

  const pool = makePool(MAX, THREE.AdditiveBlending, fireTex);
  const smokePool = makePool(SMOKE_MAX, THREE.NormalBlending, smokeTex, 4);
  const live = [];
  const smokeLive = [];

  function take(p, tex, color, pos, { life, from, to, peak = 1, vel }) {
    p.alive = true;
    p.life = life;
    p.maxLife = life;
    p.from = from;
    p.to = to;
    p.peak = peak;
    if (vel) p.vel.copy(vel);
    else p.vel.set(0, 0, 0);
    p.sprite.material.map = tex;
    p.sprite.material.color.set(color);
    p.sprite.material.opacity = peak;
    p.sprite.material.rotation = Math.random() * Math.PI * 2;
    p.sprite.position.copy(pos);
    p.sprite.scale.setScalar(from);
    p.sprite.visible = true;
  }

  function emit(tex, color, pos, opt) {
    for (const x of pool) if (!x.alive) { take(x, tex, color, pos, opt); live.push(x); return; }
  }

  function explosion(pos, scale = 1) {
    emit(fireTex, 0xffe0a0, pos, { life: 0.4, from: 1.5 * scale, to: 10 * scale });
    emit(fireTex, 0xff7a30, pos, { life: 0.6, from: 3 * scale, to: 16 * scale });
  }
  function spark(pos, color = 0xaad4ff) {
    emit(sparkTex, color, pos, { life: 0.22, from: 3, to: 0.4 });
  }
  const emberVel = new THREE.Vector3();
  function ember(pos, severity = 0.5) {
    emberVel.set((Math.random() - 0.5) * 5, (Math.random() - 0.5) * 4 + 2.5, (Math.random() - 0.5) * 5);
    const color = severity < 0.3 ? 0xff5526 : 0xffa850; // hotter when badly hurt
    emit(fireTex, color, pos, { life: 0.6, from: 0.5, to: 2.0 + (0.6 - severity) * 3, vel: emberVel });
  }
  const smokeVel = new THREE.Vector3();
  function smoke(pos, drift) {
    smokeVel.set((Math.random() - 0.5) * 2.5, (Math.random() - 0.5) * 2.5 + 1, (Math.random() - 0.5) * 2.5);
    if (drift) smokeVel.add(drift);
    for (const x of smokePool) if (!x.alive) { take(x, smokeTex, 0x8c92a0, pos, { life: 1.3, from: 1.4, to: 6.5, peak: 0.6, vel: smokeVel }); smokeLive.push(x); return; }
  }

  function step(arr, dt) {
    for (let i = arr.length - 1; i >= 0; i--) {
      const p = arr[i];
      p.life -= dt;
      if (p.life <= 0) {
        p.alive = false;
        p.sprite.visible = false;
        arr.splice(i, 1);
        continue;
      }
      const k = p.life / p.maxLife; // 1 -> 0
      const t = 1 - k;
      p.sprite.scale.setScalar(p.from + (p.to - p.from) * t);
      p.sprite.material.opacity = p.peak * k;
      if (p.vel.lengthSq() > 0) p.sprite.position.addScaledVector(p.vel, dt);
    }
  }

  function update(dt) {
    step(live, dt);
    step(smokeLive, dt);
  }

  return { explosion, spark, ember, smoke, update };
}
