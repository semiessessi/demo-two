import * as THREE from 'three';

// Maneuvering (RCS) thruster exhaust. Small attitude jets that puff from ports on the hull when the
// ship rotates. Which jets fire is derived from the ship's actual rotation each frame (see update) —
// no per-port axis tagging. Ports are in the ship pivot-local frame (forward -Z, up +Y, right +X) and
// are live-editable via the debug editor (editor.js), which logs updated values to paste back here.
// `dir` is the direction the exhaust shoots OUT (a short additive cone, wide at the nozzle).

// "down/up" = the pitch the jet commands; the exhaust points the OPPOSITE way (a "nose down" jet sits
// low on the nose and fires UP, pushing the nose down). The nose pair (wide in X) also rolls when it
// fires asymmetrically. Firing is derived from geometry (see update), so no per-port axis is needed.
// Tail "up" pairs mirror their "down" siblings in Y. Positions are pivot-local; edit live, then bake.
export const RCS_PORTS = [
  { name: 'Nose down L', pos: [-0.9, -0.1, -3.1], dir: [0, 1, 0] },
  { name: 'Nose down R', pos: [0.9, -0.1, -3.1], dir: [0, 1, 0] },
  { name: 'Nose up L', pos: [-0.9, 0.1, -3.1], dir: [0, -1, 0] },
  { name: 'Nose up R', pos: [0.9, 0.1, -3.1], dir: [0, -1, 0] },
  { name: 'Tail down L', pos: [-0.2, 0.4, 2.7], dir: [0, 1, 0] },
  { name: 'Tail down R', pos: [0.2, 0.4, 2.7], dir: [0, 1, 0] },
  { name: 'Tail up L', pos: [-0.2, -0.4, 2.7], dir: [0, -1, 0] },
  { name: 'Tail up R', pos: [0.2, -0.4, 2.7], dir: [0, -1, 0] },
];

export function createRcs(scene, ship, ports = RCS_PORTS) {
  const group = new THREE.Group();
  ship.pivot.add(group); // local frame -> tracks the ship

  // Live-tunable jet size + firing gain (user wanted thin/short jets). Editable in the debug editor.
  const jet = { radius: 0.1, length: 0.5, gain: 2.4 };

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
  const prevQ = new THREE.Quaternion();
  const dq = new THREE.Quaternion();
  const omega = new THREE.Vector3();
  const tpos = new THREE.Vector3();
  const tq = new THREE.Vector3();
  let havePrev = false;
  let t = 0;

  // Reverse-engineered RCS (no real physics): read how the ship ACTUALLY rotated this frame — the
  // local angular velocity from the quaternion delta — then fire each jet in proportion to how well
  // its reaction torque (pos × -exhaustDir) matches that rotation. So the jets always look right for
  // whatever the flight model / AI does: pitch fires symmetric nose+tail pairs, roll fires the wide
  // nose pair asymmetrically, etc. `enabled` (flying) gates them; false lets them decay to off.
  function update(dt, enabled) {
    t += dt;
    const cq = ship.pivot.quaternion;
    if (!havePrev) { prevQ.copy(cq); havePrev = true; }
    dq.copy(prevQ).invert().multiply(cq); // rotation since last frame, in the ship-local frame
    prevQ.copy(cq);
    omega.set(0, 0, 0);
    if (enabled && dt > 1e-4) {
      const w = Math.min(1, Math.max(-1, dq.w));
      let angle = 2 * Math.acos(w);
      if (angle > Math.PI) angle -= 2 * Math.PI; // shortest arc
      const s = Math.sqrt(Math.max(0, 1 - w * w));
      if (s > 1e-5) omega.set(dq.x / s, dq.y / s, dq.z / s).multiplyScalar(angle / dt);
    }
    const omegaMag = omega.length();
    const fireScale = Math.min(1, omegaMag * jet.gain);
    if (omegaMag > 1e-4) omega.multiplyScalar(1 / omegaMag); // reuse omega as the unit rotation axis

    for (const u of units) {
      dir.set(u.p.dir[0], u.p.dir[1], u.p.dir[2]);
      if (dir.lengthSq() < 1e-6) dir.set(0, 1, 0); else dir.normalize();
      let cmd = 0;
      if (fireScale > 0.001) {
        tpos.set(u.p.pos[0], u.p.pos[1], u.p.pos[2]);
        tq.copy(tpos).cross(dir).multiplyScalar(-1); // reaction torque axis = pos × (-exhaustDir)
        if (tq.lengthSq() > 1e-6) cmd = Math.max(0, tq.normalize().dot(omega)) * fireScale;
      }
      u.level += (cmd - u.level) * (1 - Math.exp(-20 * dt)); // snappy attack/decay
      const cone = u.cone;
      if (u.level <= 0.02) { cone.visible = false; continue; }
      const flick = 0.85 + 0.15 * Math.sin(t * 40 + u.seed);
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
