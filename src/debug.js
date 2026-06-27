import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { spawnChig } from './enemyShip.js';

// Localhost-only debug interface. main.js builds this only under its DEBUG flag, so none of it
// ships to the deployed site. It adds a "View" folder to the top-left lil-gui panel that switches
// between the live flight scene and static "model on a plane" viewers (hammerhead / chig) for
// inspecting the models and testing shadows (shadows are off in the normal flight scene).
//
// ctx carries references main.js already holds:
//   { renderer, scene, camera, render, bloom, ship, chigKit, flight,
//     lights: { key, rim }, sun, sunGlow, nebula, stars }

export function createDebug(ctx) {
  const { renderer, scene, camera, render, bloom, ship, chigKit, flight, thrusters, lights, sun, sunGlow, nebula, stars } =
    ctx;

  let mode = 'flight'; // 'flight' | 'hammerhead' | 'chig'
  const ui = { spin: false };
  const SPIN_SPEED = 0.4; // rad/s turntable

  let viewer = null; // lazily-built { plane, key, fill, controls }
  let chig = null; // lazily-cloned chig instance
  const saved = {}; // flight-scene state captured when leaving flight

  // --- lazy viewer rig: shadow-catching ground plane + neutral key/fill + orbit camera --------
  function buildViewer() {
    if (viewer) return viewer;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(2000, 2000),
      new THREE.MeshStandardMaterial({ color: 0x555a63, roughness: 0.95, metalness: 0 }),
    );
    plane.rotation.x = -Math.PI / 2; // lie flat (normal +Y)
    plane.receiveShadow = true;
    plane.visible = false;
    scene.add(plane);

    const key = new THREE.DirectionalLight(0xffffff, 2.4); // neutral white sun, casts the shadow
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0005;
    key.visible = false;
    scene.add(key);
    scene.add(key.target);

    const fill = new THREE.HemisphereLight(0xffffff, 0x40464f, 0.75); // soft fill so the dark side reads
    fill.visible = false;
    scene.add(fill);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enabled = false;

    viewer = { plane, key, fill, controls };
    return viewer;
  }

  function activeModel() {
    if (mode === 'hammerhead') return ship.pivot;
    if (mode === 'chig') return chig;
    return null;
  }

  // Rest a model on the y=0 plane, frame the camera + orbit target on it, and aim the shadow.
  // `placed` is the object we move/spin; `boxSource` is the hull we measure (so stray children
  // like thruster plumes don't skew the fit); `radius` is the model's nominal size.
  function layoutModel(placed, boxSource, radius) {
    placed.position.set(0, 0, 0);
    placed.quaternion.identity();
    placed.updateMatrixWorld(true);

    let box = new THREE.Box3().setFromObject(boxSource);
    placed.position.y -= box.min.y; // bottom sits on the plane
    placed.updateMatrixWorld(true);

    boxSource.traverse((o) => {
      if (o.isMesh) o.castShadow = true;
    });

    box = new THREE.Box3().setFromObject(boxSource);
    const center = box.getCenter(new THREE.Vector3());
    const span = box.getSize(new THREE.Vector3()).length();

    const v = viewer;
    v.key.position.set(center.x - radius * 3, center.y + radius * 5, center.z + radius * 4);
    v.key.target.position.copy(center);
    v.key.target.updateMatrixWorld();
    const sc = v.key.shadow.camera;
    const r = Math.max(span * 0.7, radius * 2);
    sc.left = -r;
    sc.right = r;
    sc.top = r;
    sc.bottom = -r;
    sc.near = 0.5;
    sc.far = radius * 40;
    sc.updateProjectionMatrix();

    v.controls.target.copy(center);
    camera.position.copy(center).add(new THREE.Vector3(span * 0.55, span * 0.3, span * 0.8));
    v.controls.update();
  }

  function enterViewer(which) {
    buildViewer();
    if (mode === 'flight') {
      // capture flight state once, on the way out
      saved.env = scene.environment;
      saved.bloom = bloom.strength;
      saved.shipPos = ship.pivot.position.clone();
      saved.shipQuat = ship.pivot.quaternion.clone();
    }

    flight.setEnabled(false);
    if (thrusters?.group) thrusters.group.visible = false; // hide the frozen engine plumes
    nebula.mesh.visible = false;
    stars.visible = false;
    sun.visible = false;
    sunGlow.visible = false;
    lights.key.visible = false;
    lights.rim.visible = false;
    scene.environment = null; // neutral lighting — no nebula reflections
    bloom.strength = 0.15; // keep a touch for emissives, no over-glow under bright light

    viewer.plane.visible = true;
    viewer.key.visible = true;
    viewer.fill.visible = true;
    viewer.controls.enabled = true;

    if (which === 'hammerhead') {
      if (chig) chig.visible = false;
      ship.pivot.visible = true;
      layoutModel(ship.pivot, ship.model, ship.radius);
    } else {
      if (!chig) {
        chig = spawnChig(chigKit.template);
        scene.add(chig);
      }
      ship.pivot.visible = false;
      chig.visible = true;
      layoutModel(chig, chig, chigKit.radius);
    }
  }

  function enterFlight() {
    nebula.mesh.visible = true;
    stars.visible = true;
    sun.visible = true;
    sunGlow.visible = true;
    lights.key.visible = true;
    lights.rim.visible = true;
    ship.pivot.visible = true;
    if (thrusters?.group) thrusters.group.visible = true;
    if (viewer) {
      viewer.plane.visible = false;
      viewer.key.visible = false;
      viewer.fill.visible = false;
      viewer.controls.enabled = false;
    }
    if (chig) chig.visible = false;
    if ('env' in saved) scene.environment = saved.env;
    if ('bloom' in saved) bloom.strength = saved.bloom;
    if (saved.shipPos) {
      ship.pivot.position.copy(saved.shipPos);
      ship.pivot.quaternion.copy(saved.shipQuat);
    }
    flight.setEnabled(true);
  }

  function setMode(next) {
    if (next === mode) return;
    if (next === 'flight') enterFlight();
    else enterViewer(next);
    mode = next;
  }

  // Add the View folder + move the whole panel to the top-left so the FPS counter (top-right) shows.
  function attachGui(gui) {
    gui.domElement.style.left = '0px';
    gui.domElement.style.right = 'auto';

    const view = gui.addFolder('View');
    const buttons = {
      Flight: () => setMode('flight'),
      Hammerhead: () => setMode('hammerhead'),
      Chig: () => setMode('chig'),
    };
    view.add(buttons, 'Flight');
    view.add(buttons, 'Hammerhead');
    view.add(buttons, 'Chig');
    view.add(ui, 'spin').name('auto-spin');
    view.open();
  }

  // Called at the top of the render loop. Returns true when it owns the frame (viewer modes),
  // false in flight mode so main.js runs its normal loop untouched.
  function frame(dt) {
    if (mode === 'flight') return false;
    const obj = activeModel();
    if (obj && ui.spin) obj.rotateY(SPIN_SPEED * dt);
    if (viewer) viewer.controls.update();
    render();
    return true;
  }

  return {
    attachGui,
    setMode,
    frame,
    get mode() {
      return mode;
    },
  };
}
