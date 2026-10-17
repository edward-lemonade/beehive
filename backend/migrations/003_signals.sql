CREATE TABLE IF NOT EXISTS signals (
  from_intent UUID NOT NULL REFERENCES intents(id) ON DELETE CASCADE,
  to_intent UUID NOT NULL REFERENCES intents(id) ON DELETE CASCADE,
  from_version INTEGER NOT NULL CHECK (from_version >= 0),
  to_version INTEGER NOT NULL CHECK (to_version >= 0),
  satisfiable BOOLEAN NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (from_intent, to_intent)
);

CREATE INDEX IF NOT EXISTS signals_to_idx ON signals (to_intent);
