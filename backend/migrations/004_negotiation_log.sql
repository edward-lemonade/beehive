CREATE TABLE IF NOT EXISTS negotiation_log (
  id BIGSERIAL PRIMARY KEY,
  link_id TEXT NOT NULL,
  arrangement_id TEXT,
  round INTEGER NOT NULL CHECK (round >= 0),
  from_intent UUID NOT NULL,
  to_intent UUID NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('offer', 'accept', 'walk', 'say')),
  amount_cents BIGINT,
  text TEXT,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS negotiation_log_link_idx ON negotiation_log (link_id, id);
