// Friends + invites (M3) for SA-43: Hammerhead. Adapted from kemetic/senet's worker social layer.
// All functions take (env, me=playerId, …) and return a plain result object; index.js wraps in JSON.

const now = () => Date.now();
const uid = () => crypto.randomUUID();
const INVITE_TTL = 10 * 60 * 1000; // invites expire after 10 minutes

export async function searchPlayers(env, q, selfId) {
  if (!q || q.length < 2) return [];
  const r = await env.DB.prepare(
    'SELECT player_id, callsign, display_name, avatar_url FROM players WHERE callsign LIKE ? AND player_id != ? LIMIT 12',
  ).bind(q.toUpperCase() + '%', selfId).all();
  return r.results || [];
}

export async function listFriends(env, me) {
  const r = await env.DB.prepare(
    `SELECT p.player_id, p.callsign, p.display_name, p.avatar_url
       FROM friend_requests fr
       JOIN players p ON p.player_id = CASE WHEN fr.requester_id = ? THEN fr.addressee_id ELSE fr.requester_id END
      WHERE fr.status = 'accepted' AND (fr.requester_id = ? OR fr.addressee_id = ?)`,
  ).bind(me, me, me).all();
  return r.results || [];
}

export async function listRequests(env, me, dir) {
  const sql = dir === 'out'
    ? "SELECT fr.id, p.player_id, p.callsign, p.display_name FROM friend_requests fr JOIN players p ON p.player_id = fr.addressee_id WHERE fr.requester_id = ? AND fr.status = 'pending'"
    : "SELECT fr.id, p.player_id, p.callsign, p.display_name FROM friend_requests fr JOIN players p ON p.player_id = fr.requester_id WHERE fr.addressee_id = ? AND fr.status = 'pending'";
  const r = await env.DB.prepare(sql).bind(me).all();
  return r.results || [];
}

export async function sendRequest(env, me, addresseeId) {
  if (!addresseeId || addresseeId === me) return { error: 'bad target', status: 400 };
  // mutual: if they already requested ME, accept it instead of stacking a second row
  const reverse = await env.DB.prepare("SELECT id FROM friend_requests WHERE requester_id = ? AND addressee_id = ? AND status = 'pending'").bind(addresseeId, me).first();
  if (reverse) { await env.DB.prepare("UPDATE friend_requests SET status = 'accepted', updated_at = ? WHERE id = ?").bind(now(), reverse.id).run(); return { ok: true, accepted: true }; }
  await env.DB.prepare("INSERT OR IGNORE INTO friend_requests (id, requester_id, addressee_id, status, created_at, updated_at) VALUES (?,?,?, 'pending', ?, ?)").bind(uid(), me, addresseeId, now(), now()).run();
  return { ok: true };
}

export async function actOnRequest(env, me, id, action) {
  const fr = await env.DB.prepare('SELECT * FROM friend_requests WHERE id = ?').bind(id).first();
  if (!fr) return { error: 'not found', status: 404 };
  if (action === 'accept' && fr.addressee_id === me) await env.DB.prepare("UPDATE friend_requests SET status = 'accepted', updated_at = ? WHERE id = ?").bind(now(), id).run();
  else if (action === 'decline' && fr.addressee_id === me) await env.DB.prepare("UPDATE friend_requests SET status = 'declined', updated_at = ? WHERE id = ?").bind(now(), id).run();
  else if (action === 'cancel' && fr.requester_id === me) await env.DB.prepare('DELETE FROM friend_requests WHERE id = ?').bind(id).run();
  else return { error: 'forbidden', status: 403 };
  return { ok: true };
}

export async function removeFriend(env, me, otherId) {
  await env.DB.prepare("DELETE FROM friend_requests WHERE status = 'accepted' AND ((requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?))").bind(me, otherId, otherId, me).run();
  return { ok: true };
}

export async function sendInvite(env, me, inviteeId, roomCode) {
  if (!inviteeId || !roomCode) return { error: 'bad invite', status: 400 };
  await env.DB.prepare("INSERT INTO invites (id, room_code, inviter_id, invitee_id, status, created_at, expires_at) VALUES (?,?,?,?, 'pending', ?, ?)")
    .bind(uid(), String(roomCode).toUpperCase().slice(0, 5), me, inviteeId, now(), now() + INVITE_TTL).run();
  return { ok: true };
}

export async function listInvites(env, me) {
  const r = await env.DB.prepare("SELECT inv.id, inv.room_code, p.callsign AS from_callsign FROM invites inv JOIN players p ON p.player_id = inv.inviter_id WHERE inv.invitee_id = ? AND inv.status = 'pending' AND inv.expires_at > ?").bind(me, now()).all();
  return r.results || [];
}

export async function actOnInvite(env, me, id, action) {
  const inv = await env.DB.prepare('SELECT * FROM invites WHERE id = ? AND invitee_id = ?').bind(id, me).first();
  if (!inv) return { error: 'not found', status: 404 };
  await env.DB.prepare('UPDATE invites SET status = ? WHERE id = ?').bind(action === 'accept' ? 'accepted' : 'declined', id).run();
  return { ok: true, room_code: inv.room_code };
}

export async function notifications(env, me) {
  const fr = await env.DB.prepare("SELECT COUNT(*) AS n FROM friend_requests WHERE addressee_id = ? AND status = 'pending'").bind(me).first();
  const inv = await env.DB.prepare("SELECT COUNT(*) AS n FROM invites WHERE invitee_id = ? AND status = 'pending' AND expires_at > ?").bind(me, now()).first();
  return { friendRequests: (fr && fr.n) || 0, invites: (inv && inv.n) || 0 };
}
