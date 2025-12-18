from datetime import datetime, timedelta
from decimal import Decimal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func, and_
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Product, StockMovement, Sale, User, SystemSettings
from ..auth import get_current_active_user
from app.utils.tenant import get_tenant_user_ids
from app.utils.branch import get_active_branch_id

router = APIRouter(prefix="/inventory", tags=["inventory"])


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


@router.get("/analytics")
def get_inventory_analytics(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    active_branch_id: int = Depends(get_active_branch_id),
):
    """
    Get comprehensive inventory analytics including:
    - Stock levels by location
    - Low stock alerts
    - Expiring products
    - Movement summary
    - Stock value
    """
    tenant_user_ids = get_tenant_user_ids(current_user, db)
    settings = _get_or_create_settings(db, _get_tenant_owner_id(current_user))
    low_stock_threshold = settings.low_stock_threshold
    expiry_warning_days = settings.expiry_warning_days
    
    # Get all products with their stock levels
    products = db.scalars(
        select(Product).where(
            Product.user_id.in_(tenant_user_ids),
            Product.branch_id == active_branch_id,
        )
    ).all()
    
    # Calculate stock for each product by location
    stock_by_location = {}
    low_stock_products = []
    expiring_batches = []
    total_stock_value = Decimal(0)
    
    today = datetime.now().date()
    
    for product in products:
        movements = db.scalars(
            select(StockMovement)
            .where(
                and_(
                    StockMovement.product_id == product.id,
                    StockMovement.user_id.in_(tenant_user_ids),
                    StockMovement.branch_id == active_branch_id,
                )
            )
            .order_by(StockMovement.created_at.desc())
        ).all()
        
        # Calculate total stock
        total_stock = sum(m.change for m in movements)
        
        # Calculate stock by location
        location_stock = {}
        for movement in movements:
            loc = movement.location or "Main Store"
            location_stock[loc] = location_stock.get(loc, Decimal(0)) + movement.change
        
        # Stock value
        if product.cost_price and total_stock > 0:
            total_stock_value += product.cost_price * total_stock
        
        # Low stock check
        if total_stock < low_stock_threshold:
            low_stock_products.append({
                "id": product.id,
                "name": product.name,
                "sku": product.sku,
                "current_stock": float(total_stock),
                "threshold": low_stock_threshold,
                "category": product.category,
            })
        
        # Expiring batches (estimate remaining by allocating total_stock to newest stock-in batches)
        if total_stock > 0:
            positive_batches = [
                m
                for m in movements
                if m.change > 0 and m.expiry_date is not None
            ]
            positive_batches.sort(key=lambda m: m.created_at, reverse=True)

            remaining = total_stock
            for movement in positive_batches:
                if remaining <= 0:
                    break

                batch_remaining = movement.change if movement.change <= remaining else remaining
                remaining = remaining - batch_remaining

                days_to_expiry = (movement.expiry_date - today).days
                if days_to_expiry <= expiry_warning_days and batch_remaining > 0:
                    expiring_batches.append({
                        "product_id": product.id,
                        "product_name": product.name,
                        "sku": product.sku,
                        "batch_number": movement.batch_number,
                        "quantity": float(batch_remaining),
                        "expiry_date": movement.expiry_date.isoformat(),
                        "days_to_expiry": days_to_expiry,
                        "status": "expired" if days_to_expiry < 0 else "expiring_soon" if days_to_expiry <= 7 else "expiring_30" if days_to_expiry <= 30 else "expiring_90",
                        "location": movement.location or "Main Store",
                    })
        
        # Add to location breakdown
        for loc, qty in location_stock.items():
            if loc not in stock_by_location:
                stock_by_location[loc] = {
                    "location": loc,
                    "products": 0,
                    "total_units": 0,
                    "value": 0,
                }
            stock_by_location[loc]["products"] += 1
            stock_by_location[loc]["total_units"] += float(qty)
            if product.cost_price:
                stock_by_location[loc]["value"] += float(product.cost_price * qty)
    
    # Movement summary (last 30 days)
    thirty_days_ago = datetime.now() - timedelta(days=30)
    recent_movements = db.scalars(
        select(StockMovement)
        .where(
            and_(
                StockMovement.created_at >= thirty_days_ago,
                StockMovement.user_id.in_(tenant_user_ids),
                StockMovement.branch_id == active_branch_id,
            )
        )
    ).all()
    
    movement_summary = {
        "stock_in": 0,
        "stock_out": 0,
        "adjustments": 0,
        "sales": 0,
    }
    
    for movement in recent_movements:
        if movement.change > 0:
            if movement.reason in ["Initial Stock", "New Stock", "Stock Transfer In", "Restock"]:
                movement_summary["stock_in"] += float(movement.change)
            elif movement.reason == "Stock Count":
                movement_summary["adjustments"] += float(movement.change)
        else:
            if movement.reason == "Sale":
                movement_summary["sales"] += float(abs(movement.change))
            else:
                movement_summary["stock_out"] += float(abs(movement.change))
    
    return {
        "stock_by_location": list(stock_by_location.values()),
        "low_stock_alerts": low_stock_products,
        "expiring_products": sorted(expiring_batches, key=lambda x: x["days_to_expiry"]),
        "movement_summary": movement_summary,
        "total_stock_value": float(total_stock_value),
        "total_products": len(products),
    }


@router.get("/movements")
def get_all_movements(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    active_branch_id: int = Depends(get_active_branch_id),
    location: str | None = Query(None),
    reason: str | None = Query(None),
    days: int = Query(30, ge=1, le=365),
):
    """
    Get all stock movements with optional filters.
    """
    tenant_user_ids = get_tenant_user_ids(current_user, db)
    query = select(StockMovement).join(Product)
    
    # Filter by date and user
    since_date = datetime.now() - timedelta(days=days)
    query = query.where(
        and_(
            StockMovement.created_at >= since_date,
            StockMovement.user_id.in_(tenant_user_ids),
            StockMovement.branch_id == active_branch_id,
            Product.user_id.in_(tenant_user_ids),
            Product.branch_id == active_branch_id,
        )
    )
    
    # Filter by location
    if location:
        query = query.where(StockMovement.location == location)
    
    # Filter by reason
    if reason:
        query = query.where(StockMovement.reason == reason)
    
    query = query.order_by(StockMovement.created_at.desc())
    
    movements = db.scalars(query).all()
    
    result = []
    for movement in movements:
        product = db.scalar(
            select(Product).where(
                and_(
                    Product.id == movement.product_id,
                    Product.user_id.in_(tenant_user_ids),
                    Product.branch_id == active_branch_id,
                )
            )
        )
        result.append({
            "id": movement.id,
            "product_id": movement.product_id,
            "product_name": product.name if product else "Unknown",
            "product_sku": product.sku if product else "N/A",
            "change": float(movement.change),
            "reason": movement.reason,
            "batch_number": movement.batch_number,
            "expiry_date": movement.expiry_date.isoformat() if movement.expiry_date else None,
            "location": movement.location or "Main Store",
            "created_at": movement.created_at.isoformat(),
        })
    
    return result
