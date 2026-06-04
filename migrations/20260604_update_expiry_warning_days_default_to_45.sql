-- Update existing default expiry warning window from 180 days to 45 days.
-- Preserve custom tenant values by only changing rows that still use the old default.
UPDATE system_settings
SET expiry_warning_days = 45
WHERE expiry_warning_days = 180;
