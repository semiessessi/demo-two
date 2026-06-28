-- M4: run log + aggregate stats for the leaderboard.

CREATE TABLE IF NOT EXISTS runs (
  id          TEXT PRIMARY KEY,
  player_id   TEXT NOT NULL,
  wave        INTEGER NOT NULL DEFAULT 0,
  kills       INTEGER NOT NULL DEFAULT 0,
  deaths      INTEGER NOT NULL DEFAULT 0,
  difficulty  TEXT,
  environment TEXT,
  coop        INTEGER NOT NULL DEFAULT 0,
  ended_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_runs_player ON runs (player_id, ended_at DESC);

CREATE TABLE IF NOT EXISTS player_stats (
  player_id    TEXT PRIMARY KEY,
  best_wave    INTEGER NOT NULL DEFAULT 0,
  total_kills  INTEGER NOT NULL DEFAULT 0,
  total_deaths INTEGER NOT NULL DEFAULT 0,
  games        INTEGER NOT NULL DEFAULT 0,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ps_wave  ON player_stats (best_wave DESC);
CREATE INDEX IF NOT EXISTS idx_ps_kills ON player_stats (total_kills DESC);
