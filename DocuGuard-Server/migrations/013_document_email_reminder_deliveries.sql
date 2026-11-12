-- Tracks sent document expiration reminder emails to prevent duplicates per reminder bucket/status window.
CREATE TABLE IF NOT EXISTS public.document_email_reminder_deliveries (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  document_id INTEGER NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  reminder_bucket TEXT NOT NULL, -- expired_or_today, 1_day, 7_days, 30_days
  expiry_date DATE NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_document_email_reminder_delivery UNIQUE (user_id, document_id, reminder_bucket, expiry_date)
);

CREATE INDEX IF NOT EXISTS idx_document_email_reminder_deliveries_user
  ON public.document_email_reminder_deliveries (user_id, sent_at DESC);
