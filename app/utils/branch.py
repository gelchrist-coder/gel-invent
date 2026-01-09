from __future__ import annotations

from typing import Optional

from fastapi import Depends, Header, HTTPException
from sqlalchemy.orm import Session

from app import models
from app.deps import get_db
from app.auth import get_current_active_user


def get_owner_user_id(current_user: models.User) -> int:
    if current_user.role == "Admin":
        return current_user.id
    if current_user.created_by:
        return current_user.created_by
    return current_user.id


def ensure_main_branch(db: Session, owner_user_id: int) -> models.Branch:
    """Ensure at least one branch exists for the tenant.
    
    This function creates a default 'Main Branch' only if NO branches exist.
    If any branch exists (even with a different name), no new branch is created.
    """
    # Check if ANY branch exists for this owner
    any_branch = (
        db.query(models.Branch)
        .filter(models.Branch.owner_user_id == owner_user_id, models.Branch.is_active.is_(True))
        .first()
    )
    if any_branch:
        return any_branch

    # No branches exist, create the default one
    branch = models.Branch(owner_user_id=owner_user_id, name="Main Branch", is_active=True)
    db.add(branch)
    db.commit()
    db.refresh(branch)
    return branch


def get_preferred_default_branch(db: Session, owner_user_id: int) -> models.Branch:
    """Pick the default branch for a tenant.

    Prefer any active branch that is NOT the auto-created 'Main Branch'.
    Fall back to 'Main Branch' only when it's the only available option.
    """
    preferred = (
        db.query(models.Branch)
        .filter(
            models.Branch.owner_user_id == owner_user_id,
            models.Branch.is_active.is_(True),
            models.Branch.name != "Main Branch",
        )
        .order_by(models.Branch.created_at.asc())
        .first()
    )
    if preferred:
        return preferred

    return ensure_main_branch(db, owner_user_id)


def resolve_active_branch_id(
    *,
    db: Session,
    current_user: models.User,
    header_branch_id: Optional[int],
) -> int:
    owner_user_id = get_owner_user_id(current_user)

    # Employees are locked to a single branch.
    if current_user.role != "Admin":
        if current_user.branch_id:
            return int(current_user.branch_id)

        default_branch = get_preferred_default_branch(db, owner_user_id)
        current_user.branch_id = default_branch.id
        db.add(current_user)
        db.commit()
        return int(default_branch.id)

    # Admin can switch branches via header.
    if header_branch_id:
        branch = (
            db.query(models.Branch)
            .filter(
                models.Branch.id == header_branch_id,
                models.Branch.owner_user_id == owner_user_id,
                models.Branch.is_active.is_(True),
            )
            .first()
        )
        if not branch:
            raise HTTPException(status_code=400, detail="Invalid branch")
        return int(branch.id)

    default_branch = get_preferred_default_branch(db, owner_user_id)
    return int(default_branch.id)


def get_active_branch_id(
    x_branch_id: Optional[int] = Header(default=None, alias="X-Branch-Id"),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> int:
    return resolve_active_branch_id(
        db=db,
        current_user=current_user,
        header_branch_id=x_branch_id,
    )
