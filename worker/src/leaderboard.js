// Leaderboard (M4) for SA-43: Hammerhead — each signed-in player self-reports a run on mission-over;
// we upsert aggregate stats. Client-authoritative (forgeable) by nature, so apply sanity caps and treat
// it as a friendly board, not a competitive ladder.

const now = () => Date.now();
const uid = () => crypto.randomUUID();
const CAP_WAVE = 500;
const CAP_KILLS = 100000;

export async function submitRun(env, me, body) {
  const wave = Math.max(0, Math.min(CAP_WAVE, body.wave | 0));
  const kills = Math.max(0, Math.min(CAP_KILLS, body.kills | 0));
  const deaths = Math.max(0, body.deaths | 0);
  await env.DB.prepare('INSERT INTO runs (id, player_id, wave, kills, deaths, difficulty, environment, coop, ended_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .bind(uid(), me, wave, kills, deaths, String(body.difficulty || '').slice(0, 16), String(body.environment || '').slice(0, 24), body.coop ? 1 : 0, now()).run();
  await env.DB.prepare(
    `INSERT INTO player_stats (player_id, best_wave, total_kills, total_deaths, games, updated_at)
       VALUES (?,?,?,?,1,?)
     ON CONFLICT(player_id) DO UPDATE SET
       best_wave    = MAX(best_wave, excluded.best_wave),
       total_kills  = total_kills + excluded.total_kills,
       total_deaths = total_deaths + excluded.total_deaths,
       games        = games + 1,
       updated_at   = excluded.updated_at`,
  ).bind(me, wave, kills, deaths, now()).run();
  return { ok: true };
}

export async function getLeaderboard(env, { metric = 'wave', scope = 'global', me = null, limit = 20 }) {
  const col = metric === 'kills' ? 'total_kills' : 'best_wave';
  const lim = Math.max(1, Math.min(50, (limit | 0) || 20));
  let sql = `SELECT ps.player_id, p.callsign, p.display_name, ps.best_wave, ps.total_kills, ps.games
               FROM player_stats ps JOIN players p ON p.player_id = ps.player_id
              WHERE p.leaderboard_opt_in = 1`;
  const binds = [];
  if (scope === 'friends' && me) {
    sql += ` AND ps.player_id IN (
               SELECT CASE WHEN requester_id = ? THEN addressee_id ELSE requester_id END
                 FROM friend_requests WHERE status = 'accepted' AND (requester_id = ? OR addressee_id = ?)
               UNION SELECT ?)`;
    binds.push(me, me, me, me);
  }
  sql += ` ORDER BY ${col} DESC LIMIT ${lim}`;
  const r = await env.DB.prepare(sql).bind(...binds).all();
  return r.results || [];
}
