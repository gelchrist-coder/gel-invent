import json
from decimal import Decimal, ROUND_HALF_UP
from urllib.request import urlopen

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..auth import get_current_active_user
from ..database import get_db
from ..models import CreditTransaction, Creditor, Product, Sale, SaleReturn, StockMovement, SystemSettings, User
from app.permissions import ensure_permission, is_admin
from app.utils.capabilities import normalize_capability_overrides, resolve_effective_capabilities, serialize_capability_overrides

router = APIRouter(prefix="/settings", tags=["settings"])

ALLOWED_CURRENCIES = {"GHS", "USD", "EUR", "GBP"}
LEGACY_EXPIRY_WARNING_DAYS = 180
DEFAULT_EXPIRY_WARNING_DAYS = 45


def _get_tenant_owner_id(user: User) -> int:
    if is_admin(user):
        return user.id
    return user.created_by or user.id


def _get_or_create_settings(db: Session, owner_user_id: int) -> SystemSettings:
    settings = db.query(SystemSettings).filter(SystemSettings.owner_user_id == owner_user_id).first()
    if settings:
        if int(settings.expiry_warning_days or 0) == LEGACY_EXPIRY_WARNING_DAYS:
            settings.expiry_warning_days = DEFAULT_EXPIRY_WARNING_DAYS
            db.add(settings)
            db.commit()
            db.refresh(settings)
        return settings

    settings = SystemSettings(owner_user_id=owner_user_id)
    db.add(settings)
    db.commit()
    db.refresh(settings)
    return settings


# Ghana's standard taxes/levies, preloaded (all off) so owners can just toggle
# and adjust. Prices are treated as tax-INCLUSIVE: the total never changes, the
# receipt only breaks out how much of it is each tax.
DEFAULT_TAXES: list[dict] = [
    {"name": "VAT", "rate": 15.0, "enabled": False},
    {"name": "NHIL", "rate": 2.5, "enabled": False},
    {"name": "GETFund", "rate": 2.5, "enabled": False},
    {"name": "COVID-19 Levy", "rate": 1.0, "enabled": False},
    {"name": "Tourism Levy", "rate": 1.0, "enabled": False},
]


class TaxLine(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    rate: float = Field(ge=0, le=100)
    enabled: bool = False


def _read_taxes(db: Session, owner_user_id: int) -> list[dict]:
    try:
        row = db.execute(
            text("SELECT tax_config FROM system_settings WHERE owner_user_id = :oid"),
            {"oid": owner_user_id},
        ).first()
        raw = row[0] if row else None
    except Exception:
        db.rollback()
        raw = None

    if raw:
        try:
            parsed = json.loads(raw)
        except Exception:
            parsed = None
        if isinstance(parsed, list):
            cleaned: list[dict] = []
            for item in parsed:
                if not isinstance(item, dict):
                    continue
                name = str(item.get("name") or "").strip()[:40]
                if not name:
                    continue
                try:
                    rate = float(item.get("rate") or 0)
                except Exception:
                    rate = 0.0
                cleaned.append({"name": name, "rate": max(0.0, min(100.0, rate)), "enabled": bool(item.get("enabled"))})
            return cleaned  # may be empty if the owner removed all taxes
    return [dict(t) for t in DEFAULT_TAXES]


def _write_taxes(db: Session, owner_user_id: int, taxes: list["TaxLine"]) -> None:
    payload = json.dumps(
        [
            {"name": t.name.strip()[:40], "rate": float(t.rate), "enabled": bool(t.enabled)}
            for t in taxes
            if t.name.strip()
        ]
    )
    db.execute(text("ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS tax_config TEXT"))
    db.execute(
        text("UPDATE system_settings SET tax_config = :cfg WHERE owner_user_id = :oid"),
        {"cfg": payload, "oid": owner_user_id},
    )


class SystemSettingsRead(BaseModel):
    low_stock_threshold: int
    expiry_warning_days: int
    uses_expiry_tracking: bool
    capability_overrides: dict[str, bool]
    effective_capabilities: dict[str, bool]
    currency_code: str
    auto_backup: bool
    email_notifications: bool
    taxes: list[TaxLine] = []


class SystemSettingsUpdate(BaseModel):
    low_stock_threshold: int = Field(ge=0, le=1_000_000)
    expiry_warning_days: int = Field(ge=0, le=10_000)
    uses_expiry_tracking: bool
    capability_overrides: dict[str, bool] | None = None
    currency_code: str = Field(min_length=3, max_length=3)
    auto_backup: bool
    email_notifications: bool
    taxes: list[TaxLine] | None = None


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


def _serialize_settings(settings: SystemSettings, owner: User | None, taxes: list[dict]) -> SystemSettingsRead:
    capability_overrides = normalize_capability_overrides(getattr(settings, "capability_overrides", None))
    business_types: list[str] | None = None
    if owner and getattr(owner, "business_types", None):
        try:
            parsed = json.loads(owner.business_types)
            if isinstance(parsed, list):
                business_types = [str(value).strip() for value in parsed if str(value).strip()]
        except Exception:
            business_types = None

    effective_capabilities = resolve_effective_capabilities(
        business_types=business_types,
        capability_overrides=capability_overrides,
        uses_expiry_tracking=settings.uses_expiry_tracking,
    )

    return SystemSettingsRead(
        low_stock_threshold=settings.low_stock_threshold,
        expiry_warning_days=settings.expiry_warning_days,
        uses_expiry_tracking=settings.uses_expiry_tracking,
        capability_overrides=capability_overrides,
        effective_capabilities=effective_capabilities,
        currency_code=_normalize_currency(getattr(settings, "currency_code", "GHS") or "GHS"),
        auto_backup=settings.auto_backup,
        email_notifications=settings.email_notifications,
        taxes=[TaxLine(**t) for t in taxes],
    )


@router.get("/system", response_model=SystemSettingsRead)
def get_system_settings(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    owner_user_id = _get_tenant_owner_id(current_user)
    settings = _get_or_create_settings(db, owner_user_id)
    owner = db.query(User).filter(User.id == owner_user_id).first()
    return _serialize_settings(settings, owner, _read_taxes(db, owner_user_id))


@router.put("/system", response_model=SystemSettingsRead)
def update_system_settings(
    payload: SystemSettingsUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    ensure_permission(current_user, "manage_settings", "Only business owners can update system settings")

    owner_user_id = _get_tenant_owner_id(current_user)
    settings = _get_or_create_settings(db, owner_user_id)
    currency_code = _validate_currency(payload.currency_code)
    settings.low_stock_threshold = payload.low_stock_threshold
    settings.expiry_warning_days = payload.expiry_warning_days
    settings.uses_expiry_tracking = payload.uses_expiry_tracking
    if payload.capability_overrides is not None:
        settings.capability_overrides = serialize_capability_overrides(payload.capability_overrides)
    settings.currency_code = currency_code
    settings.auto_backup = payload.auto_backup
    settings.email_notifications = payload.email_notifications

    db.add(settings)
    if payload.taxes is not None:
        _write_taxes(db, owner_user_id, payload.taxes)
    db.commit()
    db.refresh(settings)

    return _serialize_settings(settings, current_user, _read_taxes(db, owner_user_id))


class BusinessLogoRead(BaseModel):
    business_logo: str | None = None


class BusinessLogoUpdate(BaseModel):
    business_logo: str | None = None


# Base64 data URL cap (~450KB encoded). The client compresses before upload.
MAX_LOGO_CHARS = 600_000


@router.get("/business-logo", response_model=BusinessLogoRead)
def get_business_logo(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Return the business logo (data URL) for the current tenant, or null.

    Reads defensively so a tenant that has never uploaded one — where the column
    may not exist yet — simply returns no logo instead of erroring.
    """
    owner_user_id = _get_tenant_owner_id(current_user)
    _get_or_create_settings(db, owner_user_id)
    try:
        row = db.execute(
            text("SELECT business_logo FROM system_settings WHERE owner_user_id = :oid"),
            {"oid": owner_user_id},
        ).first()
        logo = row[0] if row and row[0] else None
    except Exception:
        db.rollback()
        logo = None
    return BusinessLogoRead(business_logo=logo)


@router.put("/business-logo", response_model=BusinessLogoRead)
def update_business_logo(
    payload: BusinessLogoUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Set or clear the tenant's business logo. Admin/owner only.

    The storage column is created on first use so no separate migration or
    cold-start schema work is required.
    """
    ensure_permission(current_user, "manage_settings", "Only the business owner can update the logo")

    logo = (payload.business_logo or "").strip() or None
    if logo is not None:
        if not logo.startswith("data:image/"):
            raise HTTPException(status_code=400, detail="Logo must be an image file.")
        if len(logo) > MAX_LOGO_CHARS:
            raise HTTPException(status_code=400, detail="Logo image is too large. Please choose a smaller image.")

    owner_user_id = _get_tenant_owner_id(current_user)
    _get_or_create_settings(db, owner_user_id)
    db.execute(text("ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS business_logo TEXT"))
    db.execute(
        text("UPDATE system_settings SET business_logo = :logo WHERE owner_user_id = :oid"),
        {"logo": logo, "oid": owner_user_id},
    )
    db.commit()
    return BusinessLogoRead(business_logo=logo)


@router.post("/system/currency/convert", response_model=CurrencyConvertResponse)
def convert_system_currency(
    payload: CurrencyConvertRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    ensure_permission(current_user, "manage_settings", "Only business owners can change business currency")

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
