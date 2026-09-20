-- Fix reminders severity check constraint
ALTER TABLE reminders DROP CONSTRAINT IF EXISTS reminders_severity_check;

ALTER TABLE reminders ADD CONSTRAINT reminders_severity_check 
CHECK (severity IN ('Expired', 'Expiring Soon', 'Valid')) DEFAULT 'Valid';