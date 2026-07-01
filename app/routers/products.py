from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, selectinload
from typing import Any, Optional
from pydantic import BaseModel
from datetime import date, datetime
from decimal import Decimal

from app import models, schemas
from app.deps import get_db
from app.auth import get_current_active_user
from app.permissions import ensure_permission
from app.utils.tenant import get_tenant_user_ids
from app.utils.branch import get_active_branch_id
from app.utils.movement_reasons import validate_reason_and_change
from app.utils.expiry import writeoff_expired_batches


router = APIRouter(prefix="/products", tags=["products"])

MEASUREMENT_TYPES = {"count", "weight", "volume", "length"}
VARIANT_TEXT_FIELDS = ("variant_group", "variant_label", "brand", "size", "color", "shade")
PRODUCT_METADATA_FIELDS = {"measurement_type", "allows_fractional_sales", "quantity_step", *VARIANT_TEXT_FIELDS}


def _normalize_optional_text(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def _normalized_signature_value(value: Optional[str]) -> str:
    return (_normalize_optional_text(value) or "").lower()


def _signature_column(column):
    return func.lower(func.trim(func.coalesce(column, "")))


def _build_product_signature(source: dict | models.Product) -> dict[str, str]:
    if isinstance(source, dict):
        read = lambda field: source.get(field)
    else:
        read = lambda field: getattr(source, field, None)

    signature = {"name": _normalized_signature_value(read("name"))}
    for field in VARIANT_TEXT_FIELDS:
        signature[field] = _normalized_signature_value(read(field))
    return signature


def _find_conflicting_product(
    db: Session,
    *,
    signature: dict[str, str],
    tenant_user_ids: list[int],
    active_branch_id: int,
    exclude_product_id: int | None = None,
) -> models.Product | None:
    query = db.query(models.Product).filter(
        models.Product.branch_id == active_branch_id,
        models.Product.user_id.in_(tenant_user_ids),
        _signature_column(models.Product.name) == signature["name"],
        _signature_column(models.Product.variant_group) == signature["variant_group"],
        _signature_column(models.Product.variant_label) == signature["variant_label"],
        _signature_column(models.Product.brand) == signature["brand"],
        _signature_column(models.Product.size) == signature["size"],
        _signature_column(models.Product.color) == signature["color"],
        _signature_column(models.Product.shade) == signature["shade"],
    )
    if exclude_product_id is not None:
        query = query.filter(models.Product.id != exclude_product_id)
    return query.first()


def _load_batch_metadata(
    db: Session,
    *,
    product_ids: list[int],
    tenant_user_ids: list[int],
    active_branch_id: int,
) -> dict[int, dict[str, int | date | None]]:
    if not product_ids:
        return {}

    rows = (
        db.query(
            models.StockMovement.product_id,
            models.StockMovement.batch_number,
            models.StockMovement.expiry_date,
            func.coalesce(func.sum(models.StockMovement.change), 0).label("balance"),
        )
        .filter(
            models.StockMovement.product_id.in_(product_ids),
            models.StockMovement.user_id.in_(tenant_user_ids),
            models.StockMovement.branch_id == active_branch_id,
            models.StockMovement.batch_number.isnot(None),
        )
        .group_by(
            models.StockMovement.product_id,
            models.StockMovement.batch_number,
            models.StockMovement.expiry_date,
        )
        .all()
    )

    metadata: dict[int, dict[str, int | date | None]] = {}
    for product_id, _batch_number, expiry_date, balance in rows:
        normalized_balance = balance if isinstance(balance, Decimal) else Decimal(str(balance or 0))
        if normalized_balance <= 0:
            continue

        product_key = int(product_id)
        entry = metadata.setdefault(
            product_key,
            {"active_batch_count": 0, "next_batch_expiry_date": None},
        )
        entry["active_batch_count"] = int(entry["active_batch_count"] or 0) + 1

        if expiry_date is None:
            continue

        current_next_expiry = entry.get("next_batch_expiry_date")
        if current_next_expiry is None or expiry_date < current_next_expiry:
            entry["next_batch_expiry_date"] = expiry_date

    return metadata


def _apply_batch_metadata(
    products: list[models.Product],
    metadata_by_product_id: dict[int, dict[str, int | date | None]],
) -> None:
    for product in products:
        metadata = metadata_by_product_id.get(product.id, {})
        product.active_batch_count = int(metadata.get("active_batch_count") or 0)
        product.next_batch_expiry_date = metadata.get("next_batch_expiry_date")


def _normalize_measurement_type(value: Optional[str]) -> str:
    normalized = (value or "count").strip().lower()
    if normalized not in MEASUREMENT_TYPES:
        return "count"
    return normalized


def _normalize_quantity_step(value: Optional[Decimal], *, allows_fractional_sales: bool) -> Decimal:
    if not allows_fractional_sales:
        return Decimal("1")
    if value is None or value <= 0:
        return Decimal("1")
    return value.quantize(Decimal("0.01"))


def _apply_product_defaults(product_data: dict) -> dict:
    normalized = dict(product_data)
    allows_fractional_sales = bool(normalized.get("allows_fractional_sales"))
    normalized["measurement_type"] = _normalize_measurement_type(normalized.get("measurement_type"))
    normalized["allows_fractional_sales"] = allows_fractional_sales
    normalized["quantity_step"] = _normalize_quantity_step(
        normalized.get("quantity_step"),
        allows_fractional_sales=allows_fractional_sales,
    )
    for field in VARIANT_TEXT_FIELDS:
        normalized[field] = _normalize_optional_text(normalized.get(field))
    return normalized


def _normalize_extension_text(value: str, *, field_name: str) -> str:
    normalized = " ".join(str(value).strip().split())
    if not normalized:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{field_name} is required")
    return normalized


def _normalize_variant_attributes(attributes_json: dict[str, Any] | None) -> dict[str, Any]:
    normalized: dict[str, Any] = {}
    for raw_key, raw_value in (attributes_json or {}).items():
        key = " ".join(str(raw_key).strip().split())
        if not key:
            continue
        if isinstance(raw_value, str):
            value = " ".join(raw_value.strip().split())
            normalized[key] = value or None
            continue
        normalized[key] = raw_value
    return normalized


def _prepare_product_variants(items: list[schemas.ProductVariantCreate]) -> list[dict[str, Any]]:
    prepared: list[dict[str, Any]] = []
    seen_labels: set[str] = set()
    for index, item in enumerate(items):
        label = _normalize_extension_text(item.label, field_name="Variant label")
        signature = label.lower()
        if signature in seen_labels:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Variant labels must be unique per product")
        seen_labels.add(signature)
        prepared.append(
            {
                "label": label,
                "attributes_json": _normalize_variant_attributes(item.attributes_json),
                "is_active": bool(item.is_active),
                "sort_order": item.sort_order if item.sort_order is not None else index,
            }
        )
    return prepared


def _prepare_product_unit_conversions(items: list[schemas.ProductUnitConversionCreate]) -> list[dict[str, Any]]:
    prepared: list[dict[str, Any]] = []
    seen_units: set[str] = set()
    for index, item in enumerate(items):
        unit_name = _normalize_extension_text(item.unit_name, field_name="Conversion unit name")
        signature = unit_name.lower()
        if signature in seen_units:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Unit conversion names must be unique per product",
            )
        seen_units.add(signature)
        prepared.append(
            {
                "unit_name": unit_name,
                "base_quantity": item.base_quantity,
                "is_sale_unit": bool(item.is_sale_unit),
                "is_purchase_unit": bool(item.is_purchase_unit),
                "sort_order": item.sort_order if item.sort_order is not None else index,
            }
        )
    return prepared


def _sync_product_extensions(
    product: models.Product,
    *,
    variants: list[dict[str, Any]] | None = None,
    unit_conversions: list[dict[str, Any]] | None = None,
) -> None:
    if variants is not None:
        product.variants = [models.ProductVariant(**item) for item in variants]
    if unit_conversions is not None:
        product.unit_conversions = [models.ProductUnitConversion(**item) for item in unit_conversions]


def _resolve_product_variant(
    db: Session,
    *,
    tenant_user_ids: list[int],
    active_branch_id: int,
    product_id: int,
    variant_id: int | None,
) -> models.ProductVariant | None:
    if variant_id is None:
        return None

    variant = db.query(models.ProductVariant).join(models.Product).filter(
        models.ProductVariant.id == variant_id,
        models.ProductVariant.product_id == product_id,
        models.Product.branch_id == active_branch_id,
        models.Product.user_id.in_(tenant_user_ids),
    ).first()
    if not variant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product variant not found")
    return variant


class ProductUpdate(BaseModel):
    name: Optional[str] = None
    sku: Optional[str] = None
    barcode: Optional[str] = None
    description: Optional[str] = None
    unit: Optional[str] = None
    measurement_type: Optional[str] = None
    allows_fractional_sales: Optional[bool] = None
    quantity_step: Optional[Decimal] = None
    variant_group: Optional[str] = None
    variant_label: Optional[str] = None
    brand: Optional[str] = None
    size: Optional[str] = None
    color: Optional[str] = None
    shade: Optional[str] = None
    category: Optional[str] = None
    supplier: Optional[str] = None
    expiry_date: Optional[date] = None
    cost_price: Optional[Decimal] = None
    pack_cost_price: Optional[Decimal] = None
    selling_price: Optional[Decimal] = None
    pack_selling_price: Optional[Decimal] = None
    image: Optional[str] = None
    variants: list[schemas.ProductVariantCreate] | None = None
    unit_conversions: list[schemas.ProductUnitConversionCreate] | None = None


# The client compresses product photos to a small thumbnail before upload.
MAX_PRODUCT_IMAGE_CHARS = 300_000


def _validate_product_image(image: Optional[str]) -> Optional[str]:
    if image is None:
        return None
    cleaned = image.strip()
    if not cleaned:
        return None
    if not cleaned.startswith("data:image/"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Product image must be an image file.")
    if len(cleaned) > MAX_PRODUCT_IMAGE_CHARS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Product image is too large. Please choose a smaller image.")
    return cleaned


@router.post("", response_model=schemas.ProductRead, status_code=status.HTTP_201_CREATED)
def create_product(
    payload: schemas.ProductCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
    active_branch_id: int = Depends(get_active_branch_id),
):
    ensure_permission(current_user, "manage_catalog", "Only Admin and Manager can manage products")
    tenant_user_ids = get_tenant_user_ids(current_user, db)
    normalized_barcode = (payload.barcode or "").strip() or None
    prepared_variants = _prepare_product_variants(payload.variants)
    prepared_unit_conversions = _prepare_product_unit_conversions(payload.unit_conversions)

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

    # Check for duplicate barcode within the branch (if provided).
    if normalized_barcode:
        existing_barcode = db.query(models.Product).filter(
            func.lower(func.trim(models.Product.barcode)) == normalized_barcode.lower(),
            models.Product.branch_id == active_branch_id,
            models.Product.user_id.in_(tenant_user_ids),
        ).first()
        if existing_barcode:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Barcode already exists in this branch",
            )

    # Extract initial_stock before creating product
    initial_stock = payload.initial_stock
    product_data = payload.model_dump(exclude={'initial_stock', 'initial_location', 'variants', 'unit_conversions'})
    product_data['barcode'] = normalized_barcode
    product_data['image'] = _validate_product_image(product_data.get('image'))
    product_data['user_id'] = current_user.id
    product_data['branch_id'] = active_branch_id
    product_data = _apply_product_defaults(product_data)

    if _find_conflicting_product(
        db,
        signature=_build_product_signature(product_data),
        tenant_user_ids=tenant_user_ids,
        active_branch_id=active_branch_id,
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A product with the same name and variant details already exists in this branch",
        )
    
    product = models.Product(**product_data)
    db.add(product)
    db.flush()
    _sync_product_extensions(
        product,
        variants=prepared_variants,
        unit_conversions=prepared_unit_conversions,
    )
    
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
    db.refresh(product)

    product.current_stock = initial_stock if (initial_stock and initial_stock > 0) else Decimal(0)

    # Populate computed fields expected by the frontend.
    product.created_by_name = current_user.name
    _apply_batch_metadata(
        [product],
        _load_batch_metadata(
            db,
            product_ids=[product.id],
            tenant_user_ids=tenant_user_ids,
            active_branch_id=active_branch_id,
        ),
    )
    return product


@router.get("", response_model=list[schemas.ProductRead])
def list_products(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
    active_branch_id: int = Depends(get_active_branch_id),
):
    ensure_permission(current_user, "view_catalog")
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

    products = db.query(models.Product).options(
        selectinload(models.Product.variants),
        selectinload(models.Product.unit_conversions),
    ).filter(
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

    # Reserved = paid-for goods left in the shop for later collection (not yet supplied).
    reserved: dict[int, Decimal] = {}
    if product_ids:
        reserved_rows = (
            db.query(
                models.Sale.product_id,
                func.coalesce(func.sum(models.Sale.quantity - func.coalesce(models.Sale.supplied_quantity, 0)), 0),
            )
            .filter(
                models.Sale.product_id.in_(product_ids),
                models.Sale.user_id.in_(tenant_user_ids),
                models.Sale.branch_id == active_branch_id,
                func.coalesce(models.Sale.supplied_quantity, models.Sale.quantity) < models.Sale.quantity,
            )
            .group_by(models.Sale.product_id)
            .all()
        )
        reserved = {int(pid): (total if isinstance(total, Decimal) else Decimal(str(total))) for pid, total in reserved_rows}

    creator_ids = sorted({p.user_id for p in products})
    creators = (
        db.query(models.User.id, models.User.name)
        .filter(models.User.id.in_(creator_ids))
        .all()
        if creator_ids
        else []
    )
    creator_name_by_id = {int(uid): name for uid, name in creators}
    batch_metadata_by_product_id = _load_batch_metadata(
        db,
        product_ids=product_ids,
        tenant_user_ids=tenant_user_ids,
        active_branch_id=active_branch_id,
    )

    for product in products:
        product.created_by_name = creator_name_by_id.get(product.user_id)
        raw_stock = stocks.get(product.id, Decimal(0))
        product.current_stock = raw_stock if raw_stock > 0 else Decimal(0)
        reserved_qty = reserved.get(product.id, Decimal(0))
        product.reserved_stock = reserved_qty if reserved_qty > 0 else Decimal(0)
    _apply_batch_metadata(products, batch_metadata_by_product_id)
    
    return products


@router.get("/{product_id}", response_model=schemas.ProductRead)
def get_product(
    product_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
    active_branch_id: int = Depends(get_active_branch_id),
):
    ensure_permission(current_user, "view_catalog")
    tenant_user_ids = get_tenant_user_ids(current_user, db)

    writeoff_expired_batches(
        db=db,
        actor_user_id=current_user.id,
        tenant_user_ids=tenant_user_ids,
        branch_id=active_branch_id,
        product_id=product_id,
    )
    db.commit()

    product = db.query(models.Product).options(
        selectinload(models.Product.variants),
        selectinload(models.Product.unit_conversions),
    ).filter(
        models.Product.id == product_id,
        models.Product.user_id.in_(tenant_user_ids),
        models.Product.branch_id == active_branch_id,
    ).first()
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")

    variant = _resolve_product_variant(
        db,
        tenant_user_ids=tenant_user_ids,
        active_branch_id=active_branch_id,
        product_id=product_id,
        variant_id=payload.variant_id,
    )
    
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
    _apply_batch_metadata(
        [product],
        _load_batch_metadata(
            db,
            product_ids=[product.id],
            tenant_user_ids=tenant_user_ids,
            active_branch_id=active_branch_id,
        ),
    )
    
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
    ensure_permission(current_user, "manage_inventory", "Only Admin and Manager can change stock movements")
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

    # New Stock requires explicit expiry date only if the product is perishable (has an expiry date)
    if (payload.reason or "").strip().lower() == "new stock" and product.expiry_date is not None and payload.expiry_date is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Expiry date is required for New Stock of perishable products")

    if payload.change < 0:
        available_stock_query = db.query(func.coalesce(func.sum(models.StockMovement.change), 0)).filter(
            models.StockMovement.product_id == product_id,
            models.StockMovement.user_id.in_(tenant_user_ids),
            models.StockMovement.branch_id == active_branch_id,
        )
        if variant is not None:
            available_stock_query = available_stock_query.filter(
                or_(
                    models.StockMovement.variant_id == variant.id,
                    models.StockMovement.variant_id.is_(None),
                )
            )
        available_stock = available_stock_query.scalar()
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
    movement_data["variant_id"] = variant.id if variant is not None else None
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
    ensure_permission(current_user, "view_inventory")
    tenant_user_ids = get_tenant_user_ids(current_user, db)
    product = db.query(models.Product).options(
        selectinload(models.Product.variants),
        selectinload(models.Product.unit_conversions),
    ).filter(
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
    ensure_permission(current_user, "manage_catalog", "Only Admin and Manager can manage products")
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

    incoming_barcode = payload.barcode if payload.barcode is not None else None
    normalized_barcode = incoming_barcode.strip() if isinstance(incoming_barcode, str) else None
    normalized_barcode = normalized_barcode or None
    current_barcode = (product.barcode or "").strip() or None

    # Check barcode uniqueness if it's being updated.
    if payload.barcode is not None and normalized_barcode != current_barcode:
        if normalized_barcode:
            existing_barcode = db.query(models.Product).filter(
                models.Product.id != product.id,
                func.lower(func.trim(models.Product.barcode)) == normalized_barcode.lower(),
                models.Product.user_id.in_(tenant_user_ids),
                models.Product.branch_id == active_branch_id,
            ).first()
            if existing_barcode:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Barcode already exists in this branch",
                )

    # Update only provided fields
    provided_fields = payload.model_fields_set
    update_data = payload.model_dump(exclude_unset=True, exclude={"variants", "unit_conversions"})
    if "image" in update_data:
        update_data["image"] = _validate_product_image(update_data["image"])
    if "barcode" in update_data:
        update_data["barcode"] = normalized_barcode
    if any(key in update_data for key in PRODUCT_METADATA_FIELDS):
        update_data = _apply_product_defaults({
            "measurement_type": update_data.get("measurement_type", product.measurement_type),
            "allows_fractional_sales": update_data.get("allows_fractional_sales", product.allows_fractional_sales),
            "quantity_step": update_data.get("quantity_step", product.quantity_step),
            **{field: update_data.get(field, getattr(product, field)) for field in VARIANT_TEXT_FIELDS},
            **update_data,
        })

    candidate_signature = _build_product_signature({
        "name": update_data.get("name", product.name),
        **{field: update_data.get(field, getattr(product, field)) for field in VARIANT_TEXT_FIELDS},
    })
    if candidate_signature != _build_product_signature(product):
        existing_variant = _find_conflicting_product(
            db,
            signature=candidate_signature,
            tenant_user_ids=tenant_user_ids,
            active_branch_id=active_branch_id,
            exclude_product_id=product.id,
        )
        if existing_variant:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="A product with the same name and variant details already exists in this branch",
            )
    for key, value in update_data.items():
        setattr(product, key, value)

    if "variants" in provided_fields:
        _sync_product_extensions(product, variants=_prepare_product_variants(payload.variants or []))
    if "unit_conversions" in provided_fields:
        _sync_product_extensions(
            product,
            unit_conversions=_prepare_product_unit_conversions(payload.unit_conversions or []),
        )
    
    db.commit()
    db.refresh(product)
    product.created_by_name = (db.query(models.User).filter(models.User.id == product.user_id).first() or current_user).name

    stock_total = db.query(func.coalesce(func.sum(models.StockMovement.change), 0)).filter(
        models.StockMovement.product_id == product.id,
        models.StockMovement.user_id.in_(tenant_user_ids),
        models.StockMovement.branch_id == active_branch_id,
    ).scalar()
    product.current_stock = stock_total if isinstance(stock_total, Decimal) else Decimal(str(stock_total or 0))
    _apply_batch_metadata(
        [product],
        _load_batch_metadata(
            db,
            product_ids=[product.id],
            tenant_user_ids=tenant_user_ids,
            active_branch_id=active_branch_id,
        ),
    )
    return product


@router.delete("/{product_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_product(
    product_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
    active_branch_id: int = Depends(get_active_branch_id),
):
    ensure_permission(current_user, "manage_catalog", "Only Admin and Manager can manage products")
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
