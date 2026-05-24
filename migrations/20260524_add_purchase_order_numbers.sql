ALTER TABLE purchases
ADD COLUMN IF NOT EXISTS order_number VARCHAR(80);

ALTER TABLE supplier_payments
ADD COLUMN IF NOT EXISTS order_number VARCHAR(80);

CREATE INDEX IF NOT EXISTS idx_purchases_order_number
ON purchases (order_number);

CREATE INDEX IF NOT EXISTS idx_supplier_payments_order_number
ON supplier_payments (order_number);