import urllib.parse
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, List
from datetime import date, datetime
from decimal import Decimal
from sqlalchemy import select, func
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Creditor, CreditTransaction, Sale, Product
from ..auth import get_current_active_user
from ..models import User
from app.permissions import ensure_permission
from app.utils.tenant import get_tenant_user_ids
from app.utils.branch import get_active_branch_id
from app.utils.phone import to_e164_phone

router = APIRouter(prefix="/creditors", tags=["creditors"])

WALK_IN_CUSTOMER_NAMES = {
    "walk in",
    "walk in customer",
    "walkin",
    "guest",
    "anonymous",
}


def _normalize_customer_name(name: str | None) -> str:
    normalized = str(name or "").strip().lower().replace("-", " ").replace("_", " ")
    return " ".join(normalized.split())


def _is_walk_in_customer_name(name: str | None) -> bool:
    normalized = _normalize_customer_name(name)
    if not normalized:
        return False
    return normalized in WALK_IN_CUSTOMER_NAMES


def _sales_aggregate_by_customer_name(
    *,
    db: Session,
    tenant_user_ids: list[int],
    active_branch_id: int,
) -> dict[str, dict[str, object]]:
    rows = db.execute(
        select(
            Sale.customer_name,
            func.count(Sale.id).label("sale_count"),
            func.coalesce(func.sum(Sale.total_price), 0).label("total_spent"),
            func.max(Sale.created_at).label("last_sale_at"),
        )
        .where(
            Sale.user_id.in_(tenant_user_ids),
            Sale.branch_id == active_branch_id,
            Sale.customer_name.is_not(None),
            func.trim(Sale.customer_name) != "",
        )
        .group_by(Sale.customer_name)
    ).all()

    aggregate: dict[str, dict[str, object]] = {}
    for customer_name, sale_count, total_spent, last_sale_at in rows:
        key = _normalize_customer_name(customer_name)
        if not key or _is_walk_in_customer_name(key):
            continue
        existing = aggregate.get(key)
        if existing is None:
            aggregate[key] = {
                "sale_count": int(sale_count or 0),
                "total_spent": Decimal(total_spent or 0),
                "last_sale_at": last_sale_at,
            }
            continue

        existing["sale_count"] = int(existing["sale_count"]) + int(sale_count or 0)
        existing["total_spent"] = Decimal(existing["total_spent"]) + Decimal(total_spent or 0)
        existing_last_sale = existing["last_sale_at"]
        if existing_last_sale is None or (last_sale_at and last_sale_at > existing_last_sale):
            existing["last_sale_at"] = last_sale_at

    return aggregate


def _loyalty_level(total_purchases: Decimal, transaction_count: int, outstanding: Decimal) -> str:
    if (total_purchases >= Decimal("5000") or transaction_count >= 20) and outstanding <= 0:
        return "VIP"
    if total_purchases >= Decimal("2000") or transaction_count >= 12:
        return "Gold"
    if total_purchases >= Decimal("800") or transaction_count >= 6:
        return "Silver"
    return "Bronze"


def _format_money(amount: Decimal) -> str:
    value = Decimal(amount or 0).quantize(Decimal("0.01"))
    return f"GHS {value:,.2f}"


def _format_quantity(value: object) -> str:
    try:
        number = float(value or 0)
    except Exception:
        return "0"
    if number.is_integer():
        return str(int(number))
    return f"{number:.2f}".rstrip("0").rstrip(".")


def _receipt_number(client_sale_id: str | None, sale_id: int) -> str:
    source = client_sale_id or str(sale_id)
    return str(source).split(":")[0][-8:].upper()


def _build_whatsapp_url(phone: str | None, message: str | None) -> str | None:
    if not message:
        return None
    e164 = to_e164_phone(phone)
    if not e164:
        return None
    return f"https://wa.me/{e164.lstrip('+')}?text={urllib.parse.quote(message)}"


def _next_birthday_date(birthday: date, today: date) -> date:
    try:
        upcoming = date(today.year, birthday.month, birthday.day)
    except ValueError:
        upcoming = date(today.year, 2, 28)

    if upcoming < today:
        try:
            return date(today.year + 1, birthday.month, birthday.day)
        except ValueError:
            return date(today.year + 1, 2, 28)
    return upcoming


def _loyalty_next_target(total_purchases: Decimal, purchase_count: int, outstanding: Decimal) -> dict[str, object] | None:
    current = _loyalty_level(total_purchases, purchase_count, outstanding)
    if current == "VIP":
        return None

    targets = {
        "Bronze": ("Silver", Decimal("800"), 6, False),
        "Silver": ("Gold", Decimal("2000"), 12, False),
        "Gold": ("VIP", Decimal("5000"), 20, True),
    }
    next_level, spend_target, purchase_target, requires_clear_balance = targets[current]
    return {
        "level": next_level,
        "remaining_spend": float(max(Decimal("0"), spend_target - total_purchases)),
        "remaining_purchases": max(0, purchase_target - purchase_count),
        "requires_clear_balance": requires_clear_balance and outstanding > 0,
    }

# Pydantic models
class CreditorCreate(BaseModel):
    name: str
    phone: Optional[str] = None
    email: Optional[str] = None
    birthday: Optional[date] = None
    notes: Optional[str] = None

class CreditorUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    birthday: Optional[date] = None
    notes: Optional[str] = None

class TransactionCreate(BaseModel):
    creditor_id: int
    amount: float
    transaction_type: str  # "debt" or "payment"
    notes: Optional[str] = None
    sale_id: Optional[int] = None

# Get all creditors
@router.get("")
async def get_creditors(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    active_branch_id: int = Depends(get_active_branch_id),
):
    ensure_permission(current_user, "view_creditors")
    tenant_user_ids = get_tenant_user_ids(current_user, db)
    creditors = db.scalars(
        select(Creditor).where(
            Creditor.user_id.in_(tenant_user_ids),
            Creditor.branch_id == active_branch_id,
        )
    ).all()
    
    creditor_ids = [int(c.id) for c in creditors]
    transactions = db.scalars(
        select(CreditTransaction).where(
            CreditTransaction.creditor_id.in_(creditor_ids),
            CreditTransaction.user_id.in_(tenant_user_ids),
            CreditTransaction.branch_id == active_branch_id,
        )
    ).all() if creditor_ids else []
    sales_aggregate = _sales_aggregate_by_customer_name(
        db=db,
        tenant_user_ids=tenant_user_ids,
        active_branch_id=active_branch_id,
    )

    aggregate: dict[int, dict[str, object]] = {
        cid: {
            "total_debt_amount": Decimal(0),
            "total_payments": Decimal(0),
            "transaction_count": 0,
            "last_transaction": None,
        }
        for cid in creditor_ids
    }

    for t in transactions:
        cid = int(t.creditor_id)
        item = aggregate.get(cid)
        if not item:
            continue
        amount = Decimal(t.amount)
        if t.transaction_type == "debt":
            item["total_debt_amount"] = Decimal(item["total_debt_amount"]) + amount
        elif t.transaction_type == "payment":
            item["total_payments"] = Decimal(item["total_payments"]) + amount
        item["transaction_count"] = int(item["transaction_count"]) + 1
        last_tx = item["last_transaction"]
        if last_tx is None or t.created_at > last_tx:
            item["last_transaction"] = t.created_at

    result = []
    for creditor in creditors:
        agg = aggregate.get(int(creditor.id), None)
        total_debt_amount = Decimal(agg["total_debt_amount"]) if agg else Decimal(0)
        total_payments = Decimal(agg["total_payments"]) if agg else Decimal(0)
        tx_count = int(agg["transaction_count"]) if agg else 0
        last_transaction = agg["last_transaction"] if agg else None

        sales_key = _normalize_customer_name(creditor.name)
        sales_item = sales_aggregate.get(sales_key, None)
        purchase_count = int(sales_item["sale_count"]) if sales_item else 0
        total_spent = Decimal(sales_item["total_spent"]) if sales_item else Decimal(0)
        last_purchase_at = sales_item["last_sale_at"] if sales_item else None

        actual_debt = total_debt_amount - total_payments
        loyalty_level = _loyalty_level(total_spent, purchase_count, actual_debt)
        loyalty_points = int(total_spent // Decimal("10"))
        last_activity = last_transaction
        if last_purchase_at and (last_activity is None or last_purchase_at > last_activity):
            last_activity = last_purchase_at
        
        result.append({
            "id": creditor.id,
            "name": creditor.name,
            "phone": creditor.phone,
            "email": creditor.email,
            "birthday": creditor.birthday.isoformat() if creditor.birthday else None,
            "total_debt": float(creditor.total_debt),
            "actual_debt": float(actual_debt),
            "total_purchases": float(total_spent),
            "total_payments": float(total_payments),
            "transaction_count": purchase_count,
            "purchase_count": purchase_count,
            "credit_transaction_count": tx_count,
            "loyalty_points": loyalty_points,
            "last_transaction_at": last_activity.isoformat() if last_activity else None,
            "last_purchase_at": last_purchase_at.isoformat() if last_purchase_at else None,
            "loyalty_level": loyalty_level,
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
    ensure_permission(current_user, "view_creditors")
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
    sales_aggregate = _sales_aggregate_by_customer_name(
        db=db,
        tenant_user_ids=tenant_user_ids,
        active_branch_id=active_branch_id,
    )
    
    total_debt_amount = sum((t.amount for t in transactions if t.transaction_type == "debt"), Decimal(0))
    total_payments = sum((t.amount for t in transactions if t.transaction_type == "payment"), Decimal(0))
    actual_debt = total_debt_amount - total_payments
    sales_key = _normalize_customer_name(creditor.name)
    sales_item = sales_aggregate.get(sales_key, None)
    purchase_count = int(sales_item["sale_count"]) if sales_item else 0
    total_spent = Decimal(sales_item["total_spent"]) if sales_item else Decimal(0)
    loyalty_level = _loyalty_level(total_spent, purchase_count, actual_debt)
    loyalty_points = int(total_spent // Decimal("10"))

    return {
        "id": creditor.id,
        "name": creditor.name,
        "phone": creditor.phone,
        "email": creditor.email,
        "birthday": creditor.birthday.isoformat() if creditor.birthday else None,
        "total_debt": float(creditor.total_debt),
        "actual_debt": float(actual_debt),
        "total_purchases": float(total_spent),
        "total_payments": float(total_payments),
        "transaction_count": len(transactions),
        "purchase_count": purchase_count,
        "loyalty_points": loyalty_points,
        "loyalty_level": loyalty_level,
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


@router.get("/{creditor_id}/retention")
async def get_creditor_retention(
    creditor_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    active_branch_id: int = Depends(get_active_branch_id),
):
    ensure_permission(current_user, "view_creditors")
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
    ).all()

    total_credit_purchases = sum((Decimal(t.amount) for t in transactions if t.transaction_type == "debt"), Decimal(0))
    total_payments = sum((Decimal(t.amount) for t in transactions if t.transaction_type == "payment"), Decimal(0))
    outstanding = total_credit_purchases - total_payments

    sales_key = _normalize_customer_name(creditor.name)
    sales_aggregate = _sales_aggregate_by_customer_name(
        db=db,
        tenant_user_ids=tenant_user_ids,
        active_branch_id=active_branch_id,
    )
    sales_item = sales_aggregate.get(sales_key, None)
    purchase_count = int(sales_item["sale_count"]) if sales_item else 0
    total_spent = Decimal(sales_item["total_spent"]) if sales_item else Decimal(0)
    loyalty_level = _loyalty_level(total_spent, purchase_count, outstanding)
    loyalty_points = int(total_spent // Decimal("10"))

    sales_rows = db.execute(
        select(
            Sale.id,
            Sale.client_sale_id,
            Sale.product_id,
            Product.name.label("product_name"),
            Sale.quantity,
            Sale.total_price,
            Sale.payment_method,
            Sale.created_at,
        )
        .join(Product, Product.id == Sale.product_id)
        .where(
            Sale.user_id.in_(tenant_user_ids),
            Sale.branch_id == active_branch_id,
            Sale.customer_name.is_not(None),
            func.lower(func.trim(Sale.customer_name)) == creditor.name.strip().lower(),
        )
        .order_by(Sale.created_at.desc(), Sale.id.desc())
    ).all()

    latest_receipt = None
    if sales_rows:
        first = sales_rows[0]
        latest_group_key = str(first.client_sale_id).split(":")[0] if first.client_sale_id else None
        latest_group_rows = [first]
        if latest_group_key:
            latest_group_rows = [row for row in sales_rows if row.client_sale_id and str(row.client_sale_id).split(":")[0] == latest_group_key]

        latest_total = sum((Decimal(row.total_price or 0) for row in latest_group_rows), Decimal(0))
        receipt_message_lines = [
            f"Hi {creditor.name}, thanks for shopping with {current_user.business_name or 'our store'}.",
            f"Receipt #{_receipt_number(first.client_sale_id, int(first.id))} on {first.created_at.strftime('%d/%m/%Y %H:%M')}",
        ]
        receipt_items = []
        for row in latest_group_rows[:8]:
            receipt_items.append(
                {
                    "sale_id": int(row.id),
                    "product_id": int(row.product_id),
                    "product_name": str(row.product_name),
                    "quantity": float(row.quantity),
                    "total_price": float(row.total_price),
                }
            )
            receipt_message_lines.append(
                f"- {row.product_name}: {_format_quantity(row.quantity)} unit(s) for {_format_money(Decimal(row.total_price or 0))}"
            )

        receipt_message_lines.append(f"Total: {_format_money(latest_total)}")
        receipt_message_lines.append(f"Payment: {str(first.payment_method or 'cash').upper()}")
        receipt_message = "\n".join(receipt_message_lines)

        latest_receipt = {
            "receipt_number": _receipt_number(first.client_sale_id, int(first.id)),
            "purchased_at": first.created_at.isoformat(),
            "payment_method": first.payment_method,
            "sale_ids": [int(row.id) for row in latest_group_rows],
            "total_amount": float(latest_total),
            "items": receipt_items,
            "message": receipt_message,
            "whatsapp_url": _build_whatsapp_url(creditor.phone, receipt_message),
        }

    today = datetime.utcnow().date()
    birthday_info = {
        "birthday": creditor.birthday.isoformat() if creditor.birthday else None,
        "next_occurrence": None,
        "days_until": None,
        "is_today": False,
        "is_this_month": False,
    }
    if creditor.birthday:
        next_birthday = _next_birthday_date(creditor.birthday, today)
        birthday_info = {
            "birthday": creditor.birthday.isoformat(),
            "next_occurrence": next_birthday.isoformat(),
            "days_until": (next_birthday - today).days,
            "is_today": next_birthday == today,
            "is_this_month": next_birthday.month == today.month,
        }

    product_stats: dict[int, dict[str, object]] = {}
    for row in sales_rows:
        item = product_stats.get(int(row.product_id))
        purchase_date = row.created_at.date()
        if item is None:
            product_stats[int(row.product_id)] = {
                "product_id": int(row.product_id),
                "product_name": str(row.product_name),
                "times_purchased": 1,
                "total_quantity": Decimal(row.quantity or 0),
                "last_purchased_at": row.created_at,
                "purchase_dates": [purchase_date],
            }
            continue

        item["times_purchased"] = int(item["times_purchased"]) + 1
        item["total_quantity"] = Decimal(item["total_quantity"]) + Decimal(row.quantity or 0)
        if row.created_at > item["last_purchased_at"]:
            item["last_purchased_at"] = row.created_at
        purchase_dates = item["purchase_dates"]
        if purchase_date not in purchase_dates:
            purchase_dates.append(purchase_date)

    buy_again_suggestions: list[dict[str, object]] = []
    for item in product_stats.values():
        purchase_dates = sorted(item["purchase_dates"])
        average_reorder_days = None
        if len(purchase_dates) >= 2:
            intervals = [max(1, (purchase_dates[index] - purchase_dates[index - 1]).days) for index in range(1, len(purchase_dates))]
            average_reorder_days = round(sum(intervals) / len(intervals), 1)

        last_purchased_at = item["last_purchased_at"]
        days_since_last_purchase = max(0, (today - last_purchased_at.date()).days)
        is_due = average_reorder_days is not None and days_since_last_purchase >= max(1, int(average_reorder_days * 0.8))
        buy_again_suggestions.append(
            {
                "product_id": int(item["product_id"]),
                "product_name": str(item["product_name"]),
                "times_purchased": int(item["times_purchased"]),
                "total_quantity": float(item["total_quantity"]),
                "last_purchased_at": last_purchased_at.isoformat(),
                "average_reorder_days": average_reorder_days,
                "days_since_last_purchase": days_since_last_purchase,
                "is_due": is_due,
            }
        )

    buy_again_suggestions.sort(
        key=lambda item: (
            int(bool(item["is_due"])),
            int(item["times_purchased"]),
            item["last_purchased_at"],
        ),
        reverse=True,
    )
    buy_again_suggestions = buy_again_suggestions[:5]

    favorite_names = ", ".join(item["product_name"] for item in buy_again_suggestions[:3])
    debt_message = None
    if outstanding > 0:
        debt_message = (
            f"Hi {creditor.name}, this is a friendly reminder from {current_user.business_name or 'our store'} "
            f"that your outstanding balance is {_format_money(outstanding)}. "
            "Please pass by the shop or reply to arrange payment. Thank you."
        )

    birthday_message = None
    if creditor.birthday:
        birthday_message = (
            f"Happy Birthday, {creditor.name}! Thank you for being one of our {loyalty_level} customers at "
            f"{current_user.business_name or 'our store'}. We would love to celebrate you with a special in-store offer this week."
        )

    promo_message = (
        f"Hi {creditor.name}, thank you for shopping with {current_user.business_name or 'our store'}. "
        f"You currently have {loyalty_points} loyalty points and {purchase_count} purchases with us. "
        f"{('Your usual favorites include ' + favorite_names + '. ') if favorite_names else ''}"
        "Visit us again this week for a thank-you offer on your next order."
    )

    return {
        "customer": {
            "id": creditor.id,
            "name": creditor.name,
            "phone": creditor.phone,
            "email": creditor.email,
            "birthday": creditor.birthday.isoformat() if creditor.birthday else None,
            "notes": creditor.notes,
        },
        "summary": {
            "outstanding": float(outstanding),
            "total_purchases": float(total_spent),
            "purchase_count": purchase_count,
            "loyalty_points": loyalty_points,
            "loyalty_level": loyalty_level,
            "next_target": _loyalty_next_target(total_spent, purchase_count, outstanding),
        },
        "birthday": birthday_info,
        "latest_receipt": latest_receipt,
        "campaigns": {
            "debt_reminder_message": debt_message,
            "debt_reminder_whatsapp_url": _build_whatsapp_url(creditor.phone, debt_message),
            "birthday_message": birthday_message,
            "birthday_whatsapp_url": _build_whatsapp_url(creditor.phone, birthday_message),
            "promo_message": promo_message,
            "promo_whatsapp_url": _build_whatsapp_url(creditor.phone, promo_message),
        },
        "buy_again_suggestions": buy_again_suggestions,
    }

# Create creditor
@router.post("")
async def create_creditor(
    creditor: CreditorCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    active_branch_id: int = Depends(get_active_branch_id),
):
    ensure_permission(current_user, "manage_creditors")
    new_creditor = Creditor(
        name=creditor.name.strip(),
        phone=creditor.phone,
        email=creditor.email,
        birthday=creditor.birthday,
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
    ensure_permission(current_user, "manage_creditors")
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
    
    updates = creditor.model_dump(exclude_unset=True)
    for field, value in updates.items():
        if field == "name" and value is not None:
            value = str(value).strip()
        setattr(existing, field, value)
    
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
    ensure_permission(current_user, "manage_creditors")
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
    ensure_permission(current_user, "manage_creditors")
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
    ensure_permission(current_user, "view_creditors")
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
        .order_by(CreditTransaction.created_at.asc(), CreditTransaction.id.asc())
    ).all()

    sale_ids = sorted({int(t.sale_id) for t in transactions if t.sale_id is not None})
    sales = db.scalars(
        select(Sale).where(
            Sale.id.in_(sale_ids),
            Sale.user_id.in_(tenant_user_ids),
            Sale.branch_id == active_branch_id,
        )
    ).all() if sale_ids else []
    sale_by_id = {int(s.id): s for s in sales}

    running_balance = Decimal(0)
    result = []
    for t in transactions:
        amount = Decimal(t.amount)
        if t.transaction_type == "debt":
            running_balance += amount
        else:
            running_balance -= amount

        sale = sale_by_id.get(int(t.sale_id)) if t.sale_id is not None else None
        entry_type = "purchase" if t.transaction_type == "debt" and t.sale_id is not None else t.transaction_type

        result.append(
            {
                "id": t.id,
                "creditor_id": t.creditor_id,
                "sale_id": t.sale_id,
                "amount": float(t.amount),
                "transaction_type": t.transaction_type,
                "entry_type": entry_type,
                "notes": t.notes,
                "created_at": t.created_at.isoformat(),
                "running_balance": float(running_balance),
                "sale_total": float(sale.total_price) if sale else None,
                "sale_quantity": float(sale.quantity) if sale else None,
            }
        )

    # Return newest first for UI while preserving running balance from chronological ledger.
    result.reverse()
    return result


@router.get("/{creditor_id}/statement")
async def get_creditor_statement(
    creditor_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    active_branch_id: int = Depends(get_active_branch_id),
):
    ensure_permission(current_user, "view_creditors")
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
        .order_by(CreditTransaction.created_at.asc(), CreditTransaction.id.asc())
    ).all()
    sales_aggregate = _sales_aggregate_by_customer_name(
        db=db,
        tenant_user_ids=tenant_user_ids,
        active_branch_id=active_branch_id,
    )

    total_credit_purchases = sum((t.amount for t in transactions if t.transaction_type == "debt"), Decimal(0))
    total_payments = sum((t.amount for t in transactions if t.transaction_type == "payment"), Decimal(0))
    outstanding = total_credit_purchases - total_payments

    sales_key = _normalize_customer_name(creditor.name)
    sales_item = sales_aggregate.get(sales_key, None)
    purchase_count = int(sales_item["sale_count"]) if sales_item else 0
    total_spent = Decimal(sales_item["total_spent"]) if sales_item else Decimal(0)
    loyalty_points = int(total_spent // Decimal("10"))

    return {
        "customer": {
            "id": creditor.id,
            "name": creditor.name,
            "phone": creditor.phone,
            "email": creditor.email,
            "notes": creditor.notes,
            "created_at": creditor.created_at.isoformat(),
        },
        "summary": {
            "total_purchases": float(total_spent),
            "total_credit_purchases": float(total_credit_purchases),
            "total_payments": float(total_payments),
            "outstanding": float(outstanding),
            "transaction_count": purchase_count,
            "credit_transaction_count": len(transactions),
            "loyalty_points": loyalty_points,
            "loyalty_level": _loyalty_level(total_spent, purchase_count, outstanding),
            "generated_at": datetime.utcnow().isoformat(),
        },
        "transactions": [
            {
                "id": t.id,
                "sale_id": t.sale_id,
                "amount": float(t.amount),
                "transaction_type": t.transaction_type,
                "notes": t.notes,
                "created_at": t.created_at.isoformat(),
            }
            for t in transactions
        ],
    }

# Get creditors summary/analytics
@router.get("/analytics/summary")
async def get_creditors_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    active_branch_id: int = Depends(get_active_branch_id),
):
    ensure_permission(current_user, "view_creditors")
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
