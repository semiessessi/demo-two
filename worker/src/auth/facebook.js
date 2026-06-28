// Facebook OAuth 2.0 exchange.
//
// Flow:
//   1. Frontend opens a popup at https://www.facebook.com/v18.0/dialog/oauth
//      with response_type=code, scope=public_profile, plus a state.
//   2. Facebook redirects back to /auth/callback.html with ?code=...&state=...
//   3. Frontend posts {code, redirect_uri} to /api/auth/facebook/exchange.
//   4. We exchange the code at /v18.0/oauth/access_token, then call /me
//      with fields=id,name to obtain the stable user id + display name.
//
// The `public_profile` scope intentionally avoids `email` — we don't need
// it and asking for it expands the privacy-policy disclosure.

const FB_API = 'https://graph.facebook.com/v18.0';

export async function facebookExchange({ code, redirect_uri }, env) {
  if (!code) return { error: 'missing code', status: 400 };
  if (!redirect_uri) return { error: 'missing redirect_uri', status: 400 };
  if (!env.FACEBOOK_CLIENT_ID || !env.FACEBOOK_CLIENT_SECRET) {
    return { error: 'facebook oauth not configured on server', status: 503 };
  }

  // Facebook's token endpoint accepts query-string params for the GET form,
  // but POST + form-encoded body is the documented "server" path.
  const tokenBody = new URLSearchParams({
    client_id:     env.FACEBOOK_CLIENT_ID,
    client_secret: env.FACEBOOK_CLIENT_SECRET,
    code,
    redirect_uri,
  });
  const tokenResp = await fetch(`${FB_API}/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenBody,
  });
  const tokenData = await tokenResp.json();
  if (!tokenResp.ok) {
    return { error: 'facebook oauth failed', detail: tokenData, status: tokenResp.status };
  }

  // type=large gives a ~200x200 picture; redirect=false makes Facebook
  // return JSON with the URL inside picture.data.url instead of 302-ing.
  const meResp = await fetch(`${FB_API}/me?fields=id,name,picture.type(large)`, {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const me = await meResp.json();
  if (!meResp.ok) {
    return { error: 'facebook /me failed', detail: me, status: meResp.status };
  }

  const providerUserId = me.id;
  if (!providerUserId) {
    return { error: 'facebook /me missing id', status: 502 };
  }
  const username = me.name || `user-${String(providerUserId).slice(-4)}`;
  const avatar_url = me.picture?.data?.url || null;

  return { providerUserId, username, country: null, avatar_url };
}
