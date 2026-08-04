ALTER TABLE sale_returns
    ADD COLUMN IF NOT EXISTS variant_id INTEGER REFERENCES product_variants(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS item_condition VARCHAR(30) DEFAULT 'resellable';

UPDATE sale_returns AS sale_return
SET variant_id = sale.variant_id
FROM sales AS sale
WHERE sale_return.sale_id = sale.id
  AND sale_return.variant_id IS NULL
  AND sale.variant_id IS NOT NULL;

UPDATE sale_returns
SET item_condition = CASE
    WHEN lower(coalesce(reason, '')) LIKE '%damaged%' THEN 'damaged'
    WHEN lower(coalesce(reason, '')) LIKE '%expired%' THEN 'expired'
    WHEN lower(coalesce(reason, '')) LIKE '%defective%' THEN 'defective'
    ELSE 'resellable'
END
WHERE item_condition IS NULL OR item_condition = 'resellable';

CREATE INDEX IF NOT EXISTS idx_sale_returns_variant_id ON sale_returns (variant_id);
CREATE INDEX IF NOT EXISTS idx_sale_returns_item_condition ON sale_returns (branch_id, item_condition, created_at DESC);
