ALTER TABLE sales
    ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(10,2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS tax_snapshot JSONB,
    ADD COLUMN IF NOT EXISTS currency_code VARCHAR(3) DEFAULT 'GHS';

COMMENT ON COLUMN sales.discount_amount IS
    'Per-line order discount; total_price is already reduced by this amount.';
COMMENT ON COLUMN sales.tax_snapshot IS
    'Tax-inclusive receipt configuration captured when the sale was created.';
COMMENT ON COLUMN sales.currency_code IS
    'Receipt currency captured when the sale was created.';
