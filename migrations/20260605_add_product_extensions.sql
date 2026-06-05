CREATE TABLE IF NOT EXISTS product_variants (
    id SERIAL PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    label VARCHAR(120) NOT NULL,
    attributes_json JSONB DEFAULT '{}'::jsonb,
    is_active BOOLEAN DEFAULT TRUE,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS product_unit_conversions (
    id SERIAL PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    unit_name VARCHAR(64) NOT NULL,
    base_quantity NUMERIC(14, 2) NOT NULL,
    is_sale_unit BOOLEAN DEFAULT TRUE,
    is_purchase_unit BOOLEAN DEFAULT FALSE,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_product_variants_product_label_unique
    ON product_variants (product_id, lower(trim(label)));

CREATE UNIQUE INDEX IF NOT EXISTS idx_product_unit_conversions_product_unit_name_unique
    ON product_unit_conversions (product_id, lower(trim(unit_name)));

CREATE INDEX IF NOT EXISTS idx_product_variants_product_sort_order
    ON product_variants (product_id, sort_order, id);

CREATE INDEX IF NOT EXISTS idx_product_unit_conversions_product_sort_order
    ON product_unit_conversions (product_id, sort_order, id);

ALTER TABLE stock_movements
    ADD COLUMN IF NOT EXISTS variant_id INTEGER;

ALTER TABLE purchases
    ADD COLUMN IF NOT EXISTS variant_id INTEGER;

ALTER TABLE sales
    ADD COLUMN IF NOT EXISTS variant_id INTEGER;

ALTER TABLE sales
    ALTER COLUMN sale_unit_type TYPE VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_stock_movements_variant_id
    ON stock_movements (variant_id);

CREATE INDEX IF NOT EXISTS idx_purchases_variant_id
    ON purchases (variant_id);

CREATE INDEX IF NOT EXISTS idx_sales_variant_id
    ON sales (variant_id);