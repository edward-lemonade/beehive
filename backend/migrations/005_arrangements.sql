CREATE TABLE IF NOT EXISTS arrangements (
  id UUID PRIMARY KEY,
  key TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('candidate', 'dropped', 'proposed', 'committed', 'dissolved')),
  revision INTEGER NOT NULL CHECK (revision >= 0),
  reason TEXT,
  excluded JSONB NOT NULL DEFAULT '[]'::jsonb,
  declared_net JSONB NOT NULL DEFAULT '{}'::jsonb,
  replace_deadline BIGINT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

-- One live record per key. Dissolved records are history.
CREATE UNIQUE INDEX IF NOT EXISTS arrangements_live_key_idx
  ON arrangements (key) WHERE state IN ('candidate', 'proposed', 'committed', 'dropped');

CREATE TABLE IF NOT EXISTS arrangement_slots (
  arrangement_id UUID NOT NULL REFERENCES arrangements(id) ON DELETE CASCADE,
  intent_id UUID NOT NULL REFERENCES intents(id),
  user_id UUID NOT NULL REFERENCES users(id),
  intent_version INTEGER NOT NULL CHECK (intent_version >= 0),
  approval TEXT NOT NULL CHECK (approval IN
    ('queued', 'requested', 'approved', 'declined', 'timed_out', 'retracted', 'void', 'fulfilled')),
  terms_hash TEXT,
  approved_net_cents BIGINT,
  requested_at BIGINT,
  decided_at BIGINT,
  checklist JSONB,
  PRIMARY KEY (arrangement_id, intent_id)
);

CREATE INDEX IF NOT EXISTS arrangement_slots_intent_idx ON arrangement_slots (intent_id);
CREATE INDEX IF NOT EXISTS arrangement_slots_user_idx ON arrangement_slots (user_id, approval);

CREATE TABLE IF NOT EXISTS arrangement_links (
  arrangement_id UUID NOT NULL REFERENCES arrangements(id) ON DELETE CASCADE,
  link_id TEXT NOT NULL,
  a TEXT NOT NULL,
  b TEXT NOT NULL,
  payer TEXT,
  amount_cents BIGINT,
  state TEXT NOT NULL CHECK (state IN ('unpriced', 'agreed', 'failed')),
  flows JSONB NOT NULL DEFAULT '[]'::jsonb,
  PRIMARY KEY (arrangement_id, link_id)
);

CREATE TABLE IF NOT EXISTS declined (
  user_id UUID NOT NULL REFERENCES users(id),
  arrangement_key TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, arrangement_key)
);
