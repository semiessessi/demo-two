import * as THREE from 'three';

// Player subsystem damage model. Defines hit-spheres in the ship's pivot-local frame derived from
// named meshes / nozzles: cockpit, L/R wing, L/R engine, fuselage — each with HP. applyHit() routes
// an incoming hit to the nearest zone. Effects: dead engines cut top speed (via flight.setSpeedScale
// read from speedScale()); cockpit destroyed -> onEject; fuselage destroyed -> onDestroyed. Hurt
// zones emit embers/sparks. `zones` is exposed for the HUD.

export function createDamageModel(ship, opts = {}) {
  const pivot = ship.pivot;
  pivot.updateMatrixWorld(true);
  const R = ship.radius;

  function meshCenterLocal(re, fallback) {
    let mesh = null;
    pivot.traverse((o) => {
      if (o.isMesh && re.test(o.name)) mesh = o;
    });
    if (!mesh) return fallback;
    const c = new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3());
    return pivot.worldToLocal(c);
  }

  const noz = (ship.nozzles || []).slice().sort((a, b) => a.x - b.x);
  const lEng = noz[0] ? noz[0].clone() : new THREE.Vector3(-R * 0.3, 0, R * 0.6);
  const rEng = noz[noz.length - 1] ? noz[noz.length - 1].clone() : new THREE.Vector3(R * 0.3, 0, R * 0.6);

  const zones = [];
  // `size` is per-axis half-extents (Vector3) for an axis-aligned ELLIPSOID — flat/long parts no longer
  // need a coarse oversized sphere. A plain number still works as a uniform sphere. Tune live in the editor.
  const add = (name, center, size, hp, kind) => {
    const radii = typeof size === 'number' ? new THREE.Vector3(size, size, size) : size.clone();
    zones.push({ name, center, radii, hp, maxHp: hp, kind, alive: true, trail: null });
  };

  add('Cockpit', meshCenterLocal(/canopy/i, new THREE.Vector3(0, 0.3, -R * 0.4)), new THREE.Vector3(1.0, 0.8, 1.4), 55, 'cockpit');
  add('L Engine', lEng, new THREE.Vector3(0.9, 0.9, 1.7), 20, 'engine'); // nacelle (long in z); ~2 enemy pulses
  add('R Engine', rEng, new THREE.Vector3(0.9, 0.9, 1.7), 20, 'engine');
  add('L Wing', meshCenterLocal(/l_aileron/i, new THREE.Vector3(-R * 0.8, 0, 0.3)), new THREE.Vector3(1.7, 0.45, 1.5), 20, 'wing'); // wide + flat
  add('R Wing', meshCenterLocal(/r_aileron/i, new THREE.Vector3(R * 0.8, 0, 0.3)), new THREE.Vector3(1.7, 0.45, 1.5), 20, 'wing');
  add('Gun', new THREE.Vector3(0, -R * 0.12, -R * 0.7), new THREE.Vector3(0.6, 0.6, 1.3), 20, 'gun'); // front; destroyed -> can't fire
  add('L Fuel', new THREE.Vector3(-R * 0.3, -R * 0.05, R * 0.18), new THREE.Vector3(0.85, 0.7, 1.5), 25, 'fuel'); // rupture -> catastrophic
  add('R Fuel', new THREE.Vector3(R * 0.3, -R * 0.05, R * 0.18), new THREE.Vector3(0.85, 0.7, 1.5), 25, 'fuel');
  add('Fuselage', new THREE.Vector3(0, 0, 0), new THREE.Vector3(1.4, 1.0, 3.6), 120, 'fuselage'); // long body

  // Forward canards: small, hard-to-hit control surfaces. Only DIRECT hits (the bolt's travel segment
  // pierces the ellipsoid — see applyHit) take them out, so they're rare and don't steal nearby hits.
  const findNode = (re) => { let n = null; pivot.traverse((o) => { if (!n && re.test(o.name)) n = o; }); return n; };
  function addCanard(name, re, sx) {
    const node = findNode(re);
    const center = node
      ? pivot.worldToLocal(new THREE.Box3().setFromObject(node).getCenter(new THREE.Vector3()))
      : new THREE.Vector3(sx * 0.86, -0.12, -2.94);
    add(name, center, new THREE.Vector3(0.9, 0.35, 0.7), 10, 'canard'); // small + flat; hp 10 = one enemy pulse; tune live
    const z = zones[zones.length - 1];
    z.node = node; // the L_Canard / R_Canard group — hidden + cloned to debris when destroyed
    z.sparkPoint = new THREE.Vector3(sx * 0.4, -0.1, -2.7); // inboard root near the cockpit (stub sparks)
  }
  addCanard('L Canard', /^L_Canard$/i, -1);
  addCanard('R Canard', /^R_Canard$/i, 1);

  let onEject = opts.onEject || null;
  let onDestroyed = opts.onDestroyed || null;
  let onFuelRupture = opts.onFuelRupture || null;
  let onCanardLost = opts.onCanardLost || null;
  const localPt = new THREE.Vector3();
  const segB = new THREE.Vector3();
  const _segAB = new THREE.Vector3(), _segAC = new THREE.Vector3(), _segCl = new THREE.Vector3();
  // squared distance from point c to segment [a -> b] (all pivot-local) — mirrors combat.js segDistSq
  function segPointDistSq(a, b, c) {
    _segAB.copy(b).sub(a);
    const len2 = _segAB.lengthSq();
    let t = len2 > 1e-9 ? _segAC.copy(c).sub(a).dot(_segAB) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    _segCl.copy(a).addScaledVector(_segAB, t);
    return _segCl.distanceToSquared(c);
  }

  // Ellipsoid tests in the zone's own unit space (divide each axis by its half-extent): <=1 is inside.
  const _eA = new THREE.Vector3(), _eB = new THREE.Vector3(), _ZERO = new THREE.Vector3();
  function ellipDistSq(p, z) {
    const r = z.radii;
    const dx = (p.x - z.center.x) / r.x, dy = (p.y - z.center.y) / r.y, dz = (p.z - z.center.z) / r.z;
    return dx * dx + dy * dy + dz * dz;
  }
  function segEllipDistSq(a, b, z) {
    const r = z.radii;
    _eA.set((a.x - z.center.x) / r.x, (a.y - z.center.y) / r.y, (a.z - z.center.z) / r.z);
    _eB.set((b.x - z.center.x) / r.x, (b.y - z.center.y) / r.y, (b.z - z.center.z) / r.z);
    return segPointDistSq(_eA, _eB, _ZERO); // closest approach of the segment to the ellipsoid centre, unit space
  }

  // The front gun is offline once its zone is destroyed (the player cannon checks this each frame).
  function canFire() {
    for (const z of zones) if (z.kind === 'gun' && !z.alive) return false;
    return true;
  }

  // `fromPoint` (the bolt's start-of-frame world pos) is optional; when present, canards use the bolt's
  // full travel SEGMENT for a true direct-hit test (the end point alone often lands past the canard).
  function applyHit(worldPoint, dmg, fromPoint) {
    pivot.worldToLocal(localPt.copy(worldPoint));
    // Canards: excluded from normal routing; only a DIRECT hit (the segment pierces the ellipsoid)
    // counts — keeps them rare and stops them stealing nearby hits.
    if (fromPoint) pivot.worldToLocal(segB.copy(fromPoint)); else segB.copy(localPt);
    let canard = null, canardD = Infinity;
    for (const z of zones) {
      if (z.kind !== 'canard' || !z.alive) continue;
      const d2 = segEllipDistSq(segB, localPt, z);
      if (d2 <= 1 && d2 < canardD) { canardD = d2; canard = z; }
    }
    let best = canard;
    if (!best) {
      // route to the zone the hit is most INSIDE (ellipsoid-space distance), so snug shapes claim
      // the right part instead of the biggest sphere winning by raw centre distance.
      let bestD = Infinity;
      for (const z of zones) {
        if (!z.alive || z.kind === 'canard') continue;
        const d = ellipDistSq(localPt, z);
        if (d < bestD) {
          bestD = d;
          best = z;
        }
      }
    }
    if (!best) return null;
    best.hp -= dmg;
    if (best.hp <= 0) {
      best.hp = 0;
      best.alive = false;
      if (best.kind === 'cockpit' && onEject) onEject();
      else if (best.kind === 'fuselage' && onDestroyed) onDestroyed();
      else if (best.kind === 'fuel' && onFuelRupture) onFuelRupture(best); // tank rupture is catastrophic
      else if (best.kind === 'canard') { if (best.node) best.node.visible = false; if (onCanardLost) onCanardLost(best, best.node, worldPoint); }
      // gun: no callback — canFire() reads its zone state and disables the cannon
    }
    return best;
  }

  function speedScale() {
    const dead = zones.filter((z) => z.kind === 'engine' && !z.alive).length;
    return [1, 0.6, 0.3][Math.min(dead, 2)];
  }

  // Forward canards drive control authority: lose one -> roll halves / pitch to 75%; lose both -> roll
  // to a quarter / pitch to a third. (Read each frame by flight via setRollScale/setPitchScale.)
  const deadCanards = () => zones.filter((z) => z.kind === 'canard' && !z.alive).length;
  function rollScale() { return [1, 0.5, 0.25][Math.min(deadCanards(), 2)]; }
  function pitchScale() { return [1, 0.75, 0.33][Math.min(deadCanards(), 2)]; }

  let acc = 0;
  const wp = new THREE.Vector3();
  // Hold smoke back until a zone has taken real damage — light taps stay clean (it built up too fast
  // before). Below this fraction the zone trails smoke; the lower the HP, the thicker.
  const SMOKE_AT = 0.6;
  function zonePos(z) {
    // live world position of the zone (the ship is moving) — the smoke trail samples this each tick
    if (!z._posGet) {
      const v = new THREE.Vector3();
      z._posGet = () => { v.copy(z.center); pivot.localToWorld(v); return v; };
    }
    return z._posGet;
  }
  function update(dt, vfx) {
    acc += dt;
    if (acc < 0.1) return;
    const stepDt = acc;
    acc = 0;
    const useTrail = !!vfx.createTrail && vfx.quality !== 'low';
    for (const z of zones) {
      const frac = z.hp / z.maxHp;
      const smoking = z.alive && frac < SMOKE_AT;
      if (!smoking) {
        if (z.trail) { z.trail.stop(); z.trail = null; } // repaired or destroyed -> stop trailing
        continue;
      }
      if (useTrail) {
        // raymarched smoke trail: thicker + larger the more wounded the zone is
        if (!z.trail) {
          // Ramp the smoke live (read each spawn) so it gets denser + lumpier + MORE puffs as the
          // zone keeps losing HP — not fixed at the moment trailing started.
          const hurt = () => Math.max(0, Math.min(1, (SMOKE_AT - z.hp / z.maxHp) / SMOKE_AT));
          z.trail = vfx.createTrail({
            getPos: zonePos(z),
            life: 2.6,
            radius: () => 2.4 + hurt() * 2.6,
            spawnDist: () => 5.0 - hurt() * 3.2, // tighter spacing -> more puffs when worse
            spawnInterval: () => 0.4 - hurt() * 0.28, // faster cadence -> more particles when worse
            density: () => 0.9 + hurt() * 1.3, // thicker, more occluding the more wounded
            blobs: () => (hurt() > 0.55 ? 4 : 3), // lumpier when badly hurt
          });
        }
        z.trail.update(stepDt);
      } else if (vfx.smoke) {
        wp.copy(z.center);
        pivot.localToWorld(wp);
        vfx.smoke(wp);
      }
      if (frac < 0.4 && vfx.ember && Math.random() < 0.4) { // a few flames only when badly hurt
        wp.copy(z.center);
        pivot.localToWorld(wp);
        vfx.ember(wp, frac);
      }
    }
    // ongoing electric sparks from the stub of any blown-off canard
    for (const z of zones) {
      if (z.kind === 'canard' && !z.alive && z.sparkPoint && vfx.spark && Math.random() < 0.5) {
        wp.copy(z.sparkPoint);
        pivot.localToWorld(wp);
        vfx.spark(wp, 0xcfe8ff);
      }
    }
  }

  function totalHp() {
    let h = 0;
    let m = 0;
    for (const z of zones) {
      h += Math.max(0, z.hp);
      m += z.maxHp;
    }
    return h / m;
  }

  function reset() {
    for (const z of zones) {
      z.hp = z.maxHp;
      z.alive = true;
      if (z.trail) { z.trail.stop(); z.trail = null; }
      if (z.node) z.node.visible = true; // restore a blown-off canard
    }
  }

  return {
    zones,
    applyHit,
    speedScale,
    rollScale,
    pitchScale,
    canFire,
    update,
    totalHp,
    reset,
    setCallbacks(c) {
      if (c.onEject) onEject = c.onEject;
      if (c.onDestroyed) onDestroyed = c.onDestroyed;
      if (c.onFuelRupture) onFuelRupture = c.onFuelRupture;
      if (c.onCanardLost) onCanardLost = c.onCanardLost;
    },
  };
}
