from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app import models
from app.deps import get_db
from app.auth import get_current_active_user
from app.utils.branch import get_owner_user_id, ensure_main_branch

router = APIRouter(prefix="/branches", tags=["branches"])


class BranchCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)


class BranchRead(BaseModel):
    id: int
    owner_user_id: int
    name: str
    is_active: bool

    class Config:
        from_attributes = True


@router.get("", response_model=list[BranchRead])
def list_branches(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    owner_user_id = get_owner_user_id(current_user)

    # Ensure Main Branch always exists for the tenant
    ensure_main_branch(db, owner_user_id)

    return (
        db.query(models.Branch)
        .filter(models.Branch.owner_user_id == owner_user_id, models.Branch.is_active.is_(True))
        .order_by(models.Branch.created_at.asc())
        .all()
    )


@router.post("", response_model=BranchRead, status_code=status.HTTP_201_CREATED)
def create_branch(
    payload: BranchCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    if current_user.role != "Admin":
        raise HTTPException(status_code=403, detail="Only Admin can create branches")

    owner_user_id = get_owner_user_id(current_user)

    existing = (
        db.query(models.Branch)
        .filter(models.Branch.owner_user_id == owner_user_id, models.Branch.name == payload.name)
        .first()
    )
    if existing:
        raise HTTPException(status_code=400, detail="Branch name already exists")

    branch = models.Branch(owner_user_id=owner_user_id, name=payload.name, is_active=True)
    db.add(branch)
    db.commit()
    db.refresh(branch)
    return branch


class BranchUpdate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)


@router.put("/{branch_id}", response_model=BranchRead)
def update_branch(
    branch_id: int,
    payload: BranchUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    if current_user.role != "Admin":
        raise HTTPException(status_code=403, detail="Only Admin can update branches")

    owner_user_id = get_owner_user_id(current_user)

    branch = (
        db.query(models.Branch)
        .filter(models.Branch.id == branch_id, models.Branch.owner_user_id == owner_user_id)
        .first()
    )
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")

    # Check if name already exists (excluding current branch)
    existing = (
        db.query(models.Branch)
        .filter(
            models.Branch.owner_user_id == owner_user_id,
            models.Branch.name == payload.name,
            models.Branch.id != branch_id,
        )
        .first()
    )
    if existing:
        raise HTTPException(status_code=400, detail="Branch name already exists")

    branch.name = payload.name
    db.commit()
    db.refresh(branch)
    return branch


@router.delete("/{branch_id}")
def delete_branch(
    branch_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    if current_user.role != "Admin":
        raise HTTPException(status_code=403, detail="Only Admin can delete branches")

    owner_user_id = get_owner_user_id(current_user)

    # Count total active branches
    total_branches = (
        db.query(models.Branch)
        .filter(models.Branch.owner_user_id == owner_user_id, models.Branch.is_active.is_(True))
        .count()
    )
    
    if total_branches <= 1:
        raise HTTPException(status_code=400, detail="Cannot delete the last branch")

    branch = (
        db.query(models.Branch)
        .filter(models.Branch.id == branch_id, models.Branch.owner_user_id == owner_user_id)
        .first()
    )
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")

    # Check if branch has any products, sales, or other data
    has_products = db.query(models.Product).filter(models.Product.branch_id == branch_id).first()
    has_sales = db.query(models.Sale).filter(models.Sale.branch_id == branch_id).first()
    
    if has_products or has_sales:
        raise HTTPException(
            status_code=400, 
            detail="Cannot delete branch with existing products or sales. Transfer or delete them first."
        )

    # Soft delete by marking inactive (or hard delete if preferred)
    db.delete(branch)
    db.commit()
    return {"message": "Branch deleted successfully"}
