from datetime import datetime, timedelta
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, func, and_, or_
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Sale, Product, StockMovement, Creditor, CreditTransaction, User, SystemSettings
from ..auth import get_current_active_user
from app.utils.tenant import get_tenant_user_ids
from app.utils.branch import get_active_branch_id

router = APIRouter(prefix="/reports", tags=["reports"])


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


@router.get("/sales-dashboard")
def get_sales_dashboard(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    active_branch_id: int = Depends(get_active_branch_id),
):
    """
    Get sales dashboard with key metrics (Owner/Admin only).
    """
    # Restrict access to Admin/Owner only
    if current_user.role != "Admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only business owners can access sales reports"
        )
    
    # Get tenant user IDs for multi-tenant filtering
    tenant_user_ids = get_tenant_user_ids(current_user, db)
    
    now = datetime.now()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_start = today_start - timedelta(days=today_start.weekday())
    month_start = today_start.replace(day=1)
    
    # Today's sales
    today_sales = db.execute(
        select(
            func.count(Sale.id).label("count"),
            func.coalesce(func.sum(Sale.total_price), 0).label("total")
        ).where(and_(Sale.created_at >= today_start, Sale.user_id.in_(tenant_user_ids), Sale.branch_id == active_branch_id))
    ).first()
    
    # This week's sales
    week_sales = db.execute(
        select(
            func.count(Sale.id).label("count"),
            func.coalesce(func.sum(Sale.total_price), 0).label("total")
        ).where(and_(Sale.created_at >= week_start, Sale.user_id.in_(tenant_user_ids), Sale.branch_id == active_branch_id))
    ).first()
    
    # This month's sales
    month_sales = db.execute(
        select(
            func.count(Sale.id).label("count"),
            func.coalesce(func.sum(Sale.total_price), 0).label("total")
        ).where(and_(Sale.created_at >= month_start, Sale.user_id.in_(tenant_user_ids), Sale.branch_id == active_branch_id))
    ).first()
    
    # Sales by payment method (this month)
    payment_methods = db.execute(
        select(
            Sale.payment_method,
            func.count(Sale.id).label("count"),
            func.coalesce(func.sum(Sale.total_price), 0).label("total")
        ).where(and_(Sale.created_at >= month_start, Sale.user_id.in_(tenant_user_ids), Sale.branch_id == active_branch_id))
        .group_by(Sale.payment_method)
    ).all()
    
    # Top selling products (this month)
    top_products = db.execute(
        select(
            Product.name,
            func.sum(Sale.quantity).label("quantity_sold"),
            func.coalesce(func.sum(Sale.total_price), 0).label("revenue")
        ).join(Sale, Sale.product_id == Product.id)
        .where(and_(
            Sale.created_at >= month_start,
            Sale.user_id.in_(tenant_user_ids),
            Sale.branch_id == active_branch_id,
            Product.user_id.in_(tenant_user_ids),
            Product.branch_id == active_branch_id,
        ))
        .group_by(Product.id, Product.name)
        .order_by(func.sum(Sale.quantity).desc())
        .limit(10)
    ).all()
    
    # Recent sales
    recent_sales = db.scalars(
        select(Sale)
        .where(Sale.user_id.in_(tenant_user_ids), Sale.branch_id == active_branch_id)
        .order_by(Sale.created_at.desc())
        .limit(10)
    ).all()
    
    # Add product details to recent sales
    recent_sales_data = []
    for s in recent_sales:
        product = db.scalar(
            select(Product).where(
                Product.id == s.product_id,
                Product.user_id.in_(tenant_user_ids),
                Product.branch_id == active_branch_id,
            )
        )
        recent_sales_data.append({
            "id": s.id,
            "product_id": s.product_id,
            "product": {
                "name": product.name if product else "Unknown",
                "sku": product.sku if product else "N/A"
            },
            "quantity": float(s.quantity),
            "total_price": float(s.total_price),
            "customer_name": s.customer_name,
            "payment_method": s.payment_method,
            "created_at": s.created_at.isoformat()
        })
    
    return {
        "today": {
            "count": today_sales.count,
            "total": float(today_sales.total)
        },
        "week": {
            "count": week_sales.count,
            "total": float(week_sales.total)
        },
        "month": {
            "count": month_sales.count,
            "total": float(month_sales.total)
        },
        "payment_methods": [
            {
                "method": pm.payment_method,
                "count": pm.count,
                "total": float(pm.total)
            }
            for pm in payment_methods
        ],
        "top_products": [
            {
                "name": tp.name,
                "quantity_sold": float(tp.quantity_sold),
                "revenue": float(tp.revenue)
            }
            for tp in top_products
        ],
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
    # Restrict access to Admin/Owner only  
    if current_user.role != "Admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only business owners can access inventory reports"
        )
    
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
    
    # Calculate metrics
    total_products = len(products)
    low_stock_threshold = settings.low_stock_threshold
    low_stock_items = [p for p in products if float(p.current_stock) < low_stock_threshold]
    out_of_stock = [p for p in products if float(p.current_stock) <= 0]
    
    # Items expiring soon (within expiry warning window)
    expiring_soon = []
    if products:
        warning_end = datetime.now().date() + timedelta(days=settings.expiry_warning_days)
        expiring_soon = [
            p for p in products 
            if p.expiry_date and p.expiry_date <= warning_end and float(p.current_stock) > 0
        ]
    
    # Calculate total stock value
    total_cost_value = sum(
        float(p.current_stock) * float(p.cost_price or 0) 
        for p in products
    )
    total_selling_value = sum(
        float(p.current_stock) * float(p.selling_price or 0) 
        for p in products
    )
    
    # Stock by category
    category_stock = {}
    for p in products:
        cat = p.category or "Uncategorized"
        if cat not in category_stock:
            category_stock[cat] = {"count": 0, "total_stock": 0}
        category_stock[cat]["count"] += 1
        category_stock[cat]["total_stock"] += float(p.current_stock)
    
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
                "current_stock": float(p.current_stock),
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
                "current_stock": float(p.current_stock),
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
    # Restrict access to Admin/Owner only
    if current_user.role != "Admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only business owners can access creditor reports"
        )
    
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
    # Restrict access to Admin/Owner only
    if current_user.role != "Admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only business owners can access sales reports"
        )
    
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
