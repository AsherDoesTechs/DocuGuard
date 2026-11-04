-- Draft migration: DocuGuard Admin identity and trusted-device security.
-- LOCAL DRAFT ONLY. Do not execute against Supabase or production.
-- Review and test before any future application.

BEGIN;

-- Ensure role support exists even if migration 004 has not been applied.
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

-- Administrator-assigned identity. Ordinary mobile accounts may leave this NULL.
ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS admin_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_admin_id_lower
    ON public.users (LOWER(BTRIM(admin_id)))
    WHERE admin_id IS NOT NULL AND BTRIM(admin_id) <> '';

-- Only previously authorized public keys may authenticate an administrator device.
CREATE TABLE IF NOT EXISTS public.admin_devices (
    id BIGSERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL
        REFERENCES public.users(id) ON DELETE RESTRICT,
    device_label TEXT,
    public_key_pem TEXT NOT NULL,
    key_algorithm TEXT NOT NULL DEFAULT 'ECDSA_P256_SHA256'
        CHECK (key_algorithm = 'ECDSA_P256_SHA256'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_admin_devices_user_active
    ON public.admin_devices (user_id, id)
    WHERE revoked_at IS NULL;

-- One-time enrollment grants are created through a separate, controlled
-- provisioning procedure. Store only a cryptographic hash of each grant.
CREATE TABLE IF NOT EXISTS public.admin_device_enrollment_tokens (
    id BIGSERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL
        REFERENCES public.users(id) ON DELETE RESTRICT,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_enrollment_tokens_user
    ON public.admin_device_enrollment_tokens (user_id, expires_at)
    WHERE used_at IS NULL;

-- Challenges are tied to one administrator and one registered device.
-- The backend must consume a challenge only once and reject expired/revoked devices.
CREATE TABLE IF NOT EXISTS public.admin_device_challenges (
    challenge_id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL
        REFERENCES public.users(id) ON DELETE RESTRICT,
    device_id BIGINT NOT NULL
        REFERENCES public.admin_devices(id) ON DELETE RESTRICT,
    challenge_value TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_challenges_expiry
    ON public.admin_device_challenges (expires_at)
    WHERE used_at IS NULL;

-- Short-lived proof of password and any required TOTP verification.
-- This is not an administrator session.
CREATE TABLE IF NOT EXISTS public.admin_login_attempts (
    id BIGSERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL
        REFERENCES public.users(id) ON DELETE RESTRICT,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_login_attempts_expiry
    ON public.admin_login_attempts (expires_at)
    WHERE used_at IS NULL;

-- Bind each device challenge to the exact pending login that requested it.
ALTER TABLE public.admin_device_challenges
    ADD COLUMN IF NOT EXISTS login_attempt_id BIGINT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'admin_device_challenges_login_attempt_fk'
          AND conrelid = 'public.admin_device_challenges'::regclass
    ) THEN
        ALTER TABLE public.admin_device_challenges
            ADD CONSTRAINT admin_device_challenges_login_attempt_fk
            FOREIGN KEY (login_attempt_id)
            REFERENCES public.admin_login_attempts(id)
            ON DELETE RESTRICT;
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_admin_challenges_login_attempt
    ON public.admin_device_challenges (login_attempt_id);

COMMIT;
