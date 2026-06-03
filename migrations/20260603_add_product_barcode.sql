-- Add barcode support for products and enforce branch-scoped uniqueness.

ALTER TABLE products
ADD COLUMN IF NOT EXISTS barcode VARCHAR(128);

CREATE UNIQUE INDEX IF NOT EXISTS idx_products_branch_lower_barcode_unique
ON products (branch_id, lower(trim(barcode)))
WHERE barcode IS NOT NULL AND length(trim(barcode)) > 0;
