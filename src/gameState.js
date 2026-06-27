import * as THREE from 'three';

// State machine: menu -> flying -> (tumbling) -> ejecting -> over -> menu. The game opens in `menu`
// (the pre-game / AI Skirmish setup screen, flight disabled); Launch -> flying. Holding eject for
// EJECT_HOLD (or cockpit/fuselage destruction) triggers a short cutscene, then MISSION OVER, then
// back to the menu. main supplies onRestart (reset the world) + onMenu (show the pre-game screen).

const EJECT_HOLD = 1.0;
const CUTSCENE = 2.6;

export function createGameState({ ship, camera, flight, hud, vfx, debris, playerVel, onRestart, onMenu }) {
  let mode = 'menu';
  let ejectHold = 0;
  let cutscene = 0;
  let reasonText = 'EJECTED — MISSION OVER';
  let tumbleRate = 2;
  let autoEject = 0; // backstop timer while tumbling
  const tumbleVel = new THREE.Vector3();

  const drift = new THREE.Vector3();
  const tumbleAxis = new THREE.Vector3();
  const camOffset = new THREE.Vector3();
  const desiredCam = new THREE.Vector3();
  const WUP = new THREE.Vector3(0, 1, 0);

  function beginCutscene(reason) {
    if (mode === 'ejecting' || mode === 'over') return; // allowed from 'flying' or 'tumbling'
    mode = 'ejecting';
    cutscene = CUTSCENE;
    reasonText = reason;
    flight.setEnabled(false);
    drift.set(0, 0, -1).applyQuaternion(ship.pivot.quaternion).multiplyScalar(18);
    tumbleAxis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    tumbleRate = 1.6 + Math.random() * 1.6;
    camOffset.copy(camera.position).sub(ship.pivot.position);
  }

  function eject() {
    beginCutscene('EJECTED — MISSION OVER');
  }
  function destroyed() {
    if (mode === 'flying') {
      if (vfx) vfx.explosion(ship.pivot.position, 1.8);
      // the Hammerhead shatters into debris — hide the intact hull (fall back to an intact tumble if
      // the fracture pool isn't ready yet). Eject() keeps the ship whole (pilot bails); only this path fractures.
      if (debris && debris.burst({ pos: ship.pivot.position, obj: ship.pivot, vel: playerVel }, 1.4) && ship.model) {
        ship.model.visible = false;
      }
    }
    beginCutscene('SHIP DESTROYED');
  }

  // A wing torn off: the ship snaps into an uncontrollable tumble; the only way out is to eject.
  function tumble(reason) {
    if (mode !== 'flying') return;
    mode = 'tumbling';
    reasonText = reason;
    flight.setEnabled(false);
    tumbleVel.copy(playerVel || drift.set(0, 0, 0)).multiplyScalar(0.9); // keep most of the current momentum
    tumbleAxis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    tumbleRate = 2.6 + Math.random() * 1.6;
    camOffset.copy(camera.position).sub(ship.pivot.position);
    ejectHold = 0;
    autoEject = 5; // can't hang forever — auto-bail after a few seconds
  }

  function update(dt, input) {
    if (mode === 'flying') {
      if (input.ejectHeld) {
        ejectHold += dt;
        if (ejectHold >= EJECT_HOLD) eject();
      } else {
        ejectHold = Math.max(0, ejectHold - dt * 2);
      }
    } else if (mode === 'ejecting') {
      const prog = 1 - cutscene / CUTSCENE;
      ship.pivot.position.addScaledVector(drift, dt);
      ship.pivot.rotateOnAxis(tumbleAxis, tumbleRate * dt);
      desiredCam
        .copy(ship.pivot.position)
        .addScaledVector(camOffset, 1 + prog * 1.6)
        .addScaledVector(WUP, prog * 14);
      camera.position.lerp(desiredCam, 1 - Math.exp(-2.5 * dt));
      camera.up.copy(WUP);
      camera.lookAt(ship.pivot.position);
      cutscene -= dt;
      if (cutscene <= 0) {
        mode = 'over';
        if (hud) hud.showMissionOver('MISSION OVER', reasonText);
      }
    } else if (mode === 'tumbling') {
      // out of control: spin + drift with the wreck's momentum; chase camera doesn't roll with the spin.
      ship.pivot.position.addScaledVector(tumbleVel, dt);
      tumbleVel.multiplyScalar(1 - 0.2 * dt);
      ship.pivot.rotateOnAxis(tumbleAxis, tumbleRate * dt);
      desiredCam.copy(ship.pivot.position).add(camOffset);
      camera.position.lerp(desiredCam, 1 - Math.exp(-3 * dt));
      camera.up.copy(WUP);
      camera.lookAt(ship.pivot.position);
      autoEject -= dt;
      if (input.ejectHeld) ejectHold += dt; else ejectHold = Math.max(0, ejectHold - dt * 1.5);
      if (ejectHold >= EJECT_HOLD || autoEject <= 0) beginCutscene(reasonText); // hold J to bail (or auto-bail)
    }
  }

  // Launch a skirmish from the menu. main applies the chosen settings + resets the world first.
  function launch() {
    if (mode !== 'menu') return;
    mode = 'flying';
    ejectHold = 0;
    flight.setEnabled(true);
  }

  // Return to the pre-game screen (from MISSION OVER, or programmatically). Resets the world so the
  // menu shows a clean, intact ship for the customisation preview.
  function toMenu() {
    if (onRestart) onRestart();
    if (hud) hud.hideMissionOver();
    mode = 'menu';
    ejectHold = 0;
    flight.setEnabled(false);
    if (onMenu) onMenu();
  }

  // MISSION OVER "Restart" now returns to the menu (re-customise before the next sortie).
  function restart() { toMenu(); }

  return {
    update,
    eject,
    destroyed,
    tumble,
    launch,
    toMenu,
    restart,
    get mode() {
      return mode;
    },
    get ejectProgress() {
      if (mode === 'flying') return ejectHold / EJECT_HOLD;
      if (mode === 'tumbling') return Math.min(0.99, Math.max(0.12, ejectHold / EJECT_HOLD)); // always show the prompt; fills as you hold J
      return mode === 'ejecting' ? 1 : 0;
    },
  };
}
