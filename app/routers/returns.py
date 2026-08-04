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
from ..database import ensure_sale_return_item_schema, get_db
from ..auth import get_current_active_user
from app.permissions import ensure_permission
from ..utils.branch import get_active_branch_id
from ..utils.tenant import get_tenant_user_ids

router = APIRouter(prefix="/returns", tags=["returns"])

RETURN_ITEM_CONDITIONS = {"resellable", "damaged", "expired", "defective"}


def _condition_from_values(condition: str | None, reason: str | None) -> str:
    resolved = (condition or "resellable").strip().lower()
    reason_text = (reason or "").lower()
    # Historical records and older clients encoded the condition in `reason`.
    # Keep those records safe and display them accurately after the migration.
    if resolved == "resellable":
        for loss_condition in ("damaged", "expired", "defective"):
            if loss_condition in reason_text:
                return loss_condition
    return resolved if resolved in RETURN_ITEM_CONDITIONS else "resellable"


def _resolve_item_condition(payload: schemas.SaleReturnCreate) -> str:
    return _condition_from_values(payload.item_condition, payload.reason)


def _restore_exact_sale_item_stock(
    *,
    db: Session,
    sale: models.Sale,
    tenant_user_ids: list[int],
    actor_user_id: int,
    branch_id: int,
    quantity: Decimal,
    already_returned: Decimal,
) -> None:
    """Restore a resellable return to the sold variant and original batches.

    A sale can draw from several batches. Earlier returns (including damaged
    units that were not restocked) consume the same ordered sale allocation so
    later returns map to the correct remaining batch segment.
    """
    deductions = db.scalars(
        select(models.StockMovement)
        .where(
            models.StockMovement.sale_id == sale.id,
            models.StockMovement.branch_id == branch_id,
            models.StockMovement.user_id.in_(tenant_user_ids),
            models.StockMovement.change < 0,
        )
        .order_by(models.StockMovement.created_at.asc(), models.StockMovement.id.asc())
    ).all()

    skip = Decimal(already_returned)
    remaining = Decimal(quantity)
    for deduction in deductions:
        deducted_quantity = -Decimal(deduction.change)
        if skip >= deducted_quantity:
            skip -= deducted_quantity
            continue

        available_in_segment = deducted_quantity - skip
        skip = Decimal(0)
        restored_quantity = min(remaining, available_in_segment)
        if restored_quantity <= 0:
            continue
        db.add(models.StockMovement(
            user_id=actor_user_id,
            branch_id=branch_id,
            product_id=sale.product_id,
            variant_id=sale.variant_id,
            sale_id=sale.id,
            change=restored_quantity,
            reason="Customer Return - Resellable",
            location=deduction.location or "Main Store",
            batch_number=deduction.batch_number,
            expiry_date=deduction.expiry_date,
            unit_cost_price=deduction.unit_cost_price,
            unit_selling_price=deduction.unit_selling_price or sale.unit_price,
        ))
        remaining -= restored_quantity
        if remaining <= 0:
            break

    # Legacy sale movements may not carry sale_id/batch linkage. Restore any
    # unmatched amount to the exact product variant without inventing a batch.
    if remaining > 0:
        db.add(models.StockMovement(
            user_id=actor_user_id,
            branch_id=branch_id,
            product_id=sale.product_id,
            variant_id=sale.variant_id,
            sale_id=sale.id,
            change=remaining,
            reason="Customer Return - Resellable",
            location="Main Store",
            unit_selling_price=sale.unit_price,
        ))


def _sale_return_read(db: Session, sale_return: models.SaleReturn, created_by_name: str | None) -> schemas.SaleReturnRead:
    product = db.get(models.Product, sale_return.product_id)
    variant = db.get(models.ProductVariant, sale_return.variant_id) if sale_return.variant_id else None
    return schemas.SaleReturnRead(
        id=sale_return.id,
        sale_id=sale_return.sale_id,
        product_id=sale_return.product_id,
        variant_id=sale_return.variant_id,
        variant_label=variant.label if variant else None,
        product_name=product.name if product else None,
        quantity_returned=sale_return.quantity_returned,
        refund_amount=sale_return.refund_amount,
        refund_method=sale_return.refund_method,
        reason=sale_return.reason,
        item_condition=_condition_from_values(sale_return.item_condition, sale_return.reason),
        restock=sale_return.restock,
        created_at=sale_return.created_at,
        created_by_name=created_by_name,
    )


@router.post("", response_model=schemas.SaleReturnRead)
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
    ensure_sale_return_item_schema()
    ensure_permission(current_user, "process_returns")
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
    supplied_quantity = sale.supplied_quantity if sale.supplied_quantity is not None else sale.quantity
    remaining_returnable = supplied_quantity - already_returned
    if payload.quantity_returned > remaining_returnable:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot return more than {remaining_returnable} units. Already returned: {already_returned}"
        )
    
    # Create the return record
    item_condition = _resolve_item_condition(payload)
    should_restock = bool(payload.restock and item_condition == "resellable")
    sale_return = models.SaleReturn(
        user_id=current_user.id,
        branch_id=active_branch_id,
        sale_id=payload.sale_id,
        product_id=sale.product_id,
        variant_id=sale.variant_id,
        quantity_returned=payload.quantity_returned,
        refund_amount=payload.refund_amount,
        refund_method=payload.refund_method,
        reason=payload.reason,
        item_condition=item_condition,
        restock=should_restock,
    )
    db.add(sale_return)
    
    # Add stock back to inventory if restocking
    if should_restock:
        _restore_exact_sale_item_stock(
            db=db,
            sale=sale,
            tenant_user_ids=tenant_user_ids,
            actor_user_id=current_user.id,
            branch_id=active_branch_id,
            quantity=payload.quantity_returned,
            already_returned=already_returned,
        )
    
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
    
    return _sale_return_read(db, sale_return, current_user.name)


@router.get("", response_model=list[schemas.SaleReturnRead])
def list_returns(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
    active_branch_id: int = Depends(get_active_branch_id),
    limit: int = 100,
):
    """List all returns for the current branch."""
    ensure_sale_return_item_schema()
    ensure_permission(current_user, "process_returns")
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
        creator = db.get(models.User, r.user_id)
        result.append(_sale_return_read(db, r, creator.name if creator else None))
    
    return result


@router.get("/sale/{sale_id}", response_model=list[schemas.SaleReturnRead])
def get_returns_for_sale(
    sale_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
    active_branch_id: int = Depends(get_active_branch_id),
):
    """Get all returns for a specific sale."""
    ensure_sale_return_item_schema()
    ensure_permission(current_user, "process_returns")
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
        creator = db.get(models.User, r.user_id)
        result.append(_sale_return_read(db, r, creator.name if creator else None))
    
    return result


@router.get("/summary")
def get_returns_summary(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
    active_branch_id: int = Depends(get_active_branch_id),
):
    """Get summary of returns (total count, total refund amount)."""
    ensure_sale_return_item_schema()
    ensure_permission(current_user, "process_returns")
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
