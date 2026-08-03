-- Expiry is capability-driven. New settings rows should not silently enable it
-- for business types that do not handle dated/perishable stock.
ALTER TABLE system_settings
    ALTER COLUMN uses_expiry_tracking SET DEFAULT FALSE;

