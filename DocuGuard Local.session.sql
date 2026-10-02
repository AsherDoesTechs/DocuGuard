-- =========================================================================
-- DocuGuard Local PostgreSQL Schema
--
-- THIS FILE IS A POINTER, NOT A SECOND SCHEMA.
--
-- It previously held a near-duplicate of `supabase-schema.sql` with the same
-- tables, and the two copies drifted: the local copy kept `expiry_date NOT
-- NULL`, `status DEFAULT 'valid'` and `risk_level DEFAULT 'Low'`, none of
-- which matched what the application actually writes. Applying this file gave
-- you a database the backend could not use, and there was no way to tell which
-- of the two was authoritative.
--
-- Use `supabase-schema.sql` for both local development and Supabase. It is the
-- single source of truth and is idempotent, so it is safe to re-apply to an
-- existing local database.
--
--   Local development:
--     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase-schema.sql
--
--   Existing local database (bring it up to date):
--     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase-schema.sql
--
-- The migration section inside that file is idempotent and adds anything an
-- older database is missing, so running it twice is safe.
-- =========================================================================

\echo 'Run: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase-schema.sql'
\echo 'The canonical DocuGuard schema lives in supabase-schema.sql.'