CREATE TABLE IF NOT EXISTS chat_messages (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_role TEXT NOT NULL CHECK (from_role IN ('agent', 'me')),
  text TEXT NOT NULL,
  key TEXT,
  arrangement_id TEXT,
  suggest JSONB,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS chat_messages_user_idx ON chat_messages (user_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS chat_messages_key_idx ON chat_messages (user_id, key) WHERE key IS NOT NULL;
