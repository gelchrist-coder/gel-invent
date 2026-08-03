ALTER TABLE purchases
    ADD COLUMN IF NOT EXISTS warehouse_id INTEGER REFERENCES warehouses(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS warehouse_item_id INTEGER REFERENCES warehouse_stock_items(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS warehouse_stock_movement_id INTEGER REFERENCES warehouse_stock_movements(id) ON DELETE SET NULL;

ALTER TABLE supplier_payments
    ADD COLUMN IF NOT EXISTS warehouse_id INTEGER REFERENCES warehouses(id) ON DELETE CASCADE;

ALTER TABLE purchase_returns
    ADD COLUMN IF NOT EXISTS warehouse_id INTEGER REFERENCES warehouses(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS warehouse_item_id INTEGER REFERENCES warehouse_stock_items(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS warehouse_stock_movement_id INTEGER REFERENCES warehouse_stock_movements(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_purchases_warehouse_id ON purchases (warehouse_id);
CREATE INDEX IF NOT EXISTS idx_purchases_warehouse_item_id ON purchases (warehouse_item_id);
CREATE INDEX IF NOT EXISTS idx_purchases_warehouse_movement_id ON purchases (warehouse_stock_movement_id);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_warehouse_id ON supplier_payments (warehouse_id);
CREATE INDEX IF NOT EXISTS idx_purchase_returns_warehouse_id ON purchase_returns (warehouse_id);
CREATE INDEX IF NOT EXISTS idx_purchase_returns_warehouse_item_id ON purchase_returns (warehouse_item_id);
CREATE INDEX IF NOT EXISTS idx_purchase_returns_warehouse_movement_id ON purchase_returns (warehouse_stock_movement_id);

COMMENT ON COLUMN purchases.warehouse_id IS
    'When set, the supplier delivery was received directly into this warehouse instead of a branch.';

-- Warehouse users created before warehouse procurement existed received an
-- explicit warehouse-only override from the employee form. Upgrade that old
-- default once; owners can still customize responsibilities afterward.
UPDATE users
SET permission_overrides = (
    SELECT jsonb_agg(DISTINCT permission ORDER BY permission)
    FROM jsonb_array_elements_text(
        COALESCE(permission_overrides, '[]'::jsonb)
        || '["manage_procurement", "view_procurement"]'::jsonb
    ) AS permissions(permission)
)
WHERE lower(trim(role)) = 'warehouse'
  AND permission_overrides IS NOT NULL;
