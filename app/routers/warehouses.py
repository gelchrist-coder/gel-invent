from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import models
from app.auth import get_current_active_user
from app.deps import get_db
from app.permissions import ensure_permission, get_effective_role_name
from app.utils.branch import get_owner_user_id
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


class WarehouseBranchRead(BaseModel):
    id: int
    name: str


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
    reserved_quantity: Decimal = Decimal("0")
    available_quantity: Decimal = Decimal("0")


class WarehouseVariantCreate(BaseModel):
    label: str = Field(min_length=1, max_length=120)
    attributes_json: dict = Field(default_factory=dict)
    is_active: bool = True
    sort_order: int = 0


class WarehouseUnitConversionCreate(BaseModel):
    unit_name: str = Field(min_length=1, max_length=64)
    base_quantity: Decimal = Field(gt=0, decimal_places=2)
    is_sale_unit: bool = True
    is_purchase_unit: bool = False
    sort_order: int = 0


class WarehouseItemCreate(BaseModel):
    sku: str = Field(min_length=1, max_length=100)
    barcode: str | None = Field(default=None, max_length=128)
    name: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=1024)
    unit: str = Field(default="pcs", min_length=1, max_length=50)
    measurement_type: str = Field(default="count", pattern="^(count|weight|volume|length)$")
    allows_fractional_sales: bool = False
    quantity_step: Decimal = Field(default=Decimal("1"), gt=0, decimal_places=2)
    variant_group: str | None = Field(default=None, max_length=120)
    variant_label: str | None = Field(default=None, max_length=120)
    brand: str | None = Field(default=None, max_length=100)
    size: str | None = Field(default=None, max_length=64)
    color: str | None = Field(default=None, max_length=64)
    shade: str | None = Field(default=None, max_length=64)
    pack_size: int | None = Field(default=None, gt=0)
    category: str | None = Field(default=None, max_length=120)
    supplier: str | None = Field(default=None, max_length=255)
    expiry_date: date | None = None
    cost_price: Decimal | None = Field(default=None, ge=0, decimal_places=2)
    pack_cost_price: Decimal | None = Field(default=None, ge=0, decimal_places=2)
    selling_price: Decimal | None = Field(default=None, ge=0, decimal_places=2)
    pack_selling_price: Decimal | None = Field(default=None, ge=0, decimal_places=2)
    wholesale_price: Decimal | None = Field(default=None, ge=0, decimal_places=2)
    wholesale_min_quantity: Decimal | None = Field(default=None, ge=0, decimal_places=2)
    image: str | None = None
    initial_stock: Decimal = Field(default=Decimal("0"), ge=0, decimal_places=2)
    variants: list[WarehouseVariantCreate] = Field(default_factory=list, max_length=100)
    unit_conversions: list[WarehouseUnitConversionCreate] = Field(default_factory=list, max_length=100)


class FulfillmentOrderItemCreate(BaseModel):
    item_id: int = Field(gt=0)
    quantity: Decimal = Field(gt=0, decimal_places=2)
    unit_price: Decimal | None = Field(default=None, ge=0, decimal_places=2)


class FulfillmentOrderCreate(BaseModel):
    external_order_id: str | None = Field(default=None, max_length=120)
    source: str = Field(default="manual", min_length=1, max_length=50)
    customer_name: str = Field(min_length=1, max_length=255)
    customer_phone: str | None = Field(default=None, max_length=50)
    customer_email: str | None = Field(default=None, max_length=255)
    delivery_address: str | None = Field(default=None, max_length=2000)
    notes: str | None = Field(default=None, max_length=2000)
    items: list[FulfillmentOrderItemCreate] = Field(min_length=1, max_length=100)


class FulfillmentStatusUpdate(BaseModel):
    status: str = Field(pattern="^(picking|packed|dispatched|delivered|cancelled)$")


class FulfillmentOrderItemRead(BaseModel):
    id: int
    item_id: int
    sku: str
    product_name: str
    quantity: Decimal
    unit_price: Decimal
    line_total: Decimal


class FulfillmentOrderRead(BaseModel):
    id: int
    warehouse_id: int
    external_order_id: str | None
    source: str
    status: str
    customer_name: str
    customer_phone: str | None
    customer_email: str | None
    delivery_address: str | None
    notes: str | None
    total_amount: Decimal
    items: list[FulfillmentOrderItemRead]
    picked_at: datetime | None
    packed_at: datetime | None
    dispatched_at: datetime | None
    delivered_at: datetime | None
    cancelled_at: datetime | None
    created_at: datetime


class WarehouseReceiptCreate(BaseModel):
    product_id: int | None = Field(default=None, gt=0)
    item_id: int | None = Field(default=None, gt=0)
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


def _warehouse_or_404(
    db: Session,
    owner_user_id: int,
    warehouse_id: int,
    *,
    current_user: models.User | None = None,
    active_only: bool = False,
) -> models.Warehouse:
    if current_user is not None and get_effective_role_name(current_user) == "Warehouse":
        if current_user.warehouse_id != warehouse_id:
            raise HTTPException(status_code=404, detail="Warehouse not found")
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


RESERVING_ORDER_STATUSES = ("reserved", "picking", "packed")


def _reserved_quantity(db: Session, warehouse_id: int, item_id: int, *, exclude_order_id: int | None = None) -> Decimal:
    query = (
        select(func.coalesce(func.sum(models.FulfillmentOrderItem.quantity), 0))
        .join(models.FulfillmentOrder, models.FulfillmentOrder.id == models.FulfillmentOrderItem.order_id)
        .where(
            models.FulfillmentOrder.warehouse_id == warehouse_id,
            models.FulfillmentOrder.status.in_(RESERVING_ORDER_STATUSES),
            models.FulfillmentOrderItem.warehouse_item_id == item_id,
        )
    )
    if exclude_order_id is not None:
        query = query.where(models.FulfillmentOrder.id != exclude_order_id)
    value = db.scalar(query)
    return value if isinstance(value, Decimal) else Decimal(str(value or 0))


def _serialize_order(order: models.FulfillmentOrder) -> FulfillmentOrderRead:
    return FulfillmentOrderRead(
        id=order.id,
        warehouse_id=order.warehouse_id,
        external_order_id=order.external_order_id,
        source=order.source,
        status=order.status,
        customer_name=order.customer_name,
        customer_phone=order.customer_phone,
        customer_email=order.customer_email,
        delivery_address=order.delivery_address,
        notes=order.notes,
        total_amount=order.total_amount,
        items=[FulfillmentOrderItemRead(
            id=line.id,
            item_id=line.warehouse_item_id,
            sku=line.sku,
            product_name=line.product_name,
            quantity=line.quantity,
            unit_price=line.unit_price,
            line_total=line.line_total,
        ) for line in order.items],
        picked_at=order.picked_at,
        packed_at=order.packed_at,
        dispatched_at=order.dispatched_at,
        delivered_at=order.delivered_at,
        cancelled_at=order.cancelled_at,
        created_at=order.created_at,
    )


def _get_or_create_item(
    db: Session,
    *,
    owner_user_id: int,
    warehouse_id: int,
    product: models.Product,
) -> models.WarehouseStockItem:
    variants = [{
        "label": variant.label,
        "attributes_json": variant.attributes_json or {},
        "is_active": variant.is_active,
        "sort_order": variant.sort_order,
    } for variant in product.variants]
    unit_conversions = [{
        "unit_name": conversion.unit_name,
        "base_quantity": float(conversion.base_quantity),
        "is_sale_unit": conversion.is_sale_unit,
        "is_purchase_unit": conversion.is_purchase_unit,
        "sort_order": conversion.sort_order,
    } for conversion in product.unit_conversions]
    product_snapshot = {
        "barcode": product.barcode, "name": product.name, "description": product.description,
        "unit": product.unit, "measurement_type": product.measurement_type,
        "allows_fractional_sales": product.allows_fractional_sales, "quantity_step": product.quantity_step,
        "variant_group": product.variant_group, "variant_label": product.variant_label,
        "brand": product.brand, "size": product.size, "color": product.color, "shade": product.shade,
        "pack_size": product.pack_size, "category": product.category, "supplier": product.supplier,
        "expiry_date": product.expiry_date, "cost_price": product.cost_price,
        "pack_cost_price": product.pack_cost_price, "selling_price": product.selling_price,
        "pack_selling_price": product.pack_selling_price, "wholesale_price": product.wholesale_price,
        "wholesale_min_quantity": product.wholesale_min_quantity, "image": product.image,
        "variants_json": variants, "unit_conversions_json": unit_conversions,
    }
    item = db.scalar(
        select(models.WarehouseStockItem).where(
            models.WarehouseStockItem.warehouse_id == warehouse_id,
            func.lower(func.trim(models.WarehouseStockItem.sku)) == product.sku.strip().lower(),
        )
    )
    if item:
        item.source_product_id = product.id
        for field_name, value in product_snapshot.items():
            setattr(item, field_name, value)
        return item

    item = models.WarehouseStockItem(
        owner_user_id=owner_user_id,
        warehouse_id=warehouse_id,
        source_product_id=product.id,
        sku=product.sku,
        **product_snapshot,
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
        barcode=source.barcode if source else item.barcode,
        name=item.name,
        description=source.description if source else item.description,
        unit=item.unit,
        measurement_type=source.measurement_type if source else item.measurement_type,
        allows_fractional_sales=source.allows_fractional_sales if source else item.allows_fractional_sales,
        quantity_step=source.quantity_step if source else item.quantity_step,
        variant_group=source.variant_group if source else item.variant_group,
        variant_label=source.variant_label if source else item.variant_label,
        brand=source.brand if source else item.brand,
        size=source.size if source else item.size,
        color=source.color if source else item.color,
        shade=source.shade if source else item.shade,
        pack_size=source.pack_size if source else item.pack_size,
        category=item.category,
        supplier=source.supplier if source else item.supplier,
        expiry_date=source.expiry_date if source else item.expiry_date,
        cost_price=item.cost_price,
        selling_price=item.selling_price,
        pack_cost_price=source.pack_cost_price if source else item.pack_cost_price,
        pack_selling_price=source.pack_selling_price if source else item.pack_selling_price,
        wholesale_price=source.wholesale_price if source else item.wholesale_price,
        wholesale_min_quantity=source.wholesale_min_quantity if source else item.wholesale_min_quantity,
        image=source.image if source else item.image,
    )
    db.add(product)
    db.flush()
    variants = item.variants_json or ([{
        "label": variant.label, "attributes_json": variant.attributes_json,
        "is_active": variant.is_active, "sort_order": variant.sort_order,
    } for variant in source.variants] if source else [])
    conversions = item.unit_conversions_json or ([{
        "unit_name": conversion.unit_name, "base_quantity": conversion.base_quantity,
        "is_sale_unit": conversion.is_sale_unit, "is_purchase_unit": conversion.is_purchase_unit,
        "sort_order": conversion.sort_order,
    } for conversion in source.unit_conversions] if source else [])
    for variant in variants:
        db.add(models.ProductVariant(
            product_id=product.id, label=str(variant.get("label") or "").strip(),
            attributes_json=variant.get("attributes_json") or {},
            is_active=bool(variant.get("is_active", True)), sort_order=int(variant.get("sort_order", 0)),
        ))
    for conversion in conversions:
        db.add(models.ProductUnitConversion(
            product_id=product.id, unit_name=str(conversion.get("unit_name") or "").strip(),
            base_quantity=Decimal(str(conversion.get("base_quantity") or 1)),
            is_sale_unit=bool(conversion.get("is_sale_unit", True)),
            is_purchase_unit=bool(conversion.get("is_purchase_unit", False)),
            sort_order=int(conversion.get("sort_order", 0)),
        ))
    return product


@router.get("", response_model=list[WarehouseRead])
def list_warehouses(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    ensure_permission(current_user, "view_warehouses")
    owner_user_id = get_owner_user_id(current_user)
    warehouse_query = select(models.Warehouse).where(models.Warehouse.owner_user_id == owner_user_id)
    if get_effective_role_name(current_user) == "Warehouse":
        if current_user.warehouse_id is None:
            return []
        warehouse_query = warehouse_query.where(models.Warehouse.id == current_user.warehouse_id)
    warehouses = db.scalars(
        warehouse_query
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


@router.get("/destinations/branches", response_model=list[WarehouseBranchRead])
def list_warehouse_destination_branches(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    ensure_permission(current_user, "view_warehouses")
    owner_user_id = get_owner_user_id(current_user)
    return db.scalars(select(models.Branch).where(
        models.Branch.owner_user_id == owner_user_id,
        models.Branch.is_active.is_(True),
    ).order_by(models.Branch.name.asc())).all()


@router.post("", response_model=WarehouseRead)
def create_warehouse(
    payload: WarehouseCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    ensure_permission(current_user, "manage_warehouses")
    if get_effective_role_name(current_user) == "Warehouse":
        raise HTTPException(status_code=403, detail="Warehouse users cannot create warehouses")
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
    if get_effective_role_name(current_user) == "Warehouse":
        raise HTTPException(status_code=403, detail="Warehouse users cannot change warehouse settings")
    owner_user_id = get_owner_user_id(current_user)
    warehouse = _warehouse_or_404(db, owner_user_id, warehouse_id, current_user=current_user)
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
    _warehouse_or_404(db, owner_user_id, warehouse_id, current_user=current_user)
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
    result: list[WarehouseStockRead] = []
    for item, quantity_value in rows:
        quantity = Decimal(str(quantity_value or 0))
        reserved = _reserved_quantity(db, warehouse_id, item.id)
        result.append(WarehouseStockRead(
            item_id=item.id, warehouse_id=item.warehouse_id, source_product_id=item.source_product_id,
            sku=item.sku, name=item.name, unit=item.unit, category=item.category,
            cost_price=item.cost_price, selling_price=item.selling_price, quantity=quantity,
            reserved_quantity=reserved, available_quantity=max(Decimal("0"), quantity - reserved),
        ))
    return result


@router.post("/{warehouse_id}/items", response_model=WarehouseStockRead, status_code=201)
def create_warehouse_item(
    warehouse_id: int,
    payload: WarehouseItemCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    ensure_permission(current_user, "manage_warehouses")
    owner_user_id = get_owner_user_id(current_user)
    _warehouse_or_404(db, owner_user_id, warehouse_id, current_user=current_user, active_only=True)
    sku = payload.sku.strip()
    name = payload.name.strip()
    unit = payload.unit.strip()
    if not sku or not name or not unit:
        raise HTTPException(status_code=422, detail="SKU, product name, and unit cannot be blank")
    duplicate = db.scalar(select(models.WarehouseStockItem.id).where(
        models.WarehouseStockItem.owner_user_id == owner_user_id,
        models.WarehouseStockItem.warehouse_id == warehouse_id,
        func.lower(func.trim(models.WarehouseStockItem.sku)) == sku.lower(),
    ))
    if duplicate:
        raise HTTPException(status_code=409, detail="A product with this SKU already exists in this warehouse")
    item = models.WarehouseStockItem(
        owner_user_id=owner_user_id,
        warehouse_id=warehouse_id,
        source_product_id=None,
        sku=sku,
        barcode=_clean(payload.barcode),
        name=name,
        description=_clean(payload.description),
        unit=unit,
        measurement_type=payload.measurement_type,
        allows_fractional_sales=payload.allows_fractional_sales,
        quantity_step=payload.quantity_step,
        variant_group=_clean(payload.variant_group),
        variant_label=_clean(payload.variant_label),
        brand=_clean(payload.brand),
        size=_clean(payload.size),
        color=_clean(payload.color),
        shade=_clean(payload.shade),
        pack_size=payload.pack_size,
        category=_clean(payload.category),
        supplier=_clean(payload.supplier),
        expiry_date=payload.expiry_date,
        cost_price=payload.cost_price,
        pack_cost_price=payload.pack_cost_price,
        selling_price=payload.selling_price,
        pack_selling_price=payload.pack_selling_price,
        wholesale_price=payload.wholesale_price,
        wholesale_min_quantity=payload.wholesale_min_quantity,
        image=payload.image,
        variants_json=[variant.model_dump(mode="json") for variant in payload.variants],
        unit_conversions_json=[conversion.model_dump(mode="json") for conversion in payload.unit_conversions],
    )
    db.add(item)
    db.flush()
    if payload.initial_stock > 0:
        db.add(models.WarehouseStockMovement(
            owner_user_id=owner_user_id,
            warehouse_id=warehouse_id,
            item_id=item.id,
            actor_user_id=current_user.id,
            change=payload.initial_stock,
            reason="Opening warehouse stock",
            unit_cost_price=payload.cost_price,
        ))
    db.commit()
    db.refresh(item)
    quantity = _stock_quantity(db, warehouse_id, item.id)
    return WarehouseStockRead(
        item_id=item.id, warehouse_id=item.warehouse_id, source_product_id=None,
        sku=item.sku, name=item.name, unit=item.unit, category=item.category,
        cost_price=item.cost_price, selling_price=item.selling_price,
        quantity=quantity, reserved_quantity=Decimal("0"), available_quantity=quantity,
    )


@router.post("/{warehouse_id}/receipts", response_model=WarehouseStockRead)
def receive_warehouse_stock(
    warehouse_id: int,
    payload: WarehouseReceiptCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    ensure_permission(current_user, "manage_warehouses")
    owner_user_id = get_owner_user_id(current_user)
    _warehouse_or_404(db, owner_user_id, warehouse_id, current_user=current_user, active_only=True)
    if bool(payload.product_id) == bool(payload.item_id):
        raise HTTPException(status_code=422, detail="Provide either item_id or product_id")
    product = None
    if payload.item_id:
        item = db.scalar(select(models.WarehouseStockItem).where(
            models.WarehouseStockItem.id == payload.item_id,
            models.WarehouseStockItem.owner_user_id == owner_user_id,
            models.WarehouseStockItem.warehouse_id == warehouse_id,
        ))
        if not item:
            raise HTTPException(status_code=404, detail="Warehouse product not found")
    else:
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
        expiry_date=payload.expiry_date,
        unit_cost_price=payload.unit_cost_price if payload.unit_cost_price is not None else item.cost_price,
    ))
    db.commit()
    db.refresh(item)
    return WarehouseStockRead(
        item_id=item.id, warehouse_id=item.warehouse_id, source_product_id=item.source_product_id,
        sku=item.sku, name=item.name, unit=item.unit, category=item.category,
        cost_price=item.cost_price, selling_price=item.selling_price,
        quantity=_stock_quantity(db, warehouse_id, item.id),
        reserved_quantity=_reserved_quantity(db, warehouse_id, item.id),
        available_quantity=max(Decimal("0"), _stock_quantity(db, warehouse_id, item.id) - _reserved_quantity(db, warehouse_id, item.id)),
    )


@router.get("/{warehouse_id}/orders", response_model=list[FulfillmentOrderRead])
def list_fulfillment_orders(
    warehouse_id: int,
    status_filter: str | None = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    ensure_permission(current_user, "view_warehouses")
    owner_user_id = get_owner_user_id(current_user)
    _warehouse_or_404(db, owner_user_id, warehouse_id, current_user=current_user)
    query = select(models.FulfillmentOrder).where(
        models.FulfillmentOrder.owner_user_id == owner_user_id,
        models.FulfillmentOrder.warehouse_id == warehouse_id,
    )
    if status_filter:
        query = query.where(models.FulfillmentOrder.status == status_filter.strip().lower())
    orders = db.scalars(query.order_by(models.FulfillmentOrder.created_at.desc(), models.FulfillmentOrder.id.desc()).limit(500)).unique().all()
    return [_serialize_order(order) for order in orders]


@router.post("/{warehouse_id}/orders", response_model=FulfillmentOrderRead)
def create_fulfillment_order(
    warehouse_id: int,
    payload: FulfillmentOrderCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    ensure_permission(current_user, "manage_warehouses")
    owner_user_id = get_owner_user_id(current_user)
    _warehouse_or_404(db, owner_user_id, warehouse_id, current_user=current_user, active_only=True)

    item_ids = [line.item_id for line in payload.items]
    if len(set(item_ids)) != len(item_ids):
        raise HTTPException(status_code=422, detail="Each warehouse item may only appear once per order")

    source = payload.source.strip().lower()
    external_order_id = _clean(payload.external_order_id)
    if external_order_id:
        duplicate = db.scalar(select(models.FulfillmentOrder.id).where(
            models.FulfillmentOrder.owner_user_id == owner_user_id,
            models.FulfillmentOrder.source == source,
            models.FulfillmentOrder.external_order_id == external_order_id,
        ))
        if duplicate:
            raise HTTPException(status_code=409, detail="This external order has already been imported")

    locked_items = db.scalars(
        select(models.WarehouseStockItem)
        .where(
            models.WarehouseStockItem.owner_user_id == owner_user_id,
            models.WarehouseStockItem.warehouse_id == warehouse_id,
            models.WarehouseStockItem.id.in_(sorted(item_ids)),
        )
        .order_by(models.WarehouseStockItem.id)
        .with_for_update()
    ).all()
    item_by_id = {item.id: item for item in locked_items}
    if len(item_by_id) != len(item_ids):
        raise HTTPException(status_code=404, detail="One or more warehouse items were not found")

    for line in payload.items:
        on_hand = _stock_quantity(db, warehouse_id, line.item_id)
        reserved = _reserved_quantity(db, warehouse_id, line.item_id)
        available = on_hand - reserved
        if line.quantity > available:
            item = item_by_id[line.item_id]
            raise HTTPException(status_code=400, detail=f"Insufficient available stock for {item.name}. Available: {available}")

    order = models.FulfillmentOrder(
        owner_user_id=owner_user_id,
        warehouse_id=warehouse_id,
        created_by_user_id=current_user.id,
        external_order_id=external_order_id,
        source=source,
        status="reserved",
        customer_name=payload.customer_name.strip(),
        customer_phone=_clean(payload.customer_phone),
        customer_email=_clean(payload.customer_email),
        delivery_address=_clean(payload.delivery_address),
        notes=_clean(payload.notes),
        total_amount=Decimal("0"),
    )
    db.add(order)
    db.flush()
    total = Decimal("0")
    for line in payload.items:
        item = item_by_id[line.item_id]
        unit_price = line.unit_price if line.unit_price is not None else (item.selling_price or Decimal("0"))
        line_total = (line.quantity * unit_price).quantize(Decimal("0.01"))
        total += line_total
        db.add(models.FulfillmentOrderItem(
            order_id=order.id,
            warehouse_item_id=item.id,
            sku=item.sku,
            product_name=item.name,
            quantity=line.quantity,
            unit_price=unit_price,
            line_total=line_total,
        ))
    order.total_amount = total.quantize(Decimal("0.01"))
    db.commit()
    db.refresh(order)
    result = _serialize_order(order)
    return result


@router.patch("/{warehouse_id}/orders/{order_id}/status", response_model=FulfillmentOrderRead)
def update_fulfillment_status(
    warehouse_id: int,
    order_id: int,
    payload: FulfillmentStatusUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    ensure_permission(current_user, "manage_warehouses")
    owner_user_id = get_owner_user_id(current_user)
    _warehouse_or_404(db, owner_user_id, warehouse_id, current_user=current_user)
    order = db.scalar(
        select(models.FulfillmentOrder)
        .where(
            models.FulfillmentOrder.id == order_id,
            models.FulfillmentOrder.owner_user_id == owner_user_id,
            models.FulfillmentOrder.warehouse_id == warehouse_id,
        )
        .with_for_update()
    )
    if not order:
        raise HTTPException(status_code=404, detail="Fulfilment order not found")

    target = payload.status
    allowed = {
        "reserved": {"picking", "cancelled"},
        "picking": {"packed", "cancelled"},
        "packed": {"dispatched", "cancelled"},
        "dispatched": {"delivered"},
        "delivered": set(),
        "cancelled": set(),
    }
    if target not in allowed.get(order.status, set()):
        raise HTTPException(status_code=409, detail=f"Cannot move order from {order.status} to {target}")

    now = datetime.now(timezone.utc)
    if target == "picking":
        order.picked_at = now
    elif target == "packed":
        order.packed_at = now
    elif target == "dispatched":
        locked_items = db.scalars(
            select(models.WarehouseStockItem)
            .where(models.WarehouseStockItem.id.in_(sorted(line.warehouse_item_id for line in order.items)))
            .order_by(models.WarehouseStockItem.id)
            .with_for_update()
        ).all()
        if len(locked_items) != len(order.items):
            raise HTTPException(status_code=409, detail="An order item is no longer available")
        for line in order.items:
            on_hand = _stock_quantity(db, warehouse_id, line.warehouse_item_id)
            if line.quantity > on_hand:
                raise HTTPException(status_code=409, detail=f"Physical stock for {line.product_name} is below the reserved quantity")
            db.add(models.WarehouseStockMovement(
                owner_user_id=owner_user_id,
                warehouse_id=warehouse_id,
                item_id=line.warehouse_item_id,
                actor_user_id=current_user.id,
                change=-line.quantity,
                reason=f"Dispatched fulfilment order #{order.id}",
                reference=order.external_order_id or f"FUL-{order.id}",
                unit_cost_price=line.warehouse_item.cost_price,
            ))
        order.dispatched_at = now
    elif target == "delivered":
        order.delivered_at = now
    elif target == "cancelled":
        order.cancelled_at = now
    order.status = target
    db.commit()
    db.refresh(order)
    result = _serialize_order(order)
    return result


@router.post("/{warehouse_id}/transfers")
def transfer_warehouse_stock(
    warehouse_id: int,
    payload: WarehouseTransferCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    ensure_permission(current_user, "manage_warehouses")
    owner_user_id = get_owner_user_id(current_user)
    warehouse = _warehouse_or_404(db, owner_user_id, warehouse_id, current_user=current_user, active_only=True)
    tenant_user_ids = get_tenant_user_ids(current_user, db)
    branch_id = payload.branch_id or current_user.branch_id
    if not branch_id:
        raise HTTPException(status_code=422, detail="Select a destination branch")
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
        item = db.scalar(
            select(models.WarehouseStockItem)
            .where(
                models.WarehouseStockItem.id == payload.item_id,
                models.WarehouseStockItem.owner_user_id == owner_user_id,
                models.WarehouseStockItem.warehouse_id == warehouse_id,
            )
            .with_for_update()
        )
        if not item:
            raise HTTPException(status_code=404, detail="Warehouse stock item not found")
        available = _stock_quantity(db, warehouse_id, item.id) - _reserved_quantity(db, warehouse_id, item.id)
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
