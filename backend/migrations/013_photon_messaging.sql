CREATE TABLE IF NOT EXISTS phone_link_codes (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS phone_link_codes_phone_idx ON phone_link_codes (phone);

CREATE TABLE IF NOT EXISTS unknown_phone_replies (
  phone TEXT PRIMARY KEY,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS sms_notification_dedupe (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notification_key TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, notification_key)
);

CREATE TABLE IF NOT EXISTS sms_log (
  provider_id TEXT PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  phone TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  body TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'failed', 'processed'))
);

CREATE INDEX IF NOT EXISTS sms_log_user_created_idx ON sms_log (user_id, created_at);
