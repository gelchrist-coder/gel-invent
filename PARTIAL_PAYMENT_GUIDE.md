# Partial Payment Feature

## Overview
The partial payment feature allows customers to pay a portion of their purchase upfront and put the remaining balance on credit with a creditor account.

## How It Works

### Frontend (SaleForm)
When creating a new sale:

1. Select **"partial"** as the payment method
2. A creditor selection modal will appear
3. Select an existing creditor or create a new one
4. Enter the payment details:
   - **Payment Method**: The method for the amount being paid (cash, card, mobile money, bank transfer)
   - **Amount Paid**: The portion of the total being paid immediately
5. The system automatically calculates the credit balance
6. Review the summary showing:
   - Total price
   - Amount paid (with payment method)
   - Credit balance (amount owed to creditor)

### Backend Processing
When a partial payment sale is submitted:

1. **Sale Record**: Creates a sale with `payment_method="partial"`
2. **Stock Deduction**: Deducts the full quantity from inventory
3. **Credit Calculation**: Calculates credit amount as `total_price - amount_paid`
4. **Creditor Update**: 
   - Finds or creates creditor by customer name
   - Adds credit amount to creditor's total debt
5. **Transaction Record**: Creates a credit transaction with:
   - Amount: Only the credit portion (not the full price)
   - Type: "debt"
   - Detailed notes including both paid and credit amounts

## Example Scenario

**Purchase**: 2 units @ GHS 65.00 each = **GHS 130.00 total**

**Customer pays**: GHS 80.00 in cash  
**Credit balance**: GHS 50.00

### What gets recorded:
```json
{
  "sale": {
    "product_id": 2,
    "quantity": 2,
    "total_price": 130.00,
    "payment_method": "partial",
    "customer_name": "John Doe"
  },
  "creditor": {
    "name": "John Doe",
    "total_debt": 50.00  // Only the unpaid portion
  },
  "credit_transaction": {
    "amount": 50.00,  // Only the credit portion
    "type": "debt",
    "notes": "Partial payment sale - Product x 2. Paid GHS 80.0 via cash, Credit GHS 50.0"
  }
}
```

## API Schema

### Request
```json
POST /sales
{
  "product_id": 2,
  "quantity": 2,
  "unit_price": 65.00,
  "total_price": 130.00,
  "customer_name": "John Doe",
  "payment_method": "partial",
  "amount_paid": 80.00,
  "partial_payment_method": "cash",
  "notes": "Optional notes"
}
```

### Validation Rules
- `amount_paid` must be greater than 0
- `amount_paid` must be less than `total_price`
- If paying full amount, use regular payment methods instead
- `customer_name` is required for partial payments
- Creditor must be selected in the UI

## Benefits

1. **Accurate Tracking**: Only the unpaid portion is tracked as debt
2. **Flexible Payments**: Customers can pay what they can afford immediately
3. **Clear Records**: Transaction notes show both paid and credit amounts
4. **Integrated**: Works seamlessly with existing creditors management
5. **Automatic**: System handles creditor creation and debt calculation

## Notes

- Full credit sales use `payment_method="credit"` (existing feature)
- Partial payments use `payment_method="partial"` (new feature)
- Both methods integrate with the same creditors system
- Deleting a partial payment sale correctly reverses only the credit portion
- Stock is always deducted for the full quantity (not split)
