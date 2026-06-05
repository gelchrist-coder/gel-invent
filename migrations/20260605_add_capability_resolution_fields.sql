ALTER TABLE system_settings
    ADD COLUMN IF NOT EXISTS capability_overrides TEXT;

ALTER TABLE products
    ADD COLUMN IF NOT EXISTS measurement_type VARCHAR(32) DEFAULT 'count';

ALTER TABLE products
    ADD COLUMN IF NOT EXISTS allows_fractional_sales BOOLEAN DEFAULT FALSE;

ALTER TABLE products
    ADD COLUMN IF NOT EXISTS quantity_step NUMERIC(10, 2) DEFAULT 1;

UPDATE products
SET measurement_type = 'count'
WHERE measurement_type IS NULL OR length(trim(measurement_type)) = 0;

UPDATE products
SET allows_fractional_sales = FALSE
WHERE allows_fractional_sales IS NULL;

UPDATE products
SET quantity_step = 1
WHERE quantity_step IS NULL OR quantity_step <= 0;