ALTER TABLE users ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'app';
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_channel_check;
ALTER TABLE users ADD CONSTRAINT users_channel_check CHECK (channel IN ('app', 'sms'));
