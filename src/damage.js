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
  const add = (name, center, radius, hp, kind) =>
    zones.push({ name, center, radius, hp, maxHp: hp, kind, alive: true, trail: null });

  add('Cockpit', meshCenterLocal(/canopy/i, new THREE.Vector3(0, 0.3, -R * 0.4)), R * 0.5, 55, 'cockpit');
  add('L Engine', lEng, R * 0.5, 20, 'engine'); // fragile: ~2 enemy pulses (10 dmg) knock it out
  add('R Engine', rEng, R * 0.5, 20, 'engine');
  add('L Wing', meshCenterLocal(/l_aileron/i, new THREE.Vector3(-R * 0.8, 0, 0.3)), R * 0.7, 80, 'wing');
  add('R Wing', meshCenterLocal(/r_aileron/i, new THREE.Vector3(R * 0.8, 0, 0.3)), R * 0.7, 80, 'wing');
  add('Fuselage', new THREE.Vector3(0, 0, 0), R * 0.7, 120, 'fuselage');

  let onEject = opts.onEject || null;
  let onDestroyed = opts.onDestroyed || null;
  const localPt = new THREE.Vector3();

  function applyHit(worldPoint, dmg) {
    pivot.worldToLocal(localPt.copy(worldPoint));
    let best = null;
    let bestD = Infinity;
    for (const z of zones) {
      if (!z.alive) continue;
      const d = localPt.distanceTo(z.center);
      if (d < bestD) {
        bestD = d;
        best = z;
      }
    }
    if (!best) return null;
    best.hp -= dmg;
    if (best.hp <= 0) {
      best.hp = 0;
      best.alive = false;
      if (best.kind === 'cockpit' && onEject) onEject();
      else if (best.kind === 'fuselage' && onDestroyed) onDestroyed();
    }
    return best;
  }

  function speedScale() {
    const dead = zones.filter((z) => z.kind === 'engine' && !z.alive).length;
    return [1, 0.6, 0.3][Math.min(dead, 2)];
  }

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
          const hurt = (SMOKE_AT - frac) / SMOKE_AT; // 0..1 as it worsens
          z.trail = vfx.createTrail({
            getPos: zonePos(z),
            life: 2.2,
            radius: 2.0 + hurt * 1.8,
            spawnDist: 5.5,
            spawnInterval: 0.4,
            density: 0.55 + hurt * 0.5,
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
    }
  }

  return {
    zones,
    applyHit,
    speedScale,
    update,
    totalHp,
    reset,
    setCallbacks(c) {
      if (c.onEject) onEject = c.onEject;
      if (c.onDestroyed) onDestroyed = c.onDestroyed;
    },
  };
}
