import { DIFFICULTY, ENVIRONMENT, saveSettings } from './settings.js';
import { peerJsWorksHere } from './net/webrtc-detect.js';
import { isSignedIn, onSessionChange } from './social/auth.js';
import * as friends from './social/friends.js';
import { quickMatch, cancelQuickMatch } from './social/automatch.js';

// Pre-game / Multiplayer setup screen — a self-building DOM overlay (dark glassy style, matching the title
// menu). A WIDE two-column panel: ship setup (markings / difficulty / loadout) on the left, the match +
// social side (environment / co-op / friends) on the right, with LAUNCH across the bottom. Sign-in and the
// leaderboard live in the top-right pilot bar (pilotbar.js), NOT here. Edits write through to `settings` +
// localStorage and fire onChange (live preview on the ship behind the panel).

function el(tag, css, parent) {
  const e = document.createElement(tag);
  if (css) e.style.cssText = css;
  if (parent) parent.appendChild(e);
  return e;
}

const PANEL = 'background:rgba(12,14,22,0.62);border:1px solid rgba(150,180,255,0.12);border-radius:14px;backdrop-filter:blur(10px);';
const FONT = 'font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#cdd6ea;';
const LABEL = `${FONT}font-size:10px;letter-spacing:0.16em;color:#9fb0d0;margin:0 0 7px 2px;text-transform:uppercase;`;
const BTN = `${FONT}font-size:12px;cursor:pointer;padding:7px 12px;background:rgba(150,180,255,0.08);`
  + 'border:1px solid rgba(150,180,255,0.22);border-radius:8px;transition:all 0.12s;';
const BTN_ON = 'background:rgba(120,170,255,0.32);border-color:rgba(170,210,255,0.7);color:#fff;box-shadow:0 0 10px rgba(120,170,255,0.3);';
const SECT = 'background:rgba(255,255,255,0.02);border:1px solid rgba(150,180,255,0.08);border-radius:11px;padding:13px 14px;';

// thin, subtle scrollbar for the panel (inline CSS can't do ::-webkit-scrollbar, so inject once)
function injectStyle() {
  if (document.getElementById('pg-css')) return;
  const s = document.createElement('style'); s.id = 'pg-css';
  s.textContent = '#pg-panel::-webkit-scrollbar{width:7px}#pg-panel::-webkit-scrollbar-thumb{background:rgba(150,180,255,0.22);border-radius:4px}#pg-panel::-webkit-scrollbar-thumb:hover{background:rgba(150,180,255,0.38)}#pg-panel::-webkit-scrollbar-track{background:transparent}';
  document.head.appendChild(s);
}

const STATIONS = [
  { l: 'fuelL', r: 'fuelR', label: 'Fuel', opts: ['fuel', 'empty'] },
  { l: 'L1', r: 'R1', label: 'Inner', opts: ['missile-pair', 'lr-missile', 'empty'] },
  { l: 'L2', r: 'R2', label: 'Mid', opts: ['missile-pair', 'lr-missile', 'empty'] },
  { l: 'L3', r: 'R3', label: 'Tip', opts: ['lr-missile', 'laser', 'missile-pair', 'empty'] },
];
const ORD_LABEL = { fuel: 'Fuel tank', 'missile-pair': 'Missile pair', 'lr-missile': 'LR missile', laser: 'Laser', empty: 'Empty' };

export function createPregame({ settings, onLaunch, onChange, onHost, onJoin, onQuickMatch, onBack }) {
  injectStyle();
  const fire = () => { saveSettings(settings); if (onChange) onChange(settings); };

  const root = el('div', 'position:fixed;inset:0;z-index:200;display:none;pointer-events:none;', document.body);
  const panel = el('div', `position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);`
    + `width:min(780px,calc(100vw - 32px));max-height:calc(100vh - 40px);padding:22px 24px;overflow-y:auto;`
    + `pointer-events:auto;${PANEL}${FONT}border-radius:18px;box-shadow:0 0 50px rgba(0,0,0,0.55);`
    + 'scrollbar-width:thin;scrollbar-color:rgba(150,180,255,0.25) transparent;'
    + 'display:flex;flex-direction:column;gap:16px;', root);
  panel.id = 'pg-panel';

  // header (full width)
  const head = el('div', 'display:flex;align-items:center;gap:14px;', panel);
  if (onBack) { const back = el('button', BTN, head); back.textContent = '‹ Main Menu'; back.onclick = () => onBack(); }
  const titles = el('div', 'flex:1;', head);
  el('div', `${FONT}font-size:22px;letter-spacing:0.22em;color:#eaeefc;text-shadow:0 0 16px rgba(120,170,255,0.4);`, titles).textContent = 'MULTIPLAYER';
  el('div', `${FONT}font-size:11px;color:#8a96b4;margin-top:2px;`, titles).textContent = 'SA-43: Hammerhead · configure & launch';

  // two columns
  const cols = el('div', 'display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start;', panel);
  const colL = el('div', 'flex:1;min-width:280px;display:flex;flex-direction:column;gap:14px;', cols);
  const colR = el('div', 'flex:1;min-width:280px;display:flex;flex-direction:column;gap:14px;', cols);

  const section = (parent, title) => { const w = el('div', SECT, parent); el('div', LABEL, w).textContent = title; return w; };

  function segmented(parent, title, options, getCur, setCur) {
    const wrap = section(parent, title);
    const row = el('div', 'display:flex;flex-wrap:wrap;gap:6px;', wrap);
    const btns = [];
    options.forEach((o) => {
      const b = el('button', BTN, row);
      b.textContent = o.label;
      b.onclick = () => { setCur(o.key); paint(); fire(); };
      btns.push({ b, key: o.key });
    });
    function paint() { const cur = getCur(); btns.forEach(({ b, key }) => { b.style.cssText = BTN + (key === cur ? BTN_ON : ''); }); }
    paint();
    return { paint };
  }

  // ---- LEFT: Markings, Difficulty, Loadout ----
  const mk = section(colL, 'Markings');
  const mkRow = (labelText, key, placeholder) => {
    const r = el('div', 'display:flex;align-items:center;gap:8px;margin:4px 0;', mk);
    el('span', 'width:78px;font-size:11px;color:#aeb9d4;', r).textContent = labelText;
    const inp = el('input', `${FONT}flex:1;min-width:0;font-size:12px;padding:6px 8px;background:rgba(255,255,255,0.06);`
      + 'border:1px solid rgba(150,180,255,0.2);border-radius:7px;', r);
    inp.value = settings.livery[key] || '';
    inp.maxLength = 12; inp.placeholder = placeholder;
    inp.oninput = () => { settings.livery[key] = inp.value.toUpperCase(); inp.value = settings.livery[key]; fire(); };
    return inp;
  };
  mkRow('Callsign', 'callsign', 'VANSEN');
  mkRow('Squadron', 'squadron', 'WILDCARDS');
  const colorRow = el('div', 'display:flex;align-items:center;gap:8px;margin:4px 0;', mk);
  el('span', 'width:78px;font-size:11px;color:#aeb9d4;', colorRow).textContent = 'Livery';
  const color = el('input', 'width:40px;height:28px;padding:0;border:1px solid rgba(150,180,255,0.2);border-radius:6px;background:none;cursor:pointer;', colorRow);
  color.type = 'color'; color.value = settings.livery.color || '#7a8694';
  color.oninput = () => { settings.livery.color = color.value; fire(); };

  segmented(colL, 'Difficulty',
    Object.keys(DIFFICULTY).map((k) => ({ key: k, label: DIFFICULTY[k].label })),
    () => settings.difficulty, (k) => { settings.difficulty = k; });

  const lo = section(colL, 'Weapon mounts (mirrored L/R)');
  STATIONS.forEach((m) => {
    const r = el('div', 'display:flex;align-items:center;gap:8px;margin:3px 0;', lo);
    el('span', 'width:66px;font-size:11px;color:#aeb9d4;', r).textContent = m.label;
    const b = el('button', BTN + 'flex:1;text-align:left;', r);
    const paint = () => { b.textContent = ORD_LABEL[settings.loadout[m.l]] || 'Empty'; };
    b.onclick = () => { const i = m.opts.indexOf(settings.loadout[m.l]); const next = m.opts[(i + 1) % m.opts.length]; settings.loadout[m.l] = next; settings.loadout[m.r] = next; paint(); fire(); };
    paint();
  });

  // ---- RIGHT: Environment, Co-op, Friends ----
  segmented(colR, 'Environment',
    Object.keys(ENVIRONMENT).map((k) => ({ key: k, label: ENVIRONMENT[k].label })),
    () => settings.environment, (k) => { settings.environment = k; });

  let coopStatus = null;
  let hostCode = null;
  if (peerJsWorksHere() && (onHost || onJoin)) {
    const co = section(colR, 'Co-op (beta)');
    const row = el('div', 'display:flex;gap:6px;', co);
    const hostBtn = el('button', BTN + 'flex:1;', row); hostBtn.textContent = 'Host';
    const codeInp = el('input', `${FONT}flex:1;min-width:0;font-size:12px;padding:6px 8px;text-transform:uppercase;`
      + 'background:rgba(255,255,255,0.06);border:1px solid rgba(150,180,255,0.2);border-radius:7px;', row);
    codeInp.placeholder = 'CODE'; codeInp.maxLength = 5;
    const joinBtn = el('button', BTN, row); joinBtn.textContent = 'Join';
    coopStatus = el('div', `${FONT}font-size:11px;color:#9fb0d0;margin:6px 2px 0;white-space:pre-line;`, co);
    hostBtn.onclick = () => { if (onHost) { hostCode = onHost(); coopStatus.textContent = `Hosting — share code: ${hostCode}\nwaiting for players… then LAUNCH`; renderFriends(); } };
    joinBtn.onclick = () => { const c = codeInp.value.trim().toUpperCase(); if (c && onJoin) { onJoin(c); coopStatus.textContent = `Joining ${c}…\nwait for the host to launch`; } };
    if (onQuickMatch) {
      const qmRow = el('div', 'display:flex;margin-top:6px;', co);
      const qmBtn = el('button', BTN + 'flex:1;', qmRow); qmBtn.textContent = 'Quick Match';
      let searching = false;
      qmBtn.onclick = async () => {
        if (searching) { searching = false; cancelQuickMatch(); qmBtn.textContent = 'Quick Match'; coopStatus.textContent = ''; return; }
        if (!isSignedIn()) { coopStatus.textContent = 'sign in (top-right) to use Quick Match'; return; }
        searching = true; qmBtn.textContent = 'Cancel'; coopStatus.textContent = 'Searching for a match…';
        const m = await quickMatch('coop:' + settings.difficulty, { onWaiting: (n) => { if (searching) coopStatus.textContent = `Searching… (${n} waiting)`; } });
        searching = false; qmBtn.textContent = 'Quick Match';
        if (m) { hostCode = m.role === 'host' ? m.room_code : null; onQuickMatch(m.role, m.room_code); coopStatus.textContent = m.role === 'host' ? `Matched — you host (${m.room_code}). Press LAUNCH.` : `Matched — joining ${m.room_code}…`; renderFriends(); }
        else coopStatus.textContent = 'No match — try again.';
      };
    }
  }

  const fr = section(colR, 'Friends');
  const frBody = el('div', '', fr);
  const addRow = el('div', 'display:flex;gap:6px;margin-top:4px;', fr);
  const addInp = el('input', `${FONT}flex:1;min-width:0;font-size:12px;padding:6px 8px;text-transform:uppercase;`
    + 'background:rgba(255,255,255,0.06);border:1px solid rgba(150,180,255,0.2);border-radius:7px;', addRow);
  addInp.placeholder = 'add by callsign';
  const addBtn = el('button', BTN, addRow); addBtn.textContent = 'Add';
  addBtn.onclick = async () => {
    const q = addInp.value.trim().toUpperCase(); if (q.length < 2) return;
    const found = await friends.searchPlayers(q);
    if (found[0]) { await friends.sendRequest(found[0].player_id); addInp.value = ''; renderFriends(); }
    else { addInp.value = ''; addInp.placeholder = 'no pilot found'; }
  };
  function frRow(label, actions) {
    const r = el('div', 'display:flex;align-items:center;gap:6px;margin:3px 0;', frBody);
    el('span', `${FONT}flex:1;min-width:0;font-size:12px;color:#cdd6ea;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`, r).textContent = label;
    for (const [txt, fn] of actions) { const b = el('button', BTN + 'padding:4px 8px;', r); b.textContent = txt; b.onclick = fn; }
  }
  async function renderFriends() {
    const on = isSignedIn();
    fr.style.display = on ? '' : 'none';
    if (!on) return;
    frBody.innerHTML = '';
    const [list, reqs, invs] = await Promise.all([friends.listFriends(), friends.listRequests('in'), friends.listInvites()]);
    for (const inv of invs) frRow(`✉ ${inv.from_callsign} → ${inv.room_code}`, [['Join', async () => { await friends.actInvite(inv.id, 'accept'); if (onJoin) onJoin(inv.room_code); renderFriends(); }], ['✕', async () => { await friends.actInvite(inv.id, 'decline'); renderFriends(); }]]);
    for (const rq of reqs) frRow(`${rq.callsign || rq.display_name} wants to be friends`, [['✓', async () => { await friends.actRequest(rq.id, 'accept'); renderFriends(); }], ['✕', async () => { await friends.actRequest(rq.id, 'decline'); renderFriends(); }]]);
    for (const f of list) {
      const actions = [];
      if (hostCode) actions.push(['Invite', async () => { await friends.sendInvite(f.player_id, hostCode); }]);
      actions.push(['✕', async () => { await friends.removeFriend(f.player_id); renderFriends(); }]);
      frRow(f.callsign || f.display_name, actions);
    }
    if (!list.length && !reqs.length && !invs.length) el('div', `${FONT}font-size:11px;color:#8a96b4;`, frBody).textContent = 'no friends yet — add by callsign';
  }
  renderFriends();
  onSessionChange(() => renderFriends());
  setInterval(() => { if (isSignedIn() && root.style.display !== 'none') renderFriends(); }, 15000);

  // ---- Launch (full width) ----
  const launch = el('button', `${FONT}font-size:16px;letter-spacing:0.14em;color:#eaeefc;cursor:pointer;`
    + 'padding:14px;background:rgba(120,200,140,0.18);border:1px solid rgba(140,230,170,0.55);'
    + 'border-radius:10px;box-shadow:0 0 16px rgba(120,220,150,0.25);', panel);
  launch.textContent = '▶  LAUNCH';
  launch.onmouseenter = () => { launch.style.background = 'rgba(120,220,150,0.34)'; };
  launch.onmouseleave = () => { launch.style.background = 'rgba(120,200,140,0.18)'; };
  launch.onclick = () => { saveSettings(settings); if (onLaunch) onLaunch(settings); };

  return {
    root,
    show() { root.style.display = 'block'; },
    hide() { root.style.display = 'none'; },
    setRoster(list, code) {
      if (!coopStatus) return;
      const names = (list || []).map((p) => (p.self ? `${p.name || 'You'} (you)` : (p.name || 'Pilot'))).join(', ');
      coopStatus.textContent = `${code ? 'Room ' + code + '\n' : ''}Players: ${names || '—'}`;
    },
  };
}
