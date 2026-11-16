-- Migration 018: Persist a stable user display/serial ID (DG-USER-####).
-- The profile screen previously derived this from local document count, so the
-- value changed as documents changed and did not reflect backend identity.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS display_id TEXT;

UPDATE public.users
SET display_id = 'DG-USER-' || LPAD(id::text, 4, '0')
WHERE display_id IS NULL OR BTRIM(display_id) = '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_display_id
  ON public.users(display_id)
  WHERE display_id IS NOT NULL;