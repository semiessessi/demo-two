import * as THREE from 'three';

// Skirmish capital-ship spawner. Warps a Chig battleship in at wave 3 and another at wave 5, then keeps TWO
// alive — a destroyed one is replaced. Battleship kills DON'T touch the wave count. Once one is present it is
// the spawn point for new fighter waves (see waves.js `spawnOrigin`).
//
// Battleships are TANKY (~65x the fighter) and show progressive battle damage (escalating smoke plumes as HP
// falls). On death the hull FRACTURES into a few big drifting chunks that tumble, chain-explode, trail smoke
// for a while, and can be shot further apart. `template` is the loaded battleship Group (scaled to ~30x the
// fighter); instances are clones (shared geometry + shader material).
export function createBattleships(scene, { template, worldHeight, vfx, getWave, getPlayer }) {
  const list = [];   // live battleships
  const chunks = []; // fracture debris
  const H = worldHeight || 60;
  const HP = 2000;   // ~65x the ~30hp fighter — a real chore (tunable)
  const _fwd = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _right = new THREE.Vector3();
  const _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _pw = new THREE.Vector3(), _v = new THREE.Vector3();

  const targetCount = () => { const w = getWave(); return w >= 5 ? 2 : w >= 3 ? 1 : 0; };
  const aliveCount = () => list.reduce((n, b) => n + (b.alive ? 1 : 0), 0);

  function spawnOne() {
    const p = getPlayer();
    const obj = template.clone(true);
    obj.visible = true;
    _fwd.set(0, 0, -1).applyQuaternion(p.quat);
    _right.crossVectors(_fwd, _up).normalize();
    const side = (list.length % 2 === 0) ? 1 : -1;
    obj.position.copy(p.pos).addScaledVector(_fwd, H * 5).addScaledVector(_right, H * 1.2 * side).addScaledVector(_up, H * 0.25);
    obj.lookAt(p.pos);
    scene.add(obj);
    obj.updateMatrixWorld(true);
    // static collision proxy: a stack of spheres along the hull's longest world extent
    const bb = new THREE.Box3().setFromObject(obj);
    const size = bb.getSize(new THREE.Vector3());
    const cen = bb.getCenter(new THREE.Vector3());
    const dims = [size.x, size.y, size.z];
    const la = dims[0] >= dims[1] && dims[0] >= dims[2] ? 0 : (dims[1] >= dims[2] ? 1 : 2);
    const r = Math.max(dims[(la + 1) % 3], dims[(la + 2) % 3]) * 0.55;
    const n = Math.max(3, Math.round(dims[la] / (r * 1.1)));
    const spheres = [];
    for (let k = 0; k < n; k++) {
      const t = n > 1 ? k / (n - 1) - 0.5 : 0;
      const q = cen.clone();
      q.setComponent(la, cen.getComponent(la) + t * (dims[la] - r));
      spheres.push({ pos: q, radius: r });
    }
    const b = { obj, alive: true, hp: HP, maxHp: HP, spheres, trails: [], dmgLevel: 0 };
    b.hit = (dmg, point) => {
      if (!b.alive) return;
      b.hp -= dmg;
      if (vfx) vfx.spark(point, 0xff9464);
      damageFx(b);
      if (b.hp <= 0) fracture(b);
    };
    list.push(b);
    if (vfx) vfx.firework(obj.position, 2.5); // warp-in flash
  }

  // Progressive battle damage: escalating smoke plumes at 80% / 55% / 25% HP.
  function damageFx(b) {
    if (!vfx || !vfx.createTrail) return;
    const frac = Math.max(0, b.hp / b.maxHp);
    const lvl = frac <= 0.25 ? 3 : frac <= 0.55 ? 2 : frac <= 0.8 ? 1 : 0;
    if (lvl <= b.dmgLevel) return;
    b.dmgLevel = lvl;
    const want = lvl * 2; // 2 / 4 / 6 plumes
    while (b.trails.length < want) {
      const s = b.spheres[(Math.random() * b.spheres.length) | 0];
      const pos = s.pos.clone();
      const heavy = lvl >= 2;
      b.trails.push(vfx.createTrail({ getPos: () => pos, life: heavy ? 3.2 : 2.2, radius: heavy ? H * 0.15 : H * 0.09,
        spawnDist: H * 0.06, spawnInterval: heavy ? 0.22 : 0.4, density: heavy ? 1.3 : 0.7, blobs: heavy ? 4 : 3 }));
    }
  }

  // Death: split the hull into a few big band-chunks that tumble, chain-explode, smoke, and can be shot apart.
  function fracture(b) {
    if (!b.alive) return;
    b.alive = false;
    for (const t of b.trails) t.stop();
    b.trails.length = 0;
    b.obj.updateMatrixWorld(true);
    b.obj.matrixWorld.decompose(_pw, _q, _s);
    const shipCenter = _pw.clone();

    // longest LOCAL axis (geometry space) for the band cuts
    const lbox = new THREE.Box3();
    b.obj.traverse((o) => { if (o.isMesh && o.geometry) { o.geometry.computeBoundingBox(); lbox.union(o.geometry.boundingBox); } });
    const lsize = lbox.getSize(new THREE.Vector3());
    const ld = [lsize.x, lsize.y, lsize.z];
    const la = ld[0] >= ld[1] && ld[0] >= ld[2] ? 0 : (ld[1] >= ld[2] ? 1 : 2);
    const lmin = lbox.min.getComponent(la), llen = ld[la] || 1;

    const N = 5;
    const bins = Array.from({ length: N }, () => ({ p: [], n: [] }));
    b.obj.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      const geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry;
      const pos = geo.attributes.position, nrm = geo.attributes.normal;
      const comp = (i) => (la === 0 ? pos.getX(i) : la === 1 ? pos.getY(i) : pos.getZ(i));
      for (let t = 0; t + 2 < pos.count; t += 3) {
        const cLa = (comp(t) + comp(t + 1) + comp(t + 2)) / 3;
        let band = Math.floor((cLa - lmin) / llen * N); band = band < 0 ? 0 : band >= N ? N - 1 : band;
        const bin = bins[band];
        for (let k = 0; k < 3; k++) { const i = t + k; bin.p.push(pos.getX(i), pos.getY(i), pos.getZ(i)); if (nrm) bin.n.push(nrm.getX(i), nrm.getY(i), nrm.getZ(i)); }
      }
    });
    const mat = (b.obj.children[0] && b.obj.children[0].material) || template.children[0].material;

    for (let k = 0; k < N; k++) {
      const bin = bins[k];
      if (bin.p.length < 9) continue;
      const parr = Float32Array.from(bin.p);
      let cx = 0, cy = 0, cz = 0; const cnt = parr.length / 3;
      for (let i = 0; i < parr.length; i += 3) { cx += parr[i]; cy += parr[i + 1]; cz += parr[i + 2]; }
      cx /= cnt; cy /= cnt; cz /= cnt;
      for (let i = 0; i < parr.length; i += 3) { parr[i] -= cx; parr[i + 1] -= cy; parr[i + 2] -= cz; }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(parr, 3));
      if (bin.n.length) g.setAttribute('normal', new THREE.BufferAttribute(Float32Array.from(bin.n), 3));
      const mesh = new THREE.Mesh(g, mat);
      mesh.frustumCulled = false;
      const worldC = new THREE.Vector3(cx, cy, cz).applyMatrix4(b.obj.matrixWorld);
      mesh.position.copy(worldC);
      mesh.quaternion.copy(_q);
      mesh.scale.copy(_s);
      scene.add(mesh);
      const outward = worldC.clone().sub(shipCenter);
      if (outward.lengthSq() < 1e-4) outward.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
      outward.normalize();
      const chunk = {
        mesh, vel: outward.multiplyScalar(5 + Math.random() * 7),
        ang: new THREE.Vector3((Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5),
        life: 18 + Math.random() * 8, boomsLeft: 3 + (Math.random() * 4 | 0), nextBoom: 0.1 + Math.random() * 0.6,
        sphere: { pos: mesh.position, radius: (llen / N) * _s.x * 0.6 + H * 0.05 },
      };
      if (vfx && vfx.createTrail) chunk.trail = vfx.createTrail({ getPos: () => mesh.position, life: 4.5, radius: H * 0.13, spawnDist: H * 0.08, spawnInterval: 0.25, density: 1.1, blobs: 4 });
      chunks.push(chunk);
    }

    if (vfx) { for (const s of b.spheres) vfx.explosion(s.pos, 3.0); vfx.firework(shipCenter, 5.0); }
    scene.remove(b.obj);
    const idx = list.indexOf(b);
    if (idx >= 0) list.splice(idx, 1); // maintenance spawns a replacement
  }

  function update(dt) {
    let guard = 0;
    while (aliveCount() < targetCount() && guard++ < 4) spawnOne();
    for (const b of list) if (b.alive) for (const t of b.trails) t.update(dt);
    for (let i = chunks.length - 1; i >= 0; i--) {
      const c = chunks[i];
      c.life -= dt;
      c.mesh.position.addScaledVector(c.vel, dt);
      c.mesh.rotation.x += c.ang.x * dt; c.mesh.rotation.y += c.ang.y * dt; c.mesh.rotation.z += c.ang.z * dt;
      if (c.boomsLeft > 0) { c.nextBoom -= dt; if (c.nextBoom <= 0) { c.boomsLeft--; c.nextBoom = 0.4 + Math.random() * 1.3; if (vfx) vfx.explosion(c.mesh.position, 1.6); } }
      if (c.trail) c.trail.update(dt);
      if (c.life <= 0) { if (c.trail) c.trail.stop(); scene.remove(c.mesh); c.mesh.geometry.dispose(); chunks.splice(i, 1); }
      else if (c.life < 1.5) c.mesh.scale.multiplyScalar(Math.max(0.001, 1 - dt * 0.6)); // shrink-fade at end of life
    }
  }

  // Live capital-ship targets for combat.js: intact hulls (damage) + fracture chunks (a hit shoves them apart).
  function targets() {
    const out = [];
    for (const b of list) if (b.alive) out.push(b);
    for (const c of chunks) if (c.life > 0) {
      out.push({ spheres: [c.sphere], hit: (dmg, pt) => { _v.copy(c.mesh.position).sub(pt); if (_v.lengthSq() > 1e-4) c.vel.addScaledVector(_v.normalize(), 14); if (vfx) vfx.spark(pt, 0xffb060); } });
    }
    return out;
  }

  function spawnOrigin() {
    for (const b of list) if (b.alive) return b.obj.position;
    return null;
  }

  function reset() {
    for (const b of list) { for (const t of b.trails) t.stop(); scene.remove(b.obj); }
    for (const c of chunks) { if (c.trail) c.trail.stop(); scene.remove(c.mesh); c.mesh.geometry.dispose(); }
    list.length = 0; chunks.length = 0;
  }

  return { update, spawnOrigin, targets, destroy: fracture, reset, list };
}
