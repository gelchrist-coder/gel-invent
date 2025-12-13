from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
from decimal import Decimal
from sqlalchemy import select, func
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Creditor, CreditTransaction, Sale
from ..auth import get_current_active_user
from ..models import User
from app.utils.tenant import get_tenant_user_ids
from app.utils.branch import get_active_branch_id

router = APIRouter(prefix="/creditors", tags=["creditors"])

# Pydantic models
class CreditorCreate(BaseModel):
    name: str
    phone: Optional[str] = None
    email: Optional[str] = None
    notes: Optional[str] = None

class CreditorUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    notes: Optional[str] = None

class TransactionCreate(BaseModel):
    creditor_id: int
    amount: float
    transaction_type: str  # "debt" or "payment"
    notes: Optional[str] = None
    sale_id: Optional[int] = None

# Get all creditors
@router.get("/")
async def get_creditors(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    active_branch_id: int = Depends(get_active_branch_id),
):
    tenant_user_ids = get_tenant_user_ids(current_user, db)
    creditors = db.scalars(
        select(Creditor).where(
            Creditor.user_id.in_(tenant_user_ids),
            Creditor.branch_id == active_branch_id,
        )
    ).all()
    
    result = []
    for creditor in creditors:
        # Calculate transaction metrics
        transactions = db.scalars(
            select(CreditTransaction).where(
                CreditTransaction.creditor_id == creditor.id,
                CreditTransaction.user_id.in_(tenant_user_ids),
                CreditTransaction.branch_id == active_branch_id,
            )
        ).all()
        
        total_debt_amount = sum(
            t.amount for t in transactions if t.transaction_type == "debt"
        )
        total_payments = sum(
            t.amount for t in transactions if t.transaction_type == "payment"
        )
        actual_debt = total_debt_amount - total_payments
        
        result.append({
            "id": creditor.id,
            "name": creditor.name,
            "phone": creditor.phone,
            "email": creditor.email,
            "total_debt": float(creditor.total_debt),
            "actual_debt": float(actual_debt),
            "transaction_count": len(transactions),
            "notes": creditor.notes,
            "created_at": creditor.created_at.isoformat(),
        })
    
    return result

# Get single creditor with details
@router.get("/{creditor_id}")
async def get_creditor(
    creditor_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    active_branch_id: int = Depends(get_active_branch_id),
):
    tenant_user_ids = get_tenant_user_ids(current_user, db)
    creditor = db.scalar(
        select(Creditor).where(
            Creditor.id == creditor_id,
            Creditor.user_id.in_(tenant_user_ids),
            Creditor.branch_id == active_branch_id,
        )
    )
    if not creditor:
        raise HTTPException(status_code=404, detail="Creditor not found")
    
    # Get transactions
    transactions = db.scalars(
        select(CreditTransaction)
        .where(
            CreditTransaction.creditor_id == creditor_id,
            CreditTransaction.user_id.in_(tenant_user_ids),
            CreditTransaction.branch_id == active_branch_id,
        )
        .order_by(CreditTransaction.created_at.desc())
    ).all()
    
    return {
        "id": creditor.id,
        "name": creditor.name,
        "phone": creditor.phone,
        "email": creditor.email,
        "total_debt": float(creditor.total_debt),
        "notes": creditor.notes,
        "created_at": creditor.created_at.isoformat(),
        "transactions": [
            {
                "id": t.id,
                "amount": float(t.amount),
                "transaction_type": t.transaction_type,
                "notes": t.notes,
                "sale_id": t.sale_id,
                "created_at": t.created_at.isoformat(),
            }
            for t in transactions
        ],
    }

# Create creditor
@router.post("/")
async def create_creditor(
    creditor: CreditorCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    active_branch_id: int = Depends(get_active_branch_id),
):
    new_creditor = Creditor(
        name=creditor.name,
        phone=creditor.phone,
        email=creditor.email,
        notes=creditor.notes,
        user_id=current_user.id,
        branch_id=active_branch_id,
    )
    db.add(new_creditor)
    db.commit()
    db.refresh(new_creditor)
    return {"id": new_creditor.id, "message": "Creditor created successfully"}

# Update creditor
@router.put("/{creditor_id}")
async def update_creditor(
    creditor_id: int,
    creditor: CreditorUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    active_branch_id: int = Depends(get_active_branch_id),
):
    tenant_user_ids = get_tenant_user_ids(current_user, db)
    existing = db.scalar(
        select(Creditor).where(
            Creditor.id == creditor_id,
            Creditor.user_id.in_(tenant_user_ids),
            Creditor.branch_id == active_branch_id,
        )
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Creditor not found")
    
    # Update fields if provided
    if creditor.name is not None:
        existing.name = creditor.name
    if creditor.phone is not None:
        existing.phone = creditor.phone
    if creditor.email is not None:
        existing.email = creditor.email
    if creditor.notes is not None:
        existing.notes = creditor.notes
    
    db.commit()
    return {"message": "Creditor updated successfully"}

# Delete creditor
@router.delete("/{creditor_id}")
async def delete_creditor(
    creditor_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    active_branch_id: int = Depends(get_active_branch_id),
):
    tenant_user_ids = get_tenant_user_ids(current_user, db)
    existing = db.scalar(
        select(Creditor).where(
            Creditor.id == creditor_id,
            Creditor.user_id.in_(tenant_user_ids),
            Creditor.branch_id == active_branch_id,
        )
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Creditor not found")
    
    # Check if creditor has outstanding debt
    if existing.total_debt > 0:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete creditor with outstanding debt. Please clear all debts first."
        )
    
    db.delete(existing)
    db.commit()
    return {"message": "Creditor deleted successfully"}

# Add transaction (debt or payment)
@router.post("/transactions")
async def add_transaction(
    transaction: TransactionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    active_branch_id: int = Depends(get_active_branch_id),
):
    tenant_user_ids = get_tenant_user_ids(current_user, db)
    creditor = db.scalar(
        select(Creditor).where(
            Creditor.id == transaction.creditor_id,
            Creditor.user_id.in_(tenant_user_ids),
            Creditor.branch_id == active_branch_id,
        )
    )
    if not creditor:
        raise HTTPException(status_code=404, detail="Creditor not found")
    
    # Create transaction
    new_transaction = CreditTransaction(
        creditor_id=transaction.creditor_id,
        sale_id=transaction.sale_id,
        amount=transaction.amount,
        transaction_type=transaction.transaction_type,
        notes=transaction.notes,
        user_id=current_user.id,
        branch_id=active_branch_id,
    )
    db.add(new_transaction)
    
    # Update creditor's total_debt
    amount_decimal = Decimal(str(transaction.amount))
    if transaction.transaction_type == "debt":
        creditor.total_debt += amount_decimal
    else:  # payment
        creditor.total_debt -= amount_decimal
    
    db.commit()
    return {"message": "Transaction recorded successfully"}

# Get creditor transactions
@router.get("/{creditor_id}/transactions")
async def get_creditor_transactions(
    creditor_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    active_branch_id: int = Depends(get_active_branch_id),
):
    tenant_user_ids = get_tenant_user_ids(current_user, db)
    creditor = db.scalar(
        select(Creditor).where(
            Creditor.id == creditor_id,
            Creditor.user_id.in_(tenant_user_ids),
            Creditor.branch_id == active_branch_id,
        )
    )
    if not creditor:
        raise HTTPException(status_code=404, detail="Creditor not found")
    
    transactions = db.scalars(
        select(CreditTransaction)
        .where(
            CreditTransaction.creditor_id == creditor_id,
            CreditTransaction.user_id.in_(tenant_user_ids),
            CreditTransaction.branch_id == active_branch_id,
        )
        .order_by(CreditTransaction.created_at.desc())
    ).all()
    
    return [
        {
            "id": t.id,
            "creditor_id": t.creditor_id,
            "sale_id": t.sale_id,
            "amount": float(t.amount),
            "transaction_type": t.transaction_type,
            "notes": t.notes,
            "created_at": t.created_at.isoformat(),
        }
        for t in transactions
    ]

# Get creditors summary/analytics
@router.get("/analytics/summary")
async def get_creditors_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    active_branch_id: int = Depends(get_active_branch_id),
):
    tenant_user_ids = get_tenant_user_ids(current_user, db)
    creditors = db.scalars(
        select(Creditor).where(
            Creditor.user_id.in_(tenant_user_ids),
            Creditor.branch_id == active_branch_id,
        )
    ).all()
    
    total_creditors = len(creditors)
    active_creditors = sum(1 for c in creditors if c.total_debt > 0)
    total_outstanding_debt = sum(c.total_debt for c in creditors)
    avg_debt_per_creditor = total_outstanding_debt / total_creditors if total_creditors > 0 else 0
    
    # Get recent transactions
    recent_transactions = db.scalars(
        select(CreditTransaction)
        .where(
            CreditTransaction.user_id.in_(tenant_user_ids),
            CreditTransaction.branch_id == active_branch_id,
        )
        .order_by(CreditTransaction.created_at.desc())
        .limit(10)
    ).all()
    
    return {
        "total_creditors": total_creditors,
        "active_creditors": active_creditors,
        "total_outstanding_debt": float(total_outstanding_debt),
        "avg_debt_per_creditor": float(avg_debt_per_creditor),
        "recent_transactions": [
            {
                "id": t.id,
                "creditor_name": t.creditor.name,
                "amount": float(t.amount),
                "transaction_type": t.transaction_type,
                "created_at": t.created_at.isoformat(),
            }
            for t in recent_transactions
        ],
    }
