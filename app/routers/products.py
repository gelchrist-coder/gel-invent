from fastapi import APIRouter, Depends, HTTPException, status
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

    # Extract initial_stock before creating product
    initial_stock = payload.initial_stock
    initial_location = payload.initial_location or "Main Store"
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
            location=initial_location
        )
        db.add(movement)
        db.commit()
    
    return product


@router.get("/", response_model=list[schemas.ProductRead])
def list_products(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
    active_branch_id: int = Depends(get_active_branch_id),
):
    tenant_user_ids = get_tenant_user_ids(current_user, db)
    products = db.query(models.Product).filter(
        models.Product.user_id.in_(tenant_user_ids),
        models.Product.branch_id == active_branch_id,
    ).order_by(models.Product.created_at.desc()).all()
    
    # Add created_by_name to each product
    for product in products:
        creator = db.query(models.User).filter(models.User.id == product.user_id).first()
        product.created_by_name = creator.name if creator else None
    
    return products


@router.get("/{product_id}", response_model=schemas.ProductRead)
def get_product(
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
    
    # Add created_by_name
    creator = db.query(models.User).filter(models.User.id == product.user_id).first()
    product.created_by_name = creator.name if creator else None
    
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
    product = db.query(models.Product).filter(
        models.Product.id == product_id,
        models.Product.user_id.in_(tenant_user_ids),
        models.Product.branch_id == active_branch_id,
    ).first()
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")

    # Auto-generate batch number: BATCH-{SKU}-{TIMESTAMP}
    timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
    batch_number = f"BATCH-{product.sku}-{timestamp}"
    
    movement_data = payload.model_dump()
    movement_data["batch_number"] = batch_number
    movement_data["user_id"] = current_user.id
    movement_data["branch_id"] = active_branch_id
    # If client didn't provide an expiry_date, fall back to product expiry_date
    if movement_data.get("expiry_date") is None and product.expiry_date:
        movement_data["expiry_date"] = product.expiry_date
    
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
    
    # Update only provided fields
    update_data = payload.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(product, key, value)
    
    db.commit()
    db.refresh(product)
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
