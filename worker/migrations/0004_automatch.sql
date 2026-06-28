-- Quick-Match: a tiny matchmaking queue. One row per waiting/paired player; pairing assigns a room code.

CREATE TABLE IF NOT EXISTS matchmaking_queue (
  player_id   TEXT PRIMARY KEY,
  ruleset_id  TEXT NOT NULL,           -- e.g. 'coop:veteran' (co-op + difficulty)
  status      TEXT NOT NULL DEFAULT 'waiting', -- waiting | paired
  role        TEXT,                    -- 'host' | 'joiner' (set on pairing)
  room_code   TEXT,                    -- the host's room code (set on pairing)
  partner_id  TEXT,
  queued_at   INTEGER NOT NULL         -- also the heartbeat (refreshed on status polls)
);
CREATE INDEX IF NOT EXISTS idx_mq_pool ON matchmaking_queue (ruleset_id, status, queued_at);
