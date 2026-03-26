from datetime import date
from decimal import Decimal
from html import escape

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import get_current_active_user
from ..database import get_db
from .. import models
from ..schemas import SaleCreate, SaleRead
from app.utils.tenant import get_tenant_user_ids
from app.utils.branch import get_active_branch_id
from app.utils.expiry import get_batch_balances, writeoff_expired_batches
from app.utils.email import send_email, smtp_configured

router = APIRouter(prefix="/sales", tags=["sales"])


class SendReceiptEmailRequest(BaseModel):
    sale_ids: list[int] = Field(..., min_length=1)
    to_email: EmailStr
    customer_name: str | None = None


class SendReceiptEmailResponse(BaseModel):
    message: str


@router.post("", response_model=SaleRead, status_code=201)
def create_sale(
    payload: SaleCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
    active_branch_id: int = Depends(get_active_branch_id),
):
    """
    Create a new sale and deduct stock.
    If payment method is credit or partial, create a credit transaction.
    For partial payments, only the unpaid portion is recorded as credit.
    """
    tenant_user_ids = get_tenant_user_ids(current_user, db)

    # Auto-writeoff expired batches for this product before checking availability.
    writeoff_expired_batches(
        db=db,
        actor_user_id=current_user.id,
        tenant_user_ids=tenant_user_ids,
        branch_id=active_branch_id,
        product_id=payload.product_id,
    )
    db.flush()

    # Idempotency for offline/poor-network retries
    if payload.client_sale_id:
        existing = db.scalar(
            select(models.Sale).where(
                models.Sale.branch_id == active_branch_id,
                models.Sale.user_id.in_(tenant_user_ids),
                models.Sale.client_sale_id == payload.client_sale_id,
            )
        )
        if existing:
            return existing

    # Verify product exists and belongs to current user's tenant
    product = db.scalar(
        select(models.Product).where(
            models.Product.id == payload.product_id,
            models.Product.user_id.in_(tenant_user_ids),
            models.Product.branch_id == active_branch_id,
        )
    )
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    available_stock = db.scalar(
        select(func.coalesce(func.sum(models.StockMovement.change), 0)).where(
            models.StockMovement.product_id == payload.product_id,
            models.StockMovement.branch_id == active_branch_id,
            models.StockMovement.user_id.in_(tenant_user_ids),
        )
    )
    if available_stock is None:
        available_stock = Decimal(0)
    if payload.quantity > available_stock:
        raise HTTPException(
            status_code=400,
            detail=f"Insufficient stock. Available: {available_stock}",
        )

    # Create the sale
    sale = models.Sale(
        user_id=current_user.id,
        branch_id=active_branch_id,
        product_id=payload.product_id,
        quantity=payload.quantity,
        sale_unit_type=(payload.sale_unit_type or "piece"),
        pack_quantity=payload.pack_quantity,
        unit_price=payload.unit_price,
        total_price=payload.total_price,
        customer_name=payload.customer_name,
        payment_method=payload.payment_method,
        amount_paid=payload.amount_paid,
        partial_payment_method=payload.partial_payment_method,
        notes=payload.notes,
        client_sale_id=payload.client_sale_id,
    )
    db.add(sale)
    db.flush()  # Flush to get sale.id

    # Deduct stock FIFO by earliest expiry date (non-expiring batches are sold last).
    today = date.today()
    balances = get_batch_balances(
        db=db,
        tenant_user_ids=tenant_user_ids,
        branch_id=active_branch_id,
        product_id=payload.product_id,
        include_null_expiry=True,
    )

    # Only consider batches that have stock remaining and are not expired.
    available_batches = [
        b
        for b in balances
        if b.balance > 0 and (b.expiry_date is None or b.expiry_date >= today)
    ]
    available_batches.sort(
        key=lambda b: (
            1 if b.expiry_date is None else 0,
            b.expiry_date or date.max,
        )
    )

    # Build a map of batch_number -> latest known unit_cost_price for stock-in movements.
    batch_numbers = sorted({b.batch_number for b in available_batches if b.batch_number})
    unit_cost_by_batch: dict[str, Decimal | None] = {}
    if batch_numbers:
        rows = db.execute(
            select(
                models.StockMovement.batch_number,
                models.StockMovement.unit_cost_price,
                models.StockMovement.created_at,
            )
            .where(
                models.StockMovement.product_id == payload.product_id,
                models.StockMovement.branch_id == active_branch_id,
                models.StockMovement.user_id.in_(tenant_user_ids),
                models.StockMovement.batch_number.in_(batch_numbers),
                models.StockMovement.change > 0,
            )
            .order_by(models.StockMovement.batch_number.asc(), models.StockMovement.created_at.desc())
        ).all()

        for bn, unit_cost, _created_at in rows:
            if bn is None:
                continue
            bn_str = str(bn)
            if bn_str not in unit_cost_by_batch:
                unit_cost_by_batch[bn_str] = unit_cost

    remaining = payload.quantity
    deducted_batches: list[dict[str, object]] = []

    for b in available_batches:
        if remaining <= 0:
            break
        take = b.balance if b.balance <= remaining else remaining
        if take <= 0:
            continue

        db.add(
            models.StockMovement(
                user_id=current_user.id,
                branch_id=active_branch_id,
                product_id=payload.product_id,
                sale_id=sale.id,
                change=-take,
                reason="Sale",
                batch_number=b.batch_number,
                expiry_date=b.expiry_date,
                unit_cost_price=unit_cost_by_batch.get(b.batch_number) if b.batch_number else (product.cost_price if product.cost_price is not None else None),
                unit_selling_price=sale.unit_price,
            )
        )
        deducted_batches.append(
            {
                "batch_number": b.batch_number,
                "expiry_date": b.expiry_date.isoformat() if b.expiry_date else None,
                "quantity": float(take),
            }
        )
        remaining = remaining - take

    # If we still have remaining quantity, it means some historical stock was not batch-tracked.
    # Deduct the remainder without batch attribution (keeps stock accurate, but won't show expiry).
    if remaining > 0:
        db.add(
            models.StockMovement(
                user_id=current_user.id,
                branch_id=active_branch_id,
                product_id=payload.product_id,
                sale_id=sale.id,
                change=-remaining,
                reason="Sale",
                unit_cost_price=product.cost_price if product.cost_price is not None else None,
                unit_selling_price=sale.unit_price,
            )
        )
        deducted_batches.append(
            {
                "batch_number": None,
                "expiry_date": None,
                "quantity": float(remaining),
            }
        )
        remaining = Decimal(0)

    # Handle credit transactions
    #
    # IMPORTANT:
    # - Full credit: entire amount is debt.
    # - Partial: only the unpaid portion is recorded as debt (no separate "initial payment"
    #   CreditTransaction should be created; otherwise we would subtract the upfront payment twice).
    credit_amount = Decimal(0)

    if payload.payment_method == "credit":
        # Full credit - entire amount goes to creditor
        credit_amount = payload.total_price
    elif payload.payment_method == "partial" and payload.amount_paid:
        # Partial payment - only unpaid portion goes to creditor
        credit_amount = payload.total_price - payload.amount_paid

        # Validate partial payment
        if credit_amount <= 0:
            raise HTTPException(
                status_code=400,
                detail="Amount paid should be less than total price for partial payments",
            )
    
    # Create creditor transaction if there's credit involved
    if credit_amount > 0 and payload.customer_name:
        # Extract phone number from notes if present
        phone_number = None
        if payload.notes:
            import re
            phone_match = re.search(r'Phone: ([\d\s\-\+]+)', payload.notes)
            if phone_match:
                phone_number = phone_match.group(1).strip()
        
        # Find or create creditor by name for current user's tenant
        creditor = db.scalar(
            select(models.Creditor).where(
                models.Creditor.name == payload.customer_name,
                models.Creditor.user_id.in_(tenant_user_ids),
                models.Creditor.branch_id == active_branch_id,
            )
        )
        
        if not creditor:
            # Create new creditor if doesn't exist
            creditor = models.Creditor(
                user_id=current_user.id,
                branch_id=active_branch_id,
                name=payload.customer_name,
                phone=phone_number,
                total_debt=credit_amount,
            )
            db.add(creditor)
            db.flush()
        else:
            # Update existing creditor's debt and phone if provided
            creditor.total_debt += credit_amount
            if phone_number and not creditor.phone:
                creditor.phone = phone_number
        
        # Build transaction notes
        if payload.payment_method == "partial":
            notes = (
                f"Partial payment sale - {product.name} x {payload.quantity}. "
                f"Paid GHS {payload.amount_paid} via {payload.partial_payment_method}, "
                f"Credit GHS {credit_amount}"
            )
        else:
            notes = f"Credit sale - {product.name} x {payload.quantity}"
        
        # Create debt transaction
        credit_transaction = models.CreditTransaction(
            user_id=current_user.id,
            branch_id=active_branch_id,
            creditor_id=creditor.id,
            sale_id=sale.id,
            amount=credit_amount,
            transaction_type="debt",
            notes=notes,
        )
        db.add(credit_transaction)
        
        # Create payment transaction only for "credit" sales.
        # For "partial" sales, the upfront payment is NOT part of the creditor ledger;
        # the debt transaction already represents only the unpaid portion.
        if payload.payment_method == "credit" and payload.amount_paid and payload.amount_paid > 0:
            creditor.total_debt -= payload.amount_paid
            payment_transaction = models.CreditTransaction(
                user_id=current_user.id,
                branch_id=active_branch_id,
                creditor_id=creditor.id,
                sale_id=sale.id,
                amount=payload.amount_paid,
                transaction_type="payment",
                notes=f"Initial payment for {product.name} x {payload.quantity}",
            )
            db.add(payment_transaction)

    db.commit()
    db.refresh(sale)

    # Attach batch deduction info for the client.
    sale.deducted_batches = deducted_batches
    return sale


@router.post("/bulk", response_model=list[SaleRead], status_code=201)
def create_sales_bulk(
    payloads: list[SaleCreate],
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
    active_branch_id: int = Depends(get_active_branch_id),
):
    """Create multiple sales in one request (bulk checkout).

    This is primarily a POS performance endpoint to avoid N sequential HTTP requests.
    Each item uses the same create_sale logic (including idempotency).
    """
    if not payloads:
        raise HTTPException(status_code=400, detail="No sales provided")

    created: list[models.Sale] = []
    for payload in payloads:
        created.append(
            create_sale(
                payload=payload,
                db=db,
                current_user=current_user,
                active_branch_id=active_branch_id,
            )
        )
    return created


@router.post("/send-receipt", response_model=SendReceiptEmailResponse)
def send_sale_receipt_email(
    payload: SendReceiptEmailRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
    active_branch_id: int = Depends(get_active_branch_id),
):
    """Email a receipt for one or more sales.

    Owner-only action to avoid staff sending customer emails without approval.
    """
    if current_user.role != "Admin":
        raise HTTPException(status_code=403, detail="Only business owners can email receipts")

    if not smtp_configured():
        raise HTTPException(status_code=400, detail="Email service is not configured")

    tenant_user_ids = get_tenant_user_ids(current_user, db)
    unique_sale_ids = sorted(set(payload.sale_ids))

    sales = db.scalars(
        select(models.Sale).where(
            models.Sale.id.in_(unique_sale_ids),
            models.Sale.user_id.in_(tenant_user_ids),
            models.Sale.branch_id == active_branch_id,
        )
    ).all()

    if len(sales) != len(unique_sale_ids):
        raise HTTPException(status_code=404, detail="One or more sales were not found")

    product_ids = sorted({int(s.product_id) for s in sales})
    products = db.scalars(select(models.Product).where(models.Product.id.in_(product_ids))).all() if product_ids else []
    product_name_by_id = {int(p.id): p.name for p in products}

    sales_sorted = sorted(sales, key=lambda s: (s.created_at, s.id))
    total_amount = sum(Decimal(s.total_price or 0) for s in sales_sorted)
    amount_paid = sum(Decimal(s.amount_paid or 0) for s in sales_sorted)
    customer_name = (
        (payload.customer_name or "").strip()
        or (sales_sorted[0].customer_name or "").strip()
        or "Customer"
    )
    payment_method = (sales_sorted[0].payment_method or "cash").upper()

    receipt_number_source = sales_sorted[0].client_sale_id or str(sales_sorted[0].id)
    receipt_number = str(receipt_number_source).split(":")[0][-8:].upper()

    lines: list[str] = []
    item_rows_html: list[str] = []
    for sale in sales_sorted:
        product_name = product_name_by_id.get(int(sale.product_id), f"Product #{sale.product_id}")
        quantity = Decimal(sale.quantity or 0)
        unit_price = Decimal(sale.unit_price or 0)
        line_total = Decimal(sale.total_price or 0)
        lines.append(
            f"- {product_name}: {quantity} x GHS {unit_price:.2f} = GHS {line_total:.2f}"
        )
        item_rows_html.append(
            "<tr>"
            f"<td style='padding:10px;border-bottom:1px solid #edf2f7'>{escape(product_name)}</td>"
            f"<td style='padding:10px;border-bottom:1px solid #edf2f7;text-align:right'>{quantity}</td>"
            f"<td style='padding:10px;border-bottom:1px solid #edf2f7;text-align:right'>GHS {unit_price:.2f}</td>"
            f"<td style='padding:10px;border-bottom:1px solid #edf2f7;text-align:right;font-weight:700'>GHS {line_total:.2f}</td>"
            "</tr>"
        )

    business_name = (current_user.business_name or "Gel Invent Business").strip()
    served_by = (current_user.name or "Owner").strip()
    receipt_datetime = sales_sorted[0].created_at.strftime("%Y-%m-%d %H:%M")

    body_lines = [
        f"{business_name}",
        "Sales Receipt",
        "",
        f"Receipt No: {receipt_number}",
        f"Date: {receipt_datetime}",
        f"Served by: {served_by}",
        f"Customer: {customer_name}",
        "",
        "Items:",
        *lines,
        "",
        f"Payment Method: {payment_method}",
        f"Total: GHS {total_amount:.2f}",
    ]

    if amount_paid > 0:
        body_lines.append(f"Amount Paid: GHS {amount_paid:.2f}")

    if payment_method == "CREDIT" and amount_paid > 0:
        balance = total_amount - amount_paid
        body_lines.append(f"Balance: GHS {balance:.2f}")

    body_lines.extend([
        "",
        "Thank you for your purchase.",
        "",
        "Sent from Gel Invent",
    ])

    outstanding_balance = total_amount - amount_paid if amount_paid > 0 else total_amount
    summary_extra_text = ""
    summary_extra_html = ""

    if amount_paid > 0:
        summary_extra_html += (
            f"<tr><td style='padding:6px 0;color:#475569'>Amount Paid</td>"
            f"<td style='padding:6px 0;text-align:right;font-weight:600'>GHS {amount_paid:.2f}</td></tr>"
        )
        if payment_method in {"CREDIT", "PARTIAL"}:
            summary_extra_html += (
                f"<tr><td style='padding:6px 0;color:#475569'>Balance</td>"
                f"<td style='padding:6px 0;text-align:right;font-weight:700;color:#b45309'>GHS {outstanding_balance:.2f}</td></tr>"
            )

    if payment_method in {"CREDIT", "PARTIAL"}:
        summary_extra_text = f"Outstanding: GHS {outstanding_balance:.2f}"

    receipt_html = f"""
<!DOCTYPE html>
<html lang=\"en\">
    <body style=\"margin:0;padding:20px;background:#f4f7fb;font-family:Arial,sans-serif;color:#0f172a\">
        <table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"max-width:700px;margin:0 auto;background:#ffffff;border:1px solid #dbe5f2;border-radius:12px;overflow:hidden\">
            <tr>
                <td style=\"padding:20px 24px;background:linear-gradient(120deg,#1f7aff,#2563eb);color:#ffffff\">
                    <div style=\"font-size:12px;letter-spacing:1px;opacity:.9\">OFFICIAL RECEIPT</div>
                    <div style=\"font-size:28px;font-weight:800;line-height:1.1;margin-top:6px\">{escape(business_name)}</div>
                    <div style=\"margin-top:8px;font-size:13px;opacity:.95\">Receipt #{escape(receipt_number)} • {escape(receipt_datetime)}</div>
                </td>
            </tr>
            <tr>
                <td style=\"padding:18px 24px\">
                    <table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"font-size:14px\">
                        <tr>
                            <td style=\"padding:2px 0;color:#475569\"><strong>Customer:</strong> {escape(customer_name)}</td>
                            <td style=\"padding:2px 0;color:#475569;text-align:right\"><strong>Served by:</strong> {escape(served_by)}</td>
                        </tr>
                        <tr>
                            <td style=\"padding:2px 0;color:#475569\"><strong>Payment:</strong> {escape(payment_method)}</td>
                            <td style=\"padding:2px 0;color:#475569;text-align:right\"><strong>Issued from:</strong> Gel Invent</td>
                        </tr>
                    </table>
                </td>
            </tr>
            <tr>
                <td style=\"padding:0 24px 6px\">
                    <table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"border:1px solid #e2e8f0;border-radius:10px;overflow:hidden\">
                        <thead>
                            <tr style=\"background:#f8fafc;color:#334155;font-size:12px;text-transform:uppercase\">
                                <th style=\"padding:10px;text-align:left\">Item</th>
                                <th style=\"padding:10px;text-align:right\">Qty</th>
                                <th style=\"padding:10px;text-align:right\">Unit Price</th>
                                <th style=\"padding:10px;text-align:right\">Amount</th>
                            </tr>
                        </thead>
                        <tbody>
                            {''.join(item_rows_html)}
                        </tbody>
                    </table>
                </td>
            </tr>
            <tr>
                <td style=\"padding:12px 24px 18px\">
                    <table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"font-size:14px\">
                        <tr>
                            <td style=\"padding:6px 0;color:#475569\">Total</td>
                            <td style=\"padding:6px 0;text-align:right;font-size:22px;font-weight:800;color:#0f172a\">GHS {total_amount:.2f}</td>
                        </tr>
                        {summary_extra_html}
                    </table>
                    <div style=\"margin-top:12px;padding:12px;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:10px;color:#334155;font-size:13px\">
                        Thank you for your purchase. Please keep this receipt for your records.
                    </div>
                </td>
            </tr>
        </table>
    </body>
</html>
"""

    if summary_extra_text:
        body_lines.insert(-3, summary_extra_text)

    try:
        send_email(
            to_email=str(payload.to_email),
            subject=f"Receipt from {business_name} #{receipt_number}",
            body_text="\n".join(body_lines),
            body_html=receipt_html,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to send receipt email: {exc}") from exc

    return SendReceiptEmailResponse(message="Receipt email sent successfully")


@router.get("", response_model=list[SaleRead])
def list_sales(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
    active_branch_id: int = Depends(get_active_branch_id),
):
    """
    Retrieve all sales for the current user's tenant.
    """
    tenant_user_ids = get_tenant_user_ids(current_user, db)
    sales = db.scalars(
        select(models.Sale)
        .where(models.Sale.user_id.in_(tenant_user_ids), models.Sale.branch_id == active_branch_id)
        .order_by(models.Sale.created_at.desc())
    ).all()
    
    creator_ids = sorted({s.user_id for s in sales})
    creators = db.execute(
        select(models.User.id, models.User.name).where(models.User.id.in_(creator_ids))
    ).all() if creator_ids else []
    creator_name_by_id = {int(uid): name for uid, name in creators}

    for sale in sales:
        sale.created_by_name = creator_name_by_id.get(sale.user_id)
    
    return sales


@router.get("/{sale_id}", response_model=SaleRead)
def get_sale(
    sale_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
    active_branch_id: int = Depends(get_active_branch_id),
):
    """
    Retrieve a specific sale by ID for the current user's tenant.
    """
    tenant_user_ids = get_tenant_user_ids(current_user, db)
    sale = db.scalar(
        select(models.Sale).where(
            models.Sale.id == sale_id,
            models.Sale.user_id.in_(tenant_user_ids),
            models.Sale.branch_id == active_branch_id,
        )
    )
    if not sale:
        raise HTTPException(status_code=404, detail="Sale not found")
    
    # Add created_by_name
    creator = db.scalar(select(models.User).where(models.User.id == sale.user_id))
    sale.created_by_name = creator.name if creator else None
    
    return sale


@router.delete("/{sale_id}", status_code=204)
def delete_sale(
    sale_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
    active_branch_id: int = Depends(get_active_branch_id),
):
    """
    Delete a sale and restore the stock.
    If the sale was on credit, reverse the credit transaction.
    """
    tenant_user_ids = get_tenant_user_ids(current_user, db)
    sale = db.scalar(
        select(models.Sale).where(
            models.Sale.id == sale_id,
            models.Sale.user_id.in_(tenant_user_ids),
            models.Sale.branch_id == active_branch_id,
        )
    )
    if not sale:
        raise HTTPException(status_code=404, detail="Sale not found")

    # Restore stock: if this sale has linked movements, delete them (reverts the deduction precisely).
    sale_movements = db.scalars(
        select(models.StockMovement).where(
            models.StockMovement.sale_id == sale_id,
            models.StockMovement.branch_id == active_branch_id,
            models.StockMovement.user_id.in_(tenant_user_ids),
        )
    ).all()

    if sale_movements:
        for m in sale_movements:
            db.delete(m)
    else:
        # Backwards-compatible for older sales (no sale_id links).
        db.add(
            models.StockMovement(
                user_id=current_user.id,
                branch_id=active_branch_id,
                product_id=sale.product_id,
                change=sale.quantity,
                reason="Sale Reversal",
                location="Main Store",
            )
        )

    # If the sale was on credit or partial, reverse the credit transaction
    if sale.payment_method in ["credit", "partial"]:
        txns = db.scalars(
            select(models.CreditTransaction).where(
                models.CreditTransaction.sale_id == sale_id,
                models.CreditTransaction.user_id.in_(tenant_user_ids),
                models.CreditTransaction.branch_id == active_branch_id,
            )
        ).all()
        for t in txns:
            creditor = db.get(models.Creditor, t.creditor_id)
            if creditor:
                if t.transaction_type == "debt":
                    creditor.total_debt -= t.amount
                else:
                    creditor.total_debt += t.amount
            db.delete(t)

    db.delete(sale)
    db.commit()
