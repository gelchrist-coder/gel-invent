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


def ensure_default_branch(db: Session, owner_user_id: int) -> models.Branch:
    """Return the tenant's first active branch, or raise if none exists."""
    any_branch = (
        db.query(models.Branch)
        .filter(models.Branch.owner_user_id == owner_user_id, models.Branch.is_active.is_(True))
        .order_by(models.Branch.created_at.asc(), models.Branch.id.asc())
        .first()
    )
    if any_branch:
        return any_branch

    raise HTTPException(
        status_code=400,
        detail="No active branch found. Please create a branch in Settings.",
    )


def get_preferred_default_branch(db: Session, owner_user_id: int) -> models.Branch:
    """Pick the default active branch for a tenant."""
    preferred = (
        db.query(models.Branch)
        .filter(
            models.Branch.owner_user_id == owner_user_id,
            models.Branch.is_active.is_(True),
        )
        .order_by(models.Branch.created_at.asc(), models.Branch.id.asc())
        .first()
    )
    if preferred:
        return preferred

    raise HTTPException(
        status_code=400,
        detail="No active branch found. Please create a branch in Settings.",
    )


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
            assigned_branch = (
                db.query(models.Branch)
                .filter(
                    models.Branch.id == current_user.branch_id,
                    models.Branch.owner_user_id == owner_user_id,
                    models.Branch.is_active.is_(True),
                )
                .first()
            )
            if assigned_branch:
                return int(assigned_branch.id)

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
