import { getConfig, getPlayer, isSignedIn, signInWithGoogle, signInWithFacebook, signOut, onSessionChange } from './social/auth.js';
import { getLeaderboard } from './social/leaderboard.js';

// Top-right "pilot bar": sign-in status / sign-in buttons + a Leaderboard button (opens an overlay). Lives
// here, globally, so the multiplayer pane stays focused on configuring + launching a game. Shown while in
// the menu, hidden in flight.

function el(tag, css, parent) {
  const e = document.createElement(tag);
  if (css) e.style.cssText = css;
  if (parent) parent.appendChild(e);
  return e;
}
const PANEL = 'background:rgba(12,14,22,0.62);border:1px solid rgba(150,180,255,0.12);border-radius:12px;backdrop-filter:blur(10px);';
const FONT = 'font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#cdd6ea;';
const BTN = `${FONT}font-size:12px;cursor:pointer;padding:6px 11px;background:rgba(150,180,255,0.08);`
  + 'border:1px solid rgba(150,180,255,0.22);border-radius:8px;transition:all 0.12s;';
const BTN_ON = 'background:rgba(120,170,255,0.32);border-color:rgba(170,210,255,0.7);color:#fff;';

export function createPilotBar() {
  const bar = el('div', `position:fixed;top:12px;right:14px;z-index:210;display:none;align-items:center;gap:7px;padding:7px 10px;${PANEL}`, document.body);
  let cfg = {};
  getConfig().then((c) => { cfg = c || {}; render(); });

  // --- leaderboard overlay ---
  const lbRoot = el('div', 'position:fixed;inset:0;z-index:220;display:none;align-items:center;justify-content:center;pointer-events:none;', document.body);
  const lbPanel = el('div', `width:min(440px,92vw);max-height:80vh;overflow-y:auto;padding:22px 24px;pointer-events:auto;${PANEL}${FONT}border-radius:16px;display:flex;flex-direction:column;gap:12px;box-shadow:0 0 50px rgba(0,0,0,0.55);`, lbRoot);
  el('div', `${FONT}font-size:18px;letter-spacing:0.16em;color:#eaeefc;`, lbPanel).textContent = 'LEADERBOARD';
  const lbToggles = el('div', 'display:flex;gap:6px;flex-wrap:wrap;', lbPanel);
  const lbList = el('div', 'display:flex;flex-direction:column;gap:2px;', lbPanel);
  let lbMetric = 'wave', lbScope = 'global';
  let tWave, tKills, tGlobal, tFriends;
  const tStyle = (on) => BTN + 'padding:4px 10px;' + (on ? BTN_ON : '');
  function paintToggles() {
    tWave.style.cssText = tStyle(lbMetric === 'wave'); tKills.style.cssText = tStyle(lbMetric === 'kills');
    tGlobal.style.cssText = tStyle(lbScope === 'global'); tFriends.style.cssText = tStyle(lbScope === 'friends');
  }
  const mkT = (text, fn) => { const b = el('button', BTN + 'padding:4px 10px;', lbToggles); b.textContent = text; b.onclick = () => { fn(); paintToggles(); renderLb(); }; return b; };
  tWave = mkT('Wave', () => { lbMetric = 'wave'; });
  tKills = mkT('Kills', () => { lbMetric = 'kills'; });
  tGlobal = mkT('Global', () => { lbScope = 'global'; });
  tFriends = mkT('Friends', () => { lbScope = 'friends'; });
  async function renderLb() {
    lbList.innerHTML = '';
    const rows = await getLeaderboard(lbMetric, lbScope);
    if (!rows.length) { el('div', `${FONT}font-size:12px;color:#8a96b4;`, lbList).textContent = lbScope === 'friends' ? 'no friends on the board yet' : 'no scores yet'; return; }
    rows.forEach((r, i) => {
      const row = el('div', 'display:flex;gap:10px;padding:3px 0;border-bottom:1px solid rgba(150,180,255,0.06);', lbList);
      el('span', `${FONT}font-size:12px;color:#8a96b4;width:22px;`, row).textContent = `${i + 1}.`;
      el('span', `${FONT}flex:1;font-size:13px;color:#cdd6ea;`, row).textContent = r.callsign || r.display_name || 'Pilot';
      el('span', `${FONT}font-size:13px;color:#9ec7ff;`, row).textContent = lbMetric === 'kills' ? `${r.total_kills}` : `wave ${r.best_wave}`;
    });
  }
  const close = el('button', BTN + 'align-self:flex-end;', lbPanel); close.textContent = 'Close';
  close.onclick = () => { lbRoot.style.display = 'none'; };
  lbRoot.addEventListener('click', (e) => { if (e.target === lbRoot) lbRoot.style.display = 'none'; });
  function openLb() { paintToggles(); renderLb(); lbRoot.style.display = 'flex'; }

  // --- the bar itself ---
  function render() {
    bar.innerHTML = '';
    if (isSignedIn()) {
      const p = getPlayer() || {};
      el('span', `${FONT}font-size:12px;color:#bcd2ff;`, bar).textContent = `✦ ${p.callsign || p.display_name || 'Pilot'}`;
      const lbB = el('button', BTN, bar); lbB.textContent = '🏆 Leaderboard'; lbB.onclick = openLb;
      const out = el('button', BTN, bar); out.textContent = 'Sign out'; out.onclick = () => signOut();
    } else {
      el('span', `${FONT}font-size:11px;color:#8a96b4;`, bar).textContent = 'Pilot:';
      if (cfg.googleClientId) { const g = el('button', BTN, bar); g.textContent = 'Google'; g.onclick = () => signInWithGoogle().catch(() => {}); }
      if (cfg.facebookAppId) { const f = el('button', BTN, bar); f.textContent = 'Facebook'; f.onclick = () => signInWithFacebook().catch(() => {}); }
      if (!cfg.googleClientId && !cfg.facebookAppId) el('span', `${FONT}font-size:11px;color:#8a96b4;`, bar).textContent = 'offline';
      const lbB = el('button', BTN, bar); lbB.textContent = '🏆'; lbB.title = 'Leaderboard'; lbB.onclick = openLb;
    }
  }
  render();
  onSessionChange(render);

  return {
    el: bar,
    show() { bar.style.display = 'flex'; },
    hide() { bar.style.display = 'none'; lbRoot.style.display = 'none'; },
  };
}
