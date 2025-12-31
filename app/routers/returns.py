"""
Sale Returns Router - Handle goods returned by customers.

When a return is processed:
1. Stock increases (if restock=True)
2. Revenue decreases by refund amount
3. If original sale was credit, creditor debt decreases
4. Return record is created for tracking
"""
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..deps import get_current_active_user, get_active_branch_id
from ..utils.tenant import get_tenant_user_ids

router = APIRouter(prefix="/returns", tags=["returns"])


@router.post("/", response_model=schemas.SaleReturnRead)
def create_return(
    payload: schemas.SaleReturnCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
    active_branch_id: int = Depends(get_active_branch_id),
):
    """
    Process a customer return.
    
    This will:
    - Validate the return quantity doesn't exceed what was sold
    - Create a return record
    - Add stock back to inventory (if restock=True)
    - If original sale was credit, reduce creditor's debt
    """
    tenant_user_ids = get_tenant_user_ids(current_user, db)
    
    # Get the original sale
    sale = db.scalar(
        select(models.Sale).where(
            models.Sale.id == payload.sale_id,
            models.Sale.user_id.in_(tenant_user_ids),
            models.Sale.branch_id == active_branch_id,
        )
    )
    if not sale:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Sale not found"
        )
    
    # Get already returned quantity for this sale
    already_returned = db.scalar(
        select(func.coalesce(func.sum(models.SaleReturn.quantity_returned), 0)).where(
            models.SaleReturn.sale_id == payload.sale_id,
            models.SaleReturn.user_id.in_(tenant_user_ids),
        )
    ) or Decimal(0)
    
    # Validate return quantity
    remaining_returnable = sale.quantity - already_returned
    if payload.quantity_returned > remaining_returnable:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot return more than {remaining_returnable} units. Already returned: {already_returned}"
        )
    
    # Create the return record
    sale_return = models.SaleReturn(
        user_id=current_user.id,
        branch_id=active_branch_id,
        sale_id=payload.sale_id,
        product_id=sale.product_id,
        quantity_returned=payload.quantity_returned,
        refund_amount=payload.refund_amount,
        refund_method=payload.refund_method,
        reason=payload.reason,
        restock=payload.restock,
    )
    db.add(sale_return)
    
    # Add stock back to inventory if restocking
    if payload.restock:
        movement = models.StockMovement(
            user_id=current_user.id,
            branch_id=active_branch_id,
            product_id=sale.product_id,
            sale_id=sale.id,
            change=payload.quantity_returned,  # Positive = adding back to stock
            reason="Customer Return",
            location="Main Store",
        )
        db.add(movement)
    
    # If original sale was credit, reduce the creditor's debt
    if sale.payment_method == "credit" and payload.refund_method == "credit_to_account":
        # Find the credit transaction for this sale
        credit_tx = db.scalar(
            select(models.CreditTransaction).where(
                models.CreditTransaction.sale_id == sale.id,
                models.CreditTransaction.transaction_type == "debt",
            )
        )
        if credit_tx:
            creditor = db.get(models.Creditor, credit_tx.creditor_id)
            if creditor:
                # Create a payment transaction for the return
                return_tx = models.CreditTransaction(
                    user_id=current_user.id,
                    branch_id=active_branch_id,
                    creditor_id=creditor.id,
                    sale_id=sale.id,
                    amount=payload.refund_amount,
                    transaction_type="payment",
                    notes=f"Return refund: {payload.reason or 'Customer return'}",
                )
                db.add(return_tx)
                
                # Update creditor's total debt
                creditor.total_debt = max(Decimal(0), creditor.total_debt - payload.refund_amount)
    
    db.commit()
    db.refresh(sale_return)
    
    # Get product name for response
    product = db.get(models.Product, sale.product_id)
    
    return schemas.SaleReturnRead(
        id=sale_return.id,
        sale_id=sale_return.sale_id,
        product_id=sale_return.product_id,
        product_name=product.name if product else None,
        quantity_returned=sale_return.quantity_returned,
        refund_amount=sale_return.refund_amount,
        refund_method=sale_return.refund_method,
        reason=sale_return.reason,
        restock=sale_return.restock,
        created_at=sale_return.created_at,
        created_by_name=current_user.name,
    )


@router.get("/", response_model=list[schemas.SaleReturnRead])
def list_returns(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
    active_branch_id: int = Depends(get_active_branch_id),
    limit: int = 100,
):
    """List all returns for the current branch."""
    tenant_user_ids = get_tenant_user_ids(current_user, db)
    
    returns = db.scalars(
        select(models.SaleReturn)
        .where(
            models.SaleReturn.user_id.in_(tenant_user_ids),
            models.SaleReturn.branch_id == active_branch_id,
        )
        .order_by(models.SaleReturn.created_at.desc())
        .limit(limit)
    ).all()
    
    result = []
    for r in returns:
        product = db.get(models.Product, r.product_id)
        creator = db.get(models.User, r.user_id)
        result.append(schemas.SaleReturnRead(
            id=r.id,
            sale_id=r.sale_id,
            product_id=r.product_id,
            product_name=product.name if product else None,
            quantity_returned=r.quantity_returned,
            refund_amount=r.refund_amount,
            refund_method=r.refund_method,
            reason=r.reason,
            restock=r.restock,
            created_at=r.created_at,
            created_by_name=creator.name if creator else None,
        ))
    
    return result


@router.get("/sale/{sale_id}", response_model=list[schemas.SaleReturnRead])
def get_returns_for_sale(
    sale_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
    active_branch_id: int = Depends(get_active_branch_id),
):
    """Get all returns for a specific sale."""
    tenant_user_ids = get_tenant_user_ids(current_user, db)
    
    # Verify sale exists and belongs to tenant
    sale = db.scalar(
        select(models.Sale).where(
            models.Sale.id == sale_id,
            models.Sale.user_id.in_(tenant_user_ids),
            models.Sale.branch_id == active_branch_id,
        )
    )
    if not sale:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Sale not found"
        )
    
    returns = db.scalars(
        select(models.SaleReturn).where(
            models.SaleReturn.sale_id == sale_id,
            models.SaleReturn.user_id.in_(tenant_user_ids),
        )
        .order_by(models.SaleReturn.created_at.desc())
    ).all()
    
    result = []
    for r in returns:
        product = db.get(models.Product, r.product_id)
        creator = db.get(models.User, r.user_id)
        result.append(schemas.SaleReturnRead(
            id=r.id,
            sale_id=r.sale_id,
            product_id=r.product_id,
            product_name=product.name if product else None,
            quantity_returned=r.quantity_returned,
            refund_amount=r.refund_amount,
            refund_method=r.refund_method,
            reason=r.reason,
            restock=r.restock,
            created_at=r.created_at,
            created_by_name=creator.name if creator else None,
        ))
    
    return result


@router.get("/summary")
def get_returns_summary(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
    active_branch_id: int = Depends(get_active_branch_id),
):
    """Get summary of returns (total count, total refund amount)."""
    tenant_user_ids = get_tenant_user_ids(current_user, db)
    
    result = db.execute(
        select(
            func.count(models.SaleReturn.id).label("total_returns"),
            func.coalesce(func.sum(models.SaleReturn.quantity_returned), 0).label("total_quantity"),
            func.coalesce(func.sum(models.SaleReturn.refund_amount), 0).label("total_refund"),
        ).where(
            models.SaleReturn.user_id.in_(tenant_user_ids),
            models.SaleReturn.branch_id == active_branch_id,
        )
    ).first()
    
    return {
        "total_returns": result.total_returns if result else 0,
        "total_quantity_returned": float(result.total_quantity) if result else 0,
        "total_refund_amount": float(result.total_refund) if result else 0,
    }
