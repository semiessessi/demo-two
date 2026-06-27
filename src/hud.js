import * as THREE from 'three';

// DOM combat HUD (self-building, dark glassy style): subsystem health bars, wave + kill counters, a
// crosshair, a square-grid LIDAR with up/down arrows, the eject hold-prompt, and the MISSION OVER
// overlay with Restart. update() is called each frame with the live combat state.

function el(tag, css, parent) {
  const e = document.createElement(tag);
  if (css) e.style.cssText = css;
  if (parent) parent.appendChild(e);
  return e;
}

const PANEL = 'background:rgba(12,14,22,0.55);border:1px solid rgba(150,180,255,0.1);border-radius:14px;backdrop-filter:blur(8px);';
const FONT = 'font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#cdd6ea;';

export function createHud(damage, opts = {}) {
  const onRestart = opts.onRestart || (() => {});

  // crosshair (follows the gun aim) + a target lock reticle
  const cross = el('div', 'position:fixed;left:50%;top:50%;width:26px;height:26px;transform:translate(-50%,-50%);'
    + 'border:1.5px solid rgba(170,210,255,0.7);border-radius:50%;pointer-events:none;z-index:50;'
    + 'box-shadow:0 0 6px rgba(120,170,255,0.5);', document.body);
  el('div', 'position:absolute;left:50%;top:50%;width:3px;height:3px;transform:translate(-50%,-50%);border-radius:50%;background:#dff;', cross);
  const reticle = el('div', 'position:fixed;left:50%;top:50%;width:42px;height:42px;transform:translate(-50%,-50%);'
    + 'border:2px solid rgba(255,90,90,0.85);border-radius:7px;pointer-events:none;z-index:51;display:none;'
    + 'box-shadow:0 0 9px rgba(255,80,80,0.45);', document.body);

  // counters (top-left)
  const counters = el('div', `position:fixed;top:12px;left:14px;padding:8px 12px;${PANEL}${FONT}`
    + 'font-size:13px;line-height:1.5;letter-spacing:0.04em;z-index:50;', document.body);
  const waveEl = el('div', '', counters);
  const killsEl = el('div', 'color:#7fd08a;', counters);

  // subsystem bars (bottom-left)
  const sub = el('div', `position:fixed;bottom:120px;left:14px;padding:10px 12px;${PANEL}${FONT}`
    + 'font-size:11px;z-index:50;width:150px;', document.body);
  el('div', 'font-size:10px;letter-spacing:0.14em;color:#9fb0d0;margin-bottom:6px;', sub).textContent = 'HULL INTEGRITY';
  const bars = damage.zones.map((z) => {
    const row = el('div', 'display:flex;align-items:center;gap:7px;margin:3px 0;', sub);
    el('span', 'width:64px;color:#aeb9d4;', row).textContent = z.name;
    const track = el('div', 'flex:1;height:6px;background:rgba(255,255,255,0.08);border-radius:3px;overflow:hidden;', row);
    const fill = el('div', 'height:100%;width:100%;background:#5fd07f;border-radius:3px;transition:width 0.1s linear;', track);
    return { z, fill };
  });

  // LIDAR (bottom-right)
  const SIZE = 188;
  const lwrap = el('div', `position:fixed;bottom:24px;right:18px;padding:8px;${PANEL}z-index:50;`, document.body);
  el('div', `font-size:10px;letter-spacing:0.14em;color:#9fb0d0;${FONT}margin:0 0 5px 2px;`, lwrap).textContent = 'LIDAR';
  const lidar = el('canvas', 'display:block;border-radius:8px;', lwrap);
  lidar.width = SIZE;
  lidar.height = SIZE;
  const lx = lidar.getContext('2d');
  const LRANGE = 360; // world units mapped to the grid half-extent

  // eject prompt (centred, hidden until holding J)
  const ejectWrap = el('div', 'position:fixed;left:50%;top:62%;transform:translateX(-50%);z-index:60;'
    + 'display:none;flex-direction:column;align-items:center;gap:8px;pointer-events:none;', document.body);
  const ring = el('canvas', '', ejectWrap);
  ring.width = ring.height = 64;
  const rx = ring.getContext('2d');
  el('div', `${FONT}font-size:13px;letter-spacing:0.1em;color:#ffd27a;`, ejectWrap).textContent = 'EJECTING…';

  // MISSION OVER overlay
  const over = el('div', 'position:fixed;inset:0;z-index:300;display:none;flex-direction:column;'
    + 'align-items:center;justify-content:center;gap:22px;background:rgba(3,3,8,0.72);backdrop-filter:blur(4px);', document.body);
  const overTitle = el('div', `${FONT}font-size:34px;letter-spacing:0.16em;color:#eaeefc;text-shadow:0 0 18px rgba(120,170,255,0.4);`, over);
  const overSub = el('div', `${FONT}font-size:14px;color:#9fb0d0;`, over);
  const restartBtn = el('button', `${FONT}font-size:15px;color:#eaeefc;cursor:pointer;padding:12px 26px;`
    + 'background:rgba(150,180,255,0.1);border:1px solid rgba(150,180,255,0.3);border-radius:999px;', over);
  restartBtn.textContent = 'Restart';
  restartBtn.onclick = () => onRestart();

  // --- LIDAR draw ---
  const inv = new THREE.Quaternion();
  const rel = new THREE.Vector3();
  function drawLidar(enemies, player) {
    lx.clearRect(0, 0, SIZE, SIZE);
    const c = SIZE / 2;
    // grid
    lx.strokeStyle = 'rgba(120,160,255,0.14)';
    lx.lineWidth = 1;
    for (let i = 1; i < 8; i++) {
      const o = (SIZE / 8) * i;
      lx.beginPath(); lx.moveTo(o, 0); lx.lineTo(o, SIZE); lx.moveTo(0, o); lx.lineTo(SIZE, o); lx.stroke();
    }
    lx.strokeStyle = 'rgba(120,160,255,0.35)';
    lx.strokeRect(0.5, 0.5, SIZE - 1, SIZE - 1);
    // player marker (centre, pointing up = forward)
    lx.fillStyle = '#7fd08a';
    lx.beginPath(); lx.moveTo(c, c - 6); lx.lineTo(c - 4, c + 4); lx.lineTo(c + 4, c + 4); lx.closePath(); lx.fill();

    inv.copy(player.quat).invert();
    for (const e of enemies) {
      if (!e.alive) continue;
      rel.copy(e.pos).sub(player.pos).applyQuaternion(inv); // into player-local frame
      const gx = c + (rel.x / LRANGE) * c;
      const gy = c - (-rel.z / LRANGE) * c; // forward (-Z) -> up on the grid
      const cx = THREE.MathUtils.clamp(gx, 4, SIZE - 4);
      const cy = THREE.MathUtils.clamp(gy, 4, SIZE - 4);
      const edge = gx !== cx || gy !== cy;
      lx.fillStyle = edge ? 'rgba(255,90,90,0.6)' : '#ff5a5a';
      lx.beginPath(); lx.arc(cx, cy, edge ? 2 : 3, 0, Math.PI * 2); lx.fill();
      // up/down arrow for vertical separation
      const vy = rel.y;
      if (Math.abs(vy) > 6) {
        const up = vy > 0;
        const a = THREE.MathUtils.clamp(Math.abs(vy) / 120, 0.3, 1);
        lx.fillStyle = up ? `rgba(120,220,255,${a})` : `rgba(255,170,90,${a})`;
        const ay = cy + (up ? -7 : 7);
        lx.beginPath();
        if (up) { lx.moveTo(cx, ay - 3); lx.lineTo(cx - 3, ay + 2); lx.lineTo(cx + 3, ay + 2); }
        else { lx.moveTo(cx, ay + 3); lx.lineTo(cx - 3, ay - 2); lx.lineTo(cx + 3, ay - 2); }
        lx.closePath(); lx.fill();
      }
    }
  }

  function drawRing(t) {
    rx.clearRect(0, 0, 64, 64);
    rx.strokeStyle = 'rgba(255,255,255,0.15)';
    rx.lineWidth = 5;
    rx.beginPath(); rx.arc(32, 32, 26, 0, Math.PI * 2); rx.stroke();
    rx.strokeStyle = '#ffd27a';
    rx.beginPath(); rx.arc(32, 32, 26, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * t); rx.stroke();
  }

  function update({ waves, enemies, player, ejectProgress = 0 }) {
    waveEl.textContent = `WAVE ${waves?.wave ?? 0}`;
    killsEl.textContent = `KILLS ${opts.getKills ? opts.getKills() : 0}`;
    for (const b of bars) {
      const f = Math.max(0, b.z.hp / b.z.maxHp);
      b.fill.style.width = `${f * 100}%`;
      b.fill.style.background = f > 0.5 ? '#5fd07f' : f > 0.2 ? '#e7c14a' : '#e7564a';
    }
    if (enemies && player) drawLidar(enemies, player);
    if (ejectProgress > 0 && ejectProgress < 1) {
      ejectWrap.style.display = 'flex';
      drawRing(ejectProgress);
    } else {
      ejectWrap.style.display = 'none';
    }
  }

  function showMissionOver(title, sub) {
    overTitle.textContent = title;
    overSub.textContent = sub || '';
    over.style.display = 'flex';
  }
  function hideMissionOver() {
    over.style.display = 'none';
  }
  // Hide/show the in-flight HUD (used by the pre-game menu). Leaves the MISSION OVER overlay alone.
  function setVisible(on) {
    const d = on ? '' : 'none';
    cross.style.display = d;
    counters.style.display = d;
    sub.style.display = d;
    lwrap.style.display = d;
    if (!on) reticle.style.display = 'none';
  }
  function setAim(x, y) {
    cross.style.left = x == null ? '50%' : `${x}px`;
    cross.style.top = x == null ? '50%' : `${y}px`;
  }
  function setTarget(x, y, on) {
    reticle.style.display = on ? 'block' : 'none';
    if (on) {
      reticle.style.left = `${x}px`;
      reticle.style.top = `${y}px`;
    }
  }

  return { update, showMissionOver, hideMissionOver, setVisible, setAim, setTarget };
}
