-- Ensures 2FA/email verification columns exist on public.users and recovery codes table exists.
-- Safe to run multiple times. Run in Supabase SQL editor (or migration runner) then restart DocuGuard-Server.
-- Note: two_factor_recovery_codes are stored as hashed rows in public.user_two_factor_recovery_codes (not plaintext on users).

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS verification_token TEXT,
  ADD COLUMN IF NOT EXISTS verification_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS two_factor_secret TEXT,
  ADD COLUMN IF NOT EXISTS two_factor_enabled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS two_factor_setup_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS two_factor_verified_at TIMESTAMPTZ;

-- Backfill verified timestamp for accounts already enabled.
UPDATE public.users
SET two_factor_verified_at = two_factor_enabled_at
WHERE two_factor_enabled_at IS NOT NULL
  AND two_factor_verified_at IS NULL;

CREATE TABLE IF NOT EXISTS public.user_two_factor_recovery_codes (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_user_2fa_recovery_codes_unused
  ON public.user_two_factor_recovery_codes (user_id, id)
  WHERE used_at IS NULL;
