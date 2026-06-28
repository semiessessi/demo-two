// demo-two-social — the Cloudflare Worker backend for SA-43: Hammerhead (sign-in + profile; friends /
// invites / leaderboards land in later milestones). Adapted from kemetic/senet's worker.
//
// Routed at d2.redmarmosetstudios.com/api/* via a DASHBOARD route (NOT [[routes]] in wrangler.toml —
// that would fight the static-assets worker's Custom Domain). Everything else falls through to the
// static site. Stateless HMAC bearer sessions (no sessions table).

import { issueSession, readSession } from './auth/session.js';
import { googleExchange } from './auth/google.js';
import { facebookExchange } from './auth/facebook.js';

const CORS = {
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};
// Allow the game origins to call the API cross-origin (local dev: game on :8788, worker on :8787;
// prod is same-origin via the route so this is a no-op there).
function corsOrigin(request) {
  const o = request.headers.get('Origin') || '';
  if (/^https:\/\/d2\.redmarmosetstudios\.com$/.test(o)) return o;
  if (/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(o)) return o;
  return '';
}
function json(data, status, request) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': corsOrigin(request), ...CORS },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    let path = url.pathname.replace(/^\/api/, '') || '/';
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': corsOrigin(request), ...CORS } });
    }
    try {
      // public config so the client can build authorize URLs without hardcoding ids
      if (path === '/auth/config' && request.method === 'GET') {
        return json({ googleClientId: env.GOOGLE_CLIENT_ID || null, facebookAppId: env.FACEBOOK_CLIENT_ID || null }, 200, request);
      }
      if (path === '/auth/google/exchange' && request.method === 'POST') {
        return await handleExchange(googleExchange, 'google', request, env);
      }
      if (path === '/auth/facebook/exchange' && request.method === 'POST') {
        return await handleExchange(facebookExchange, 'facebook', request, env);
      }
      if (path === '/me' && request.method === 'GET') {
        const s = await readSession(request, env);
        if (!s) return json({ error: 'unauthenticated' }, 401, request);
        const p = await getPlayer(env, s.playerId);
        return p ? json({ player: p }, 200, request) : json({ error: 'not found' }, 404, request);
      }
      if (path === '/me' && request.method === 'PATCH') {
        const s = await readSession(request, env);
        if (!s) return json({ error: 'unauthenticated' }, 401, request);
        const body = await request.json().catch(() => ({}));
        const p = await patchPlayer(env, s.playerId, body);
        return json({ player: p }, 200, request);
      }
      return json({ error: 'not found', path }, 404, request);
    } catch (e) {
      return json({ error: 'server error', detail: String(e && e.message || e) }, 500, request);
    }
  },
};

// run a provider exchange -> ensure a player -> issue a session
async function handleExchange(exchangeFn, provider, request, env) {
  const body = await request.json().catch(() => ({}));
  const res = await exchangeFn(body, env);
  if (res.error) return json(res, res.status || 400, request);
  const player = await ensurePlayerForProvider(env, provider, res);
  const session_token = await issueSession(env, player.player_id);
  return json({ session_token, player }, 200, request);
}

// look up (provider, providerUserId) -> player; create a fresh player on first sign-in.
async function ensurePlayerForProvider(env, provider, { providerUserId, username, country, avatar_url }) {
  const link = await env.DB.prepare('SELECT player_id FROM provider_accounts WHERE provider=? AND provider_user_id=?')
    .bind(provider, String(providerUserId)).first();
  const now = Date.now();
  if (link) {
    return await getPlayer(env, link.player_id);
  }
  const playerId = crypto.randomUUID();
  await env.DB.prepare(
    'INSERT INTO players (player_id, display_name, callsign, avatar_url, country, leaderboard_opt_in, created_at, updated_at) VALUES (?,?,?,?,?,1,?,?)',
  ).bind(playerId, username || 'Pilot', (username || 'PILOT').toUpperCase().slice(0, 12), avatar_url || null, country || null, now, now).run();
  await env.DB.prepare('INSERT INTO provider_accounts (provider, provider_user_id, player_id, username, linked_at) VALUES (?,?,?,?,?)')
    .bind(provider, String(providerUserId), playerId, username || null, now).run();
  return await getPlayer(env, playerId);
}

async function getPlayer(env, playerId) {
  return await env.DB.prepare('SELECT player_id, display_name, callsign, squadron, livery_color, avatar_url, country, leaderboard_opt_in FROM players WHERE player_id=?')
    .bind(playerId).first();
}

async function patchPlayer(env, playerId, body) {
  const sets = [];
  const vals = [];
  for (const [col, key] of [['callsign', 'callsign'], ['squadron', 'squadron'], ['livery_color', 'livery_color'], ['display_name', 'display_name']]) {
    if (typeof body[key] === 'string') { sets.push(`${col}=?`); vals.push(body[key].slice(0, 32)); }
  }
  if (typeof body.leaderboard_opt_in === 'boolean') { sets.push('leaderboard_opt_in=?'); vals.push(body.leaderboard_opt_in ? 1 : 0); }
  if (sets.length) {
    sets.push('updated_at=?'); vals.push(Date.now());
    vals.push(playerId);
    await env.DB.prepare(`UPDATE players SET ${sets.join(', ')} WHERE player_id=?`).bind(...vals).run();
  }
  return await getPlayer(env, playerId);
}
