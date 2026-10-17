CREATE TABLE IF NOT EXISTS notices (
  observer_intent UUID NOT NULL REFERENCES intents(id) ON DELETE CASCADE,
  intent UUID NOT NULL REFERENCES intents(id) ON DELETE CASCADE,
  observer_version INTEGER NOT NULL CHECK (observer_version >= 0),
  version INTEGER NOT NULL CHECK (version >= 0),
  relevant BOOLEAN NOT NULL,
  edge JSONB,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (observer_intent, intent)
);

CREATE INDEX IF NOT EXISTS notices_intent_idx ON notices (intent);
