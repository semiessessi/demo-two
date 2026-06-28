import * as THREE from 'three';

// Target computer: a small panel (mirrors the LIDAR styling, stacked above it) that renders the
// currently selected enemy as a cyan WIREFRAME, oriented to show its attitude relative to the player
// (so you see its nose when it turns to face you, its tail when it runs). Identified by name +
// a unique hash so a specific fighter can be tracked. Its own tiny WebGL renderer keeps it isolated
// from the main composer/bloom pipeline.

function el(tag, css, parent) {
  const e = document.createElement(tag);
  if (css) e.style.cssText = css;
  if (parent) parent.appendChild(e);
  return e;
}

const PANEL = 'background:rgba(12,14,22,0.55);border:1px solid rgba(150,180,255,0.1);border-radius:14px;backdrop-filter:blur(8px);';
const FONT = 'font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#cdd6ea;';
const SIZE = 188; // match the LIDAR

export function createTargetDisplay(chigTemplate) {
  const wrap = el('div', `position:fixed;bottom:266px;right:18px;padding:8px;${PANEL}z-index:50;width:${SIZE}px;display:none;`, document.body);
  el('div', `font-size:10px;letter-spacing:0.14em;color:#9fb0d0;${FONT}margin:0 0 5px 2px;`, wrap).textContent = 'TARGET';
  const canvas = el('canvas', 'display:block;border-radius:8px;background:rgba(8,10,16,0.55);', wrap);
  canvas.width = SIZE;
  canvas.height = SIZE;
  const label = el('div', `font-size:12px;${FONT}margin:6px 2px 0;color:#e3b04b;letter-spacing:0.03em;`, wrap);
  const sub = el('div', `font-size:10px;${FONT}margin:2px 2px 0;color:#8fa0c0;letter-spacing:0.04em;`, wrap);

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(SIZE, SIZE, false);
  renderer.setClearAlpha(0);
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(38, 1, 0.1, 400);

  // a faint reference ring on the player's view plane, so the target's roll/pitch reads against it
  const ring = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(
      Array.from({ length: 48 }, (_, i) => {
        const a = (i / 48) * Math.PI * 2;
        return new THREE.Vector3(Math.cos(a), Math.sin(a), 0);
      }),
    ),
    new THREE.LineBasicMaterial({ color: 0x2b3a5a, transparent: true, opacity: 0.5 }),
  );
  scene.add(ring);

  // cyan wireframe clone of the Chig (glows/sprites hidden)
  const wire = chigTemplate.clone(true);
  wire.traverse((o) => {
    if (o.isSprite) o.visible = false;
    else if (o.isMesh) o.material = new THREE.MeshBasicMaterial({ color: 0x8fe9ff, wireframe: true, transparent: true, opacity: 0.85 });
  });
  const holder = new THREE.Group();
  holder.add(wire);
  scene.add(holder);

  // frame the model
  const sphere = new THREE.Box3().setFromObject(wire).getBoundingSphere(new THREE.Sphere());
  const r = sphere.radius || 2.2;
  ring.scale.setScalar(r * 1.35);
  cam.position.set(0, r * 0.55, r * 3.4);
  cam.lookAt(0, 0, 0);

  const invP = new THREE.Quaternion();
  const relQ = new THREE.Quaternion();

  function update(target, playerQuat, playerPos, locked) {
    if (!target || !target.alive) {
      wrap.style.opacity = '0.55';
      label.textContent = 'NO TARGET';
      sub.textContent = '— — — —';
      holder.visible = false;
      renderer.render(scene, cam);
      return;
    }
    wrap.style.opacity = '1';
    holder.visible = true;
    // attitude relative to the player's frame
    invP.copy(playerQuat).invert();
    relQ.copy(invP).multiply(target.obj.quaternion);
    holder.quaternion.copy(relQ);
    label.textContent = `${target.name} #${target.hash}`;
    const d = playerPos ? target.pos.distanceTo(playerPos) : 0;
    sub.textContent = `RANGE ${d.toFixed(0)}  ·  ${locked ? 'LOCKED' : 'AUTO'}`;
    renderer.render(scene, cam);
  }

  function dispose() {
    renderer.dispose();
    wrap.remove();
  }

  return { update, dispose, setVisible(v) { wrap.style.display = v ? 'block' : 'none'; } };
}
