CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_id TEXT NOT NULL UNIQUE,
  handle TEXT NOT NULL,
  tier TEXT NOT NULL DEFAULT 'new',
  phone TEXT,
  phone_verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS intents (
  id UUID PRIMARY KEY,
  draft_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id),
  version INTEGER NOT NULL CHECK (version >= 0),
  state TEXT NOT NULL CHECK (state IN ('open', 'done', 'withdrawn', 'expired')),
  "public" JSONB NOT NULL,
  "private" JSONB NOT NULL,
  source_text TEXT NOT NULL,
  parsed JSONB NOT NULL,
  deadline TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS intents_state_idx ON intents (state);
CREATE INDEX IF NOT EXISTS intents_user_state_idx ON intents (user_id, state);
CREATE INDEX IF NOT EXISTS intents_draft_id_idx ON intents (draft_id, user_id);

CREATE TABLE IF NOT EXISTS intent_versions (
  intent_id UUID NOT NULL REFERENCES intents(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version >= 0),
  "public" JSONB NOT NULL,
  "private" JSONB NOT NULL,
  source_text TEXT NOT NULL,
  parsed JSONB NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (intent_id, version)
);
