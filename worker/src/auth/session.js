// Session-token signing for the multi-provider auth flow.
//
// Token format: `<base64url(payload)>.<base64url(signature)>`
//   payload   = JSON {pid, exp}   pid = player_id, exp = ms-since-epoch
//   signature = HMAC-SHA256 over the payload string, key = SESSION_SIGNING_KEY
//
// JWT-shaped but not JWT — no header, no claims registry, no algorithm
// negotiation. The Worker is the only issuer and verifier; we don't need
// inter-op. Less surface area, fewer pitfalls.
//
// SESSION_SIGNING_KEY is a Wrangler secret. Generate via:
//   openssl rand -hex 32 | wrangler secret put SESSION_SIGNING_KEY
// Rotating it invalidates every existing session — fine, users just sign in
// again.

const TEXT = new TextEncoder();
const TTL_MS = 30 * 24 * 60 * 60 * 1000;        // 30 days

function b64urlEncode(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let str = '';
  for (let i = 0; i < arr.length; i++) str += String.fromCharCode(arr[i]);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str) {
  let s = str.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacKey(secret) {
  if (!secret) throw new Error('SESSION_SIGNING_KEY is not configured');
  return crypto.subtle.importKey(
    'raw',
    TEXT.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function issueSession(env, playerId) {
  const exp = Date.now() + TTL_MS;
  const payloadStr = b64urlEncode(TEXT.encode(JSON.stringify({ pid: playerId, exp })));
  const key = await hmacKey(env.SESSION_SIGNING_KEY);
  const sigBuf = await crypto.subtle.sign('HMAC', key, TEXT.encode(payloadStr));
  return `${payloadStr}.${b64urlEncode(sigBuf)}`;
}

export async function verifySession(env, token) {
  if (!token || typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return null;
  const payloadStr = token.slice(0, dot);
  let sig;
  try { sig = b64urlDecode(token.slice(dot + 1)); }
  catch { return null; }
  const key = await hmacKey(env.SESSION_SIGNING_KEY);
  const ok = await crypto.subtle.verify('HMAC', key, sig, TEXT.encode(payloadStr));
  if (!ok) return null;
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlDecode(payloadStr)));
  } catch { return null; }
  if (!payload || typeof payload.pid !== 'string' || typeof payload.exp !== 'number') return null;
  if (Date.now() >= payload.exp) return null;
  return { playerId: payload.pid, exp: payload.exp };
}

// Read the bearer token from the Authorization header and verify it.
// Returns the parsed session or null. Endpoints that require auth should
// 401 on null; endpoints that have a legacy fallback (?id= query) can
// inspect both.
export async function readSession(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  return verifySession(env, match[1].trim());
}
