-- Make expiry_date nullable to support incomplete OCR drafts.
-- Safe: only drops NOT NULL if present; preserves existing values.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'documents'
      AND column_name = 'expiry_date' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE public.documents ALTER COLUMN expiry_date DROP NOT NULL;
  END IF;
END $$;
SQL