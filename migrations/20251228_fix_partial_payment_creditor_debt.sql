-- Fix historical partial-payment sales that incorrectly created a payment transaction
-- and therefore subtracted the upfront payment twice from creditor outstanding.
--
-- Intended behavior (see PARTIAL_PAYMENT_GUIDE.md):
-- - For payment_method = 'partial', only the unpaid portion is recorded as a single 'debt' transaction.
-- - No 'payment' transaction should be linked to the sale.

-- 1) Remove wrongly-created payment transactions for partial sales.
DELETE FROM credit_transactions ct
USING sales s
WHERE ct.sale_id = s.id
  AND s.payment_method = 'partial'
  AND ct.transaction_type = 'payment';

-- 2) Recompute creditors.total_debt from remaining transactions.
--    (total_debt = sum(debt) - sum(payment))
UPDATE creditors c
SET total_debt = COALESCE(
  (
    SELECT SUM(
      CASE
        WHEN ct.transaction_type = 'debt' THEN ct.amount
        WHEN ct.transaction_type = 'payment' THEN -ct.amount
        ELSE 0
      END
    )
    FROM credit_transactions ct
    WHERE ct.creditor_id = c.id
  ),
  0
);
