-- Adds sale/batch tracking needed for FIFO expiry deduction and "type bought" reporting.
-- Postgres (Railway) migration.

-- 1) Link stock movements to a sale (so we can see which batches were sold)
ALTER TABLE stock_movements
  ADD COLUMN IF NOT EXISTS sale_id INTEGER NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM   pg_constraint
    WHERE  conname = 'stock_movements_sale_id_fkey'
  ) THEN
    ALTER TABLE stock_movements
      ADD CONSTRAINT stock_movements_sale_id_fkey
      FOREIGN KEY (sale_id) REFERENCES sales(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_stock_movements_sale_id ON stock_movements (sale_id);

-- 2) Store how the customer bought the item (piece vs pack)
ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS sale_unit_type VARCHAR(10) NOT NULL DEFAULT 'piece';

ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS pack_quantity INTEGER NULL;
