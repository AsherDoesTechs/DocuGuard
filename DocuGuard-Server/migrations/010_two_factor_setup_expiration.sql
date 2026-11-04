-- LOCAL MIGRATION PROPOSAL ONLY.
-- Adds a timestamp for pending 2FA enrollment expiration.
-- Existing pending enrollments have no timestamp and must restart setup.
-- DO NOT apply to live Supabase without explicit approval.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS two_factor_setup_started_at TIMESTAMPTZ;
