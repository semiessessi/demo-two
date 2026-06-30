// Top-down weapon / ammo readout: a stylized SA-43 Hammerhead seen from above, with every weapon at its
// place — nose front-gun, tail rear-cannon, engine afterburner, and the 8 wing mounts (fuel + missiles) —
// each showing its ammo, and the CURRENTLY SELECTED weapon drawn green. Driven by weaponSelect.getHudState().
// A small 2D-canvas widget (LIDAR-style), flight-only.

const PANEL = 'background:rgba(12,14,22,0.55);border:1px solid rgba(150,180,255,0.1);border-radius:12px;backdrop-filter:blur(8px);';
const FONT = "11px ui-monospace,SFMono-Regular,Menlo,monospace";
const GREEN = '#7fd08a';
const ORD_COL = { 'missile-pair': '#ffb060', 'lr-missile': '#9ec7ff', laser: '#d59cff', fuel: '#8fe0a0', empty: '#3c465e' };

export function createWeaponHud() {
  const wrap = document.createElement('div');
  wrap.style.cssText = `position:fixed;left:18px;bottom:18px;z-index:48;padding:8px 9px 6px;${PANEL}display:none;`;
  document.body.appendChild(wrap);
  const W = 214, H = 184;
  const cv = document.createElement('canvas');
  cv.style.cssText = `display:block;width:${W}px;height:${H}px;`;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = W * dpr; cv.height = H * dpr;
  wrap.appendChild(cv);
  const g = cv.getContext('2d'); g.scale(dpr, dpr);

  const CX = 100; // fuselage centre x; nose points up (−y)
  // stylized mount positions (canvas px). Wings are forward-swept: tips sit higher (smaller y) than roots.
  const NODES = {
    gun:         { x: CX,      y: 14 },
    afterburner: { x: CX,      y: 150 },
    rear:        { x: CX,      y: 168 },
    fuelL: { x: CX - 17, y: 96 }, fuelR: { x: CX + 17, y: 96 },
    L1: { x: CX - 33, y: 92 }, L2: { x: CX - 53, y: 82 }, L3: { x: CX - 73, y: 70 },
    R1: { x: CX + 33, y: 92 }, R2: { x: CX + 53, y: 82 }, R3: { x: CX + 73, y: 70 },
  };
  const MOUNTS = ['fuelL', 'L1', 'L2', 'L3', 'fuelR', 'R1', 'R2', 'R3'];

  function shipPath() {
    // fuselage
    g.beginPath();
    g.moveTo(CX, 8);
    g.lineTo(CX - 9, 60); g.lineTo(CX - 11, 150); g.lineTo(CX - 6, 162);
    g.lineTo(CX + 6, 162); g.lineTo(CX + 11, 150); g.lineTo(CX + 9, 60);
    g.closePath();
    // wings (forward-swept)
    g.moveTo(CX - 7, 74); g.lineTo(CX - 82, 64); g.lineTo(CX - 80, 84); g.lineTo(CX - 7, 100); g.closePath();
    g.moveTo(CX + 7, 74); g.lineTo(CX + 82, 64); g.lineTo(CX + 80, 84); g.lineTo(CX + 7, 100); g.closePath();
  }

  function node(n, color, selected, ammo, dim, pulse) {
    if (!n) return;
    const r = selected ? 6 : 4.5;
    if (selected) {
      g.beginPath(); g.arc(n.x, n.y, r + 4 + (pulse || 0) * 2, 0, Math.PI * 2);
      g.strokeStyle = GREEN; g.lineWidth = 1.5; g.globalAlpha = 0.85; g.stroke(); g.globalAlpha = 1;
    }
    g.beginPath(); g.arc(n.x, n.y, r, 0, Math.PI * 2);
    g.fillStyle = selected ? GREEN : (dim ? 'rgba(90,104,134,0.5)' : color);
    g.fill();
    if (ammo != null) {
      g.fillStyle = selected ? GREEN : '#aeb9d4';
      g.font = FONT; g.textBaseline = 'middle';
      const right = n.x < CX;
      g.textAlign = right ? 'right' : 'left';
      g.fillText(String(ammo), n.x + (right ? -9 : 9), n.y);
    }
  }

  function update(s) {
    g.clearRect(0, 0, W, H);
    if (!s) return;
    const lo = s.loadout || {};
    const sel = s.selectedKey;
    const pulse = s.lock && s.lock.locked ? (0.5 + 0.5 * Math.sin(performance.now() * 0.012)) : 0;

    // silhouette
    shipPath();
    g.fillStyle = 'rgba(120,150,210,0.10)'; g.fill();
    g.strokeStyle = 'rgba(150,180,255,0.35)'; g.lineWidth = 1; g.stroke();

    // nose gun / tail rear / engine afterburner
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = FONT;
    node(NODES.gun, '#ffd27f', sel === 'gun', s.gunAmmo, s.gunAmmo === 0);
    node(NODES.rear, '#ffd27f', sel === 'rear', s.rearAmmo, s.rearAmmo === 0);
    // afterburner shows a fuel bar instead of a count
    const ab = NODES.afterburner, frac = s.fuelMax > 0 ? Math.max(0, Math.min(1, s.fuel / s.fuelMax)) : 0;
    node(ab, frac < 0.2 ? '#ff6a5a' : '#8fe0a0', sel === 'afterburner', null, false);
    g.fillStyle = 'rgba(150,180,255,0.18)'; g.fillRect(ab.x - 18, ab.y + 8, 36, 4);
    g.fillStyle = sel === 'afterburner' ? GREEN : (frac < 0.2 ? '#ff6a5a' : '#8fe0a0'); g.fillRect(ab.x - 18, ab.y + 8, 36 * frac, 4);

    // wing mounts
    for (const k of MOUNTS) {
      const ord = lo[k] || 'empty';
      const n = NODES[k];
      let ammo = null, selected = false;
      if (ord === 'missile-pair') { ammo = s.missilePair; selected = sel === 'missilePair'; }
      else if (ord === 'lr-missile') { ammo = s.lrMissile; selected = sel === 'lrMissile'; }
      else if (ord === 'fuel') { selected = sel === k; }
      node(n, ORD_COL[ord] || ORD_COL.empty, selected, ammo, ord === 'empty' || ammo === 0, selected ? pulse : 0);
    }

    // status line: selected weapon + lock state
    g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.font = FONT;
    let status = '';
    if (s.lock && (sel === 'missilePair' || sel === 'lrMissile')) {
      status = s.lock.locked ? 'LOCK' : (s.lock.target ? `LOCK ${Math.round(s.lock.progress * 100)}%` : 'no target');
    }
    if (status) {
      g.fillStyle = s.lock.locked ? GREEN : '#ffcaa0';
      g.fillText(status, 8, H - 4);
    }
  }

  return {
    el: wrap,
    update,
    setVisible(on) { wrap.style.display = on ? 'block' : 'none'; },
    dispose() { wrap.remove(); },
  };
}
