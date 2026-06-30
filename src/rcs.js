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
  { name: 'Nose down L', pos: [-0.9, -0.15, -3.1], dir: [0, 1, 0] },
  { name: 'Nose down R', pos: [0.9, -0.15, -3.1], dir: [0, 1, 0] },
  { name: 'Nose up L', pos: [-0.9, -0.1, -3.1], dir: [0, -1, 0] },
  { name: 'Nose up R', pos: [0.9, -0.1, -3.1], dir: [0, -1, 0] },
  { name: 'Tail down L', pos: [-0.2, 0.4, 2.7], dir: [0, 1, 0] },
  { name: 'Tail down R', pos: [0.2, 0.4, 2.7], dir: [0, 1, 0] },
  { name: 'Tail up L', pos: [-0.2, -0.4, 2.7], dir: [0, -1, 0] },
  { name: 'Tail up R', pos: [0.2, -0.4, 2.7], dir: [0, -1, 0] },
  // Outward-firing YAW jets (mirrored pairs): on the canards (fore) and the wingtips (aft). Exhaust points
  // out the side (-X left / +X right). A fore + aft pair on the same side give opposite yaw torque, so the
  // geometry-driven firing picks whichever one matches the turn. Starting positions are rough — drag them
  // into place in ?debug -> RCS Ports (edit), then "log ports -> console" and paste back here.
  { name: 'Canard yaw L', pos: [-1.15, -0.05, -3.2], dir: [-1, 0, 0] },
  { name: 'Canard yaw R', pos: [1.15, -0.05, -3.2], dir: [1, 0, 0] },
  { name: 'Wingtip yaw L', pos: [-3.45, 0.05, 0.2], dir: [-1, 0, 0] },
  { name: 'Wingtip yaw R', pos: [3.45, 0.05, 0.2], dir: [1, 0, 0] },
  // Forward-firing jets (mirrored): on the canards + wingtips, exhaust out the FRONT (-Z). At their
  // off-centre X they command yaw (opposite the outward jets) and add a retro/attitude flourish. Rough
  // starting spots — drag them in ?debug -> RCS Ports (edit) (mirror on), then log + paste back.
  { name: 'Canard fwd L', pos: [-1.05, -0.05, -3.2], dir: [0, 0, -1] },
  { name: 'Canard fwd R', pos: [1.05, -0.05, -3.2], dir: [0, 0, -1] },
  { name: 'Wingtip fwd L', pos: [-3.4, 0, -0.05], dir: [0, 0, -1] },
  { name: 'Wingtip fwd R', pos: [3.4, 0, -0.05], dir: [0, 0, -1] },
  // Wing pitch/roll jets (mirrored): up + down faces in the middle-front of each wing. Off-centre in X,
  // so they mostly command roll (like the ailerons), with some pitch. Rough starts — place in the editor.
  { name: 'Wing up L', pos: [-1.65, 0.35, 0.55], dir: [0, 1, 0] },
  { name: 'Wing up R', pos: [1.65, 0.35, 0.55], dir: [0, 1, 0] },
  { name: 'Wing down L', pos: [-1.65, 0.3, 0.55], dir: [0, -1, 0] },
  { name: 'Wing down R', pos: [1.65, 0.3, 0.55], dir: [0, -1, 0] },
];

export function createRcs(scene, ship, ports = RCS_PORTS, opts = {}) {
  const group = new THREE.Group();
  ship.pivot.add(group); // local frame -> tracks the ship

  // Live-tunable jet size + firing gain (user wanted thin/short jets). Editable in the debug editor.
  // `gain` now scales angular ACCELERATION (see update) — jets pulse on rate changes, not steady turns.
  const jet = { radius: 0.1, length: 0.5, gain: 0.38, brakeGain: 0.05 };
  const RCS_SMOOTH = 14; // low-pass on angular velocity before differentiating (AI micro-corrections are noisy)

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

  // Optional REAL local point lights (opts.lights = pool size). A small pool that hops to the strongest-
  // firing jets each frame so the hull genuinely lights up — without one-light-per-jet cost. Parented to
  // the ship-local group so they move with it (no per-frame world transform); parked at intensity 0 idle.
  const RCS_LIGHT_PEAK = 22;
  const rcsLights = [];
  for (let i = 0; i < (opts.lights || 0); i++) {
    const pl = new THREE.PointLight(0xbfe0ff, 0, ship.radius * 1.6, 2); // cool-white, short range, no shadow
    pl.castShadow = false;
    group.add(pl);
    rcsLights.push(pl);
  }
  const litUnits = [];
  const _ld = new THREE.Vector3();

  const UP = new THREE.Vector3(0, 1, 0);
  const dir = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const prevQ = new THREE.Quaternion();
  const dq = new THREE.Quaternion();
  const omega = new THREE.Vector3();
  const omegaLP = new THREE.Vector3(); // lightly-smoothed angular velocity
  const prevOmegaLP = new THREE.Vector3(); // previous smoothed value, for differentiation
  const alpha = new THREE.Vector3(); // angular acceleration = the jet command axis
  const tpos = new THREE.Vector3();
  const tq = new THREE.Vector3();
  let havePrev = false;
  let t = 0;
  // forward-motion tracking so the FORWARD-facing jets can also fire on deceleration (retro thrusters)
  const prevPos = new THREE.Vector3();
  const dpos = new THREE.Vector3();
  const fwdTmp = new THREE.Vector3();
  let havePrevPos = false, prevV = 0, decel = 0;

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
    // Fire on angular ACCELERATION, not steady angular velocity. In vacuum a constant rotation needs no
    // torque, so a real attitude jet pulses when a turn STARTS / STOPS / CHANGES, then goes quiet — firing
    // on velocity instead pegged the pitch jets on for the whole of a sustained banked turn ("the up
    // thrusters never stop", which the AI does almost constantly). Smooth the noisy AI-jittered angular
    // velocity, differentiate it for the command axis, and scale firing by its magnitude.
    omegaLP.lerp(omega, 1 - Math.exp(-RCS_SMOOTH * dt));
    alpha.copy(omegaLP).sub(prevOmegaLP).multiplyScalar(1 / Math.max(dt, 1e-3));
    prevOmegaLP.copy(omegaLP);
    const omegaMag = alpha.length();
    const fireScale = Math.min(1, omegaMag * jet.gain);
    omega.copy(alpha);
    if (omegaMag > 1e-4) omega.multiplyScalar(1 / omegaMag); // command axis = unit angular acceleration

    // forward deceleration (units/s²) from the ship's own motion — drives the forward-facing retro jets
    fwdTmp.set(0, 0, -1).applyQuaternion(cq);
    if (!havePrevPos) { prevPos.copy(ship.pivot.position); havePrevPos = true; }
    dpos.copy(ship.pivot.position).sub(prevPos);
    prevPos.copy(ship.pivot.position);
    const instV = (enabled && dt > 1e-4) ? dpos.dot(fwdTmp) / dt : prevV;
    decel += (Math.max(0, (prevV - instV) / Math.max(dt, 1e-3)) - decel) * (1 - Math.exp(-8 * dt));
    prevV = instV;
    const brakeFire = Math.min(1, decel * jet.brakeGain);

    for (const u of units) {
      dir.set(u.p.dir[0], u.p.dir[1], u.p.dir[2]);
      if (dir.lengthSq() < 1e-6) dir.set(0, 1, 0); else dir.normalize();
      let cmd = 0;
      if (fireScale > 0.001) {
        tpos.set(u.p.pos[0], u.p.pos[1], u.p.pos[2]);
        tq.copy(tpos).cross(dir).multiplyScalar(-1); // reaction torque axis = pos × (-exhaustDir)
        if (tq.lengthSq() > 1e-6) cmd = Math.max(0, tq.normalize().dot(omega)) * fireScale;
      }
      if (u.p.dir[2] < -0.5) cmd = Math.max(cmd, brakeFire); // forward-facing jets ALSO fire on deceleration (retro)
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

    // hop the real-light pool to the strongest-firing jets — the hull lights up where it's thrusting
    if (rcsLights.length) {
      litUnits.length = 0;
      for (const u of units) if (u.level > 0.05) litUnits.push(u);
      litUnits.sort((a, b) => b.level - a.level);
      for (let i = 0; i < rcsLights.length; i++) {
        const u = litUnits[i], pl = rcsLights[i];
        if (u) {
          _ld.set(u.p.dir[0], u.p.dir[1], u.p.dir[2]); if (_ld.lengthSq() > 1e-6) _ld.normalize();
          pl.position.set(u.p.pos[0], u.p.pos[1], u.p.pos[2]).addScaledVector(_ld, 0.2);
          pl.intensity = u.level * RCS_LIGHT_PEAK;
        } else pl.intensity = 0;
      }
    }
  }

  return { ports, units, update, group, jet };
}
