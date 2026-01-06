from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session
from typing import Optional
from pydantic import BaseModel
from datetime import date, datetime
from decimal import Decimal

from app import models, schemas
from app.deps import get_db
from app.auth import get_current_active_user
from app.utils.tenant import get_tenant_user_ids
from app.utils.branch import get_active_branch_id
from app.utils.movement_reasons import validate_reason_and_change
from app.utils.expiry import writeoff_expired_batches


def _uses_expiry_tracking(db: Session, owner_user_id: int) -> bool:
    """Check if the business uses expiry tracking."""
    settings = db.query(models.SystemSettings).filter(
        models.SystemSettings.owner_user_id == owner_user_id
    ).first()
    return settings.uses_expiry_tracking if settings else True


router = APIRouter(prefix="/products", tags=["products"])


class ProductUpdate(BaseModel):
    name: Optional[str] = None
    sku: Optional[str] = None
    description: Optional[str] = None
    unit: Optional[str] = None
    category: Optional[str] = None
    expiry_date: Optional[date] = None
    cost_price: Optional[Decimal] = None
    pack_cost_price: Optional[Decimal] = None
    selling_price: Optional[Decimal] = None
    pack_selling_price: Optional[Decimal] = None


@router.post("/", response_model=schemas.ProductRead, status_code=status.HTTP_201_CREATED)
def create_product(
    payload: schemas.ProductCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
    active_branch_id: int = Depends(get_active_branch_id),
):
    tenant_user_ids = get_tenant_user_ids(current_user, db)
    # Check for duplicate SKU within the branch's products
    existing = db.query(models.Product).filter(
        models.Product.sku == payload.sku,
        models.Product.branch_id == active_branch_id,
        models.Product.user_id.in_(tenant_user_ids),
    ).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="SKU already exists"
        )

    # Check for duplicate name within the branch (case-insensitive)
    normalized_name = payload.name.strip().lower()
    existing_name = db.query(models.Product).filter(
        func.lower(func.trim(models.Product.name)) == normalized_name,
        models.Product.branch_id == active_branch_id,
        models.Product.user_id.in_(tenant_user_ids),
    ).first()
    if existing_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Product name already exists in this branch",
        )

    # Extract initial_stock before creating product
    initial_stock = payload.initial_stock
    product_data = payload.model_dump(exclude={'initial_stock', 'initial_location'})
    product_data['user_id'] = current_user.id
    product_data['branch_id'] = active_branch_id
    
    product = models.Product(**product_data)
    db.add(product)
    db.commit()
    db.refresh(product)
    
    # Create initial stock movement if initial_stock was provided
    if initial_stock and initial_stock > 0:
        timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
        batch_number = f"BATCH-{product.sku}-{timestamp}"
        
        movement = models.StockMovement(
            product_id=product.id,
            user_id=current_user.id,
            branch_id=active_branch_id,
            change=initial_stock,
            reason="Initial Stock",
            batch_number=batch_number,
            expiry_date=product.expiry_date,
        )
        db.add(movement)
        db.commit()

    product.current_stock = initial_stock if (initial_stock and initial_stock > 0) else Decimal(0)

    # Populate computed fields expected by the frontend.
    product.created_by_name = current_user.name
    return product


@router.get("/", response_model=list[schemas.ProductRead])
def list_products(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
    active_branch_id: int = Depends(get_active_branch_id),
):
    tenant_user_ids = get_tenant_user_ids(current_user, db)

    # Auto-writeoff any expired batches so stock totals stay accurate.
    writeoff_expired_batches(
        db=db,
        actor_user_id=current_user.id,
        tenant_user_ids=tenant_user_ids,
        branch_id=active_branch_id,
        product_id=None,
    )
    db.commit()

    products = db.query(models.Product).filter(
        models.Product.user_id.in_(tenant_user_ids),
        models.Product.branch_id == active_branch_id,
    ).order_by(models.Product.created_at.desc()).all()

    product_ids = [p.id for p in products]
    stocks: dict[int, Decimal] = {}
    if product_ids:
        stock_rows = (
            db.query(
                models.StockMovement.product_id,
                func.coalesce(func.sum(models.StockMovement.change), 0),
            )
            .filter(
                models.StockMovement.product_id.in_(product_ids),
                models.StockMovement.user_id.in_(tenant_user_ids),
                models.StockMovement.branch_id == active_branch_id,
            )
            .group_by(models.StockMovement.product_id)
            .all()
        )
        stocks = {int(pid): (total if isinstance(total, Decimal) else Decimal(str(total))) for pid, total in stock_rows}
    
    # Add created_by_name to each product
    for product in products:
        creator = db.query(models.User).filter(models.User.id == product.user_id).first()
        product.created_by_name = creator.name if creator else None
        raw_stock = stocks.get(product.id, Decimal(0))
        product.current_stock = raw_stock if raw_stock > 0 else Decimal(0)
    
    return products


@router.get("/{product_id}", response_model=schemas.ProductRead)
def get_product(
    product_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
    active_branch_id: int = Depends(get_active_branch_id),
):
    tenant_user_ids = get_tenant_user_ids(current_user, db)

    writeoff_expired_batches(
        db=db,
        actor_user_id=current_user.id,
        tenant_user_ids=tenant_user_ids,
        branch_id=active_branch_id,
        product_id=product_id,
    )
    db.commit()

    product = db.query(models.Product).filter(
        models.Product.id == product_id,
        models.Product.user_id.in_(tenant_user_ids),
        models.Product.branch_id == active_branch_id,
    ).first()
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    
    # Add created_by_name
    creator = db.query(models.User).filter(models.User.id == product.user_id).first()
    product.created_by_name = creator.name if creator else None

    stock_total = db.query(func.coalesce(func.sum(models.StockMovement.change), 0)).filter(
        models.StockMovement.product_id == product.id,
        models.StockMovement.user_id.in_(tenant_user_ids),
        models.StockMovement.branch_id == active_branch_id,
    ).scalar()
    raw_stock = stock_total if isinstance(stock_total, Decimal) else Decimal(str(stock_total or 0))
    product.current_stock = raw_stock if raw_stock > 0 else Decimal(0)
    
    return product


@router.post(
    "/{product_id}/movements",
    response_model=schemas.StockMovementRead,
    status_code=status.HTTP_201_CREATED,
)
def record_movement(
    product_id: int,
    payload: schemas.StockMovementCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
    active_branch_id: int = Depends(get_active_branch_id),
):
    tenant_user_ids = get_tenant_user_ids(current_user, db)

    # Before any new movement, write off expired batches for this product.
    writeoff_expired_batches(
        db=db,
        actor_user_id=current_user.id,
        tenant_user_ids=tenant_user_ids,
        branch_id=active_branch_id,
        product_id=product_id,
    )
    db.commit()

    product = db.query(models.Product).filter(
        models.Product.id == product_id,
        models.Product.user_id.in_(tenant_user_ids),
        models.Product.branch_id == active_branch_id,
    ).first()
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")

    # Validate reason rules.
    error = validate_reason_and_change(payload.reason, payload.change)
    if error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=error)

    # New Stock requires explicit expiry date for the new batch (only if business uses expiry tracking).
    owner_id = current_user.id if current_user.role == "Admin" else (current_user.created_by or current_user.id)
    if _uses_expiry_tracking(db, owner_id):
        if (payload.reason or "").strip().lower() == "new stock" and payload.expiry_date is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Expiry date is required for New Stock")

    if payload.change < 0:
        available_stock = db.query(func.coalesce(func.sum(models.StockMovement.change), 0)).filter(
            models.StockMovement.product_id == product_id,
            models.StockMovement.user_id.in_(tenant_user_ids),
            models.StockMovement.branch_id == active_branch_id,
        ).scalar()
        if available_stock is None:
            available_stock = Decimal(0)
        if (-payload.change) > available_stock:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Insufficient stock. Available: {available_stock}",
            )

    movement_data = payload.model_dump()
    # Only auto-generate batch numbers for stock-in so each batch keeps its own expiry.
    if payload.change > 0:
        timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
        movement_data["batch_number"] = f"BATCH-{product.sku}-{timestamp}"
    else:
        movement_data["batch_number"] = movement_data.get("batch_number")
    movement_data["user_id"] = current_user.id
    movement_data["branch_id"] = active_branch_id
    # IMPORTANT: do not fall back to product.expiry_date for new stock.
    # Expiry must be recorded per batch (movement), not inherited from a previous batch.
    
    movement = models.StockMovement(product_id=product_id, **movement_data)
    db.add(movement)

    db.commit()
    db.refresh(movement)
    return movement


@router.get("/{product_id}/movements", response_model=list[schemas.StockMovementRead])
def list_movements(
    product_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
    active_branch_id: int = Depends(get_active_branch_id),
):
    tenant_user_ids = get_tenant_user_ids(current_user, db)
    product = db.query(models.Product).filter(
        models.Product.id == product_id,
        models.Product.user_id.in_(tenant_user_ids),
        models.Product.branch_id == active_branch_id,
    ).first()
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")

    return (
        db.query(models.StockMovement)
        .filter(
            models.StockMovement.product_id == product_id,
            models.StockMovement.user_id.in_(tenant_user_ids),
            models.StockMovement.branch_id == active_branch_id,
        )
        .order_by(models.StockMovement.created_at.desc())
        .all()
    )


@router.patch("/{product_id}", response_model=schemas.ProductRead)
def update_product(
    product_id: int,
    payload: ProductUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
    active_branch_id: int = Depends(get_active_branch_id),
):
    tenant_user_ids = get_tenant_user_ids(current_user, db)
    product = db.query(models.Product).filter(
        models.Product.id == product_id,
        models.Product.user_id.in_(tenant_user_ids),
        models.Product.branch_id == active_branch_id,
    ).first()
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    
    # Check SKU uniqueness if it's being updated
    if payload.sku and payload.sku != product.sku:
        existing = db.query(models.Product).filter(
            models.Product.sku == payload.sku,
            models.Product.user_id.in_(tenant_user_ids),
            models.Product.branch_id == active_branch_id,
        ).first()
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"SKU '{payload.sku}' already exists"
            )

    # Check name uniqueness if it's being updated (case-insensitive)
    if payload.name and payload.name.strip() and payload.name.strip() != (product.name or ""):
        normalized_name = payload.name.strip().lower()
        existing_name = db.query(models.Product).filter(
            models.Product.id != product.id,
            func.lower(func.trim(models.Product.name)) == normalized_name,
            models.Product.user_id.in_(tenant_user_ids),
            models.Product.branch_id == active_branch_id,
        ).first()
        if existing_name:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Product name already exists in this branch",
            )
    
    # Update only provided fields
    update_data = payload.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(product, key, value)
    
    db.commit()
    db.refresh(product)
    product.created_by_name = (db.query(models.User).filter(models.User.id == product.user_id).first() or current_user).name

    stock_total = db.query(func.coalesce(func.sum(models.StockMovement.change), 0)).filter(
        models.StockMovement.product_id == product.id,
        models.StockMovement.user_id.in_(tenant_user_ids),
        models.StockMovement.branch_id == active_branch_id,
    ).scalar()
    product.current_stock = stock_total if isinstance(stock_total, Decimal) else Decimal(str(stock_total or 0))
    return product


@router.delete("/{product_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_product(
    product_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
    active_branch_id: int = Depends(get_active_branch_id),
):
    tenant_user_ids = get_tenant_user_ids(current_user, db)
    product = db.query(models.Product).filter(
        models.Product.id == product_id,
        models.Product.user_id.in_(tenant_user_ids),
        models.Product.branch_id == active_branch_id,
    ).first()
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    
    # Delete the product (cascade will handle stock movements)
    db.delete(product)
    db.commit()
    return None
