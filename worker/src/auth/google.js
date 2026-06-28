// Google OAuth 2.0 + OIDC exchange.
//
// Two flows supported, dispatched on body shape:
//
//   A. authorization-code (default, popup OAuth):
//      1. Frontend opens a popup at https://accounts.google.com/o/oauth2/v2/auth
//         with response_type=code, scope=openid+profile, plus a state.
//      2. Google redirects back to /auth/callback.html with ?code=...&state=...
//      3. Frontend posts {code, redirect_uri} to /api/auth/google/exchange.
//      4. We exchange the code for tokens, then call the OIDC userinfo
//         endpoint to obtain a stable subject id + display name.
//
//   B. id_token (FedCM / Google Identity Services):
//      1. Frontend uses Google Identity Services (loaded as
//         https://accounts.google.com/gsi/client) to render Google's
//         own iframe-friendly sign-in. The browser hands the page an
//         ID token JWT directly — no popup, works inside iframe
//         portals (GameDistribution, itch, ...).
//      2. Frontend posts {id_token} to /api/auth/google/exchange.
//      3. We crypto-verify the JWT against Google's JWKS, extract sub
//         + name + locale + picture from the verified claims, and
//         issue the same session.
//
// Returns the canonical { providerUserId, username, country } shape that
// `ensurePlayerForProvider` in worker/src/index.js consumes.

export async function googleExchange(body, env) {
  if (!env.GOOGLE_CLIENT_ID) {
    return { error: 'google oauth not configured on server', status: 503 };
  }

  // Flow B — FedCM-issued ID token. No client_secret required;
  // verifying the JWT signature against Google's JWKS is what proves
  // the assertion was actually minted by Google for our client.
  if (body && body.id_token) {
    return await verifyIdToken(body.id_token, env);
  }

  // Flow A — authorization code.
  const { code, redirect_uri } = body || {};
  if (!code) return { error: 'missing code', status: 400 };
  if (!redirect_uri) return { error: 'missing redirect_uri', status: 400 };
  if (!env.GOOGLE_CLIENT_SECRET) {
    return { error: 'google oauth not configured on server', status: 503 };
  }

  // 1. Exchange the auth code for an access_token (and id_token).
  const tokenBody = new URLSearchParams({
    client_id:     env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    grant_type:    'authorization_code',
    code,
    redirect_uri,
  });
  const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenBody,
  });
  const tokenData = await tokenResp.json();
  if (!tokenResp.ok) {
    return { error: 'google oauth failed', detail: tokenData, status: tokenResp.status };
  }

  // 2. Fetch the user's stable id + display name from OIDC userinfo.
  const meResp = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const me = await meResp.json();
  if (!meResp.ok) {
    return { error: 'google userinfo failed', detail: me, status: meResp.status };
  }

  const providerUserId = me.sub;          // stable, unique per Google account
  if (!providerUserId) {
    return { error: 'google userinfo missing sub', status: 502 };
  }
  const username = me.name || me.given_name || `user-${String(providerUserId).slice(-4)}`;
  // Google returns `locale` like "en-GB"; the country half is the closest we
  // get to a country flag without an extra scope.
  const country = pickCountry(me.locale);
  // OIDC userinfo includes `picture` (a Google-hosted CDN URL) when the
  // user has set a profile picture. We pass it through verbatim — the
  // frontend uses it as the initial avatar if the local profile is empty.
  const avatar_url = me.picture || null;

  return { providerUserId, username, country, avatar_url };
}

function pickCountry(locale) {
  if (!locale || typeof locale !== 'string') return null;
  const dash = locale.indexOf('-');
  if (dash < 0) return null;
  const cc = locale.slice(dash + 1).toUpperCase();
  return /^[A-Z]{2}$/.test(cc) ? cc : null;
}

// ---------- FedCM / GIS id_token verification ----------

// JWKS cache lives at module scope so the worker isolate keeps it
// across requests. Re-fetched after JWKS_TTL_MS or when a `kid`
// lookup misses (Google rotates keys infrequently but we want the
// rotation to be transparent).
let jwksCache = null;
let jwksFetchedAt = 0;
const JWKS_TTL_MS = 60 * 60 * 1000;

async function getGoogleJwks(force = false) {
  const now = Date.now();
  if (!force && jwksCache && (now - jwksFetchedAt) < JWKS_TTL_MS) return jwksCache;
  const r = await fetch('https://www.googleapis.com/oauth2/v3/certs');
  if (!r.ok) throw new Error('JWKS fetch failed: ' + r.status);
  const data = await r.json();
  jwksCache = data.keys;
  jwksFetchedAt = now;
  return jwksCache;
}

function b64urlDecode(str) {
  let s = str.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Verify a Google-issued ID token (JWT, RS256) against the JWKS, then
// validate iss / aud / exp claims. On success returns the same shape
// the code-flow path returns; on failure returns { error, status }.
async function verifyIdToken(idToken, env) {
  if (typeof idToken !== 'string') return { error: 'missing id_token', status: 400 };
  const parts = idToken.split('.');
  if (parts.length !== 3) return { error: 'malformed id_token', status: 400 };
  const [headerB64, payloadB64, sigB64] = parts;
  let header, payload;
  try {
    header  = JSON.parse(new TextDecoder().decode(b64urlDecode(headerB64)));
    payload = JSON.parse(new TextDecoder().decode(b64urlDecode(payloadB64)));
  } catch {
    return { error: 'invalid id_token base64', status: 400 };
  }
  if (header.alg !== 'RS256') return { error: 'unsupported jwt alg', status: 400 };

  let jwks;
  try { jwks = await getGoogleJwks(); }
  catch (e) { return { error: 'JWKS fetch failed', detail: e.message, status: 502 }; }
  let jwk = jwks.find(k => k.kid === header.kid);
  if (!jwk) {
    // Bypass cache once in case Google rotated keys mid-TTL.
    try { jwks = await getGoogleJwks(true); }
    catch (e) { return { error: 'JWKS fetch failed', detail: e.message, status: 502 }; }
    jwk = jwks.find(k => k.kid === header.kid);
  }
  if (!jwk) return { error: 'unknown signing key', status: 400 };

  let key;
  try {
    key = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
  } catch (e) {
    return { error: 'JWK import failed', detail: e.message, status: 502 };
  }

  const signed = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const sig = b64urlDecode(sigB64);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sig, signed);
  if (!ok) return { error: 'id_token signature invalid', status: 400 };

  const now = Math.floor(Date.now() / 1000);
  if (payload.aud !== env.GOOGLE_CLIENT_ID) return { error: 'aud mismatch', status: 400 };
  if (payload.iss !== 'https://accounts.google.com' && payload.iss !== 'accounts.google.com') {
    return { error: 'iss mismatch', status: 400 };
  }
  if (typeof payload.exp !== 'number' || payload.exp < now) return { error: 'id_token expired', status: 400 };
  // Allow up to 5 min of clock skew on the future side; an iat far in
  // the future is a sign of something amiss.
  if (typeof payload.iat === 'number' && payload.iat > now + 300) {
    return { error: 'iat in future', status: 400 };
  }

  const providerUserId = payload.sub;
  if (!providerUserId) return { error: 'id_token missing sub', status: 400 };
  const username = payload.name || payload.given_name || `user-${String(providerUserId).slice(-4)}`;
  const country = pickCountry(payload.locale);
  const avatar_url = payload.picture || null;
  return { providerUserId, username, country, avatar_url };
}
