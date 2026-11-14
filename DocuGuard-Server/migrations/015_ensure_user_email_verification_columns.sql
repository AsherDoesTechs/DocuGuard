-- Ensure email verification token columns exist on public.users (idempotent).
-- Fixes cases where verification_token / verification_expires_at are not reflected
-- because migration 012 was not applied on the target Supabase database.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS verification_token TEXT,
  ADD COLUMN IF NOT EXISTS verification_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_verification_token
  ON public.users (verification_token);