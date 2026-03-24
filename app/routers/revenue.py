from datetime import datetime, timedelta
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, func, or_
from sqlalchemy.orm import Session

from ..auth import get_current_active_user
from ..database import get_db
from ..models import Sale, Product, StockMovement, User, CreditTransaction, Creditor, SaleReturn
from app.utils.tenant import get_tenant_user_ids
from app.utils.branch import get_active_branch_id

router = APIRouter(prefix="/revenue", tags=["revenue"])


def _to_naive_datetime(value: datetime | None, fallback: datetime) -> datetime:
    if value is None:
        return fallback
    if value.tzinfo is not None:
        return value.replace(tzinfo=None)
    return value


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
    
    account_created_at = _to_naive_datetime(getattr(current_user, "created_at", None), now)

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
            start = account_created_at.replace(hour=0, minute=0, second=0, microsecond=0)
            end = now
    
    # Get sales in period (filtered by tenant + active branch)
    sales_query = select(Sale).where(
        Sale.created_at >= start,
        Sale.created_at <= end,
        Sale.user_id.in_(tenant_user_ids),
        Sale.branch_id == active_branch_id,
    )
    sales = db.scalars(sales_query).all()

    sale_ids = [s.id for s in sales]
    sale_ids_set = set(sale_ids)
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
                # Clamp the "as-of" ledger state to the end of the selected range.
                CreditTransaction.created_at <= end,
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
    losses_query = select(StockMovement).where(
        StockMovement.created_at >= start,
        StockMovement.created_at <= end,
        StockMovement.change < 0,
        StockMovement.reason.in_(loss_reasons),
        StockMovement.user_id.in_(tenant_user_ids),
        StockMovement.branch_id == active_branch_id,
    )
    losses = db.scalars(losses_query).all()

    # Preload products used by this analytics run (avoids N+1 lookups).
    sale_product_ids = {int(s.product_id) for s in sales}
    loss_product_ids = {int(l.product_id) for l in losses}
    analytics_product_ids = sorted(sale_product_ids | loss_product_ids)
    products_by_id: dict[int, Product] = {}
    if analytics_product_ids:
        product_rows = db.scalars(
            select(Product).where(
                Product.id.in_(analytics_product_ids),
                Product.user_id.in_(tenant_user_ids),
                Product.branch_id == active_branch_id,
            )
        ).all()
        products_by_id = {int(p.id): p for p in product_rows}
    
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

    def infer_method_from_notes(notes: str | None) -> str:
        if not notes:
            return "cash"
        n = notes.lower()
        if "momo" in n or "mobile" in n:
            return "mobile money"
        if "card" in n:
            return "card"
        if "bank" in n or "transfer" in n:
            return "bank transfer"
        if "cash" in n:
            return "cash"
        return "cash"

    def compute_returns_totals(
        range_start: datetime,
        range_end: datetime,
    ) -> tuple[Decimal, Decimal, Decimal, Decimal, Decimal, dict[str, Decimal]]:
        """
        Calculate returns totals from both:
        1. SaleReturn records (new system)
        2. Stock movements marked as 'Returned*' or 'Customer Return' (legacy/fallback)
        """
        returns_revenue = Decimal(0)
        returns_cost = Decimal(0)
        returns_profit = Decimal(0)
        cash_refunds = Decimal(0)
        credit_refunds = Decimal(0)
        daily_refunds: dict[str, Decimal] = {}
        
        # First, check the new SaleReturn model
        sale_returns = db.scalars(
            select(SaleReturn).where(
                SaleReturn.created_at >= range_start,
                SaleReturn.created_at <= range_end,
                SaleReturn.branch_id == active_branch_id,
                SaleReturn.user_id.in_(tenant_user_ids),
            )
        ).all()

        sale_return_sale_ids = {int(sr.sale_id) for sr in sale_returns if sr.sale_id is not None}
        return_product_ids = sorted({int(sr.product_id) for sr in sale_returns})
        return_products = db.scalars(
            select(Product).where(
                Product.id.in_(return_product_ids),
                Product.user_id.in_(tenant_user_ids),
                Product.branch_id == active_branch_id,
            )
        ).all() if return_product_ids else []
        return_product_by_id = {int(p.id): p for p in return_products}
        
        for sr in sale_returns:
            returns_revenue += sr.refund_amount
            # Estimate cost based on product
            product = return_product_by_id.get(int(sr.product_id))
            if product and product.cost_price is not None:
                cost_value = sr.quantity_returned * product.cost_price
                returns_cost += cost_value

            if (sr.refund_method or "").lower() == "credit_to_account":
                credit_refunds += sr.refund_amount
            else:
                cash_refunds += sr.refund_amount

            day_key = sr.created_at.strftime("%Y-%m-%d")
            daily_refunds[day_key] = daily_refunds.get(day_key, Decimal(0)) + sr.refund_amount
        
        returns_profit = returns_revenue - returns_cost
        
        # Also check legacy stock movements marked as returns (for backwards compatibility)
        returns_query = select(StockMovement).where(
            StockMovement.created_at >= range_start,
            StockMovement.created_at <= range_end,
            StockMovement.change > 0,
            or_(
                StockMovement.reason.like("Returned%"),
                StockMovement.reason == "Customer Return",
            ),
            StockMovement.user_id.in_(tenant_user_ids),
            StockMovement.branch_id == active_branch_id,
        )
        # Avoid double-counting modern returns already recorded in SaleReturn.
        if sale_return_sale_ids:
            returns_query = returns_query.where(
                or_(
                    StockMovement.sale_id.is_(None),
                    ~StockMovement.sale_id.in_(sale_return_sale_ids),
                )
            )

        returns_movements = db.scalars(returns_query).all()

        legacy_product_ids = sorted({int(m.product_id) for m in returns_movements})
        legacy_products = db.scalars(
            select(Product).where(
                Product.id.in_(legacy_product_ids),
                Product.user_id.in_(tenant_user_ids),
                Product.branch_id == active_branch_id,
            )
        ).all() if legacy_product_ids else []
        legacy_product_by_id = {int(p.id): p for p in legacy_products}

        for movement in returns_movements:
            product = legacy_product_by_id.get(int(movement.product_id))
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
            cash_refunds += revenue_value

            day_key = movement.created_at.strftime("%Y-%m-%d")
            daily_refunds[day_key] = daily_refunds.get(day_key, Decimal(0)) + revenue_value

        return returns_revenue, returns_cost, returns_profit, cash_refunds, credit_refunds, daily_refunds
    
    for sale in sales:
        # Revenue
        total_revenue += sale.total_price

        # Separate cash received vs credit pending.
        # For credit/partial sales, we derive paid/unpaid from the creditor ledger linked to the sale:
        #   - debt transaction amount == unpaid portion
        #   - payment transactions (if any) are informational, but paid = total - unpaid
        if sale.payment_method in ("credit", "partial"):
            debt_amt = debt_by_sale_id.get(sale.id, Decimal(0))
            pay_amt = payment_by_sale_id.get(sale.id, Decimal(0))

            # In this codebase, credit sales may record:
            # - a debt txn for the full sale total, and
            # - a payment txn for any initial payment.
            # So unpaid should be (debt - payments), clamped to [0, total].
            unpaid = debt_amt - pay_amt
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
        product = products_by_id.get(int(sale.product_id))

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
            debt_amt = debt_by_sale_id.get(sale.id, Decimal(0))
            pay_amt = payment_by_sale_id.get(sale.id, Decimal(0))

            unpaid = debt_amt - pay_amt
            if unpaid < 0:
                unpaid = Decimal(0)
            if unpaid > sale.total_price:
                unpaid = sale.total_price
            paid = sale.total_price - unpaid

            received_method = "cash"
            # If a partial payment method is recorded, attribute the received portion to it.
            # This also applies to credit sales that had an initial payment.
            if getattr(sale, "partial_payment_method", None):
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

    # Debt cleared within the selected period should increase cash received in this period.
    # We include payment transactions that are NOT already accounted for by the sales-in-range loop
    # (to avoid double-counting payments for sales that are already split into paid/unpaid above).
    payment_tx_q = select(CreditTransaction).where(
        CreditTransaction.transaction_type == "payment",
        CreditTransaction.created_at >= start,
        CreditTransaction.created_at <= end,
        CreditTransaction.branch_id == active_branch_id,
        CreditTransaction.user_id.in_(tenant_user_ids),
    )
    if sale_ids:
        payment_tx_q = payment_tx_q.where(
            or_(CreditTransaction.sale_id.is_(None), ~CreditTransaction.sale_id.in_(sale_ids))
        )

    extra_payments = db.scalars(payment_tx_q).all()
    if extra_payments:
        extra_cash = sum((t.amount for t in extra_payments), Decimal(0))
        cash_revenue += extra_cash
        # These payments reduce the credit pending (they were paying off existing debt)
        credit_revenue -= extra_cash
        if credit_revenue < 0:
            credit_revenue = Decimal(0)
        for t in extra_payments:
            method = infer_method_from_notes(t.notes)
            payment_methods[method] = payment_methods.get(method, Decimal(0)) + t.amount
            # Reduce credit in payment methods breakdown
            if "credit" in payment_methods:
                payment_methods["credit"] = payment_methods.get("credit", Decimal(0)) - t.amount
                if payment_methods["credit"] <= 0:
                    del payment_methods["credit"]

    # Deduct returns from revenue using product selling_price
    returns_revenue, returns_cost, returns_profit, cash_refunds, credit_refunds, daily_refunds = compute_returns_totals(start, end)
    if returns_revenue != 0:
        total_revenue -= returns_revenue
        cash_revenue -= cash_refunds
        credit_revenue -= credit_refunds
        if credit_revenue < 0:
            credit_revenue = Decimal(0)
        total_profit -= returns_profit
        total_cost -= returns_cost
        # Reflect refund allocation on payment breakdown.
        if cash_refunds > 0:
            payment_methods["cash"] = payment_methods.get("cash", Decimal(0)) - cash_refunds
            if payment_methods["cash"] <= 0:
                del payment_methods["cash"]
        if credit_refunds > 0 and "credit" in payment_methods:
            payment_methods["credit"] = payment_methods.get("credit", Decimal(0)) - credit_refunds
            if payment_methods["credit"] <= 0:
                del payment_methods["credit"]

        # Reduce daily revenue trend by actual refund day/amount.
        for day_key, refund_amount in daily_refunds.items():
            daily_revenue[day_key] = daily_revenue.get(day_key, Decimal(0)) - refund_amount
    
    # Calculate losses from expired/damaged goods
    for loss in losses:
        product = products_by_id.get(int(loss.product_id))
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
    
    prev_sales_query = select(Sale).where(
        Sale.created_at >= prev_start,
        Sale.created_at < prev_end,
        Sale.branch_id == active_branch_id,
        Sale.user_id.in_(tenant_user_ids),
    )
    prev_sales = db.scalars(prev_sales_query).all()
    prev_revenue = sum(s.total_price for s in prev_sales)

    prev_returns_revenue, _, _, _, _, _ = compute_returns_totals(prev_start, prev_end)
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
    
    # Daily trend
    if period == "today":
        trend_days = 1
    elif period == "7d":
        trend_days = 7
    elif period == "30d":
        trend_days = 30
    elif period == "90d":
        trend_days = 90
    else:
        trend_days = max((end - start).days + 1, 1)
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
