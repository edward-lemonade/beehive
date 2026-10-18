CREATE TABLE IF NOT EXISTS photon_conversations (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  phone TEXT NOT NULL UNIQUE,
  photon_user_id TEXT NOT NULL,
  photon_space_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('sms', 'imessage')),
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS photon_event_cursors (
  consumer TEXT PRIMARY KEY,
  seq BIGINT NOT NULL CHECK (seq >= 0),
  updated_at BIGINT NOT NULL
);
