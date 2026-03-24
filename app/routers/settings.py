import json
from decimal import Decimal, ROUND_HALF_UP
from urllib.request import urlopen

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..auth import get_current_active_user
from ..database import get_db
from ..models import CreditTransaction, Creditor, Product, Sale, SaleReturn, StockMovement, SystemSettings, User

router = APIRouter(prefix="/settings", tags=["settings"])

ALLOWED_CURRENCIES = {"GHS", "USD", "EUR", "GBP"}


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
    currency_code: str
    auto_backup: bool
    email_notifications: bool


class SystemSettingsUpdate(BaseModel):
    low_stock_threshold: int = Field(ge=0, le=1_000_000)
    expiry_warning_days: int = Field(ge=0, le=10_000)
    uses_expiry_tracking: bool
    currency_code: str = Field(min_length=3, max_length=3)
    auto_backup: bool
    email_notifications: bool


class CurrencyConvertRequest(BaseModel):
    target_currency: str = Field(min_length=3, max_length=3)
    convert_existing: bool = True


class CurrencyConvertResponse(BaseModel):
    currency_code: str
    previous_currency: str
    conversion_rate: float
    converted_existing: bool


def _normalize_currency(code: str) -> str:
    return (code or "").strip().upper()


def _validate_currency(code: str) -> str:
    normalized = _normalize_currency(code)
    if normalized not in ALLOWED_CURRENCIES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported currency '{code}'. Allowed: {', '.join(sorted(ALLOWED_CURRENCIES))}",
        )
    return normalized


def _fetch_exchange_rate(base: str, target: str) -> Decimal:
    if base == target:
        return Decimal("1")

    url = f"https://open.er-api.com/v6/latest/{base}"
    try:
        with urlopen(url, timeout=10) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not fetch live exchange rate. Please try again.",
        ) from exc

    rates = payload.get("rates") if isinstance(payload, dict) else None
    if not isinstance(rates, dict) or target not in rates:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Live exchange rate for selected currency is unavailable.",
        )

    try:
        rate = Decimal(str(rates[target]))
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Received invalid exchange rate response.",
        ) from exc

    if rate <= 0:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Received non-positive exchange rate.",
        )

    return rate


def _to_money(value: Decimal | None, rate: Decimal) -> Decimal | None:
    if value is None:
        return None
    return (Decimal(value) * rate).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _tenant_user_ids(db: Session, owner_user_id: int) -> list[int]:
    rows = (
        db.query(User.id)
        .filter((User.id == owner_user_id) | (User.created_by == owner_user_id))
        .all()
    )
    return [int(row[0]) for row in rows]


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
        currency_code=_normalize_currency(getattr(settings, "currency_code", "GHS") or "GHS"),
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
    currency_code = _validate_currency(payload.currency_code)
    settings.low_stock_threshold = payload.low_stock_threshold
    settings.expiry_warning_days = payload.expiry_warning_days
    settings.uses_expiry_tracking = payload.uses_expiry_tracking
    settings.currency_code = currency_code
    settings.auto_backup = payload.auto_backup
    settings.email_notifications = payload.email_notifications

    db.add(settings)
    db.commit()
    db.refresh(settings)

    return SystemSettingsRead(
        low_stock_threshold=settings.low_stock_threshold,
        expiry_warning_days=settings.expiry_warning_days,
        uses_expiry_tracking=settings.uses_expiry_tracking,
        currency_code=_normalize_currency(settings.currency_code or "GHS"),
        auto_backup=settings.auto_backup,
        email_notifications=settings.email_notifications,
    )


@router.post("/system/currency/convert", response_model=CurrencyConvertResponse)
def convert_system_currency(
    payload: CurrencyConvertRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    if current_user.role != "Admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only business owners can change business currency",
        )

    settings = _get_or_create_settings(db, current_user.id)
    previous_currency = _normalize_currency(getattr(settings, "currency_code", "GHS") or "GHS")
    target_currency = _validate_currency(payload.target_currency)

    if target_currency == previous_currency:
        return CurrencyConvertResponse(
            currency_code=target_currency,
            previous_currency=previous_currency,
            conversion_rate=1.0,
            converted_existing=False,
        )

    rate = _fetch_exchange_rate(previous_currency, target_currency)

    if payload.convert_existing:
        tenant_user_ids = _tenant_user_ids(db, current_user.id)
        if tenant_user_ids:
            products = db.query(Product).filter(Product.user_id.in_(tenant_user_ids)).all()
            for row in products:
                row.cost_price = _to_money(row.cost_price, rate)
                row.pack_cost_price = _to_money(row.pack_cost_price, rate)
                row.selling_price = _to_money(row.selling_price, rate)
                row.pack_selling_price = _to_money(row.pack_selling_price, rate)

            movements = db.query(StockMovement).filter(StockMovement.user_id.in_(tenant_user_ids)).all()
            for row in movements:
                row.unit_cost_price = _to_money(row.unit_cost_price, rate)
                row.unit_selling_price = _to_money(row.unit_selling_price, rate)

            sales = db.query(Sale).filter(Sale.user_id.in_(tenant_user_ids)).all()
            for row in sales:
                row.unit_price = _to_money(row.unit_price, rate)
                row.total_price = _to_money(row.total_price, rate)
                row.amount_paid = _to_money(row.amount_paid, rate)

            creditors = db.query(Creditor).filter(Creditor.user_id.in_(tenant_user_ids)).all()
            for row in creditors:
                row.total_debt = _to_money(row.total_debt, rate)

            credit_txns = db.query(CreditTransaction).filter(CreditTransaction.user_id.in_(tenant_user_ids)).all()
            for row in credit_txns:
                row.amount = _to_money(row.amount, rate)

            sale_returns = db.query(SaleReturn).filter(SaleReturn.user_id.in_(tenant_user_ids)).all()
            for row in sale_returns:
                row.refund_amount = _to_money(row.refund_amount, rate)

    settings.currency_code = target_currency
    db.add(settings)
    db.commit()
    db.refresh(settings)

    return CurrencyConvertResponse(
        currency_code=target_currency,
        previous_currency=previous_currency,
        conversion_rate=float(rate),
        converted_existing=payload.convert_existing,
    )
