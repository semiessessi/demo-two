-- M3: friends + invites.

CREATE TABLE IF NOT EXISTS friend_requests (
  id            TEXT PRIMARY KEY,
  requester_id  TEXT NOT NULL,
  addressee_id  TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending', -- pending | accepted | declined | cancelled
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  UNIQUE (requester_id, addressee_id)
);
CREATE INDEX IF NOT EXISTS idx_fr_addressee ON friend_requests (addressee_id, status);
CREATE INDEX IF NOT EXISTS idx_fr_requester ON friend_requests (requester_id, status);

CREATE TABLE IF NOT EXISTS blocks (
  blocker_id  TEXT NOT NULL,
  blocked_id  TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id)
);

CREATE TABLE IF NOT EXISTS invites (
  id          TEXT PRIMARY KEY,
  room_code   TEXT NOT NULL,
  inviter_id  TEXT NOT NULL,
  invitee_id  TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending', -- pending | accepted | declined | expired
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_inv_invitee ON invites (invitee_id, status);
