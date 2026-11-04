-- Migration 006: Account-specific privacy consent event history.
-- LOCAL DRAFT ONLY. Review permissions and retention before deployment.
-- Proposed post-deletion retention: 365 days, subject to policy review.

BEGIN;

CREATE TABLE IF NOT EXISTS public.privacy_consent_records (
    id BIGSERIAL PRIMARY KEY,

    -- Nullable after account deletion; direct account link is removed.
    user_id INTEGER
        REFERENCES public.users(id) ON DELETE SET NULL,

    notice_version TEXT NOT NULL
        CHECK (length(trim(notice_version)) BETWEEN 1 AND 50),

    event_type TEXT NOT NULL
        CHECK (event_type IN ('accepted', 'withdrawn')),

    notice_acknowledged BOOLEAN NOT NULL,
    processing_agreed BOOLEAN NOT NULL,

    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Set when the account link is removed.
    detached_at TIMESTAMPTZ,

    CONSTRAINT privacy_consent_event_choices_check CHECK (
        (event_type = 'accepted'
            AND notice_acknowledged = TRUE
            AND processing_agreed = TRUE)
        OR
        (event_type = 'withdrawn'
            AND notice_acknowledged = TRUE
            AND processing_agreed = FALSE)
    ),

    CONSTRAINT privacy_consent_detached_check CHECK (
        (user_id IS NOT NULL AND detached_at IS NULL)
        OR
        (user_id IS NULL AND detached_at IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_privacy_consent_user_occurred
    ON public.privacy_consent_records (user_id, occurred_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_privacy_consent_user_version
    ON public.privacy_consent_records (user_id, notice_version);

CREATE INDEX IF NOT EXISTS idx_privacy_consent_detached_at
    ON public.privacy_consent_records (detached_at)
    WHERE detached_at IS NOT NULL;

-- Allow only the account-link detachment transition.
-- Historical event fields cannot be edited by ordinary UPDATE statements.
CREATE OR REPLACE FUNCTION public.set_privacy_consent_detached_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.notice_version IS DISTINCT FROM OLD.notice_version
       OR NEW.event_type IS DISTINCT FROM OLD.event_type
       OR NEW.notice_acknowledged IS DISTINCT FROM OLD.notice_acknowledged
       OR NEW.processing_agreed IS DISTINCT FROM OLD.processing_agreed
       OR NEW.occurred_at IS DISTINCT FROM OLD.occurred_at
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'Consent event history cannot be edited';
    END IF;

    IF OLD.user_id IS NOT NULL
       AND NEW.user_id IS NULL
       AND OLD.detached_at IS NULL THEN
        NEW.detached_at := NOW();
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'Only account-link detachment is permitted';
END;
$$;

DROP TRIGGER IF EXISTS trg_privacy_consent_detached_at
    ON public.privacy_consent_records;

CREATE TRIGGER trg_privacy_consent_detached_at
BEFORE UPDATE ON public.privacy_consent_records
FOR EACH ROW
EXECUTE FUNCTION public.set_privacy_consent_detached_at();
-- Baseline restriction only. Actual protection depends on ownership,
-- effective database role, and grants; verify before claiming immutability.
REVOKE UPDATE, DELETE ON public.privacy_consent_records FROM PUBLIC;

COMMIT;

