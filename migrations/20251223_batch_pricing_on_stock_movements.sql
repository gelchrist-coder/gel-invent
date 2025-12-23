-- Add per-batch pricing to stock movements (Option B)
-- These prices are stored per piece/unit.

ALTER TABLE stock_movements
  ADD COLUMN IF NOT EXISTS unit_cost_price NUMERIC(10,2);

ALTER TABLE stock_movements
  ADD COLUMN IF NOT EXISTS unit_selling_price NUMERIC(10,2);

CREATE INDEX IF NOT EXISTS ix_stock_movements_unit_cost_price ON stock_movements(unit_cost_price);
CREATE INDEX IF NOT EXISTS ix_stock_movements_unit_selling_price ON stock_movements(unit_selling_price);
