import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

// Front-gun mesh + its calibration. The cannon (weapons.js) is gimbal math with no barrel; this loads
// the user's gun model and pivots it to the cannon's aim. The FBX has an arbitrary origin / orientation
// / scale ("substandard mesh cutting"), so on load the mesh is re-centred (bbox centre -> origin) and the
// rest of the fit (mount, barrel length, rest orientation, offset, scale) is dialed in live via the
// ?debug "Front Gun (calibrate)" editor and baked back here. weapons.js reads mount + barrel for the
// muzzle (flash + bolts); the visible mesh uses all of it. Distances are in the ship.pivot frame
// (radius ~5), matching the other editors and the cannon muzzle.
export const FRONT_GUN = {
  mount: [0, -0.54, -2.18], // ship-local pivot the gun swings from (calibrated)
  barrel: 0.58, //             mount -> muzzle-tip distance along the aim (flash + bolts spawn here)
  rest: [0, 0, 0], //          euler (rad) orienting the mesh's barrel along the gun's local -Z at rest
  offset: [0, 0, 0], //        mesh nudge off the pivot
  scale: 1.0, //               1 = the ship's render scale (the gun was cut from the same model)
};

const _Y = new THREE.Vector3(0, 1, 0);
const _X = new THREE.Vector3(1, 0, 0);

export async function createFrontGun(ship) {
  const alignScale = (ship.align && ship.align.scale && ship.align.scale.x) || 1;
  const center = ship.center || new THREE.Vector3(); // the ship's recenter (model is drawn at scale*(V - center))

  const gunMount = new THREE.Group(); // at FRONT_GUN.mount (ship-local) — the pivot point
  const gunAim = new THREE.Group(); //  rotated each frame to the cannon's aim
  const gunHolder = new THREE.Group(); // carries the calibrated offset/rest/scale of the re-centred mesh
  gunAim.add(gunHolder);
  gunMount.add(gunAim);
  ship.pivot.add(gunMount);

  let gunModel = null;
  const _qy = new THREE.Quaternion();
  const _qp = new THREE.Quaternion();

  // push FRONT_GUN onto the live objects (on load and after any calibration edit)
  function applyConfig() {
    gunMount.position.set(FRONT_GUN.mount[0], FRONT_GUN.mount[1], FRONT_GUN.mount[2]);
    // The mesh keeps its NATIVE model coords (cut from the hull in place). The hull is drawn at
    // scale*(V - center), so cancel BOTH the pivot (-mount) and the ship's recenter (-scale*center)
    // here; the gun then sits exactly where it was modelled and pivots about the mount. offset nudges.
    gunHolder.position.set(
      FRONT_GUN.offset[0] - FRONT_GUN.mount[0] - alignScale * center.x,
      FRONT_GUN.offset[1] - FRONT_GUN.mount[1] - alignScale * center.y,
      FRONT_GUN.offset[2] - FRONT_GUN.mount[2] - alignScale * center.z,
    );
    gunHolder.rotation.set(FRONT_GUN.rest[0], FRONT_GUN.rest[1], FRONT_GUN.rest[2]);
    gunHolder.scale.setScalar(FRONT_GUN.scale * alignScale); // scale = 1 -> matches the hull's render scale
  }
  applyConfig(); // place the mount even before the mesh loads (so calibration markers track)

  try {
    const draco = new DRACOLoader();
    draco.setDecoderPath('/draco/gltf/');
    const loader = new GLTFLoader();
    loader.setDRACOLoader(draco);
    const gltf = await loader.loadAsync('/front-gun.glb');
    gunModel = gltf.scene;
    gunModel.traverse((o) => {
      if (!o.isMesh) return;
      if (o.material) o.material.side = THREE.DoubleSide; // match the hull (inconsistent winding)
      o.castShadow = o.receiveShadow = false;
      o.frustumCulled = false; // tiny + always near the camera
    });
    gunHolder.add(gunModel); // keep native model coords — placed in world by applyConfig()
    applyConfig();
  } catch (e) {
    console.warn('[frontGun] /front-gun.glb not loaded — gun not drawn (run scripts/convert-front-gun.sh)', e);
  }

  // Match the cannon's aim exactly: yaw(+Y, gimbalYaw) then pitch(+X, gimbalPitch) — the same construction
  // as cannon.aimDir, so the barrel points where the bolts go. (No roll for the usual small angles.)
  function update(cannon) {
    if (!cannon) return;
    _qy.setFromAxisAngle(_Y, cannon.gimbalYaw || 0);
    _qp.setFromAxisAngle(_X, cannon.gimbalPitch || 0);
    gunAim.quaternion.copy(_qp).multiply(_qy);
  }

  return {
    update,
    applyConfig, //  re-apply FRONT_GUN after a live calibration edit
    gunMount,
    gunAim, //       the calibration editor hangs the muzzle marker here
    get model() { return gunModel; },
    setVisible(on) { gunMount.visible = !!on; },
    dispose() { gunMount.removeFromParent(); },
  };
}
