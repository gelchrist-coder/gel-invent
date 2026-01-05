-- Add uses_expiry_tracking column to system_settings table
-- Defaults to TRUE (most businesses use expiry tracking)

ALTER TABLE system_settings 
ADD COLUMN IF NOT EXISTS uses_expiry_tracking BOOLEAN NOT NULL DEFAULT TRUE;

-- Update any existing NULL values to TRUE
UPDATE system_settings SET uses_expiry_tracking = TRUE WHERE uses_expiry_tracking IS NULL;
