import * as THREE from 'three';

// Debug-only visual editor for placement data that has no on-screen representation otherwise:
//   • DAMAGE ZONES — drawn as wireframe spheres (colour-coded by kind) at each zone's centre/radius.
//   • RCS PORTS    — drawn as the jet cone itself (apex along the exhaust dir) at full-fire size.
// Both attach under ship.pivot (local frame) so they track the ship in flight AND the model viewers.
// lil-gui controls move/resize each item live; "log → console" buttons print the current values as
// code/JSON to paste back into damage.js / rcs.js. Built only under the DEBUG flag.

const KIND_COLOR = {
  cockpit: 0x66ccff, engine: 0xff8a3a, wing: 0x9f7dff, gun: 0xffe04a, fuel: 0xff4a4a, fuselage: 0x66ff8c, canard: 0x4ad0ff,
};

export function createEditor(gui, { scene, ship, damage, rcs }) {
  const pivot = ship.pivot;
  const sphereGeo = new THREE.SphereGeometry(1, 16, 12);

  // Flat fill light so the hull is evenly lit for placing things (the shadowed sun makes it hard to
  // judge surface positions). Off by default; toggle while editing.
  if (scene) {
    const amb = new THREE.AmbientLight(0xffffff, 2.2);
    amb.visible = false;
    scene.add(amb);
    gui.add({ bright: false }, 'bright').name('bright (for placing)').onChange((v) => { amb.visible = v; });
  }

  // ---- damage zone gizmos -----------------------------------------------------------------------
  const zoneGroup = new THREE.Group();
  zoneGroup.visible = false;
  zoneGroup.renderOrder = 999;
  pivot.add(zoneGroup);
  const zoneMeshes = damage.zones.map((z) => {
    const mat = new THREE.MeshBasicMaterial({ color: KIND_COLOR[z.kind] || 0xffffff, wireframe: true, transparent: true, opacity: 0.45, depthTest: false });
    const m = new THREE.Mesh(sphereGeo, mat);
    m.frustumCulled = false;
    m.renderOrder = 999;
    zoneGroup.add(m);
    return { z, m };
  });
  function syncZones() {
    for (const { z, m } of zoneMeshes) { m.position.copy(z.center); m.scale.copy(z.radii); } // ellipsoid: per-axis
  }
  syncZones();

  // L/R mirror + focus highlight. Editing one side of a mirrored pair (L/R Engine, Wing, Fuel, Canard)
  // updates the other (X-flipped); opening a zone's folder highlights it (and optionally isolates it).
  const ui = { mirror: true, isolate: false };
  const byName = new Map(damage.zones.map((z) => [z.name, z]));
  const mirrorName = (n) => (n.startsWith('L ') ? 'R ' + n.slice(2) : n.startsWith('R ') ? 'L ' + n.slice(2) : null);
  const mirrorOf = (z) => { const mn = mirrorName(z.name); return mn ? byName.get(mn) : null; };
  function onZoneChange(z) {
    if (ui.mirror) {
      const p = mirrorOf(z);
      if (p) { p.center.set(-z.center.x, z.center.y, z.center.z); p.radii.copy(z.radii); p.maxHp = z.maxHp; }
    }
    syncZones();
  }
  let focusZone = null;
  function applyHighlight() {
    for (const { z, m } of zoneMeshes) {
      if (!focusZone) { m.visible = true; m.material.opacity = 0.45; }
      else if (z === focusZone) { m.visible = true; m.material.opacity = 0.95; }
      else { m.visible = !ui.isolate; m.material.opacity = 0.1; }
    }
  }

  const zf = gui.addFolder('Damage Zones (edit)');
  zf.add(zoneGroup, 'visible').name('show zones');
  zf.add(ui, 'mirror').name('mirror L/R edits');
  zf.add(ui, 'isolate').name('isolate focused').onChange(applyHighlight);
  for (const { z } of zoneMeshes) {
    const f = zf.addFolder(z.name);
    f.add(z.center, 'x', -8, 8, 0.05).onChange(() => onZoneChange(z)).listen();
    f.add(z.center, 'y', -8, 8, 0.05).onChange(() => onZoneChange(z)).listen();
    f.add(z.center, 'z', -8, 8, 0.05).onChange(() => onZoneChange(z)).listen();
    f.add(z.radii, 'x', 0.15, 6, 0.05).name('size x').onChange(() => onZoneChange(z)).listen();
    f.add(z.radii, 'y', 0.15, 6, 0.05).name('size y').onChange(() => onZoneChange(z)).listen();
    f.add(z.radii, 'z', 0.15, 6, 0.05).name('size z').onChange(() => onZoneChange(z)).listen();
    f.add(z, 'maxHp', 5, 200, 5).name('max HP').onChange(() => onZoneChange(z)).listen();
    f.onOpenClose((folder) => { focusZone = folder._closed ? null : z; applyHighlight(); }); // highlight the open zone
    f.close();
  }
  zf.add({
    log: () => {
      const lines = damage.zones.map((z) =>
        `  add('${z.name}', new THREE.Vector3(${z.center.x.toFixed(2)}, ${z.center.y.toFixed(2)}, ${z.center.z.toFixed(2)}), new THREE.Vector3(${z.radii.x.toFixed(2)}, ${z.radii.y.toFixed(2)}, ${z.radii.z.toFixed(2)}), ${z.maxHp}, '${z.kind}');`);
      console.log('[damage zones]\n' + lines.join('\n'));
    },
  }, 'log').name('log zones → console');
  zf.close();

  // ---- RCS port gizmos --------------------------------------------------------------------------
  if (rcs) {
    const portGroup = new THREE.Group();
    portGroup.visible = false;
    pivot.add(portGroup);
    // Show the actual JET (a cone, apex along the exhaust dir, base at the port) at a representative
    // full-fire size from the live jet radius/length — WYSIWYG instead of a marker + arrow.
    const coneGeo = new THREE.ConeGeometry(0.5, 1, 12, 1, true); // apex +Y, matches rcs.js
    const UP = new THREE.Vector3(0, 1, 0);
    const cones = rcs.ports.map((p) => {
      const mat = new THREE.MeshBasicMaterial({ color: 0x9fe2ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, side: THREE.DoubleSide, opacity: 0.8 });
      const cone = new THREE.Mesh(coneGeo, mat);
      cone.frustumCulled = false;
      cone.renderOrder = 999;
      portGroup.add(cone);
      return { p, cone };
    });
    const _dir = new THREE.Vector3();
    const _q = new THREE.Quaternion();
    function syncPorts() {
      const jr = rcs.jet ? rcs.jet.radius : 0.1;
      const jl = rcs.jet ? rcs.jet.length : 0.5;
      const len = 2.9 * jl; // a full-fire jet (preview); matches rcs.js update() at level 1
      const wid = 0.8 * jr;
      for (const { p, cone } of cones) {
        _dir.set(p.dir[0], p.dir[1], p.dir[2]);
        if (_dir.lengthSq() < 1e-6) _dir.set(0, 1, 0); else _dir.normalize();
        _q.setFromUnitVectors(UP, _dir);
        cone.quaternion.copy(_q);
        cone.scale.set(wid, len, wid);
        cone.position.set(p.pos[0], p.pos[1], p.pos[2]).addScaledVector(_dir, len * 0.5); // base at the port
      }
    }
    syncPorts();

    const pf = gui.addFolder('RCS Ports (edit)');
    pf.add(portGroup, 'visible').name('show ports (jets)');
    if (rcs.jet) {
      pf.add(rcs.jet, 'radius', 0.02, 1, 0.01).name('jet radius ×').onChange(syncPorts);
      pf.add(rcs.jet, 'length', 0.1, 2, 0.05).name('jet length ×').onChange(syncPorts);
      pf.add(rcs.jet, 'gain', 0.2, 8, 0.1).name('jet gain');
    }
    rcs.ports.forEach((p) => {
      const f = pf.addFolder(p.name);
      const proxy = { x: p.pos[0], y: p.pos[1], z: p.pos[2], dx: p.dir[0], dy: p.dir[1], dz: p.dir[2] };
      const writePos = () => { p.pos[0] = proxy.x; p.pos[1] = proxy.y; p.pos[2] = proxy.z; syncPorts(); };
      const writeDir = () => { p.dir[0] = proxy.dx; p.dir[1] = proxy.dy; p.dir[2] = proxy.dz; syncPorts(); };
      f.add(proxy, 'x', -8, 8, 0.05).onChange(writePos);
      f.add(proxy, 'y', -8, 8, 0.05).onChange(writePos);
      f.add(proxy, 'z', -8, 8, 0.05).onChange(writePos);
      f.add(proxy, 'dx', -1, 1, 0.05).name('dir x').onChange(writeDir);
      f.add(proxy, 'dy', -1, 1, 0.05).name('dir y').onChange(writeDir);
      f.add(proxy, 'dz', -1, 1, 0.05).name('dir z').onChange(writeDir);
      f.close();
    });
    pf.add({
      log: () => {
        const lines = rcs.ports.map((p) =>
          `  { name: '${p.name}', pos: [${p.pos.map((v) => +v.toFixed(2)).join(', ')}], dir: [${p.dir.map((v) => +v.toFixed(2)).join(', ')}] },`);
        console.log('[rcs ports]\nexport const RCS_PORTS = [\n' + lines.join('\n') + '\n];');
      },
    }, 'log').name('log ports → console');
    pf.close();
  }

  return { syncZones };
}
