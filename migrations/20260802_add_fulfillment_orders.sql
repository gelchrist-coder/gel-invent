CREATE TABLE IF NOT EXISTS fulfillment_orders (
    id SERIAL PRIMARY KEY,
    owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    warehouse_id INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
    created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    external_order_id VARCHAR(120),
    source VARCHAR(50) NOT NULL DEFAULT 'manual',
    status VARCHAR(30) NOT NULL DEFAULT 'reserved',
    customer_name VARCHAR(255) NOT NULL,
    customer_phone VARCHAR(50),
    customer_email VARCHAR(255),
    delivery_address TEXT,
    notes TEXT,
    total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    picked_at TIMESTAMPTZ,
    packed_at TIMESTAMPTZ,
    dispatched_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fulfillment_orders_owner_external_unique
    ON fulfillment_orders (owner_user_id, source, external_order_id)
    WHERE external_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fulfillment_orders_warehouse_status
    ON fulfillment_orders (warehouse_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS fulfillment_order_items (
    id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES fulfillment_orders(id) ON DELETE CASCADE,
    warehouse_item_id INTEGER NOT NULL REFERENCES warehouse_stock_items(id) ON DELETE RESTRICT,
    sku VARCHAR(64) NOT NULL,
    product_name VARCHAR(255) NOT NULL,
    quantity NUMERIC(14,2) NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC(10,2) NOT NULL DEFAULT 0,
    line_total NUMERIC(12,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fulfillment_items_order ON fulfillment_order_items (order_id);
CREATE INDEX IF NOT EXISTS idx_fulfillment_items_warehouse_item ON fulfillment_order_items (warehouse_item_id);
