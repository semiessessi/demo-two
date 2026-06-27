import * as THREE from 'three';

// Debug-only visual editor for placement data that has no on-screen representation otherwise:
//   • DAMAGE ZONES — drawn as wireframe spheres (colour-coded by kind) at each zone's centre/radius.
//   • RCS PORTS    — drawn as a marker + a direction arrow showing where the exhaust shoots.
// Both attach under ship.pivot (local frame) so they track the ship in flight AND the model viewers.
// lil-gui controls move/resize each item live; "log → console" buttons print the current values as
// code/JSON to paste back into damage.js / rcs.js. Built only under the DEBUG flag.

const KIND_COLOR = {
  cockpit: 0x66ccff, engine: 0xff8a3a, wing: 0x9f7dff, gun: 0xffe04a, fuel: 0xff4a4a, fuselage: 0x66ff8c,
};

export function createEditor(gui, { ship, damage, rcs }) {
  const pivot = ship.pivot;
  const sphereGeo = new THREE.SphereGeometry(1, 16, 12);

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
    for (const { z, m } of zoneMeshes) { m.position.copy(z.center); m.scale.setScalar(z.radius); }
  }
  syncZones();

  const zf = gui.addFolder('Damage Zones (edit)');
  zf.add(zoneGroup, 'visible').name('show zones');
  for (const { z } of zoneMeshes) {
    const f = zf.addFolder(z.name);
    f.add(z.center, 'x', -8, 8, 0.05).onChange(syncZones);
    f.add(z.center, 'y', -8, 8, 0.05).onChange(syncZones);
    f.add(z.center, 'z', -8, 8, 0.05).onChange(syncZones);
    f.add(z, 'radius', 0.3, 6, 0.05).onChange(syncZones);
    f.add(z, 'maxHp', 5, 200, 5).name('max HP');
    f.close();
  }
  zf.add({
    log: () => {
      const lines = damage.zones.map((z) =>
        `  add('${z.name}', new THREE.Vector3(${z.center.x.toFixed(2)}, ${z.center.y.toFixed(2)}, ${z.center.z.toFixed(2)}), ${z.radius.toFixed(2)}, ${z.maxHp}, '${z.kind}');`);
      console.log('[damage zones]\n' + lines.join('\n'));
    },
  }, 'log').name('log zones → console');
  zf.close();

  // ---- RCS port gizmos --------------------------------------------------------------------------
  if (rcs) {
    const portGroup = new THREE.Group();
    portGroup.visible = false;
    pivot.add(portGroup);
    const markGeo = new THREE.OctahedronGeometry(0.28);
    const marks = rcs.ports.map((p) => {
      const mark = new THREE.Mesh(markGeo, new THREE.MeshBasicMaterial({ color: 0x9fe2ff, depthTest: false, transparent: true, opacity: 0.9 }));
      const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0x9fe2ff, depthTest: false }));
      mark.frustumCulled = line.frustumCulled = false;
      mark.renderOrder = line.renderOrder = 999;
      portGroup.add(mark);
      portGroup.add(line);
      return { p, mark, line };
    });
    const _a = new THREE.Vector3();
    const _b = new THREE.Vector3();
    const _d = new THREE.Vector3();
    function syncPorts() {
      for (const { p, mark, line } of marks) {
        _a.set(p.pos[0], p.pos[1], p.pos[2]);
        mark.position.copy(_a);
        _d.set(p.dir[0], p.dir[1], p.dir[2]);
        if (_d.lengthSq() < 1e-6) _d.set(0, 1, 0); else _d.normalize();
        _b.copy(_a).addScaledVector(_d, 2.2); // arrow length
        line.geometry.setFromPoints([_a, _b]);
      }
    }
    syncPorts();

    const pf = gui.addFolder('RCS Ports (edit)');
    pf.add(portGroup, 'visible').name('show ports');
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
      f.add(p, 'axis', ['pitch', 'yaw', 'roll']);
      f.close();
    });
    pf.add({
      log: () => {
        const lines = rcs.ports.map((p) =>
          `  { name: '${p.name}', pos: [${p.pos.map((v) => +v.toFixed(2)).join(', ')}], dir: [${p.dir.map((v) => +v.toFixed(2)).join(', ')}], axis: '${p.axis}' },`);
        console.log('[rcs ports]\nexport const RCS_PORTS = [\n' + lines.join('\n') + '\n];');
      },
    }, 'log').name('log ports → console');
    pf.close();
  }

  return { syncZones };
}
