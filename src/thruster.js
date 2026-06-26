import * as THREE from 'three';

// Two symmetric engine plumes. Each is an additive cone (bright at the nozzle, fading to nothing at
// the tip via vertex colours, so it points truly backward) plus a round additive core sprite for a
// bloom hotspot. The pair is mirrored across the ship centerline (local X); the offset + size are
// live-tunable (see the lil-gui panel in main.js) so the nozzles can be lined up by hand.

function radialSprite(colorStops) {
  const s = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  for (const [o, c] of colorStops) g.addColorStop(o, c);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeConeGeometry(coreColor, tipColor) {
  const geo = new THREE.ConeGeometry(1, 1, 20, 1, true); // open cone, apex at +Y
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const a = new THREE.Color(coreColor);
  const b = new THREE.Color(tipColor);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = THREE.MathUtils.clamp(pos.getY(i) + 0.5, 0, 1); // 0 base -> 1 apex
    c.copy(a).lerp(b, Math.pow(t, 0.7));
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

export function createThrusters(pivot, nozzles, rearDir, shipRadius) {
  const rear = rearDir.clone().normalize();
  // Centerline base (x forced to 0) so the two plumes mirror symmetrically across X — a clean,
  // predictable layout the sliders fine-tune.
  const base = nozzles
    .reduce((a, n) => a.add(n.clone()), new THREE.Vector3())
    .multiplyScalar(1 / Math.max(1, nozzles.length));
  base.x = 0;

  // live-tunable; symmetric X-mirror about the centerline (defaults hand-tuned in-browser)
  const params = { offsetX: 0.4, offsetY: -0.1, offsetZ: 1.45, length: 1, width: 0.4, intensity: 1 };

  const coreTex = radialSprite([
    [0.0, 'rgba(255,255,255,1)'],
    [0.3, 'rgba(150,230,255,0.85)'],
    [0.7, 'rgba(60,120,255,0.3)'],
    [1.0, 'rgba(0,0,40,0)'],
  ]);
  const coneGeo = makeConeGeometry(0xff9a5a, 0x000010); // warm core fading to nothing
  const coneQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), rear);

  const group = new THREE.Group();
  const units = [];
  for (const side of [-1, 1]) {
    const cone = new THREE.Mesh(
      coneGeo,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    cone.quaternion.copy(coneQuat);
    cone.frustumCulled = false;
    group.add(cone);

    const core = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: coreTex,
        color: 0x9fe6ff,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
      }),
    );
    group.add(core);

    units.push({ side, cone, core, pos: new THREE.Vector3(), seed: side * 3.1 + 1.7 });
  }
  pivot.add(group);

  function layout() {
    for (const u of units) {
      u.pos.set(
        base.x + u.side * params.offsetX,
        base.y + params.offsetY,
        base.z + params.offsetZ,
      );
      u.core.position.copy(u.pos);
    }
  }
  layout();

  let t = 0;
  function update(intensity, dt) {
    t += dt;
    const i = Math.max(0, intensity) * params.intensity;
    for (const u of units) {
      const flick = 0.9 + 0.1 * Math.sin(t * 37 + u.seed) + 0.04 * Math.sin(t * 91 + u.seed * 2.3);
      const len = shipRadius * (0.25 + 0.95 * i) * params.length * flick;
      const wid = shipRadius * 0.09 * params.width * (0.7 + 0.3 * i);
      u.cone.scale.set(wid, len, wid);
      u.cone.position.copy(u.pos).addScaledVector(rear, len * 0.5);
      u.cone.material.opacity = Math.min(1, 0.4 + 0.7 * i) * flick;

      const cs = shipRadius * 0.12 * params.width * (0.55 + 0.7 * i) * flick;
      u.core.scale.setScalar(cs);
      u.core.material.opacity = Math.min(1, 0.45 + 0.6 * i);
    }
  }

  function setParams(p) {
    Object.assign(params, p);
    layout();
  }

  return { group, update, setParams, params };
}
