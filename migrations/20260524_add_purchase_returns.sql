CREATE TABLE IF NOT EXISTS purchase_returns (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    branch_id INTEGER REFERENCES branches(id) ON DELETE CASCADE,
    supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
    purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    stock_movement_id INTEGER REFERENCES stock_movements(id) ON DELETE SET NULL,
    order_number VARCHAR(80),
    quantity_returned NUMERIC(14, 2) NOT NULL,
    unit_cost_price NUMERIC(10, 2) NOT NULL,
    total_cost_returned NUMERIC(12, 2) NOT NULL,
    return_date DATE,
    reason VARCHAR(255),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_purchase_returns_user_id ON purchase_returns (user_id);
CREATE INDEX IF NOT EXISTS idx_purchase_returns_branch_id ON purchase_returns (branch_id);
CREATE INDEX IF NOT EXISTS idx_purchase_returns_supplier_id ON purchase_returns (supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchase_returns_purchase_id ON purchase_returns (purchase_id);
CREATE INDEX IF NOT EXISTS idx_purchase_returns_product_id ON purchase_returns (product_id);
CREATE INDEX IF NOT EXISTS idx_purchase_returns_stock_movement_id ON purchase_returns (stock_movement_id);
CREATE INDEX IF NOT EXISTS idx_purchase_returns_order_number ON purchase_returns (order_number);