-- Local proposal: persistent per-user idempotency for document creation.
-- DO NOT APPLY TO PRODUCTION until reviewed and tested.
CREATE TABLE IF NOT EXISTS public.idempotency_requests (
  user_id INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'in_progress'
    CHECK (state IN ('in_progress', 'completed')),
  response_status INTEGER,
  response_body JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_idempotency_requests_expires_at
  ON public.idempotency_requests (expires_at);
