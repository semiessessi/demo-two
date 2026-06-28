-- M2: players + provider links. (friends/invites/leaderboards arrive in later migrations.)

CREATE TABLE IF NOT EXISTS players (
  player_id          TEXT PRIMARY KEY,
  display_name       TEXT,
  callsign           TEXT,
  squadron           TEXT,
  livery_color       TEXT,
  avatar_url         TEXT,
  country            TEXT,
  leaderboard_opt_in INTEGER NOT NULL DEFAULT 1,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_accounts (
  provider          TEXT NOT NULL,
  provider_user_id  TEXT NOT NULL,
  player_id         TEXT NOT NULL,
  username          TEXT,
  linked_at         INTEGER NOT NULL,
  PRIMARY KEY (provider, provider_user_id)
);
CREATE INDEX IF NOT EXISTS idx_provider_accounts_player ON provider_accounts (player_id);
