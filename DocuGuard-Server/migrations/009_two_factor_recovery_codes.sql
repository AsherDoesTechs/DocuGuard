-- LOCAL MIGRATION PROPOSAL ONLY.
-- Review and test before any production use.
-- DO NOT apply to the live Supabase database as part of this implementation step.

CREATE TABLE IF NOT EXISTS public.user_two_factor_recovery_codes (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL
    REFERENCES public.users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_user_2fa_recovery_codes_unused
  ON public.user_two_factor_recovery_codes (user_id, id)
  WHERE used_at IS NULL;