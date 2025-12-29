from datetime import datetime, timedelta
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from ..auth import get_current_active_user
from ..database import get_db
from ..models import Sale, Product, StockMovement, User, CreditTransaction
from app.utils.tenant import get_tenant_user_ids
from app.utils.branch import get_active_branch_id

router = APIRouter(prefix="/revenue", tags=["revenue"])


@router.get("/analytics")
def get_revenue_analytics(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    active_branch_id: int = Depends(get_active_branch_id),
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
        Sale.branch_id == active_branch_id,
        Product.user_id.in_(tenant_user_ids)
        ,
        Product.branch_id == active_branch_id,
    )
    sales = db.scalars(sales_query).all()

    sale_ids = [s.id for s in sales]
    cost_by_sale_id: dict[int, Decimal] = {}
    debt_by_sale_id: dict[int, Decimal] = {}
    payment_by_sale_id: dict[int, Decimal] = {}
    if sale_ids:
        cost_rows = db.execute(
            select(
                StockMovement.sale_id,
                func.coalesce(
                    func.sum(
                        func.abs(StockMovement.change)
                        * func.coalesce(StockMovement.unit_cost_price, Product.cost_price, 0)
                    ),
                    0,
                ).label("cost"),
            )
            .select_from(StockMovement)
            .join(Product, Product.id == StockMovement.product_id)
            .where(
                StockMovement.sale_id.in_(sale_ids),
                StockMovement.reason == "Sale",
                StockMovement.change < 0,
                StockMovement.branch_id == active_branch_id,
                Product.user_id.in_(tenant_user_ids),
                Product.branch_id == active_branch_id,
            )
            .group_by(StockMovement.sale_id)
        ).all()
        for sid, cost in cost_rows:
            if sid is None:
                continue
            cost_by_sale_id[int(sid)] = cost if isinstance(cost, Decimal) else Decimal(str(cost or 0))

        # Creditor ledger per sale (for credit/partial logic)
        tx_rows = db.execute(
            select(
                CreditTransaction.sale_id,
                CreditTransaction.transaction_type,
                func.coalesce(func.sum(CreditTransaction.amount), 0).label("amount"),
            )
            .where(
                CreditTransaction.sale_id.in_(sale_ids),
                CreditTransaction.branch_id == active_branch_id,
                CreditTransaction.user_id.in_(tenant_user_ids),
            )
            .group_by(CreditTransaction.sale_id, CreditTransaction.transaction_type)
        ).all()

        for sid, ttype, amt in tx_rows:
            if sid is None:
                continue
            sale_id_int = int(sid)
            amount = amt if isinstance(amt, Decimal) else Decimal(str(amt or 0))
            if str(ttype) == "debt":
                debt_by_sale_id[sale_id_int] = debt_by_sale_id.get(sale_id_int, Decimal(0)) + amount
            elif str(ttype) == "payment":
                payment_by_sale_id[sale_id_int] = payment_by_sale_id.get(sale_id_int, Decimal(0)) + amount
    
    # Get losses/write-offs (stock movements with negative change for expired/damaged goods)
    loss_reasons = ["Expired", "Damaged", "Lost", "Lost/Stolen", "Write-off", "Spoiled", "Destroyed"]
    losses_query = select(StockMovement).join(Product).where(
        StockMovement.created_at >= start,
        StockMovement.created_at <= end,
        StockMovement.change < 0,
        StockMovement.reason.in_(loss_reasons),
        StockMovement.branch_id == active_branch_id,
        Product.user_id.in_(tenant_user_ids)
        ,
        Product.branch_id == active_branch_id,
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

    def compute_returns_totals(range_start: datetime, range_end: datetime) -> tuple[Decimal, Decimal, Decimal]:
        """Returns (revenue, cost, profit) for stock movements marked as Returned.*"""
        returns_query = select(StockMovement).join(Product).where(
            StockMovement.created_at >= range_start,
            StockMovement.created_at <= range_end,
            StockMovement.change > 0,
            StockMovement.reason.like("Returned%"),
            StockMovement.branch_id == active_branch_id,
            Product.user_id.in_(tenant_user_ids),
            Product.branch_id == active_branch_id,
        )
        returns_movements = db.scalars(returns_query).all()

        returns_revenue = Decimal(0)
        returns_cost = Decimal(0)
        returns_profit = Decimal(0)

        for movement in returns_movements:
            product = db.scalar(
                select(Product).where(
                    Product.id == movement.product_id,
                    Product.user_id.in_(tenant_user_ids),
                )
            )
            if not product:
                continue

            selling = (
                Decimal(movement.unit_selling_price)
                if getattr(movement, "unit_selling_price", None) is not None
                else (Decimal(product.selling_price) if product.selling_price is not None else Decimal(0))
            )
            cost = (
                Decimal(movement.unit_cost_price)
                if getattr(movement, "unit_cost_price", None) is not None
                else (Decimal(product.cost_price) if product.cost_price is not None else Decimal(0))
            )

            revenue_value = movement.change * selling
            cost_value = movement.change * cost
            profit_value = revenue_value - cost_value

            returns_revenue += revenue_value
            returns_cost += cost_value
            returns_profit += profit_value

        return returns_revenue, returns_cost, returns_profit
    
    for sale in sales:
        # Revenue
        total_revenue += sale.total_price

        # Separate cash received vs credit pending.
        # For credit/partial sales, we derive paid/unpaid from the creditor ledger linked to the sale:
        #   - debt transaction amount == unpaid portion
        #   - payment transactions (if any) are informational, but paid = total - unpaid
        if sale.payment_method in ("credit", "partial"):
            unpaid = debt_by_sale_id.get(sale.id, Decimal(0))
            if unpaid < 0:
                unpaid = Decimal(0)
            if unpaid > sale.total_price:
                unpaid = sale.total_price
            paid = sale.total_price - unpaid
            cash_revenue += paid
            credit_revenue += unpaid
        else:
            cash_revenue += sale.total_price
        
        # Get product for naming/sku and fallback prices
        product = db.scalar(
            select(Product).where(
                Product.id == sale.product_id,
                Product.user_id.in_(tenant_user_ids),
                Product.branch_id == active_branch_id,
            )
        )

        cost = cost_by_sale_id.get(sale.id)
        if cost is None:
            fallback_cost = Decimal(product.cost_price) if (product and product.cost_price is not None) else Decimal(0)
            cost = fallback_cost * sale.quantity
        profit = sale.total_price - cost
        total_cost += cost
        total_profit += profit
        
        # Payment method breakdown
        # - For cash/card/momo/bank: entire amount is received under that method
        # - For credit/partial: split into received (assigned to a method) + pending (credit)
        if sale.payment_method in ("credit", "partial"):
            unpaid = debt_by_sale_id.get(sale.id, Decimal(0))
            if unpaid < 0:
                unpaid = Decimal(0)
            if unpaid > sale.total_price:
                unpaid = sale.total_price
            paid = sale.total_price - unpaid

            received_method = "cash"
            if sale.payment_method == "partial" and getattr(sale, "partial_payment_method", None):
                received_method = str(sale.partial_payment_method)

            if paid > 0:
                payment_methods[received_method] = payment_methods.get(received_method, Decimal(0)) + paid
            if unpaid > 0:
                payment_methods["credit"] = payment_methods.get("credit", Decimal(0)) + unpaid
        else:
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
        product_revenue[product_name]["cost"] += cost
        product_revenue[product_name]["profit"] += sale.total_price - cost
        
        # Daily revenue
        day_key = sale.created_at.strftime("%Y-%m-%d")
        daily_revenue[day_key] = daily_revenue.get(day_key, Decimal(0)) + sale.total_price

    # Deduct returns from revenue using product selling_price
    returns_revenue, returns_cost, returns_profit = compute_returns_totals(start, end)
    if returns_revenue != 0:
        total_revenue -= returns_revenue
        cash_revenue -= returns_revenue
        total_profit -= returns_profit
        total_cost -= returns_cost
        # Reflect on payment breakdown + daily trend (assume cash refund)
        payment_methods["cash"] = payment_methods.get("cash", Decimal(0)) - returns_revenue

        # Reduce daily revenue trend by day of the return movement
        returns_movements_for_days = db.scalars(
            select(StockMovement)
            .where(
                StockMovement.created_at >= start,
                StockMovement.created_at <= end,
                StockMovement.change > 0,
                StockMovement.reason.like("Returned%"),
                StockMovement.user_id.in_(tenant_user_ids),
                StockMovement.branch_id == active_branch_id,
            )
        ).all()
        for movement in returns_movements_for_days:
            product = db.scalar(
                select(Product).where(
                    Product.id == movement.product_id,
                    Product.user_id.in_(tenant_user_ids),
                    Product.branch_id == active_branch_id,
                )
            )
            if not product or product.selling_price is None:
                continue
            day_key = movement.created_at.strftime("%Y-%m-%d")
            daily_revenue[day_key] = daily_revenue.get(day_key, Decimal(0)) - (movement.change * Decimal(product.selling_price))
    
    # Calculate losses from expired/damaged goods
    for loss in losses:
        product = db.scalar(select(Product).where(
            Product.id == loss.product_id,
            Product.user_id.in_(tenant_user_ids),
            Product.branch_id == active_branch_id,
        ))
        unit_cost = (
            Decimal(loss.unit_cost_price)
            if getattr(loss, "unit_cost_price", None) is not None
            else (Decimal(product.cost_price) if (product and product.cost_price is not None) else Decimal(0))
        )
        loss_value = abs(loss.change) * unit_cost
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
        Sale.branch_id == active_branch_id,
        Product.user_id.in_(tenant_user_ids)
        ,
        Product.branch_id == active_branch_id,
    )
    prev_sales = db.scalars(prev_sales_query).all()
    prev_revenue = sum(s.total_price for s in prev_sales)

    prev_returns_revenue, _, _ = compute_returns_totals(prev_start, prev_end)
    prev_revenue -= prev_returns_revenue
    
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
