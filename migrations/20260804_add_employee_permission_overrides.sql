ALTER TABLE users
    ADD COLUMN IF NOT EXISTS permission_overrides JSONB;

COMMENT ON COLUMN users.permission_overrides IS
    'Owner-selected employee permissions. NULL uses the primary role preset; a JSON array is an explicit permission set.';
