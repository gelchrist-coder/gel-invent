from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import get_current_active_user
from ..database import get_db
from .. import models
from ..schemas import SaleCreate, SaleRead
from app.utils.tenant import get_tenant_user_ids
from app.utils.branch import get_active_branch_id

router = APIRouter(prefix="/sales", tags=["sales"])


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
        unit_price=payload.unit_price,
        total_price=payload.total_price,
        customer_name=payload.customer_name,
        payment_method=payload.payment_method,
        notes=payload.notes,
    )
    db.add(sale)
    db.flush()  # Flush to get sale.id

    # Deduct stock by creating a negative stock movement
    stock_movement = models.StockMovement(
        user_id=current_user.id,
        branch_id=active_branch_id,
        product_id=payload.product_id,
        change=-payload.quantity,  # Negative to deduct stock
        reason="Sale",
        location="Main Store",  # Default location for sales
    )
    db.add(stock_movement)

    # Handle credit transactions
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
                detail="Amount paid should be less than total price for partial payments"
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
        
        # Create payment transaction if there's an initial payment
        if payload.amount_paid and payload.amount_paid > 0:
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
    return sale


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
    
    # Add created_by_name to each sale
    for sale in sales:
        creator = db.scalar(select(models.User).where(models.User.id == sale.user_id))
        sale.created_by_name = creator.name if creator else None
    
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

    # Restore stock by creating a positive stock movement
    stock_movement = models.StockMovement(
        user_id=current_user.id,
        branch_id=active_branch_id,
        product_id=sale.product_id,
        change=sale.quantity,  # Positive to restore stock
        reason="Sale Reversal",
        location="Main Store",
    )
    db.add(stock_movement)

    # If the sale was on credit or partial, reverse the credit transaction
    if sale.payment_method in ["credit", "partial"]:
        credit_transaction = db.scalar(
            select(models.CreditTransaction).where(
                models.CreditTransaction.sale_id == sale_id,
                models.CreditTransaction.user_id.in_(tenant_user_ids),
                models.CreditTransaction.branch_id == active_branch_id,
            )
        )
        if credit_transaction:
            # Update creditor's total debt by the credit amount (not total price for partial payments)
            creditor = db.get(models.Creditor, credit_transaction.creditor_id)
            if creditor:
                creditor.total_debt -= credit_transaction.amount
            # Delete the credit transaction
            db.delete(credit_transaction)

    db.delete(sale)
    db.commit()
