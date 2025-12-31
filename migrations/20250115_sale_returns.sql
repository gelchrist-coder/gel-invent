-- Migration: Add sale_returns table for tracking customer returns
-- Date: 2025-01-XX

-- Create sale_returns table
CREATE TABLE IF NOT EXISTS sale_returns (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    branch_id INTEGER NOT NULL REFERENCES branches(id),
    sale_id INTEGER NOT NULL REFERENCES sales(id),
    product_id INTEGER NOT NULL REFERENCES products(id),
    quantity_returned INTEGER NOT NULL CHECK (quantity_returned > 0),
    refund_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    refund_method VARCHAR(50) NOT NULL DEFAULT 'cash',  -- cash, credit_to_account, exchange, store_credit
    reason TEXT NOT NULL,
    restock BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Add indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_sale_returns_user_id ON sale_returns(user_id);
CREATE INDEX IF NOT EXISTS idx_sale_returns_branch_id ON sale_returns(branch_id);
CREATE INDEX IF NOT EXISTS idx_sale_returns_sale_id ON sale_returns(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_returns_product_id ON sale_returns(product_id);
CREATE INDEX IF NOT EXISTS idx_sale_returns_created_at ON sale_returns(created_at);

-- Grant permissions (if using role-based access)
-- GRANT SELECT, INSERT, UPDATE, DELETE ON sale_returns TO your_app_role;
-- GRANT USAGE, SELECT ON SEQUENCE sale_returns_id_seq TO your_app_role;
