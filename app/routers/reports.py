from datetime import datetime, timedelta, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func, and_, or_
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Sale, Product, StockMovement, Creditor, CreditTransaction, User, SystemSettings, Branch, Purchase
from ..auth import get_current_active_user
from app.permissions import ensure_permission, is_admin
from app.utils.tenant import get_tenant_user_ids
from app.utils.branch import get_active_branch_id
from app.utils.expiry import get_batch_balances

router = APIRouter(prefix="/reports", tags=["reports"])
LEGACY_EXPIRY_WARNING_DAYS = 180
DEFAULT_EXPIRY_WARNING_DAYS = 45


def _to_float(value: object, default: float = 0.0) -> float:
    try:
        return float(value)  # type: ignore[arg-type]
    except Exception:
        return default


def _to_int(value: object) -> int | None:
    try:
        if value is None:
            return None
        return int(value)  # type: ignore[arg-type]
    except Exception:
        return None


def _to_utc_datetime(value: object) -> datetime | None:
    if not isinstance(value, datetime):
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _sale_transaction_key(sale_id: object, client_sale_id: object) -> str:
    raw = str(client_sale_id or "").strip()
    if not raw:
        return f"sale:{sale_id}"
    return raw.split(":")[0] or f"sale:{sale_id}"


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


@router.get("/morning-summary")
def get_morning_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    active_branch_id: int = Depends(get_active_branch_id),
):
    """Owner morning command center with daily operational priorities."""
    ensure_permission(current_user, "view_reports", "Only Admin and Manager can access reports")
    tenant_user_ids = get_tenant_user_ids(current_user, db)
    owner_user_id = _get_tenant_owner_id(current_user)
    settings = _get_or_create_settings(db, owner_user_id)

    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    yesterday_start = today_start - timedelta(days=1)
    slow_mover_start = today_start - timedelta(days=30)
    expiry_cutoff = today_start.date() + timedelta(days=settings.expiry_warning_days)

    yesterday_sales_rows = db.execute(
        select(
            Sale.id,
            Sale.client_sale_id,
            Sale.total_price,
        )
        .where(
            and_(
                Sale.created_at >= yesterday_start,
                Sale.created_at < today_start,
                Sale.user_id.in_(tenant_user_ids),
                Sale.branch_id == active_branch_id,
            )
        )
        .order_by(Sale.id.desc())
    ).all()

    yesterday_transactions: dict[str, float] = {}
    for sale in yesterday_sales_rows:
        key = _sale_transaction_key(sale.id, sale.client_sale_id)
        yesterday_transactions[key] = yesterday_transactions.get(key, 0.0) + _to_float(sale.total_price)

    yesterday_sales_total = sum(yesterday_transactions.values())
    yesterday_sales_count = len(yesterday_transactions)

    stock_rows = db.execute(
        select(
            Product.id,
            Product.name,
            Product.sku,
            Product.expiry_date,
            func.coalesce(func.sum(StockMovement.change), 0).label("current_stock"),
        )
        .outerjoin(
            StockMovement,
            and_(
                StockMovement.product_id == Product.id,
                StockMovement.branch_id == active_branch_id,
            ),
        )
        .where(
            Product.user_id.in_(tenant_user_ids),
            Product.branch_id == active_branch_id,
        )
        .group_by(Product.id)
    ).all()

    low_stock_items = []
    expiring_items = []
    for row in stock_rows:
        stock = max(0.0, _to_float(row.current_stock))
        if stock < float(settings.low_stock_threshold):
            low_stock_items.append(
                {
                    "id": int(row.id),
                    "name": row.name,
                    "sku": row.sku,
                    "current_stock": stock,
                    "threshold": int(settings.low_stock_threshold),
                }
            )

        if stock <= 0:
            continue

        soonest_expiry_date = None
        soonest_days_until = None

        if row.expiry_date and today_start.date() <= row.expiry_date <= expiry_cutoff:
            soonest_expiry_date = row.expiry_date
            soonest_days_until = (row.expiry_date - today_start.date()).days

        balances = get_batch_balances(
            db=db,
            tenant_user_ids=tenant_user_ids,
            branch_id=active_branch_id,
            product_id=int(row.id),
            include_null_expiry=False,
        )
        for batch in balances:
            if batch.balance <= 0 or batch.expiry_date is None:
                continue
            if not (today_start.date() <= batch.expiry_date <= expiry_cutoff):
                continue

            days_until = (batch.expiry_date - today_start.date()).days
            if soonest_days_until is None or days_until < soonest_days_until:
                soonest_days_until = days_until
                soonest_expiry_date = batch.expiry_date

        if soonest_expiry_date is not None and soonest_days_until is not None:
            expiring_items.append(
                {
                    "id": int(row.id),
                    "name": row.name,
                    "sku": row.sku,
                    "expiry_date": soonest_expiry_date.isoformat(),
                    "days_until_expiry": soonest_days_until,
                    "current_stock": stock,
                }
            )

    low_stock_items.sort(key=lambda item: (item["current_stock"], item["name"]))
    expiring_items.sort(key=lambda item: (item["days_until_expiry"], item["name"]))

    best_seller_rows = db.execute(
        select(
            Sale.product_id,
            func.coalesce(func.sum(Sale.quantity), 0).label("qty"),
            func.coalesce(func.sum(Sale.total_price), 0).label("revenue"),
        )
        .where(
            and_(
                Sale.created_at >= yesterday_start,
                Sale.created_at < today_start,
                Sale.user_id.in_(tenant_user_ids),
                Sale.branch_id == active_branch_id,
            )
        )
        .group_by(Sale.product_id)
        .order_by(func.sum(Sale.quantity).desc())
        .limit(5)
    ).all()

    best_seller_ids = [_to_int(row.product_id) for row in best_seller_rows]
    valid_best_seller_ids = [pid for pid in best_seller_ids if pid is not None]
    best_seller_products = db.scalars(
        select(Product).where(
            Product.id.in_(valid_best_seller_ids),
            Product.user_id.in_(tenant_user_ids),
            Product.branch_id == active_branch_id,
        )
    ).all() if valid_best_seller_ids else []
    best_seller_name_by_id = {int(product.id): product.name for product in best_seller_products}

    best_sellers = []
    for row in best_seller_rows:
        product_id = _to_int(row.product_id)
        best_sellers.append(
            {
                "product_id": product_id,
                "name": best_seller_name_by_id.get(product_id, f"Product #{product_id}" if product_id is not None else "Unknown product"),
                "quantity_sold": _to_float(row.qty),
                "revenue": _to_float(row.revenue),
            }
        )

    sold_last_30_rows = db.execute(
        select(
            Sale.product_id,
            func.coalesce(func.sum(Sale.quantity), 0).label("qty"),
        )
        .where(
            and_(
                Sale.created_at >= slow_mover_start,
                Sale.created_at < today_start,
                Sale.user_id.in_(tenant_user_ids),
                Sale.branch_id == active_branch_id,
            )
        )
        .group_by(Sale.product_id)
    ).all()
    sold_last_30_by_product = {
        _to_int(row.product_id): _to_float(row.qty)
        for row in sold_last_30_rows
        if _to_int(row.product_id) is not None
    }

    slow_movers = []
    for row in stock_rows:
        product_id = _to_int(row.id)
        if product_id is None:
            continue
        stock = max(0.0, _to_float(row.current_stock))
        if stock <= 0:
            continue
        sold_qty = sold_last_30_by_product.get(product_id, 0.0)
        if sold_qty <= 0:
            slow_movers.append(
                {
                    "product_id": product_id,
                    "name": row.name,
                    "sku": row.sku,
                    "current_stock": stock,
                    "sold_last_30_days": sold_qty,
                }
            )
    slow_movers.sort(key=lambda item: (-item["current_stock"], item["name"]))

    purchase_due_row = db.execute(
        select(
            func.coalesce(func.sum(Purchase.amount_due), 0).label("amount_due"),
            func.count(Purchase.id).label("due_count"),
        )
        .where(
            and_(
                Purchase.user_id.in_(tenant_user_ids),
                Purchase.branch_id == active_branch_id,
                Purchase.amount_due > 0,
                or_(Purchase.due_date.is_(None), Purchase.due_date <= today_start.date()),
            )
        )
    ).first()

    creditor_due_row = db.execute(
        select(
            func.coalesce(func.sum(Creditor.total_debt), 0).label("total_debt"),
            func.count(Creditor.id).label("creditor_count"),
        )
        .where(
            and_(
                Creditor.user_id.in_(tenant_user_ids),
                Creditor.branch_id == active_branch_id,
                Creditor.total_debt > 0,
            )
        )
    ).first()

    branches = db.scalars(
        select(Branch)
        .where(
            Branch.owner_user_id == owner_user_id,
            Branch.is_active.is_(True),
        )
        .order_by(Branch.created_at.asc(), Branch.id.asc())
    ).all()
    branch_name_by_id = {int(branch.id): branch.name for branch in branches}
    branch_ids = list(branch_name_by_id.keys())

    branch_sales_rows = db.execute(
        select(
            Sale.branch_id,
            Sale.id,
            Sale.client_sale_id,
            Sale.total_price,
        )
        .where(
            and_(
                Sale.created_at >= yesterday_start,
                Sale.created_at < today_start,
                Sale.user_id.in_(tenant_user_ids),
                Sale.branch_id.in_(branch_ids),
            )
        )
        .order_by(Sale.branch_id.asc(), Sale.id.desc())
    ).all() if branch_ids else []

    branch_transactions: dict[int, dict[str, float]] = {branch_id: {} for branch_id in branch_ids}
    for sale in branch_sales_rows:
        branch_id = _to_int(sale.branch_id)
        if branch_id is None or branch_id not in branch_transactions:
            continue
        key = _sale_transaction_key(sale.id, sale.client_sale_id)
        branch_bucket = branch_transactions[branch_id]
        branch_bucket[key] = branch_bucket.get(key, 0.0) + _to_float(sale.total_price)

    total_branch_revenue = 0.0
    branch_comparison = []
    for branch_id in branch_ids:
        transactions = branch_transactions.get(branch_id, {})
        revenue = sum(transactions.values())
        total_branch_revenue += revenue
        branch_comparison.append(
            {
                "branch_id": branch_id,
                "branch_name": branch_name_by_id.get(branch_id, f"Branch {branch_id}"),
                "transactions": len(transactions),
                "revenue": revenue,
            }
        )

    branch_comparison.sort(key=lambda item: item["revenue"], reverse=True)
    for index, item in enumerate(branch_comparison, start=1):
        item["rank"] = index
        item["share_percent"] = (item["revenue"] / total_branch_revenue * 100.0) if total_branch_revenue > 0 else 0.0

    return {
        "generated_at": now.isoformat(),
        "window": {
            "label": "yesterday",
            "start": yesterday_start.date().isoformat(),
            "end": (today_start.date() - timedelta(days=1)).isoformat(),
        },
        "yesterday_sales": {
            "transactions": yesterday_sales_count,
            "revenue": yesterday_sales_total,
        },
        "low_stock": {
            "count": len(low_stock_items),
            "items": low_stock_items[:8],
            "threshold": int(settings.low_stock_threshold),
        },
        "expiring_products": {
            "count": len(expiring_items),
            "window_days": int(settings.expiry_warning_days),
            "items": expiring_items[:8],
        },
        "debt_due": {
            "supplier_due_amount": _to_float(getattr(purchase_due_row, "amount_due", 0)),
            "supplier_due_count": _to_int(getattr(purchase_due_row, "due_count", 0)) or 0,
            "customer_debt_amount": _to_float(getattr(creditor_due_row, "total_debt", 0)),
            "customer_debt_count": _to_int(getattr(creditor_due_row, "creditor_count", 0)) or 0,
        },
        "best_sellers": best_sellers,
        "slow_movers": slow_movers[:8],
        "branch_comparison": branch_comparison,
    }


@router.get("/sales-dashboard")
def get_sales_dashboard(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    active_branch_id: int = Depends(get_active_branch_id),
    filter_date: str | None = None,
):
    """
    Get sales dashboard with key metrics (Owner/Admin only).
    Optional filter_date (YYYY-MM-DD format) to filter top products since that date.
    """
    ensure_permission(current_user, "view_reports", "Only Admin and Manager can access sales reports")
    
    # Get tenant user IDs for multi-tenant filtering
    tenant_user_ids = get_tenant_user_ids(current_user, db)
    
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_start = today_start - timedelta(days=today_start.weekday())
    month_start = today_start.replace(day=1)
    
    # Parse custom date for top products if provided (interpreted as range start).
    # The dashboard passes the selected range start date (e.g., last 7/30 days).
    top_products_start = month_start
    top_products_end = now
    if filter_date:
        try:
            parsed_date = datetime.strptime(filter_date, "%Y-%m-%d")
            top_products_start = parsed_date.replace(hour=0, minute=0, second=0, microsecond=0)
            top_products_end = now
        except ValueError:
            pass
    
    sales_since_month = db.execute(
        select(
            Sale.id,
            Sale.client_sale_id,
            Sale.total_price,
            Sale.payment_method,
            Sale.customer_name,
            Sale.created_at,
        )
        .where(and_(Sale.created_at >= month_start, Sale.user_id.in_(tenant_user_ids), Sale.branch_id == active_branch_id))
        .order_by(Sale.created_at.desc(), Sale.id.desc())
    ).all()

    monthly_transactions: dict[str, dict[str, object]] = {}
    for sale in sales_since_month:
        key = _sale_transaction_key(sale.id, sale.client_sale_id)
        transaction = monthly_transactions.get(key)
        if transaction is None:
            transaction = {
                "created_at": sale.created_at,
                "payment_method": sale.payment_method,
                "customer_name": sale.customer_name,
                "total": 0.0,
            }
            monthly_transactions[key] = transaction

        transaction["total"] = _to_float(transaction.get("total")) + _to_float(sale.total_price)
        if not transaction.get("customer_name") and sale.customer_name:
            transaction["customer_name"] = sale.customer_name

    today_summary = {"count": 0, "total": 0.0}
    week_summary = {"count": 0, "total": 0.0}
    month_summary = {"count": 0, "total": 0.0}
    payment_method_totals: dict[str, dict[str, float | int]] = {}

    for transaction in monthly_transactions.values():
        created_at = _to_utc_datetime(transaction.get("created_at"))
        if created_at is None:
            continue

        total_value = _to_float(transaction.get("total"))
        payment_key = str(transaction.get("payment_method") or "unknown")

        month_summary["count"] += 1
        month_summary["total"] += total_value

        if created_at >= week_start:
            week_summary["count"] += 1
            week_summary["total"] += total_value

        if created_at >= today_start:
            today_summary["count"] += 1
            today_summary["total"] += total_value

        payment_meta = payment_method_totals.setdefault(payment_key, {"count": 0, "total": 0.0})
        payment_meta["count"] = int(payment_meta["count"]) + 1
        payment_meta["total"] = _to_float(payment_meta["total"]) + total_value

    payment_methods = [
        {
            "method": method,
            "count": int(data["count"]),
            "total": _to_float(data["total"]),
        }
        for method, data in payment_method_totals.items()
    ]
    
    # Top selling products (filtered by date range).
    # Aggregate from sales first so legacy/misaligned product rows do not hide valid sales.
    top_product_rows = db.execute(
        select(
            Sale.product_id,
            func.sum(Sale.quantity).label("quantity_sold"),
            func.coalesce(func.sum(Sale.total_price), 0).label("revenue")
        )
        .where(and_(
            Sale.created_at >= top_products_start,
            Sale.created_at <= top_products_end,
            Sale.user_id.in_(tenant_user_ids),
            Sale.branch_id == active_branch_id,
        ))
        .group_by(Sale.product_id)
        .order_by(func.sum(Sale.quantity).desc())
        .limit(10)
    ).all()

    top_product_ids_set: set[int] = set()
    for row in top_product_rows:
        product_id = _to_int(row.product_id)
        if product_id is not None:
            top_product_ids_set.add(product_id)
    top_product_ids = sorted(top_product_ids_set)
    top_product_records = db.scalars(
        select(Product).where(
            Product.id.in_(top_product_ids),
            Product.user_id.in_(tenant_user_ids),
            Product.branch_id == active_branch_id,
        )
    ).all() if top_product_ids else []
    top_product_by_id = {int(product.id): product for product in top_product_records}
    
    # Recent sales grouped by checkout transaction so multi-item purchases appear on one line.
    recent_sales_rows = db.execute(
        select(
            Sale.id,
            Sale.client_sale_id,
            Sale.product_id,
            Sale.quantity,
            Sale.total_price,
            Sale.customer_name,
            Sale.payment_method,
            Sale.created_at,
            Product.name.label("product_name"),
            Product.sku.label("product_sku"),
        )
        .outerjoin(
            Product,
            and_(
                Product.id == Sale.product_id,
                Product.user_id.in_(tenant_user_ids),
                Product.branch_id == active_branch_id,
            ),
        )
        .where(Sale.user_id.in_(tenant_user_ids), Sale.branch_id == active_branch_id)
        .order_by(Sale.created_at.desc(), Sale.id.desc())
        .limit(80)
    ).all()

    recent_sales_grouped: dict[str, dict[str, object]] = {}
    for sale in recent_sales_rows:
        key = _sale_transaction_key(sale.id, sale.client_sale_id)
        transaction = recent_sales_grouped.get(key)
        if transaction is None:
            transaction = {
                "id": sale.id,
                "receipt_number": key.split(":")[0][-8:].upper() if not str(key).startswith("sale:") else str(sale.id).zfill(6),
                "customer_name": sale.customer_name,
                "payment_method": sale.payment_method,
                "created_at": sale.created_at.isoformat(),
                "total_price": 0.0,
                "item_count": 0,
                "items": [],
            }
            recent_sales_grouped[key] = transaction

        transaction["total_price"] = _to_float(transaction.get("total_price")) + _to_float(sale.total_price)
        transaction["item_count"] = int(transaction.get("item_count", 0)) + 1
        if not transaction.get("customer_name") and sale.customer_name:
            transaction["customer_name"] = sale.customer_name
        transaction_items = transaction.setdefault("items", [])
        if isinstance(transaction_items, list):
            transaction_items.append({
                "name": sale.product_name or (f"Product #{sale.product_id}" if sale.product_id is not None else "Unknown product"),
                "quantity": _to_float(sale.quantity),
            })

    recent_sales_data = list(recent_sales_grouped.values())[:10]

    top_products_data = []
    for row in top_product_rows:
        product_id = _to_int(row.product_id)
        product = top_product_by_id.get(product_id) if product_id is not None else None
        fallback_name = f"Product #{product_id}" if product_id is not None else "Unknown product"
        top_products_data.append(
            {
                "name": product.name if product else fallback_name,
                "quantity_sold": float(row.quantity_sold),
                "revenue": float(row.revenue),
            }
        )
    
    return {
        "today": {
            "count": int(today_summary["count"]),
            "total": float(today_summary["total"])
        },
        "week": {
            "count": int(week_summary["count"]),
            "total": float(week_summary["total"])
        },
        "month": {
            "count": int(month_summary["count"]),
            "total": float(month_summary["total"])
        },
        "payment_methods": payment_methods,
        "top_products": top_products_data,
        "recent_sales": recent_sales_data
    }


@router.get("/inventory-status")
def get_inventory_status(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    active_branch_id: int = Depends(get_active_branch_id),
):
    """
    Get current inventory status with stock levels and alerts (Owner/Admin only).
    """
    ensure_permission(current_user, "view_reports", "Only Admin and Manager can access inventory reports")
    
    # Get tenant user IDs for multi-tenant filtering
    tenant_user_ids = get_tenant_user_ids(current_user, db)
    settings = _get_or_create_settings(db, _get_tenant_owner_id(current_user))
    
    # Get all products with their current stock
    products_query = select(
        Product.id,
        Product.sku,
        Product.name,
        Product.category,
        Product.unit,
        Product.cost_price,
        Product.selling_price,
        Product.expiry_date,
        func.coalesce(func.sum(StockMovement.change), 0).label("current_stock")
    ).outerjoin(StockMovement, and_(StockMovement.product_id == Product.id, StockMovement.branch_id == active_branch_id))\
     .where(Product.user_id.in_(tenant_user_ids), Product.branch_id == active_branch_id)\
     .group_by(Product.id)
    
    products = db.execute(products_query).all()

    def clamp_stock(value: object) -> float:
        try:
            n = float(value)  # type: ignore[arg-type]
        except Exception:
            return 0.0
        return n if n > 0 else 0.0
    
    # Calculate metrics
    total_products = len(products)
    low_stock_threshold = settings.low_stock_threshold
    low_stock_items = [p for p in products if clamp_stock(p.current_stock) < float(low_stock_threshold)]
    out_of_stock = [p for p in products if clamp_stock(p.current_stock) <= 0]
    
    # Items expiring soon (within expiry warning window)
    expiring_soon = []
    if products:
        warning_end = datetime.now().date() + timedelta(days=settings.expiry_warning_days)
        expiring_soon = [
            p for p in products 
            if p.expiry_date and p.expiry_date <= warning_end and clamp_stock(p.current_stock) > 0
        ]
    
    # Calculate total stock value
    total_cost_value = sum(
        clamp_stock(p.current_stock) * float(p.cost_price or 0) 
        for p in products
    )
    total_selling_value = sum(
        clamp_stock(p.current_stock) * float(p.selling_price or 0) 
        for p in products
    )
    
    # Stock by category
    category_stock = {}
    for p in products:
        cat = p.category or "Uncategorized"
        if cat not in category_stock:
            category_stock[cat] = {"count": 0, "total_stock": 0}
        category_stock[cat]["count"] += 1
        category_stock[cat]["total_stock"] += clamp_stock(p.current_stock)
    
    return {
        "summary": {
            "total_products": total_products,
            "low_stock_count": len(low_stock_items),
            "out_of_stock_count": len(out_of_stock),
            "expiring_soon_count": len(expiring_soon),
            "total_cost_value": total_cost_value,
            "total_selling_value": total_selling_value,
            "potential_profit": total_selling_value - total_cost_value
        },
        "low_stock": [
            {
                "id": p.id,
                "sku": p.sku,
                "name": p.name,
                "current_stock": clamp_stock(p.current_stock),
                "unit": p.unit
            }
            for p in low_stock_items[:20]
        ],
        "out_of_stock": [
            {
                "id": p.id,
                "sku": p.sku,
                "name": p.name,
                "unit": p.unit
            }
            for p in out_of_stock[:20]
        ],
        "expiring_soon": [
            {
                "id": p.id,
                "sku": p.sku,
                "name": p.name,
                "current_stock": clamp_stock(p.current_stock),
                "expiry_date": p.expiry_date.isoformat(),
                "days_until_expiry": (p.expiry_date - datetime.now().date()).days
            }
            for p in sorted(expiring_soon, key=lambda x: x.expiry_date)[:20]
        ],
        "by_category": [
            {
                "category": cat,
                "product_count": data["count"],
                "total_stock": data["total_stock"]
            }
            for cat, data in category_stock.items()
        ]
    }


@router.get("/creditors-summary")
def get_creditors_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    active_branch_id: int = Depends(get_active_branch_id),
):
    """
    Get summary of all creditors with outstanding debts (Owner/Admin only).
    """
    ensure_permission(current_user, "view_reports", "Only Admin and Manager can access creditor reports")
    
    # Get tenant user IDs for multi-tenant filtering
    tenant_user_ids = get_tenant_user_ids(current_user, db)
    
    # Get all creditors with transaction details
    creditors = db.scalars(
        select(Creditor)
        .where(Creditor.user_id.in_(tenant_user_ids), Creditor.branch_id == active_branch_id)
        .order_by(Creditor.total_debt.desc())
    ).all()
    
    # Calculate totals
    total_debt = sum(float(c.total_debt) for c in creditors)
    creditors_with_debt = [c for c in creditors if c.total_debt > 0]
    
    # Recent credit transactions
    recent_transactions = db.execute(
        select(
            CreditTransaction.id,
            CreditTransaction.creditor_id,
            Creditor.name.label("creditor_name"),
            CreditTransaction.amount,
            CreditTransaction.transaction_type,
            CreditTransaction.notes,
            CreditTransaction.created_at
        ).join(Creditor, Creditor.id == CreditTransaction.creditor_id)
        .where(
            Creditor.user_id.in_(tenant_user_ids),
            Creditor.branch_id == active_branch_id,
            CreditTransaction.branch_id == active_branch_id,
        )
        .order_by(CreditTransaction.created_at.desc())
        .limit(20)
    ).all()
    
    # Top debtors
    top_debtors = sorted(creditors_with_debt, key=lambda c: c.total_debt, reverse=True)[:10]
    
    return {
        "summary": {
            "total_creditors": len(creditors),
            "creditors_with_debt": len(creditors_with_debt),
            "total_outstanding_debt": total_debt,
            "average_debt": total_debt / len(creditors_with_debt) if creditors_with_debt else 0
        },
        "top_debtors": [
            {
                "id": c.id,
                "name": c.name,
                "phone": c.phone,
                "email": c.email,
                "total_debt": float(c.total_debt),
                "created_at": c.created_at.isoformat()
            }
            for c in top_debtors
        ],
        "recent_transactions": [
            {
                "id": t.id,
                "creditor_id": t.creditor_id,
                "creditor_name": t.creditor_name,
                "amount": float(t.amount),
                "type": t.transaction_type,
                "notes": t.notes,
                "created_at": t.created_at.isoformat()
            }
            for t in recent_transactions
        ],
        "all_creditors": [
            {
                "id": c.id,
                "name": c.name,
                "phone": c.phone,
                "total_debt": float(c.total_debt)
            }
            for c in creditors_with_debt
        ]
    }


@router.get("/sales-by-period")
def get_sales_by_period(
    start_date: str = Query(..., description="Start date (YYYY-MM-DD)"),
    end_date: str = Query(..., description="End date (YYYY-MM-DD)"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    active_branch_id: int = Depends(get_active_branch_id),
):
    """
    Get detailed sales report for a specific period (Owner/Admin only).
    """
    ensure_permission(current_user, "view_reports", "Only Admin and Manager can access sales reports")
    
    # Get tenant user IDs for multi-tenant filtering
    tenant_user_ids = get_tenant_user_ids(current_user, db)
    
    start = datetime.fromisoformat(start_date)
    end = datetime.fromisoformat(end_date).replace(hour=23, minute=59, second=59)
    
    # Sales in period
    sales = db.scalars(
        select(Sale)
        .where(and_(Sale.created_at >= start, Sale.created_at <= end, Sale.user_id.in_(tenant_user_ids), Sale.branch_id == active_branch_id))
        .order_by(Sale.created_at.desc())
    ).all()
    
    # Summary
    total_sales = len(sales)
    total_revenue = sum(float(s.total_price) for s in sales)
    total_quantity = sum(float(s.quantity) for s in sales)
    
    # By payment method
    payment_breakdown = {}
    for sale in sales:
        method = sale.payment_method
        if method not in payment_breakdown:
            payment_breakdown[method] = {"count": 0, "total": 0}
        payment_breakdown[method]["count"] += 1
        payment_breakdown[method]["total"] += float(sale.total_price)
    
    return {
        "period": {
            "start": start_date,
            "end": end_date
        },
        "summary": {
            "total_sales": total_sales,
            "total_revenue": total_revenue,
            "total_quantity": total_quantity,
            "average_sale_value": total_revenue / total_sales if total_sales > 0 else 0
        },
        "payment_breakdown": [
            {
                "method": method,
                "count": data["count"],
                "total": data["total"]
            }
            for method, data in payment_breakdown.items()
        ],
        "sales": [
            {
                "id": s.id,
                "product_id": s.product_id,
                "quantity": float(s.quantity),
                "unit_price": float(s.unit_price),
                "total_price": float(s.total_price),
                "customer_name": s.customer_name,
                "payment_method": s.payment_method,
                "notes": s.notes,
                "created_at": s.created_at.isoformat()
            }
            for s in sales
        ]
    }
