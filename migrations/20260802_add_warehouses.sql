CREATE TABLE IF NOT EXISTS warehouses (
    id SERIAL PRIMARY KEY,
    owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    address TEXT,
    contact_name VARCHAR(255),
    phone VARCHAR(50),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_warehouses_owner_lower_name_unique
    ON warehouses (owner_user_id, lower(trim(name)));

CREATE TABLE IF NOT EXISTS warehouse_stock_items (
    id SERIAL PRIMARY KEY,
    owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    warehouse_id INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    source_product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    sku VARCHAR(64) NOT NULL,
    name VARCHAR(255) NOT NULL,
    unit VARCHAR(32) NOT NULL DEFAULT 'unit',
    category VARCHAR(100),
    cost_price NUMERIC(10,2),
    selling_price NUMERIC(10,2),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_warehouse_items_warehouse_lower_sku_unique
    ON warehouse_stock_items (warehouse_id, lower(trim(sku)));

CREATE TABLE IF NOT EXISTS warehouse_stock_movements (
    id SERIAL PRIMARY KEY,
    owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    warehouse_id INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    item_id INTEGER NOT NULL REFERENCES warehouse_stock_items(id) ON DELETE CASCADE,
    actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
    change NUMERIC(14,2) NOT NULL,
    reason VARCHAR(255) NOT NULL,
    reference VARCHAR(100),
    batch_number VARCHAR(100),
    expiry_date DATE,
    unit_cost_price NUMERIC(10,2),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_warehouse_movements_location_product
    ON warehouse_stock_movements (warehouse_id, item_id, created_at);
CREATE INDEX IF NOT EXISTS idx_warehouse_movements_owner
    ON warehouse_stock_movements (owner_user_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_movements_reference
    ON warehouse_stock_movements (reference);
