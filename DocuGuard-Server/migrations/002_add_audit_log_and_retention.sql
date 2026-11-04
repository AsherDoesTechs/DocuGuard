-- Migration: Add audit_log table for security accountability (ISO/IEC 27001 A.12/A.16)
-- and data retention settings for lifecycle management.

-- Audit log: immutable record of security-relevant events.
-- Rows are never updated or deleted by application code; retention is
-- enforced by a separate cleanup job that deletes whole rows by age.
CREATE TABLE IF NOT EXISTS audit_log (
    id SERIAL PRIMARY KEY,
    user_id INTEGER,
    actor_user_id INTEGER,
    event_type TEXT NOT NULL,
    event_category TEXT NOT NULL,
    resource_type TEXT,
    resource_id TEXT,
    ip_address TEXT,
    user_agent TEXT,
    outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure', 'blocked')),
    details JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor_user_id ON audit_log(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_event_type ON audit_log(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_outcome ON audit_log(outcome);

-- Immutability enforcement (ISO/IEC 27001 A.12.4 / A.16.1):
--
-- The audit_log table is append-only at the SQL privilege level:
--   - INSERT is granted to PUBLIC so the application role can write audit rows.
--   - UPDATE and DELETE are revoked from PUBLIC.
--
-- CRITICAL LIMITATION: REVOKE ... FROM PUBLIC does NOT restrict:
--   - The table owner (who always has full privileges on their own table)
--   - Superusers (who bypass all privilege checks)
--   - Roles with BYPASSRLS (if row-level security were enabled)
--
-- The application connects via DATABASE_URL or DB_USER/DB_PASSWORD. If that
-- role happens to be the audit_log table owner or a superuser, it can
-- UPDATE or DELETE audit rows despite the REVOKE. The actual connection
-- role must be verified against the deployed database before claiming
-- immutability.
--
-- Row-level security with session GUCs (e.g. app.current_user_id) is
-- deliberately NOT used: a GUC is a session variable that any client
-- can SET to an arbitrary value, so it is not an authorization boundary.
-- Read authorization is enforced in the application layer by scoping every
-- audit_log read by the authenticated user's id.
--
-- RECOMMENDED DEPLOYMENT: Create a dedicated non-owner, non-superuser
-- database role for the application, set audit_log OWNER to a separate
-- administrative role, and grant only INSERT to the application role on
-- audit_log. Audit log retention (deletion of aged entries) is then an
-- operational concern performed by the administrative role, not by the
-- application role.

REVOKE UPDATE, DELETE ON audit_log FROM PUBLIC;
GRANT INSERT ON audit_log TO PUBLIC;

-- Data retention settings per user.
-- Controls how long expired/deleted documents and audit records are kept.
CREATE TABLE IF NOT EXISTS data_retention (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL UNIQUE,
    expired_documents_ttl_days INTEGER NOT NULL DEFAULT 90,
    deleted_documents_ttl_days INTEGER NOT NULL DEFAULT 30,
    audit_log_ttl_days INTEGER NOT NULL DEFAULT 365,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_data_retention_user_id ON data_retention(user_id);

-- Backfill default retention rows for existing users.
INSERT INTO data_retention (user_id, expired_documents_ttl_days, deleted_documents_ttl_days, audit_log_ttl_days)
SELECT id, 90, 30, 365 FROM users
ON CONFLICT (user_id) DO NOTHING;

-- Add deleted_at to documents for retention tracking (soft delete already uses status='deleted').
-- This column records when the soft delete occurred, distinct from updated_at.
ALTER TABLE documents
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_documents_deleted_at ON documents(deleted_at);


-- Support document soft deletion and retention.
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

ALTER TABLE public.documents
  DROP CONSTRAINT IF EXISTS documents_status_check;

ALTER TABLE public.documents
  ADD CONSTRAINT documents_status_check
  CHECK (
    status IS NULL OR status IN (
      'Expired',
      'Expiring Soon',
      'Valid',
      'active',
      'verified',
      'deleted'
    )
  );

CREATE INDEX IF NOT EXISTS idx_documents_deleted_at
  ON public.documents (deleted_at);
