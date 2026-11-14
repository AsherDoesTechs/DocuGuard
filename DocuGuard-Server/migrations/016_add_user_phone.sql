-- Add phone number to users profile (idempotent).
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS phone TEXT;
