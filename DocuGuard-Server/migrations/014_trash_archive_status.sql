-- Add trash/archive support and soft-delete lifecycle
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS trashed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Ensure status supports common values; keep backward compatible
UPDATE public.documents
SET status = COALESCE(status, 'active')
WHERE status IS NULL;

CREATE INDEX IF NOT EXISTS idx_documents_user_status ON public.documents (user_id, status);
CREATE INDEX IF NOT EXISTS idx_documents_archived ON public.documents (user_id, is_archived) WHERE is_archived = TRUE;
CREATE INDEX IF NOT EXISTS idx_documents_trashed ON public.documents (user_id, trashed_at) WHERE trashed_at IS NOT NULL;
