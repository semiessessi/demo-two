// Client auth for SA-43: Hammerhead — Google/Facebook sign-in via a popup + the demo-two-social worker.
// Adapted (trimmed) from kemetic/senet's src/auth. The provider IDs come from /api/auth/config so they
// aren't hardcoded here; the popup returns an auth code which the worker exchanges for a session token.

// API base: same-origin /api on d2 (served by the worker via the dashboard route); a separate port in
// local dev (run `npm run dev` in worker/ -> :8787). Override with localStorage.d2ApiBase if needed.
const API_BASE = (() => {
  try { const o = localStorage.getItem('d2ApiBase'); if (o) return o.replace(/\/$/, '') + '/api'; } catch { /* */ }
  const h = location.hostname;
  if (h === 'localhost' || h === '127.0.0.1') return 'http://localhost:8787/api';
  return '/api';
})();

const TOKEN_KEY = 'd2.session.token';
const PLAYER_KEY = 'd2.session.player';

function readBoth(k) { try { return sessionStorage.getItem(k) || localStorage.getItem(k) || null; } catch { return null; } }
function writeBoth(k, v) {
  try {
    if (v == null) { sessionStorage.removeItem(k); localStorage.removeItem(k); }
    else { sessionStorage.setItem(k, v); localStorage.setItem(k, v); }
  } catch { /* private mode */ }
}

export function getToken() { return readBoth(TOKEN_KEY); }
export function getPlayer() { const r = readBoth(PLAYER_KEY); if (!r) return null; try { return JSON.parse(r); } catch { return null; } }
export function isSignedIn() { return !!getToken(); }
function setSession(token, player) {
  writeBoth(TOKEN_KEY, token);
  writeBoth(PLAYER_KEY, player ? JSON.stringify(player) : null);
  window.dispatchEvent(new CustomEvent('d2:session-changed', { detail: player }));
}
export function signOut() { setSession(null, null); }
export function onSessionChange(fn) { window.addEventListener('d2:session-changed', (e) => fn(e.detail)); }

let configP = null;
export function getConfig() {
  if (!configP) configP = fetch(`${API_BASE}/auth/config`).then((r) => r.json()).catch(() => ({}));
  return configP;
}

// authenticated fetch helper
export async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  const tok = getToken();
  if (tok) headers.Authorization = `Bearer ${tok}`;
  if (opts.body && typeof opts.body !== 'string') { headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(opts.body); }
  const r = await fetch(`${API_BASE}${path}`, { ...opts, headers });
  if (r.status === 401) { signOut(); return null; }
  return r.ok ? r.json() : null;
}

// validate the stored session on load (and refresh the cached player)
export async function refreshMe() {
  if (!getToken()) return null;
  const res = await api('/me');
  if (res && res.player) { writeBoth(PLAYER_KEY, JSON.stringify(res.player)); window.dispatchEvent(new CustomEvent('d2:session-changed', { detail: res.player })); return res.player; }
  return null;
}

// --- OAuth popup ----------------------------------------------------------------------------------
const callbackUri = () => new URL('auth/callback.html', location.origin + '/').toString();
function b64u(bytes) { let s = ''; const a = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes); for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function makeState() {
  const csrf = b64u(crypto.getRandomValues(new Uint8Array(16)));
  return `${b64u(new TextEncoder().encode(location.origin))}.${csrf}`;
}
function runPopup({ authorize_url, client_id, scope }) {
  return new Promise((resolve, reject) => {
    const state = makeState();
    const redirect_uri = callbackUri();
    const params = new URLSearchParams({ client_id, response_type: 'code', scope, redirect_uri, state });
    const url = `${authorize_url}?${params}`;
    const w = 480, h = 640;
    const left = Math.max(0, (screen.width - w) / 2), top = Math.max(0, (screen.height - h) / 2);
    const popup = window.open(url, 'd2-oauth', `width=${w},height=${h},left=${left},top=${top}`);
    if (!popup) { reject(new Error('Popup blocked — allow popups and try again.')); return; }
    let done = false;
    const onMsg = (e) => {
      const d = e.data || {};
      if (d.type !== 'd2-oauth-callback') return;
      if (d.state !== state) return finish(new Error('OAuth state mismatch'));
      if (d.error) return finish(new Error(d.error_description || d.error));
      if (!d.code) return finish(new Error('OAuth callback missing code'));
      finish(null, { code: d.code, redirect_uri });
    };
    const iv = setInterval(() => { if (popup.closed) finish(new Error('Sign-in cancelled')); }, 500);
    function finish(err, val) {
      if (done) return; done = true;
      window.removeEventListener('message', onMsg); clearInterval(iv);
      try { if (!popup.closed) popup.close(); } catch { /* */ }
      err ? reject(err) : resolve(val);
    }
    window.addEventListener('message', onMsg);
  });
}

async function exchange(provider, payload) {
  const r = await fetch(`${API_BASE}/auth/${provider}/exchange`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.session_token) throw new Error(data.error || 'sign-in failed');
  setSession(data.session_token, data.player);
  return data.player;
}

export async function signInWithGoogle() {
  const cfg = await getConfig();
  if (!cfg.googleClientId) throw new Error('Google sign-in not configured');
  const { code, redirect_uri } = await runPopup({
    authorize_url: 'https://accounts.google.com/o/oauth2/v2/auth', client_id: cfg.googleClientId, scope: 'openid profile',
  });
  return exchange('google', { code, redirect_uri });
}

export async function signInWithFacebook() {
  const cfg = await getConfig();
  if (!cfg.facebookAppId) throw new Error('Facebook sign-in not configured');
  const { code, redirect_uri } = await runPopup({
    authorize_url: 'https://www.facebook.com/v18.0/dialog/oauth', client_id: cfg.facebookAppId, scope: 'public_profile',
  });
  return exchange('facebook', { code, redirect_uri });
}
