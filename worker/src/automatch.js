// Quick-Match (automatch) for SA-43: Hammerhead — pair two waiting players into a co-op room without
// sharing a code. Adapted from kemetic/senet's automatch. The NEWER caller becomes the host (mints the
// room code); the waiting partner becomes the joiner and learns the code on its next status poll.

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function roomCode() { let s = ''; for (let i = 0; i < 5; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]; return s; }
const now = () => Date.now();
const STALE_MS = 60 * 1000; // drop waiters idle longer than this

async function pruneStale(env) {
  await env.DB.prepare("DELETE FROM matchmaking_queue WHERE status='waiting' AND queued_at < ?").bind(now() - STALE_MS).run();
}

export async function join(env, me, rulesetId) {
  if (!rulesetId) return { error: 'missing ruleset', status: 400 };
  await pruneStale(env);
  // already paired (idempotent re-call)? hand back the pairing
  const mine = await env.DB.prepare('SELECT * FROM matchmaking_queue WHERE player_id=?').bind(me).first();
  if (mine && mine.status === 'paired') return { paired: true, room_code: mine.room_code, role: mine.role };
  // find the oldest OTHER waiter on the same ruleset
  const partner = await env.DB.prepare("SELECT * FROM matchmaking_queue WHERE ruleset_id=? AND status='waiting' AND player_id != ? ORDER BY queued_at ASC LIMIT 1")
    .bind(rulesetId, me).first();
  if (partner) {
    const code = roomCode();
    // partner waited first -> joiner; I'm the host (I mint + own the room)
    await env.DB.prepare("UPDATE matchmaking_queue SET status='paired', role='joiner', room_code=?, partner_id=? WHERE player_id=?").bind(code, me, partner.player_id).run();
    await env.DB.prepare("INSERT INTO matchmaking_queue (player_id, ruleset_id, status, role, room_code, partner_id, queued_at) VALUES (?,?,'paired','host',?,?,?) ON CONFLICT(player_id) DO UPDATE SET status='paired', role='host', room_code=excluded.room_code, partner_id=excluded.partner_id, ruleset_id=excluded.ruleset_id")
      .bind(me, rulesetId, code, partner.player_id, now()).run();
    return { paired: true, room_code: code, role: 'host' };
  }
  // no one waiting -> enqueue me
  await env.DB.prepare("INSERT INTO matchmaking_queue (player_id, ruleset_id, status, queued_at) VALUES (?,?,'waiting',?) ON CONFLICT(player_id) DO UPDATE SET ruleset_id=excluded.ruleset_id, status='waiting', role=NULL, room_code=NULL, partner_id=NULL, queued_at=excluded.queued_at")
    .bind(me, rulesetId, now()).run();
  const c = await env.DB.prepare("SELECT COUNT(*) AS n FROM matchmaking_queue WHERE ruleset_id=? AND status='waiting'").bind(rulesetId).first();
  return { paired: false, waiting: (c && c.n) || 1 };
}

export async function status(env, me) {
  const row = await env.DB.prepare('SELECT * FROM matchmaking_queue WHERE player_id=?').bind(me).first();
  if (!row) return { paired: false };
  if (row.status === 'paired') {
    // pairing consumed once the host reads it; the joiner keeps polling until it sees paired, then both clear
    return { paired: true, room_code: row.room_code, role: row.role };
  }
  await env.DB.prepare('UPDATE matchmaking_queue SET queued_at=? WHERE player_id=? AND status=\'waiting\'').bind(now(), me).run(); // heartbeat
  return { paired: false };
}

export async function leave(env, me) {
  await env.DB.prepare('DELETE FROM matchmaking_queue WHERE player_id=?').bind(me).run();
  return { ok: true };
}
