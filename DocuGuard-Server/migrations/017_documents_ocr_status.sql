-- OCR telemetry/status for Admin Health (and document workflow).
-- Idempotent: safe to run against existing databases.

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS ocr_status TEXT NOT NULL DEFAULT 'pending';

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS ocr_error TEXT;

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS ocr_completed_at TIMESTAMPTZ;

UPDATE public.documents
SET ocr_status = 'completed'
WHERE ocr_status IS NULL
   OR LOWER(TRIM(ocr_status)) IN ('', 'unknown');

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'documents'
      AND column_name = 'processing_status'
  ) THEN
    UPDATE public.documents
    SET ocr_status = CASE
        WHEN LOWER(COALESCE(processing_status, '')) IN ('completed', 'verified') THEN 'completed'
        WHEN LOWER(COALESCE(processing_status, '')) IN ('failed', 'rejected') THEN 'failed'
        WHEN LOWER(COALESCE(processing_status, '')) IN ('processing', 'pending', 'ocr_pending', 'manual_review') THEN 'pending'
        ELSE 'completed'
      END
    WHERE ocr_status = 'pending'
      AND processing_status IS NOT NULL
      AND TRIM(processing_status) <> '';
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_documents_ocr_status ON public.documents (ocr_status);

ALTER TABLE public.documents
  DROP CONSTRAINT IF EXISTS documents_ocr_status_chk;

ALTER TABLE public.documents
  ADD CONSTRAINT documents_ocr_status_chk
  CHECK (LOWER(ocr_status) IN ('pending', 'completed', 'failed', 'unknown'));
