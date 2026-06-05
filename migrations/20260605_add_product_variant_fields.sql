ALTER TABLE products
    ADD COLUMN IF NOT EXISTS variant_group VARCHAR(120);

ALTER TABLE products
    ADD COLUMN IF NOT EXISTS variant_label VARCHAR(120);

ALTER TABLE products
    ADD COLUMN IF NOT EXISTS brand VARCHAR(100);

ALTER TABLE products
    ADD COLUMN IF NOT EXISTS size VARCHAR(64);

ALTER TABLE products
    ADD COLUMN IF NOT EXISTS color VARCHAR(64);

ALTER TABLE products
    ADD COLUMN IF NOT EXISTS shade VARCHAR(64);

UPDATE products
SET variant_group = NULL
WHERE variant_group IS NOT NULL AND length(trim(variant_group)) = 0;

UPDATE products
SET variant_label = NULL
WHERE variant_label IS NOT NULL AND length(trim(variant_label)) = 0;

UPDATE products
SET brand = NULL
WHERE brand IS NOT NULL AND length(trim(brand)) = 0;

UPDATE products
SET size = NULL
WHERE size IS NOT NULL AND length(trim(size)) = 0;

UPDATE products
SET color = NULL
WHERE color IS NOT NULL AND length(trim(color)) = 0;

UPDATE products
SET shade = NULL
WHERE shade IS NOT NULL AND length(trim(shade)) = 0;

DROP INDEX IF EXISTS idx_products_branch_lower_name_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_products_branch_variant_signature_unique
    ON products (
        branch_id,
        lower(trim(name)),
        lower(trim(coalesce(variant_group, ''))),
        lower(trim(coalesce(variant_label, ''))),
        lower(trim(coalesce(brand, ''))),
        lower(trim(coalesce(size, ''))),
        lower(trim(coalesce(color, ''))),
        lower(trim(coalesce(shade, '')))
    );