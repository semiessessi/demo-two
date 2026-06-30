import * as THREE from 'three';
import { createVolumetrics } from './volumetrics.js';

// Combat VFX facade. The headline effects (explosion, smoke) are GPU raymarched volumes (see
// volumetrics.js); this module wires them to the game and adds the cheaper bits:
//   • glowy-line SPARKS — thin additive streaks that bloom (replaces the old radial-blob sprites)
//   • a firework BURST on explosions — hot spark streaks + glowing blob chunks flying out
//   • ember sprites (small, cheap) for damaged subsystems
//   • a sprite-based explosion/smoke FALLBACK used on low-end / phones (setQuality('low'))
// update(dt) advances sprites, streaks, and the volumetric system.

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

const MAX = 1100; // big additive-sprite pool (the spark blobs are now numerous + tiny)
const SMOKE_MAX = 48;
const STREAK_MAX = 420;

function detectQuality() {
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  const small = Math.min(window.innerWidth, window.innerHeight) < 560;
  return mobile || small ? 'low' : 'high';
}

export function createVfx(scene, camera, opts = {}) {
  const fireTex = radialTexture([
    [0.0, 'rgba(255,255,240,1)'],
    [0.3, 'rgba(255,200,110,0.9)'],
    [0.65, 'rgba(255,110,40,0.35)'],
    [1.0, 'rgba(180,40,10,0)'],
  ]);
  const smokeTex = radialTexture([
    [0.0, 'rgba(200,205,215,1)'],
    [0.45, 'rgba(140,146,158,0.65)'],
    [1.0, 'rgba(90,96,108,0)'],
  ]);

  const vol = createVolumetrics(scene, camera, opts); // opts.lightDir aligns smoke self-shadow with the sun
  let quality = detectQuality();
  vol.setQuality(quality);

  // ---- sprite pools (embers always; explosion/smoke only on the low-end fallback path) ----------
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

  // ---- glowy-line sparks (thin additive streaks oriented along their velocity) ------------------
  const streakGeo = new THREE.BoxGeometry(0.08, 0.08, 1); // unit length along +Z
  const streakPool = [];
  for (let i = 0; i < STREAK_MAX; i++) {
    const mesh = new THREE.Mesh(streakGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    mesh.visible = false;
    mesh.frustumCulled = false;
    scene.add(mesh);
    streakPool.push({ mesh, alive: false, life: 0, maxLife: 1, vel: new THREE.Vector3(), len: 1, width: 1 });
  }
  const streakLive = [];
  const _zAxis = new THREE.Vector3(0, 0, 1);
  const _q = new THREE.Quaternion();
  const _dir = new THREE.Vector3();

  function spawnStreak(pos, vel, color, life, len, width) {
    for (const s of streakPool) {
      if (s.alive) continue;
      s.alive = true;
      s.life = life;
      s.maxLife = life;
      s.vel.copy(vel);
      s.len = len;
      s.width = width;
      s.mesh.material.color.set(color);
      s.mesh.material.opacity = 1;
      s.mesh.position.copy(pos);
      _dir.copy(vel);
      if (_dir.lengthSq() < 1e-6) _dir.set(0, 0, 1); else _dir.normalize();
      _q.setFromUnitVectors(_zAxis, _dir);
      s.mesh.quaternion.copy(_q);
      s.mesh.scale.set(width, width, len);
      s.mesh.visible = true;
      streakLive.push(s);
      return;
    }
  }

  const _v = new THREE.Vector3();
  function randDir(out) {
    const u = Math.random() * 2 - 1;
    const th = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.max(0, 1 - u * u));
    return out.set(r * Math.cos(th), r * Math.sin(th), u);
  }

  function sparkBurst(pos, color, o) {
    for (let i = 0; i < o.count; i++) {
      randDir(_v).multiplyScalar(o.speed * (0.45 + Math.random() * 0.9));
      const spd = _v.length();
      const len = Math.min(o.maxLen ?? 6, 0.5 + spd * (o.lenScale ?? 0.06));
      spawnStreak(pos, _v, color, o.life * (0.7 + Math.random() * 0.6), len, o.width ?? 1.2);
    }
  }

  function spark(pos, color = 0xffe0b0) {
    sparkBurst(pos, color, { count: 6, speed: 17, life: 0.26, lenScale: 0.05, width: 1.1, maxLen: 4 });
  }

  function stepStreaks(dt) {
    for (let i = streakLive.length - 1; i >= 0; i--) {
      const s = streakLive[i];
      s.life -= dt;
      if (s.life <= 0) {
        s.alive = false;
        s.mesh.visible = false;
        streakLive.splice(i, 1);
        continue;
      }
      const k = s.life / s.maxLife; // 1 -> 0
      s.mesh.position.addScaledVector(s.vel, dt);
      s.mesh.scale.set(s.width * k, s.width * k, Math.max(0.2, s.len * (0.4 + 0.6 * k)));
      s.mesh.material.opacity = k;
    }
  }

  // ---- public effects --------------------------------------------------------------------------
  function spriteExplosion(pos, scale) {
    emit(fireTex, 0xffe0a0, pos, { life: 0.4, from: 1.5 * scale, to: 10 * scale });
    emit(fireTex, 0xff7a30, pos, { life: 0.6, from: 3 * scale, to: 16 * scale });
  }

  const SPARK_HOT = new THREE.Color(44.0, 26.4, 9.6);   // 8x HDR hot yellow-orange -> blooms hard
  const SPARK_WHITE = new THREE.Color(56.0, 44.8, 27.2); // 8x HDR hotter yellow-white core
  function firework(pos, scale) {
    // MANY but SMALL radiating spark streaks (a few temperatures) — the sci-fi "blast" look
    sparkBurst(pos, 0xffd9a0, { count: Math.round(42 * scale), speed: 28 * scale, life: 0.5, lenScale: 0.06, width: 0.9, maxLen: 6 });
    sparkBurst(pos, 0xfff4d6, { count: Math.round(20 * scale), speed: 46 * scale, life: 0.34, lenScale: 0.05, width: 0.7, maxLen: 5 });
    // fine fast shrapnel — lots of tiny short streaks
    sparkBurst(pos, 0xffe6c0, { count: Math.round(30 * scale), speed: 34 * scale, life: 0.22, lenScale: 0.04, width: 0.5, maxLen: 3 });
    // hot spark blobs flung outward (additive fire sprites): ~2x more, 4x smaller, HDR-bright so they bloom
    const n = Math.round(416 * scale); // 8x as many
    for (let i = 0; i < n; i++) {
      randDir(_v).multiplyScalar((10 + Math.random() * 26) * scale);
      const col = Math.random() < 0.5 ? SPARK_HOT : SPARK_WHITE;
      emit(fireTex, col, pos, { life: 0.4 + Math.random() * 0.45, from: 0.0225 * scale, to: (0.055 + Math.random() * 0.075) * scale, vel: _v.clone() }); // 1/4 size again
    }
  }

  function explosion(pos, scale = 1) {
    if (quality === 'low') spriteExplosion(pos, scale);
    else vol.explosion(pos, scale);
    firework(pos, scale);
    if (opts.onExplosion) opts.onExplosion(pos, scale); // single SFX hook — every death path routes through here
  }

  const emberVel = new THREE.Vector3();
  function ember(pos, severity = 0.5) {
    emberVel.set((Math.random() - 0.5) * 5, (Math.random() - 0.5) * 4 + 2.5, (Math.random() - 0.5) * 5);
    const color = severity < 0.3 ? 0xff5526 : 0xffa850; // hotter when badly hurt
    emit(fireTex, color, pos, { life: 0.6, from: 0.5, to: 2.0 + (0.6 - severity) * 3, vel: emberVel });
  }

  // Phase 1: smoke stays a cheap sprite puff (damage.js calls this continuously). Phase 2 swaps the
  // per-zone path to vol.createTrail for proper raymarched smoke trails.
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

  // ---- blown-off part debris (a CLONE of a hull group tumbling away in world space) -------------
  // The caller hides the real node and hands it here; we clone it (clone(true) SHARES geometry + the
  // CSM-registered material, so it stays lit + shadowed), pin the clone at the node's world transform,
  // and tumble it away. NEVER dispose the geometry/material (shared with the live ship) and never touch
  // material.opacity — fade by shrinking the Object3D's scale only.
  const debrisLive = [];
  // Wing-fracture debris pools (createDebris, one per side), attached by main once the ship is loaded.
  // Shared by EVERY Hammerhead (player + AI allies in attract/campaign/co-op) since they share geometry —
  // fractureWing(side, e) just re-aims a burst at the losing ship's transform.
  let wingDebris = null;
  const _dEuler = new THREE.Euler();
  const _dQuat = new THREE.Quaternion();
  function spawnDebris(node, { vel, angVel, life = 2.0 } = {}) {
    if (!node) return;
    node.updateWorldMatrix(true, false);
    const clone = node.clone(true);
    node.matrixWorld.decompose(clone.position, clone.quaternion, clone.scale);
    clone.traverse((o) => { o.visible = true; }); // the original is hidden by now
    clone.userData.baseScale = clone.scale.x;
    scene.add(clone);
    debrisLive.push({ obj: clone, vel: vel ? vel.clone() : new THREE.Vector3(), angVel: angVel ? angVel.clone() : new THREE.Vector3(), life, maxLife: life });
  }
  function stepDebris(dt) {
    for (let i = debrisLive.length - 1; i >= 0; i--) {
      const d = debrisLive[i];
      d.life -= dt;
      if (d.life <= 0) { scene.remove(d.obj); debrisLive.splice(i, 1); continue; } // shared geom/mat -> no dispose
      d.obj.position.addScaledVector(d.vel, dt);
      _dEuler.set(d.angVel.x * dt, d.angVel.y * dt, d.angVel.z * dt, 'XYZ');
      d.obj.quaternion.multiply(_dQuat.setFromEuler(_dEuler));
      d.obj.scale.setScalar(d.obj.userData.baseScale * Math.min(1, d.life / 0.4)); // shrink out over the last 0.4s
    }
  }
  function clearDebris() {
    for (const d of debrisLive) scene.remove(d.obj);
    debrisLive.length = 0;
    if (wingDebris) { wingDebris.L.reset(); wingDebris.R.reset(); }
  }

  // ---- wing fracture: the wing comes apart into chunks (replaces the intact-clone tumble) ------------
  function attachWingDebris(pools) { wingDebris = pools; } // { L, R } createDebris instances
  // Burst the losing side's wing chunks at the ship's live transform. `e` = { pos, obj:{quaternion}, vel }.
  // Returns false when the pool isn't ready or quality is 'low' so the caller can fall back to spawnDebris.
  function fractureWing(side, e) {
    return !!(wingDebris && wingDebris[side] && wingDebris[side].burst(e, 1.0));
  }

  function update(dt) {
    step(live, dt);
    step(smokeLive, dt);
    stepStreaks(dt);
    stepDebris(dt);
    if (wingDebris) { wingDebris.L.update(dt, null, null); wingDebris.R.update(dt, null, null); } // drift/spin/heat/shrink-fade (no ship-bounce needed)
    vol.update(dt);
  }

  function setQuality(q) {
    quality = q;
    vol.setQuality(q);
    if (wingDebris) { wingDebris.L.setQuality(q); wingDebris.R.setQuality(q); } // 'low' -> burst no-ops -> fractureWing falls back to the intact clone
  }
  function setLoad(p) { vol.setLoad(p); } // per-frame autoscaler pressure -> trims volumetric raymarch cost

  return { explosion, firework, spark, ember, smoke, spawnDebris, attachWingDebris, fractureWing, clearDebris, update, setQuality, setLoad, setSmokeShadows: vol.setSmokeShadows, createTrail: vol.createTrail, setOcclusion: vol.setOcclusion, updateOcclusion: vol.updateOcclusion, setHiddenForDepth: vol.setHiddenForDepth, get quality() { return quality; }, _vol: vol };
}
