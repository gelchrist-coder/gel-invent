from datetime import datetime, timedelta
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from ..auth import get_current_active_user
from ..database import get_db
from ..models import Sale, Product, StockMovement, User
from app.utils.tenant import get_tenant_user_ids

router = APIRouter(prefix="/revenue", tags=["revenue"])


@router.get("/analytics")
def get_revenue_analytics(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    start_date: str | None = Query(None),
    end_date: str | None = Query(None),
    period: str = Query("30d", regex="^(today|7d|30d|90d|all)$"),
):
    """
    Get comprehensive revenue analytics including:
    - Total revenue, profit, sales count
    - Revenue by payment method
    - Top products by revenue
    - Daily/weekly trends
    - Period comparison
    
    (Owner/Admin only)
    """
    # Restrict access to Admin/Owner only
    if current_user.role != "Admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only business owners can access revenue analytics"
        )
    
    # Get tenant user IDs for multi-tenant filtering
    tenant_user_ids = get_tenant_user_ids(current_user, db)
    
    # Determine date range
    now = datetime.now()
    
    if start_date and end_date:
        start = datetime.fromisoformat(start_date)
        end = datetime.fromisoformat(end_date)
    else:
        if period == "today":
            start = now.replace(hour=0, minute=0, second=0, microsecond=0)
            end = now
        elif period == "7d":
            start = now - timedelta(days=7)
            end = now
        elif period == "30d":
            start = now - timedelta(days=30)
            end = now
        elif period == "90d":
            start = now - timedelta(days=90)
            end = now
        else:  # all
            start = datetime(2000, 1, 1)
            end = now
    
    # Get sales in period (filtered by tenant)
    sales_query = select(Sale).join(Product).where(
        Sale.created_at >= start,
        Sale.created_at <= end,
        Product.user_id.in_(tenant_user_ids)
    )
    sales = db.scalars(sales_query).all()
    
    # Get losses/write-offs (stock movements with negative change for expired/damaged goods)
    loss_reasons = ["Expired", "Damaged", "Lost", "Write-off", "Spoiled", "Destroyed"]
    losses_query = select(StockMovement).join(Product).where(
        StockMovement.created_at >= start,
        StockMovement.created_at <= end,
        StockMovement.change < 0,
        StockMovement.reason.in_(loss_reasons),
        Product.user_id.in_(tenant_user_ids)
    )
    losses = db.scalars(losses_query).all()
    
    # Calculate metrics
    total_revenue = Decimal(0)
    cash_revenue = Decimal(0)
    credit_revenue = Decimal(0)
    total_profit = Decimal(0)
    total_cost = Decimal(0)
    total_losses = Decimal(0)
    sales_count = len(sales)
    payment_methods = {}
    product_revenue = {}
    daily_revenue = {}
    
    for sale in sales:
        # Revenue
        total_revenue += sale.total_price
        
        # Separate cash and credit
        if sale.payment_method == "credit":
            # For credit sales with initial payment
            amount_paid = Decimal(sale.amount_paid) if sale.amount_paid is not None else Decimal(0)
            credit_amount = sale.total_price - amount_paid
            
            # Cash received from initial payment
            cash_revenue += amount_paid
            # Remaining credit/debt
            credit_revenue += credit_amount
        else:
            cash_revenue += sale.total_price
        
        # Get product for cost calculation
        product = db.scalar(select(Product).where(
            Product.id == sale.product_id,
            Product.user_id.in_(tenant_user_ids)
        ))
        if product and product.cost_price:
            cost = product.cost_price * sale.quantity
            profit = sale.total_price - cost
            total_cost += cost
            total_profit += profit
        
        # Payment method breakdown
        payment_methods[sale.payment_method] = payment_methods.get(sale.payment_method, Decimal(0)) + sale.total_price
        
        # Product revenue
        product_name = product.name if product else f"Product #{sale.product_id}"
        if product_name not in product_revenue:
            product_revenue[product_name] = {
                "product_id": sale.product_id,
                "product_name": product_name,
                "sku": product.sku if product else "N/A",
                "quantity_sold": Decimal(0),
                "revenue": Decimal(0),
                "cost": Decimal(0),
                "profit": Decimal(0),
            }
        product_revenue[product_name]["quantity_sold"] += sale.quantity
        product_revenue[product_name]["revenue"] += sale.total_price
        if product and product.cost_price:
            product_revenue[product_name]["cost"] += product.cost_price * sale.quantity
            product_revenue[product_name]["profit"] += sale.total_price - (product.cost_price * sale.quantity)
        
        # Daily revenue
        day_key = sale.created_at.strftime("%Y-%m-%d")
        daily_revenue[day_key] = daily_revenue.get(day_key, Decimal(0)) + sale.total_price
    
    # Calculate losses from expired/damaged goods
    for loss in losses:
        product = db.scalar(select(Product).where(
            Product.id == loss.product_id,
            Product.user_id.in_(tenant_user_ids)
        ))
        if product and product.cost_price:
            loss_value = abs(loss.change) * product.cost_price
            total_losses += loss_value
    
    # Calculate actual profit (profit - losses)
    actual_profit = total_profit - total_losses
    
    # Calculate averages and margins
    avg_transaction = total_revenue / sales_count if sales_count > 0 else Decimal(0)
    profit_margin = (total_profit / total_revenue * 100) if total_revenue > 0 else Decimal(0)
    actual_profit_margin = (actual_profit / total_revenue * 100) if total_revenue > 0 else Decimal(0)
    
    # Get previous period for comparison
    period_length = (end - start).days
    prev_start = start - timedelta(days=period_length)
    prev_end = start
    
    prev_sales_query = select(Sale).join(Product).where(
        Sale.created_at >= prev_start,
        Sale.created_at < prev_end,
        Product.user_id.in_(tenant_user_ids)
    )
    prev_sales = db.scalars(prev_sales_query).all()
    prev_revenue = sum(s.total_price for s in prev_sales)
    
    revenue_growth = ((total_revenue - prev_revenue) / prev_revenue * 100) if prev_revenue > 0 else Decimal(0)
    
    # Sort products by revenue
    top_products = sorted(
        product_revenue.values(),
        key=lambda x: x["revenue"],
        reverse=True
    )[:10]
    
    # Convert to serializable format
    for product in top_products:
        product["quantity_sold"] = float(product["quantity_sold"])
        product["revenue"] = float(product["revenue"])
        product["cost"] = float(product["cost"])
        product["profit"] = float(product["profit"])
        product["profit_margin"] = float((product["profit"] / product["revenue"] * 100) if product["revenue"] > 0 else 0)
    
    # Daily trend (last 30 days)
    trend_days = 30 if period == "30d" or period == "90d" else 7 if period == "7d" else (end - start).days + 1
    daily_trend = []
    for i in range(trend_days):
        day = (end - timedelta(days=trend_days - 1 - i)).strftime("%Y-%m-%d")
        daily_trend.append({
            "date": day,
            "revenue": float(daily_revenue.get(day, 0))
        })
    
    return {
        "period": {
            "start": start.isoformat(),
            "end": end.isoformat(),
            "label": period,
        },
        "metrics": {
            "total_revenue": float(total_revenue),
            "cash_revenue": float(cash_revenue),
            "credit_revenue": float(credit_revenue),
            "total_profit": float(total_profit),
            "total_losses": float(total_losses),
            "actual_profit": float(actual_profit),
            "total_cost": float(total_cost),
            "profit_margin": float(profit_margin),
            "actual_profit_margin": float(actual_profit_margin),
            "sales_count": sales_count,
            "avg_transaction": float(avg_transaction),
            "revenue_growth": float(revenue_growth),
        },
        "payment_methods": [
            {"method": method, "revenue": float(revenue)}
            for method, revenue in sorted(payment_methods.items(), key=lambda x: x[1], reverse=True)
        ],
        "top_products": top_products,
        "daily_trend": daily_trend,
    }
