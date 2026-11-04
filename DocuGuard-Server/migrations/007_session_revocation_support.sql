-- Proposed migration for server-side session revocation
-- DO NOT APPLY TO PRODUCTION
ALTER TABLE login_sessions
  ADD COLUMN IF NOT EXISTS session_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revoked BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_login_sessions_user_id ON login_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_login_sessions_expires_at ON login_sessions(expires_at);
