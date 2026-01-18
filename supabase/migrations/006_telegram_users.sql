-- Create telegram_users table for language preferences
CREATE TABLE telegram_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id TEXT NOT NULL UNIQUE,
  name TEXT,
  language TEXT NOT NULL DEFAULT 'ko' CHECK (language IN ('ko', 'en')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast lookup by telegram_id
CREATE INDEX idx_telegram_users_telegram_id ON telegram_users(telegram_id);

-- RLS policies
ALTER TABLE telegram_users ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
CREATE POLICY "Service role has full access to telegram_users"
  ON telegram_users
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
