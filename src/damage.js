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
    zones.push({ name, center, radius, hp, maxHp: hp, kind, alive: true });

  add('Cockpit', meshCenterLocal(/canopy/i, new THREE.Vector3(0, 0.3, -R * 0.4)), R * 0.5, 55, 'cockpit');
  add('L Engine', lEng, R * 0.5, 70, 'engine');
  add('R Engine', rEng, R * 0.5, 70, 'engine');
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
  function update(dt, vfx) {
    acc += dt;
    if (acc < 0.1) return;
    acc = 0;
    for (const z of zones) {
      const frac = z.hp / z.maxHp;
      if (frac < 0.6 && vfx.ember) {
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

  return {
    zones,
    applyHit,
    speedScale,
    update,
    totalHp,
    setCallbacks(c) {
      if (c.onEject) onEject = c.onEject;
      if (c.onDestroyed) onDestroyed = c.onDestroyed;
    },
  };
}
