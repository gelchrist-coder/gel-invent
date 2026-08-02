from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import models
from app.auth import get_current_active_user
from app.deps import get_db
from app.permissions import ensure_permission
from app.utils.branch import get_active_branch_id, get_owner_user_id
from app.utils.tenant import get_tenant_user_ids

router = APIRouter(prefix="/warehouses", tags=["warehouses"])


class WarehouseCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    address: str | None = Field(default=None, max_length=1000)
    contact_name: str | None = Field(default=None, max_length=255)
    phone: str | None = Field(default=None, max_length=50)


class WarehouseUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    address: str | None = Field(default=None, max_length=1000)
    contact_name: str | None = Field(default=None, max_length=255)
    phone: str | None = Field(default=None, max_length=50)
    is_active: bool | None = None


class WarehouseRead(BaseModel):
    id: int
    name: str
    address: str | None
    contact_name: str | None
    phone: str | None
    is_active: bool
    total_skus: int = 0
    total_units: Decimal = Decimal("0")
    created_at: datetime


class WarehouseStockRead(BaseModel):
    item_id: int
    warehouse_id: int
    source_product_id: int | None
    sku: str
    name: str
    unit: str
    category: str | None
    cost_price: Decimal | None
    selling_price: Decimal | None
    quantity: Decimal


class WarehouseReceiptCreate(BaseModel):
    product_id: int = Field(gt=0)
    quantity: Decimal = Field(gt=0, decimal_places=2)
    reference: str | None = Field(default=None, max_length=100)
    batch_number: str | None = Field(default=None, max_length=100)
    expiry_date: date | None = None
    unit_cost_price: Decimal | None = Field(default=None, ge=0, decimal_places=2)
    notes: str | None = Field(default=None, max_length=120)


class WarehouseTransferCreate(BaseModel):
    direction: str = Field(pattern="^(branch_to_warehouse|warehouse_to_branch)$")
    quantity: Decimal = Field(gt=0, decimal_places=2)
    product_id: int | None = Field(default=None, gt=0)
    item_id: int | None = Field(default=None, gt=0)
    branch_id: int | None = Field(default=None, gt=0)
    reference: str | None = Field(default=None, max_length=100)
    notes: str | None = Field(default=None, max_length=120)


def _clean(value: str | None) -> str | None:
    cleaned = (value or "").strip()
    return cleaned or None


def _warehouse_or_404(db: Session, owner_user_id: int, warehouse_id: int, *, active_only: bool = False) -> models.Warehouse:
    query = select(models.Warehouse).where(
        models.Warehouse.id == warehouse_id,
        models.Warehouse.owner_user_id == owner_user_id,
    )
    if active_only:
        query = query.where(models.Warehouse.is_active.is_(True))
    warehouse = db.scalar(query)
    if not warehouse:
        raise HTTPException(status_code=404, detail="Warehouse not found")
    return warehouse


def _stock_quantity(db: Session, warehouse_id: int, item_id: int) -> Decimal:
    value = db.scalar(
        select(func.coalesce(func.sum(models.WarehouseStockMovement.change), 0)).where(
            models.WarehouseStockMovement.warehouse_id == warehouse_id,
            models.WarehouseStockMovement.item_id == item_id,
        )
    )
    return value if isinstance(value, Decimal) else Decimal(str(value or 0))


def _get_or_create_item(
    db: Session,
    *,
    owner_user_id: int,
    warehouse_id: int,
    product: models.Product,
) -> models.WarehouseStockItem:
    item = db.scalar(
        select(models.WarehouseStockItem).where(
            models.WarehouseStockItem.warehouse_id == warehouse_id,
            func.lower(func.trim(models.WarehouseStockItem.sku)) == product.sku.strip().lower(),
        )
    )
    if item:
        item.source_product_id = product.id
        item.name = product.name
        item.unit = product.unit
        item.category = product.category
        item.cost_price = product.cost_price
        item.selling_price = product.selling_price
        return item

    item = models.WarehouseStockItem(
        owner_user_id=owner_user_id,
        warehouse_id=warehouse_id,
        source_product_id=product.id,
        sku=product.sku,
        name=product.name,
        unit=product.unit,
        category=product.category,
        cost_price=product.cost_price,
        selling_price=product.selling_price,
    )
    db.add(item)
    db.flush()
    return item


def _find_or_clone_branch_product(
    db: Session,
    *,
    tenant_user_ids: list[int],
    actor_user_id: int,
    branch_id: int,
    item: models.WarehouseStockItem,
) -> models.Product:
    product = db.scalar(
        select(models.Product).where(
            models.Product.user_id.in_(tenant_user_ids),
            models.Product.branch_id == branch_id,
            func.lower(func.trim(models.Product.sku)) == item.sku.strip().lower(),
        )
    )
    if product:
        return product

    source = item.source_product
    product = models.Product(
        user_id=actor_user_id,
        branch_id=branch_id,
        sku=item.sku,
        name=item.name,
        description=source.description if source else None,
        unit=item.unit,
        measurement_type=source.measurement_type if source else "count",
        allows_fractional_sales=source.allows_fractional_sales if source else False,
        quantity_step=source.quantity_step if source else Decimal("1"),
        variant_group=source.variant_group if source else None,
        variant_label=source.variant_label if source else None,
        brand=source.brand if source else None,
        size=source.size if source else None,
        color=source.color if source else None,
        shade=source.shade if source else None,
        pack_size=source.pack_size if source else None,
        category=item.category,
        supplier=source.supplier if source else None,
        cost_price=item.cost_price,
        selling_price=item.selling_price,
        pack_cost_price=source.pack_cost_price if source else None,
        pack_selling_price=source.pack_selling_price if source else None,
        wholesale_price=source.wholesale_price if source else None,
        wholesale_min_quantity=source.wholesale_min_quantity if source else None,
        image=source.image if source else None,
    )
    db.add(product)
    db.flush()
    return product


@router.get("", response_model=list[WarehouseRead])
def list_warehouses(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    ensure_permission(current_user, "view_warehouses")
    owner_user_id = get_owner_user_id(current_user)
    warehouses = db.scalars(
        select(models.Warehouse)
        .where(models.Warehouse.owner_user_id == owner_user_id)
        .order_by(models.Warehouse.is_active.desc(), models.Warehouse.name.asc())
    ).all()

    totals = db.execute(
        select(
            models.WarehouseStockItem.warehouse_id,
            func.count(func.distinct(models.WarehouseStockItem.id)),
            func.coalesce(func.sum(models.WarehouseStockMovement.change), 0),
        )
        .outerjoin(
            models.WarehouseStockMovement,
            models.WarehouseStockMovement.item_id == models.WarehouseStockItem.id,
        )
        .where(models.WarehouseStockItem.owner_user_id == owner_user_id)
        .group_by(models.WarehouseStockItem.warehouse_id)
    ).all()
    by_id = {int(wid): (int(count), Decimal(str(quantity or 0))) for wid, count, quantity in totals}
    return [
        WarehouseRead(
            id=w.id,
            name=w.name,
            address=w.address,
            contact_name=w.contact_name,
            phone=w.phone,
            is_active=w.is_active,
            total_skus=by_id.get(w.id, (0, Decimal("0")))[0],
            total_units=by_id.get(w.id, (0, Decimal("0")))[1],
            created_at=w.created_at,
        )
        for w in warehouses
    ]


@router.post("", response_model=WarehouseRead)
def create_warehouse(
    payload: WarehouseCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    ensure_permission(current_user, "manage_warehouses")
    owner_user_id = get_owner_user_id(current_user)
    name = payload.name.strip()
    duplicate = db.scalar(select(models.Warehouse.id).where(
        models.Warehouse.owner_user_id == owner_user_id,
        func.lower(func.trim(models.Warehouse.name)) == name.lower(),
    ))
    if duplicate:
        raise HTTPException(status_code=409, detail="A warehouse with this name already exists")
    warehouse = models.Warehouse(
        owner_user_id=owner_user_id,
        name=name,
        address=_clean(payload.address),
        contact_name=_clean(payload.contact_name),
        phone=_clean(payload.phone),
    )
    db.add(warehouse)
    db.commit()
    db.refresh(warehouse)
    return WarehouseRead(**{c: getattr(warehouse, c) for c in ("id", "name", "address", "contact_name", "phone", "is_active", "created_at")})


@router.patch("/{warehouse_id}", response_model=WarehouseRead)
def update_warehouse(
    warehouse_id: int,
    payload: WarehouseUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    ensure_permission(current_user, "manage_warehouses")
    owner_user_id = get_owner_user_id(current_user)
    warehouse = _warehouse_or_404(db, owner_user_id, warehouse_id)
    data = payload.model_dump(exclude_unset=True)
    if "name" in data:
        name = str(data["name"]).strip()
        duplicate = db.scalar(select(models.Warehouse.id).where(
            models.Warehouse.owner_user_id == owner_user_id,
            models.Warehouse.id != warehouse_id,
            func.lower(func.trim(models.Warehouse.name)) == name.lower(),
        ))
        if duplicate:
            raise HTTPException(status_code=409, detail="A warehouse with this name already exists")
        warehouse.name = name
    for key in ("address", "contact_name", "phone"):
        if key in data:
            setattr(warehouse, key, _clean(data[key]))
    if "is_active" in data:
        warehouse.is_active = bool(data["is_active"])
    db.commit()
    db.refresh(warehouse)
    return WarehouseRead(**{c: getattr(warehouse, c) for c in ("id", "name", "address", "contact_name", "phone", "is_active", "created_at")})


@router.get("/{warehouse_id}/stock", response_model=list[WarehouseStockRead])
def list_warehouse_stock(
    warehouse_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    ensure_permission(current_user, "view_warehouses")
    owner_user_id = get_owner_user_id(current_user)
    _warehouse_or_404(db, owner_user_id, warehouse_id)
    rows = db.execute(
        select(models.WarehouseStockItem, func.coalesce(func.sum(models.WarehouseStockMovement.change), 0))
        .outerjoin(models.WarehouseStockMovement, models.WarehouseStockMovement.item_id == models.WarehouseStockItem.id)
        .where(
            models.WarehouseStockItem.owner_user_id == owner_user_id,
            models.WarehouseStockItem.warehouse_id == warehouse_id,
        )
        .group_by(models.WarehouseStockItem.id)
        .order_by(models.WarehouseStockItem.name.asc())
    ).all()
    return [WarehouseStockRead(
        item_id=item.id, warehouse_id=item.warehouse_id, source_product_id=item.source_product_id,
        sku=item.sku, name=item.name, unit=item.unit, category=item.category,
        cost_price=item.cost_price, selling_price=item.selling_price, quantity=Decimal(str(quantity or 0)),
    ) for item, quantity in rows]


@router.post("/{warehouse_id}/receipts", response_model=WarehouseStockRead)
def receive_warehouse_stock(
    warehouse_id: int,
    payload: WarehouseReceiptCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    ensure_permission(current_user, "manage_warehouses")
    owner_user_id = get_owner_user_id(current_user)
    _warehouse_or_404(db, owner_user_id, warehouse_id, active_only=True)
    tenant_user_ids = get_tenant_user_ids(current_user, db)
    product = db.scalar(select(models.Product).where(
        models.Product.id == payload.product_id,
        models.Product.user_id.in_(tenant_user_ids),
    ))
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    item = _get_or_create_item(db, owner_user_id=owner_user_id, warehouse_id=warehouse_id, product=product)
    reason = "Warehouse receipt" + (f": {payload.notes.strip()}" if payload.notes and payload.notes.strip() else "")
    db.add(models.WarehouseStockMovement(
        owner_user_id=owner_user_id, warehouse_id=warehouse_id, item_id=item.id,
        actor_user_id=current_user.id, change=payload.quantity, reason=reason,
        reference=_clean(payload.reference), batch_number=_clean(payload.batch_number),
        expiry_date=payload.expiry_date, unit_cost_price=payload.unit_cost_price or product.cost_price,
    ))
    db.commit()
    db.refresh(item)
    return WarehouseStockRead(
        item_id=item.id, warehouse_id=item.warehouse_id, source_product_id=item.source_product_id,
        sku=item.sku, name=item.name, unit=item.unit, category=item.category,
        cost_price=item.cost_price, selling_price=item.selling_price,
        quantity=_stock_quantity(db, warehouse_id, item.id),
    )


@router.post("/{warehouse_id}/transfers")
def transfer_warehouse_stock(
    warehouse_id: int,
    payload: WarehouseTransferCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
    active_branch_id: int = Depends(get_active_branch_id),
):
    ensure_permission(current_user, "manage_warehouses")
    owner_user_id = get_owner_user_id(current_user)
    warehouse = _warehouse_or_404(db, owner_user_id, warehouse_id, active_only=True)
    tenant_user_ids = get_tenant_user_ids(current_user, db)
    branch_id = payload.branch_id or active_branch_id
    branch = db.scalar(select(models.Branch).where(
        models.Branch.id == branch_id,
        models.Branch.owner_user_id == owner_user_id,
        models.Branch.is_active.is_(True),
    ))
    if not branch:
        raise HTTPException(status_code=400, detail="Invalid branch")

    reference = _clean(payload.reference) or f"WT-{uuid4().hex[:10].upper()}"
    note = f": {payload.notes.strip()}" if payload.notes and payload.notes.strip() else ""

    if payload.direction == "branch_to_warehouse":
        if not payload.product_id:
            raise HTTPException(status_code=422, detail="product_id is required for branch-to-warehouse transfers")
        product = db.scalar(select(models.Product).where(
            models.Product.id == payload.product_id,
            models.Product.user_id.in_(tenant_user_ids),
            models.Product.branch_id == branch_id,
        ))
        if not product:
            raise HTTPException(status_code=404, detail="Product not found in branch")
        available_value = db.scalar(select(func.coalesce(func.sum(models.StockMovement.change), 0)).where(
            models.StockMovement.product_id == product.id,
            models.StockMovement.branch_id == branch_id,
            models.StockMovement.user_id.in_(tenant_user_ids),
        ))
        available = Decimal(str(available_value or 0))
        if payload.quantity > available:
            raise HTTPException(status_code=400, detail=f"Insufficient branch stock. Available: {available}")
        item = _get_or_create_item(db, owner_user_id=owner_user_id, warehouse_id=warehouse_id, product=product)
        db.add(models.StockMovement(
            user_id=current_user.id, branch_id=branch_id, product_id=product.id,
            change=-payload.quantity, reason=f"Transfer to warehouse {warehouse.name}{note}",
            unit_cost_price=product.cost_price, unit_selling_price=product.selling_price,
        ))
        db.add(models.WarehouseStockMovement(
            owner_user_id=owner_user_id, warehouse_id=warehouse_id, item_id=item.id,
            actor_user_id=current_user.id, branch_id=branch_id, change=payload.quantity,
            reason=f"Transfer in from branch {branch.name}{note}", reference=reference,
            unit_cost_price=product.cost_price,
        ))
    else:
        if not payload.item_id:
            raise HTTPException(status_code=422, detail="item_id is required for warehouse-to-branch transfers")
        item = db.scalar(select(models.WarehouseStockItem).where(
            models.WarehouseStockItem.id == payload.item_id,
            models.WarehouseStockItem.owner_user_id == owner_user_id,
            models.WarehouseStockItem.warehouse_id == warehouse_id,
        ))
        if not item:
            raise HTTPException(status_code=404, detail="Warehouse stock item not found")
        available = _stock_quantity(db, warehouse_id, item.id)
        if payload.quantity > available:
            raise HTTPException(status_code=400, detail=f"Insufficient warehouse stock. Available: {available}")
        product = _find_or_clone_branch_product(
            db, tenant_user_ids=tenant_user_ids, actor_user_id=current_user.id,
            branch_id=branch_id, item=item,
        )
        db.add(models.WarehouseStockMovement(
            owner_user_id=owner_user_id, warehouse_id=warehouse_id, item_id=item.id,
            actor_user_id=current_user.id, branch_id=branch_id, change=-payload.quantity,
            reason=f"Transfer out to branch {branch.name}{note}", reference=reference,
            unit_cost_price=item.cost_price,
        ))
        db.add(models.StockMovement(
            user_id=current_user.id, branch_id=branch_id, product_id=product.id,
            change=payload.quantity, reason=f"Transfer in from warehouse {warehouse.name}{note}",
            unit_cost_price=item.cost_price, unit_selling_price=item.selling_price,
        ))

    db.commit()
    return {
        "message": "Stock transferred successfully",
        "reference": reference,
        "direction": payload.direction,
        "quantity": float(payload.quantity),
        "warehouse": warehouse.name,
        "branch": branch.name,
    }
