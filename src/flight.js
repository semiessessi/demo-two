import * as THREE from 'three';

// Arcade flight model + chase camera (keyboard to fly). The ship is a THREE.Object3D (the pivot from
// ship.js): we spin it with local-axis angular rates from the keys, auto-bank it into yaw turns,
// push it forward along its own -Z, and trail a spring-damped camera behind + above it that rolls
// with the ship so left/right stay relative to the cockpit.
//   - mouse wheel  : zoom (chase distance)
//   - middle-drag  : orbit around the ship; springs back to the chase position on release

const TUNE = {
  pitchRate: 1.5,
  yawRate: 1.1,
  rollRate: 2.4,
  autoBank: 0.9,
  damp: 6.0,
  baseSpeed: 26,
  boostSpeed: 70,
  brakeSpeed: 9,
  accel: 1.8,
  camDist: 13,
  heightRatio: 0.42,
  camLook: 26,
  minDist: 2.5, // allow zooming in close
  maxDist: 60,
  posSpring: 4.5,
  dragSpring: 16, // snappier camera while orbiting
  upSpring: 8.0,
  rollBlend: 1.0, // camera up = ship up: the view rolls fully with the hull so left/right stay cockpit-relative
  orbitSens: 0.005, // rad per pixel of middle-drag
  orbitSpring: 6.0, // how fast the orbit springs back when released
};

export function createFlight(ship, camera, domElement, input) {
  let enabled = true;
  let speedScale = 1; // reduced by engine damage
  let rollScale = 1; // reduced as forward canards are shot off (roll authority)
  let pitchScale = 1; // reduced as forward canards are shot off (pitch authority)
  let camDist = TUNE.camDist;
  let heightRatio = TUNE.heightRatio;

  let rPitch = 0;
  let rYaw = 0;
  let rRoll = 0;
  let speed = TUNE.baseSpeed;
  let throttle = 0.4;

  // middle-drag orbit
  let orbitYaw = 0;
  let orbitPitch = 0;
  let dragging = false;

  const onWheel = (e) => {
    e.preventDefault();
    camDist = THREE.MathUtils.clamp(camDist + e.deltaY * 0.02, TUNE.minDist, TUNE.maxDist);
  };
  const onMouseDown = (e) => {
    if (e.button === 1) {
      dragging = true;
      e.preventDefault();
    }
  };
  const onMouseUp = (e) => {
    if (e.button === 1) dragging = false;
  };
  const onMouseMove = (e) => {
    if (!dragging) return;
    orbitYaw -= e.movementX * TUNE.orbitSens;
    orbitPitch = THREE.MathUtils.clamp(orbitPitch + e.movementY * TUNE.orbitSens, -1.3, 1.3);
  };
  const onAux = (e) => {
    if (e.button === 1) e.preventDefault();
  };
  domElement.addEventListener('wheel', onWheel, { passive: false });
  domElement.addEventListener('mousedown', onMouseDown);
  domElement.addEventListener('auxclick', onAux);
  window.addEventListener('mouseup', onMouseUp);
  window.addEventListener('mousemove', onMouseMove);

  const tmp = new THREE.Vector3();
  const dq = new THREE.Quaternion();
  const e = new THREE.Euler();
  const fwd = new THREE.Vector3();
  const up = new THREE.Vector3();
  const off = new THREE.Vector3();
  const worldUp = new THREE.Vector3(0, 1, 0);
  const qOrbit = new THREE.Quaternion();
  const rightAxis = new THREE.Vector3();
  const desiredCam = new THREE.Vector3();
  const lookTarget = new THREE.Vector3();
  const camUp = new THREE.Vector3(0, 1, 0);
  placeCameraBehind();

  function update(dt) {
    dt = Math.min(dt, 0.05);
    if (!enabled) {
      followCamera(dt);
      return { throttle, speed };
    }

    // pitch/yaw/roll come from the shared input layer (keyboard + gamepad), same sign convention
    const pitchIn = input.pitch; // -1 = nose down (W / stick forward)
    const yawIn = input.yaw; // +1 = yaw left (A / stick left)
    const rollIn = input.roll; // +1 = roll left (Q / LB)

    // Turning circle vs throttle: braking -> ~0.5x the cruise circle (tighter), boosting -> ~2x (wider).
    // circle = speed / turn-rate, so scale the pitch+yaw rate by `agility` to hit that target circle, so
    // slowing down lets you turn tighter. (Roll is left alone.)
    const circleScale = THREE.MathUtils.clamp(
      speed <= TUNE.baseSpeed
        ? THREE.MathUtils.mapLinear(speed, TUNE.brakeSpeed, TUNE.baseSpeed, 0.5, 1.0)
        : THREE.MathUtils.mapLinear(speed, TUNE.baseSpeed, TUNE.boostSpeed, 1.0, 2.0),
      0.5, 2.0);
    const agility = (speed / TUNE.baseSpeed) / circleScale;
    const tPitch = pitchIn * TUNE.pitchRate * pitchScale * agility;
    const tYaw = yawIn * TUNE.yawRate * agility;
    const tRoll = rollIn * TUNE.rollRate * rollScale - yawIn * TUNE.autoBank; // canard loss saps commanded roll (auto-bank kept)

    const k = 1 - Math.exp(-TUNE.damp * dt);
    rPitch += (tPitch - rPitch) * k;
    rYaw += (tYaw - rYaw) * k;
    rRoll += (tRoll - rRoll) * k;

    e.set(rPitch * dt, rYaw * dt, rRoll * dt, 'XYZ');
    dq.setFromEuler(e);
    ship.quaternion.multiply(dq);
    ship.quaternion.normalize();

    const boosting = input.boost;
    const braking = input.brake;
    const target = (braking ? TUNE.brakeSpeed : boosting ? TUNE.boostSpeed : TUNE.baseSpeed) * speedScale;
    speed += (target - speed) * (1 - Math.exp(-TUNE.accel * dt));
    throttle = THREE.MathUtils.clamp((speed - TUNE.brakeSpeed) / (TUNE.boostSpeed - TUNE.brakeSpeed), 0, 1);
    if (boosting) throttle = Math.min(1.2, throttle + 0.25);

    fwd.set(0, 0, -1).applyQuaternion(ship.quaternion);
    ship.position.addScaledVector(fwd, speed * dt);

    followCamera(dt);
    return { throttle, speed, boosting };
  }

  function followCamera(dt) {
    fwd.set(0, 0, -1).applyQuaternion(ship.quaternion);
    up.set(0, 1, 0).applyQuaternion(ship.quaternion);

    // spring the orbit back to the chase position once the drag is released
    if (!dragging) {
      const d = Math.exp(-TUNE.orbitSpring * dt);
      orbitYaw *= d;
      orbitPitch *= d;
      if (Math.abs(orbitYaw) < 1e-4) orbitYaw = 0;
      if (Math.abs(orbitPitch) < 1e-4) orbitPitch = 0;
    }

    // base chase offset, then orbit it around the ship (yaw about world up, pitch about camera right)
    off.set(0, 0, 0).addScaledVector(fwd, -camDist).addScaledVector(up, camDist * heightRatio);
    qOrbit.setFromAxisAngle(worldUp, orbitYaw);
    off.applyQuaternion(qOrbit);
    rightAxis.crossVectors(off, worldUp).normalize();
    qOrbit.setFromAxisAngle(rightAxis, orbitPitch);
    off.applyQuaternion(qOrbit);

    desiredCam.copy(ship.position).add(off);
    const ks = 1 - Math.exp(-(dragging ? TUNE.dragSpring : TUNE.posSpring) * dt);
    camera.position.lerp(desiredCam, ks);

    // look toward the ship; ease from look-ahead toward the ship as you orbit
    const orbitAmt = Math.min(1, Math.abs(orbitYaw) + Math.abs(orbitPitch));
    lookTarget.copy(ship.position).addScaledVector(fwd, TUNE.camLook * (1 - orbitAmt) + 2 * orbitAmt);
    camUp.lerp(tmp.set(0, 1, 0).lerp(up, TUNE.rollBlend), 1 - Math.exp(-TUNE.upSpring * dt)).normalize();
    camera.up.copy(camUp);
    camera.lookAt(lookTarget);
  }

  function placeCameraBehind() {
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(ship.quaternion);
    const u = new THREE.Vector3(0, 1, 0).applyQuaternion(ship.quaternion);
    camera.position.copy(ship.position).addScaledVector(f, -camDist).addScaledVector(u, camDist * heightRatio);
    camera.up.set(0, 1, 0);
    camera.lookAt(ship.position.clone().addScaledVector(f, TUNE.camLook));
  }

  function dispose() {
    domElement.removeEventListener('wheel', onWheel);
    domElement.removeEventListener('mousedown', onMouseDown);
    domElement.removeEventListener('auxclick', onAux);
    window.removeEventListener('mouseup', onMouseUp);
    window.removeEventListener('mousemove', onMouseMove);
  }

  return {
    update,
    dispose,
    get throttle() {
      return throttle;
    },
    get speed() {
      return speed;
    },
    get camDist() {
      return camDist;
    },
    set camDist(v) {
      camDist = THREE.MathUtils.clamp(v, TUNE.minDist, TUNE.maxDist);
    },
    get heightRatio() {
      return heightRatio;
    },
    set heightRatio(v) {
      heightRatio = v;
    },
    setEnabled(v) {
      enabled = v;
    },
    setSpeedScale(v) {
      speedScale = v;
    },
    setRollScale(v) {
      rollScale = v;
    },
    setPitchScale(v) {
      pitchScale = v;
    },
  };
}
