from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..auth import get_current_active_user
from ..database import get_db
from ..models import SystemSettings, User
from ..utils.whatsapp import send_whatsapp_message, whatsapp_configured

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
    uses_expiry_tracking: bool
    auto_backup: bool
    email_notifications: bool
    whatsapp_notifications: bool
    whatsapp_number: str | None


class SystemSettingsUpdate(BaseModel):
    low_stock_threshold: int = Field(ge=0, le=1_000_000)
    expiry_warning_days: int = Field(ge=0, le=10_000)
    uses_expiry_tracking: bool
    auto_backup: bool
    email_notifications: bool
    whatsapp_notifications: bool = False
    whatsapp_number: str | None = Field(default=None, max_length=32)


class WhatsAppTestPayload(BaseModel):
    message: str | None = Field(default=None, max_length=500)


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
        uses_expiry_tracking=settings.uses_expiry_tracking,
        auto_backup=settings.auto_backup,
        email_notifications=settings.email_notifications,
        whatsapp_notifications=settings.whatsapp_notifications,
        whatsapp_number=settings.whatsapp_number,
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
    settings.uses_expiry_tracking = payload.uses_expiry_tracking
    settings.auto_backup = payload.auto_backup
    settings.email_notifications = payload.email_notifications
    settings.whatsapp_notifications = payload.whatsapp_notifications
    settings.whatsapp_number = (payload.whatsapp_number or "").strip() or None

    db.add(settings)
    db.commit()
    db.refresh(settings)

    return SystemSettingsRead(
        low_stock_threshold=settings.low_stock_threshold,
        expiry_warning_days=settings.expiry_warning_days,
        uses_expiry_tracking=settings.uses_expiry_tracking,
        auto_backup=settings.auto_backup,
        email_notifications=settings.email_notifications,
        whatsapp_notifications=settings.whatsapp_notifications,
        whatsapp_number=settings.whatsapp_number,
    )


@router.post("/system/whatsapp-test")
def send_whatsapp_test(
    payload: WhatsAppTestPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    if current_user.role != "Admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only business owners can send WhatsApp tests",
        )

    settings = _get_or_create_settings(db, current_user.id)
    to_number = (settings.whatsapp_number or "").strip()
    if not to_number:
        raise HTTPException(status_code=400, detail="Set a WhatsApp number in settings first")
    if not whatsapp_configured():
        raise HTTPException(status_code=500, detail="WhatsApp provider is not configured on the server")

    message = (payload.message or "").strip() or f"Gel Invent test alert for {current_user.business_name or current_user.name}."

    try:
        send_whatsapp_message(to_number=to_number, message=message)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to send WhatsApp test: {exc}") from exc

    return {"message": "WhatsApp test sent"}
