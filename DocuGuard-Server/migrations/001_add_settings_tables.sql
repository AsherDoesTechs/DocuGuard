-- Migration: Add user_settings, login_sessions tables for Profile Settings Management

CREATE TABLE IF NOT EXISTS user_settings (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL DEFAULT 1,
    default_category TEXT DEFAULT 'other',
    auto_backup BOOLEAN DEFAULT TRUE,
    reminder_before_days INTEGER DEFAULT 7,
    reminder_30days BOOLEAN DEFAULT TRUE,
    reminder_7days BOOLEAN DEFAULT TRUE,
    reminder_1day BOOLEAN DEFAULT TRUE,
    reminder_on_day BOOLEAN DEFAULT TRUE,
    theme_mode TEXT DEFAULT 'system',
    font_size TEXT DEFAULT 'medium',
    biometric_lock BOOLEAN DEFAULT FALSE,
    data_exported_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS login_sessions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL DEFAULT 1,
    device_name TEXT,
    platform TEXT,
    ip_address TEXT,
    location TEXT,
    is_current BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_active TIMESTAMPTZ DEFAULT NOW()
);

-- Add missing columns to users table for new features
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS theme_mode TEXT DEFAULT 'system',
ADD COLUMN IF NOT EXISTS font_size TEXT DEFAULT 'medium',
ADD COLUMN IF NOT EXISTS reduced_motion BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS analytics_enabled BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS crash_reports_enabled BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS data_sharing_enabled BOOLEAN DEFAULT FALSE;

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_user_settings_user_id ON user_settings(user_id);
CREATE INDEX IF NOT EXISTS idx_login_sessions_user_id ON login_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_login_sessions_current ON login_sessions(user_id, is_current);