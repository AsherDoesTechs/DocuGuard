
-- Migration 004: Add explicit user roles for administrator authorization.
-- Review and apply to the target database only after local verification.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_role_check'
      AND conrelid = 'public.users'::regclass
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_role_check
      CHECK (role IN ('user', 'admin'));
  END IF;
END
$$;

COMMENT ON COLUMN public.users.role IS
  'Authorization role. New and existing accounts default to user; admin assignment requires controlled provisioning.';
