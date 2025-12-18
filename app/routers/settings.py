from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..auth import get_current_active_user
from ..database import get_db
from ..models import SystemSettings, User

router = APIRouter(prefix="/settings", tags=["settings"])


def _get_tenant_owner_id(user: User) -> int:
    if user.role == "Admin":
        return user.id
    return user.created_by or user.id


def _get_or_create_settings(db: Session, owner_user_id: int) -> SystemSettings:
    settings = db.query(SystemSettings).filter(SystemSettings.owner_user_id == owner_user_id).first()
    if settings:
        return settings

    settings = SystemSettings(owner_user_id=owner_user_id)
    db.add(settings)
    db.commit()
    db.refresh(settings)
    return settings


class SystemSettingsRead(BaseModel):
    low_stock_threshold: int
    expiry_warning_days: int
    auto_backup: bool
    email_notifications: bool


class SystemSettingsUpdate(BaseModel):
    low_stock_threshold: int = Field(ge=0, le=1_000_000)
    expiry_warning_days: int = Field(ge=0, le=10_000)
    auto_backup: bool
    email_notifications: bool


@router.get("/system", response_model=SystemSettingsRead)
def get_system_settings(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    owner_user_id = _get_tenant_owner_id(current_user)
    settings = _get_or_create_settings(db, owner_user_id)
    return SystemSettingsRead(
        low_stock_threshold=settings.low_stock_threshold,
        expiry_warning_days=settings.expiry_warning_days,
        auto_backup=settings.auto_backup,
        email_notifications=settings.email_notifications,
    )


@router.put("/system", response_model=SystemSettingsRead)
def update_system_settings(
    payload: SystemSettingsUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    if current_user.role != "Admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only business owners can update system settings",
        )

    settings = _get_or_create_settings(db, current_user.id)
    settings.low_stock_threshold = payload.low_stock_threshold
    settings.expiry_warning_days = payload.expiry_warning_days
    settings.auto_backup = payload.auto_backup
    settings.email_notifications = payload.email_notifications

    db.add(settings)
    db.commit()
    db.refresh(settings)

    return SystemSettingsRead(
        low_stock_threshold=settings.low_stock_threshold,
        expiry_warning_days=settings.expiry_warning_days,
        auto_backup=settings.auto_backup,
        email_notifications=settings.email_notifications,
    )
