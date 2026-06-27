import * as THREE from 'three';

// Maneuvering (RCS) thruster exhaust. Small attitude jets that puff from ports on the hull when the
// ship rotates — pitch fires the nose/tail up-down ports, yaw the nose side ports, roll the wingtip
// ports. Ports are defined in the ship pivot-local frame (forward -Z, up +Y, right +X) and are live-
// editable via the debug editor (editor.js), which logs updated values to paste back here.
//
// `axis` selects which control input drives a port: 'pitch' | 'yaw' | 'roll'. `dir` is the direction
// the exhaust shoots OUT (a short additive cone, wide at the nozzle, tapering away from the hull).

export const RCS_PORTS = [
  { name: 'Nose up', pos: [0, 1.4, -4.4], dir: [0, 1, 0], axis: 'pitch' },
  { name: 'Nose down', pos: [0, -1.4, -4.4], dir: [0, -1, 0], axis: 'pitch' },
  { name: 'Tail up', pos: [0, 1.3, 2.6], dir: [0, 1, 0], axis: 'pitch' },
  { name: 'Tail down', pos: [0, -1.3, 2.6], dir: [0, -1, 0], axis: 'pitch' },
  { name: 'Nose left', pos: [-1.1, 0, -4.4], dir: [-1, 0, 0], axis: 'yaw' },
  { name: 'Nose right', pos: [1.1, 0, -4.4], dir: [1, 0, 0], axis: 'yaw' },
  { name: 'Wing L', pos: [-3.8, 0, 0.6], dir: [0, 1, 0], axis: 'roll' },
  { name: 'Wing R', pos: [3.8, 0, 0.6], dir: [0, -1, 0], axis: 'roll' },
];

export function createRcs(scene, ship, ports = RCS_PORTS) {
  const group = new THREE.Group();
  ship.pivot.add(group); // local frame -> tracks the ship

  // Live-tunable jet size multipliers (user wanted thin/short jets). Editable in the debug editor.
  const jet = { radius: 0.1, length: 0.5 };

  const coneGeo = new THREE.ConeGeometry(0.5, 1, 12, 1, true); // apex +Y, open base
  const units = ports.map((p) => {
    const mat = new THREE.MeshBasicMaterial({
      color: 0x9fe2ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, opacity: 0,
    });
    const cone = new THREE.Mesh(coneGeo, mat);
    cone.frustumCulled = false;
    cone.visible = false;
    group.add(cone);
    return { p, cone, level: 0, seed: Math.random() * 6.28 };
  });

  const UP = new THREE.Vector3(0, 1, 0);
  const dir = new THREE.Vector3();
  const q = new THREE.Quaternion();
  let t = 0;

  // input carries pitch/yaw/roll in [-1,1]; pass null to force all jets off.
  function update(dt, input) {
    t += dt;
    for (const u of units) {
      const cmd = input ? Math.abs(input[u.p.axis] || 0) : 0;
      u.level += (cmd - u.level) * (1 - Math.exp(-20 * dt)); // snappy attack/decay
      const cone = u.cone;
      if (u.level <= 0.02) { cone.visible = false; continue; }
      const flick = 0.85 + 0.15 * Math.sin(t * 40 + u.seed);
      dir.set(u.p.dir[0], u.p.dir[1], u.p.dir[2]);
      if (dir.lengthSq() < 1e-6) dir.set(0, 1, 0); else dir.normalize();
      q.setFromUnitVectors(UP, dir); // cone apex points along the exhaust direction
      cone.quaternion.copy(q);
      const len = (0.5 + u.level * 2.4) * flick * jet.length;
      const wid = (0.3 + u.level * 0.5) * jet.radius;
      cone.scale.set(wid, len, wid);
      cone.position.set(u.p.pos[0], u.p.pos[1], u.p.pos[2]).addScaledVector(dir, len * 0.5); // base at the port
      cone.material.opacity = Math.min(1, u.level * 1.4) * 0.9 * flick;
      cone.visible = true;
    }
  }

  return { ports, units, update, group, jet };
}
