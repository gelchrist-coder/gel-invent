from datetime import datetime, timedelta, date, time
from decimal import Decimal
from io import BytesIO

from fastapi import APIRouter, Depends, Query, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select, func, and_, or_, case, update
from sqlalchemy.orm import Session

from ..database import get_db
from .. import schemas
from ..models import Product, StockMovement, Sale, User, SystemSettings, Branch, Supplier, Purchase, SupplierPayment
from ..auth import get_current_active_user
from app.utils.tenant import get_tenant_user_ids
from app.utils.branch import get_active_branch_id
from app.utils.movement_reasons import classify_movement, validate_reason_and_change
from app.utils.expiry import get_batch_balances, writeoff_expired_batches

router = APIRouter(prefix="/inventory", tags=["inventory"])

MONEY_SCALE = Decimal("0.01")
MONEY_ZERO = Decimal("0.00")


def _get_tenant_owner_id(user: User) -> int:
    if user.role == "Admin":
        return user.id
    return user.created_by or user.id


def _to_money(value: Decimal | int | float | None) -> Decimal:
    if value is None:
        return MONEY_ZERO
    if isinstance(value, Decimal):
        return value.quantize(MONEY_SCALE)
    return Decimal(str(value)).quantize(MONEY_SCALE)


def _apply_purchase_payment_state(purchase: Purchase, amount_paid: Decimal | None = None) -> None:
    total_cost = _to_money(purchase.total_cost)
    paid = _to_money(amount_paid if amount_paid is not None else purchase.amount_paid)

    if paid < MONEY_ZERO:
        paid = MONEY_ZERO
    if paid > total_cost:
        paid = total_cost

    due = (total_cost - paid).quantize(MONEY_SCALE)
    purchase.amount_paid = paid
    if due <= MONEY_ZERO:
        purchase.payment_status = "paid"
        purchase.amount_due = MONEY_ZERO
    elif paid > MONEY_ZERO:
        purchase.payment_status = "partial"
        purchase.amount_due = due
    else:
        purchase.payment_status = "unpaid"
        purchase.amount_due = total_cost


def _generate_purchase_order_number() -> str:
    return f"PO-{datetime.now().strftime('%Y%m%d%H%M%S%f')}"


def _get_purchase_order_rows(
    db: Session,
    tenant_user_ids: list[int],
    active_branch_id: int,
    order_number: str,
) -> list[Purchase]:
    normalized_order_number = order_number.strip()
    if not normalized_order_number:
        raise HTTPException(status_code=400, detail="Order number is required")

    purchases = db.scalars(
        select(Purchase)
        .where(
            Purchase.order_number == normalized_order_number,
            Purchase.user_id.in_(tenant_user_ids),
            Purchase.branch_id == active_branch_id,
        )
        .order_by(Purchase.purchase_date.asc(), Purchase.created_at.asc(), Purchase.id.asc())
    ).all()

    if not purchases:
        raise HTTPException(status_code=404, detail="Purchase order not found")

    return purchases


def _resolve_supplier_for_existing_purchases(
    db: Session,
    current_user: User,
    tenant_user_ids: list[int],
    purchases: list[Purchase],
) -> Supplier:
    primary_purchase = purchases[0]
    supplier: Supplier | None = None
    if primary_purchase.supplier_id is not None:
        supplier = db.scalar(
            select(Supplier).where(
                Supplier.id == primary_purchase.supplier_id,
                Supplier.user_id.in_(tenant_user_ids),
            )
        )

    if supplier is None:
        supplier_name = (primary_purchase.supplier_name or "").strip()
        if not supplier_name:
            raise HTTPException(status_code=400, detail="Purchase is missing supplier information")
        supplier = _ensure_supplier_record(db, current_user, tenant_user_ids, supplier_name)
        for purchase in purchases:
            purchase.supplier_id = supplier.id
            purchase.supplier_name = supplier.name

    return supplier


def _resolve_supplier_for_purchase(
    db: Session,
    current_user: User,
    tenant_user_ids: list[int],
    supplier_id: int | None,
    supplier_name: str | None,
) -> tuple[Supplier, str]:
    supplier: Supplier | None = None
    if supplier_id is not None:
        supplier = db.scalar(
            select(Supplier).where(
                Supplier.id == supplier_id,
                Supplier.user_id.in_(tenant_user_ids),
                Supplier.is_active.is_(True),
            )
        )
        if not supplier:
            raise HTTPException(status_code=404, detail="Supplier not found")

    resolved_name = supplier.name if supplier else (supplier_name or "").strip()
    if not resolved_name:
        raise HTTPException(status_code=400, detail="Supplier is required")

    if supplier is None:
        supplier = _ensure_supplier_record(db, current_user, tenant_user_ids, resolved_name)
        resolved_name = supplier.name

    return supplier, resolved_name


def _create_purchase_records(
    db: Session,
    current_user: User,
    tenant_user_ids: list[int],
    active_branch_id: int,
    items: list[schemas.PurchaseOrderItemCreate],
    supplier_id: int | None,
    supplier_name: str | None,
    invoice_number: str | None,
    amount_paid: Decimal | None,
    payment_method: str | None,
    purchase_date: date | None,
    due_date: date | None,
    notes: str | None,
) -> list[Purchase]:
    if not items:
        raise HTTPException(status_code=400, detail="Add at least one item to the purchase order")

    supplier, resolved_supplier_name = _resolve_supplier_for_purchase(
        db,
        current_user,
        tenant_user_ids,
        supplier_id,
        supplier_name,
    )

    product_ids = sorted({item.product_id for item in items})
    products = db.scalars(
        select(Product).where(
            Product.id.in_(product_ids),
            Product.user_id.in_(tenant_user_ids),
            Product.branch_id == active_branch_id,
        )
    ).all()
    product_by_id = {product.id: product for product in products}

    missing_product_ids = [str(product_id) for product_id in product_ids if product_id not in product_by_id]
    if missing_product_ids:
        raise HTTPException(status_code=404, detail="Product not found")

    prepared_items: list[tuple[int, Product, schemas.PurchaseOrderItemCreate, Decimal, Decimal]] = []
    order_total = MONEY_ZERO
    for index, item in enumerate(items, start=1):
        product = product_by_id[item.product_id]
        if product.expiry_date is not None and item.expiry_date is None:
            raise HTTPException(
                status_code=400,
                detail=f"Expiry date is required when purchasing stock for {product.name}",
            )

        quantity = _to_money(item.quantity)
        rule_error = validate_reason_and_change("Restock", quantity)
        if rule_error:
            raise HTTPException(status_code=400, detail=rule_error)

        unit_cost = _to_money(item.unit_cost_price)
        line_total = (quantity * unit_cost).quantize(MONEY_SCALE)
        prepared_items.append((index, product, item, quantity, line_total))
        order_total += line_total

    upfront_payment = _to_money(amount_paid)
    if upfront_payment > order_total:
        raise HTTPException(status_code=400, detail="Amount paid cannot exceed the purchase total")

    normalized_payment_method = (payment_method or "").strip() or None
    if upfront_payment > MONEY_ZERO and not normalized_payment_method:
        raise HTTPException(status_code=400, detail="Payment method is required when recording an upfront payment")

    order_number = _generate_purchase_order_number()
    invoice_number_value = (invoice_number or "").strip() or None
    notes_value = (notes or "").strip() or None
    purchase_date_value = purchase_date or date.today()

    remaining_payment = upfront_payment
    created_purchases: list[Purchase] = []
    for index, product, item, quantity, line_total in prepared_items:
        existing_movements = db.scalar(
            select(func.count(StockMovement.id)).where(
                StockMovement.product_id == product.id,
                StockMovement.user_id.in_(tenant_user_ids),
                StockMovement.branch_id == active_branch_id,
            )
        )
        movement_reason = "Restock" if int(existing_movements or 0) > 0 else "New Stock"
        batch_number = f"{order_number}-{index:02d}"
        movement = StockMovement(
            product_id=product.id,
            user_id=current_user.id,
            branch_id=active_branch_id,
            change=quantity,
            reason=movement_reason,
            batch_number=batch_number,
            expiry_date=item.expiry_date,
            unit_cost_price=item.unit_cost_price,
            unit_selling_price=item.unit_selling_price if item.unit_selling_price is not None else product.selling_price,
        )
        db.add(movement)
        db.flush()

        product.supplier = resolved_supplier_name
        product.cost_price = item.unit_cost_price
        if item.unit_selling_price is not None:
            product.selling_price = item.unit_selling_price

        line_payment = min(remaining_payment, line_total)
        remaining_payment = (remaining_payment - line_payment).quantize(MONEY_SCALE)
        purchase = Purchase(
            user_id=current_user.id,
            branch_id=active_branch_id,
            supplier_id=supplier.id,
            product_id=product.id,
            stock_movement_id=movement.id,
            order_number=order_number,
            supplier_name=resolved_supplier_name,
            product_name=product.name,
            product_sku=product.sku,
            invoice_number=invoice_number_value,
            quantity=quantity,
            unit_cost_price=item.unit_cost_price,
            unit_selling_price=item.unit_selling_price,
            total_cost=line_total,
            amount_paid=line_payment,
            payment_method=normalized_payment_method if line_payment > MONEY_ZERO else None,
            purchase_date=purchase_date_value,
            due_date=due_date,
            notes=notes_value,
        )
        _apply_purchase_payment_state(purchase, line_payment)
        if purchase.payment_status == "paid":
            purchase.due_date = None

        db.add(purchase)
        db.flush()
        created_purchases.append(purchase)

    if upfront_payment > MONEY_ZERO:
        db.add(
            SupplierPayment(
                user_id=current_user.id,
                branch_id=active_branch_id,
                supplier_id=supplier.id,
                purchase_id=created_purchases[0].id if len(created_purchases) == 1 else None,
                order_number=order_number,
                amount=upfront_payment,
                payment_method=normalized_payment_method or "cash",
                payment_date=purchase_date_value,
                notes="Initial purchase payment" if len(created_purchases) == 1 else f"Initial payment for purchase order {order_number}",
            )
        )

    return created_purchases


def _build_purchase_order_response(purchases: list[Purchase]) -> schemas.PurchaseOrderRead:
    if not purchases:
        raise HTTPException(status_code=400, detail="Purchase order has no items")

    ordered_purchases = sorted(purchases, key=lambda purchase: purchase.id)
    first_purchase = ordered_purchases[0]
    total_cost = sum((_to_money(purchase.total_cost) for purchase in ordered_purchases), MONEY_ZERO)
    amount_paid = sum((_to_money(purchase.amount_paid) for purchase in ordered_purchases), MONEY_ZERO)
    amount_due = sum(
        (_to_money(purchase.amount_due if purchase.amount_due is not None else purchase.total_cost) for purchase in ordered_purchases),
        MONEY_ZERO,
    )

    if amount_due <= MONEY_ZERO and total_cost > MONEY_ZERO:
        payment_status = "paid"
        amount_due = MONEY_ZERO
    elif amount_paid > MONEY_ZERO:
        payment_status = "partial"
    else:
        payment_status = "unpaid"

    purchase_date = next((purchase.purchase_date for purchase in ordered_purchases if purchase.purchase_date is not None), first_purchase.purchase_date)
    due_date_value = None if payment_status == "paid" else next(
        (purchase.due_date for purchase in ordered_purchases if purchase.due_date is not None),
        first_purchase.due_date,
    )

    return schemas.PurchaseOrderRead(
        order_number=first_purchase.order_number or f"PURCHASE-{first_purchase.id}",
        supplier_id=first_purchase.supplier_id,
        supplier_name=first_purchase.supplier_name,
        invoice_number=first_purchase.invoice_number,
        line_count=len(ordered_purchases),
        total_cost=total_cost,
        amount_paid=amount_paid,
        amount_due=amount_due,
        payment_status=payment_status,
        payment_method=first_purchase.payment_method,
        purchase_date=purchase_date,
        due_date=due_date_value,
        notes=first_purchase.notes,
        created_at=first_purchase.created_at,
        created_by_name=getattr(first_purchase, "created_by_name", None),
        items=ordered_purchases,
    )


def _find_supplier_by_name(db: Session, tenant_user_ids: list[int], supplier_name: str) -> Supplier | None:
    normalized_name = supplier_name.strip().lower()
    if not normalized_name:
        return None

    return db.scalar(
        select(Supplier).where(
            func.lower(func.trim(Supplier.name)) == normalized_name,
            Supplier.user_id.in_(tenant_user_ids),
            Supplier.is_active.is_(True),
        )
    )


def _ensure_supplier_record(
    db: Session,
    current_user: User,
    tenant_user_ids: list[int],
    supplier_name: str,
) -> Supplier:
    supplier = _find_supplier_by_name(db, tenant_user_ids, supplier_name)
    if supplier:
        return supplier

    supplier = Supplier(user_id=current_user.id, name=supplier_name.strip())
    db.add(supplier)
    db.flush()
    return supplier


def _get_supplier_or_404(db: Session, tenant_user_ids: list[int], supplier_id: int) -> Supplier:
    supplier = db.scalar(
        select(Supplier).where(
            Supplier.id == supplier_id,
            Supplier.user_id.in_(tenant_user_ids),
        )
    )
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")
    return supplier


def _supplier_purchase_condition(supplier: Supplier):
    supplier_key = supplier.name.strip().lower()
    return or_(
        Purchase.supplier_id == supplier.id,
        and_(
            Purchase.supplier_id.is_(None),
            func.lower(func.trim(Purchase.supplier_name)) == supplier_key,
        ),
    )


def _attach_purchase_creator_names(purchases: list[Purchase], db: Session) -> None:
    if not purchases:
        return

    for purchase in purchases:
        if purchase.amount_paid is None or purchase.amount_due is None or not purchase.payment_status:
            _apply_purchase_payment_state(purchase)

    creator_ids = sorted({p.user_id for p in purchases})
    creators = db.execute(select(User.id, User.name).where(User.id.in_(creator_ids))).all()
    creator_name_by_id = {int(uid): name for uid, name in creators}

    for purchase in purchases:
        purchase.created_by_name = creator_name_by_id.get(purchase.user_id)


def _attach_supplier_financials(
    suppliers: list[Supplier],
    db: Session,
    tenant_user_ids: list[int],
    active_branch_id: int,
) -> None:
    if not suppliers:
        return

    purchase_summary_rows = db.execute(
        select(
            Purchase.supplier_id,
            func.lower(func.trim(Purchase.supplier_name)).label("supplier_key"),
            func.coalesce(func.sum(Purchase.total_cost), 0).label("total_purchased"),
            func.coalesce(func.sum(func.coalesce(Purchase.amount_paid, 0)), 0).label("total_paid"),
            func.coalesce(func.sum(func.coalesce(Purchase.amount_due, Purchase.total_cost)), 0).label("outstanding_balance"),
            func.coalesce(
                func.sum(
                    case(
                        (func.coalesce(Purchase.amount_due, Purchase.total_cost) > 0, 1),
                        else_=0,
                    )
                ),
                0,
            ).label("unpaid_count"),
        )
        .where(
            Purchase.user_id.in_(tenant_user_ids),
            Purchase.branch_id == active_branch_id,
        )
        .group_by(Purchase.supplier_id, func.lower(func.trim(Purchase.supplier_name)))
    ).all()

    payment_date_rows = db.execute(
        select(
            SupplierPayment.supplier_id,
            func.max(SupplierPayment.payment_date).label("last_payment_date"),
        )
        .where(
            SupplierPayment.user_id.in_(tenant_user_ids),
            SupplierPayment.branch_id == active_branch_id,
            SupplierPayment.supplier_id.is_not(None),
        )
        .group_by(SupplierPayment.supplier_id)
    ).all()

    summary_by_id: dict[int, dict[str, Decimal | int]] = {}
    summary_by_name: dict[str, dict[str, Decimal | int]] = {}
    for row in purchase_summary_rows:
        summary = {
            "total_purchased": _to_money(row.total_purchased),
            "total_paid": _to_money(row.total_paid),
            "outstanding_balance": _to_money(row.outstanding_balance),
            "unpaid_purchases_count": int(row.unpaid_count or 0),
        }
        if row.supplier_id is not None:
            summary_by_id[int(row.supplier_id)] = summary
        if row.supplier_key:
            summary_by_name[str(row.supplier_key)] = summary

    last_payment_date_by_supplier_id = {
        int(row.supplier_id): row.last_payment_date
        for row in payment_date_rows
        if row.supplier_id is not None
    }

    for supplier in suppliers:
        summary = summary_by_id.get(supplier.id) or summary_by_name.get(supplier.name.strip().lower())
        supplier.total_purchased = summary["total_purchased"] if summary else MONEY_ZERO
        supplier.total_paid = summary["total_paid"] if summary else MONEY_ZERO
        supplier.outstanding_balance = summary["outstanding_balance"] if summary else MONEY_ZERO
        supplier.unpaid_purchases_count = int(summary["unpaid_purchases_count"]) if summary else 0
        supplier.last_payment_date = last_payment_date_by_supplier_id.get(supplier.id)


def _attach_supplier_payment_metadata(payments: list[SupplierPayment], db: Session) -> None:
    if not payments:
        return

    creator_ids = sorted({payment.user_id for payment in payments})
    creators = db.execute(select(User.id, User.name).where(User.id.in_(creator_ids))).all()
    creator_name_by_id = {int(uid): name for uid, name in creators}

    purchase_ids = sorted({payment.purchase_id for payment in payments if payment.purchase_id is not None})
    purchases = db.scalars(select(Purchase).where(Purchase.id.in_(purchase_ids))).all() if purchase_ids else []
    purchase_by_id = {purchase.id: purchase for purchase in purchases}

    order_numbers = sorted({payment.order_number for payment in payments if payment.order_number})
    order_purchases = db.scalars(select(Purchase).where(Purchase.order_number.in_(order_numbers))).all() if order_numbers else []
    purchases_by_order_number: dict[str, list[Purchase]] = {}
    for purchase in order_purchases:
        if not purchase.order_number:
            continue
        purchases_by_order_number.setdefault(purchase.order_number, []).append(purchase)

    supplier_ids = sorted({payment.supplier_id for payment in payments if payment.supplier_id is not None})
    suppliers = db.scalars(select(Supplier).where(Supplier.id.in_(supplier_ids))).all() if supplier_ids else []
    supplier_name_by_id = {supplier.id: supplier.name for supplier in suppliers}

    for payment in payments:
        payment.created_by_name = creator_name_by_id.get(payment.user_id)
        purchase = purchase_by_id.get(payment.purchase_id) if payment.purchase_id is not None else None
        order_purchase_rows = purchases_by_order_number.get(payment.order_number or "")
        reference_purchase = purchase or (order_purchase_rows[0] if order_purchase_rows else None)
        payment.order_number = payment.order_number or (purchase.order_number if purchase else None)
        payment.purchase_invoice_number = purchase.invoice_number if purchase else (reference_purchase.invoice_number if reference_purchase else None)
        if purchase:
            payment.product_name = purchase.product_name
        elif order_purchase_rows:
            payment.product_name = f"{len(order_purchase_rows)} item order" if len(order_purchase_rows) > 1 else reference_purchase.product_name
        else:
            payment.product_name = None
        payment.supplier_name = supplier_name_by_id.get(payment.supplier_id or -1) or (reference_purchase.supplier_name if reference_purchase else "Supplier")


def _get_or_create_settings(db: Session, owner_user_id: int) -> SystemSettings:
    settings = db.query(SystemSettings).filter(SystemSettings.owner_user_id == owner_user_id).first()
    if settings:
        return settings
    settings = SystemSettings(owner_user_id=owner_user_id)
    db.add(settings)
    db.commit()
    db.refresh(settings)
    return settings


class BranchTransferCreate(BaseModel):
    product_id: int
    to_branch_id: int
    quantity: Decimal = Field(gt=0)
    notes: str | None = None


@router.get("/suppliers", response_model=list[schemas.SupplierRead])
def list_suppliers(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    active_branch_id: int = Depends(get_active_branch_id),
):
    tenant_user_ids = get_tenant_user_ids(current_user, db)
    suppliers = db.scalars(
        select(Supplier)
        .where(
            Supplier.user_id.in_(tenant_user_ids),
            Supplier.is_active.is_(True),
        )
        .order_by(func.lower(Supplier.name), Supplier.id.asc())
    ).all()
    _attach_supplier_financials(suppliers, db, tenant_user_ids, active_branch_id)
    return suppliers


@router.post("/suppliers", response_model=schemas.SupplierRead, status_code=201)
def create_supplier(
    payload: schemas.SupplierCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    tenant_user_ids = get_tenant_user_ids(current_user, db)
    normalized_name = payload.name.strip().lower()

    existing = db.scalar(
        select(Supplier).where(
            func.lower(func.trim(Supplier.name)) == normalized_name,
            Supplier.user_id.in_(tenant_user_ids),
            Supplier.is_active.is_(True),
        )
    )
    if existing:
        raise HTTPException(status_code=400, detail="Supplier already exists")

    supplier = Supplier(user_id=current_user.id, **payload.model_dump())
    db.add(supplier)
    db.commit()
    db.refresh(supplier)
    return supplier


@router.get("/suppliers/{supplier_id}", response_model=schemas.SupplierDetailRead)
def get_supplier_detail(
    supplier_id: int,
    purchase_limit: int = Query(default=50, ge=1, le=300),
    payment_limit: int = Query(default=50, ge=1, le=300),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    active_branch_id: int = Depends(get_active_branch_id),
):
    tenant_user_ids = get_tenant_user_ids(current_user, db)
    supplier = _get_supplier_or_404(db, tenant_user_ids, supplier_id)
    _attach_supplier_financials([supplier], db, tenant_user_ids, active_branch_id)

    purchases = db.scalars(
        select(Purchase)
        .where(
            Purchase.user_id.in_(tenant_user_ids),
            Purchase.branch_id == active_branch_id,
            _supplier_purchase_condition(supplier),
        )
        .order_by(Purchase.created_at.desc())
        .limit(purchase_limit)
    ).all()
    _attach_purchase_creator_names(purchases, db)

    purchase_ids = [purchase.id for purchase in purchases]
    payment_stmt = (
        select(SupplierPayment)
        .where(
            SupplierPayment.user_id.in_(tenant_user_ids),
            SupplierPayment.branch_id == active_branch_id,
            SupplierPayment.supplier_id == supplier.id,
        )
        .order_by(SupplierPayment.payment_date.desc(), SupplierPayment.created_at.desc())
        .limit(payment_limit)
    )
    if purchase_ids:
        payment_stmt = (
            select(SupplierPayment)
            .where(
                SupplierPayment.user_id.in_(tenant_user_ids),
                SupplierPayment.branch_id == active_branch_id,
                or_(
                    SupplierPayment.supplier_id == supplier.id,
                    SupplierPayment.purchase_id.in_(purchase_ids),
                ),
            )
            .order_by(SupplierPayment.payment_date.desc(), SupplierPayment.created_at.desc())
            .limit(payment_limit)
        )
    payments = db.scalars(payment_stmt).all()
    _attach_supplier_payment_metadata(payments, db)

    return schemas.SupplierDetailRead(supplier=supplier, purchases=purchases, payments=payments)


@router.put("/suppliers/{supplier_id}", response_model=schemas.SupplierRead)
def update_supplier(
    supplier_id: int,
    payload: schemas.SupplierUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    active_branch_id: int = Depends(get_active_branch_id),
):
    tenant_user_ids = get_tenant_user_ids(current_user, db)
    supplier = _get_supplier_or_404(db, tenant_user_ids, supplier_id)

    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        _attach_supplier_financials([supplier], db, tenant_user_ids, active_branch_id)
        return supplier

    old_name = supplier.name
    new_name = old_name
    if "name" in updates and updates["name"] is not None:
        trimmed_name = updates["name"].strip()
        if not trimmed_name:
            raise HTTPException(status_code=400, detail="Supplier name is required")

        existing = db.scalar(
            select(Supplier).where(
                func.lower(func.trim(Supplier.name)) == trimmed_name.lower(),
                Supplier.user_id.in_(tenant_user_ids),
                Supplier.is_active.is_(True),
                Supplier.id != supplier.id,
            )
        )
        if existing:
            raise HTTPException(status_code=400, detail="Supplier already exists")
        new_name = trimmed_name
        supplier.name = trimmed_name

    for field_name in ("contact_person", "phone", "email", "address", "notes"):
        if field_name not in updates:
            continue
        raw_value = updates[field_name]
        if raw_value is None:
            setattr(supplier, field_name, None)
            continue
        trimmed_value = raw_value.strip()
        setattr(supplier, field_name, trimmed_value or None)

    if new_name.strip().lower() != old_name.strip().lower():
        old_name_key = old_name.strip().lower()
        db.execute(
            update(Purchase)
            .where(
                Purchase.user_id.in_(tenant_user_ids),
                or_(
                    Purchase.supplier_id == supplier.id,
                    func.lower(func.trim(Purchase.supplier_name)) == old_name_key,
                ),
            )
            .values(supplier_id=supplier.id, supplier_name=new_name)
        )
        db.execute(
            update(Product)
            .where(
                Product.user_id.in_(tenant_user_ids),
                func.lower(func.trim(Product.supplier)) == old_name_key,
            )
            .values(supplier=new_name)
        )

    db.commit()
    db.refresh(supplier)
    _attach_supplier_financials([supplier], db, tenant_user_ids, active_branch_id)
    return supplier


@router.delete("/suppliers/{supplier_id}")
def deactivate_supplier(
    supplier_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    active_branch_id: int = Depends(get_active_branch_id),
):
    tenant_user_ids = get_tenant_user_ids(current_user, db)
    supplier = _get_supplier_or_404(db, tenant_user_ids, supplier_id)
    _attach_supplier_financials([supplier], db, tenant_user_ids, active_branch_id)

    if _to_money(getattr(supplier, "outstanding_balance", MONEY_ZERO)) > MONEY_ZERO:
        raise HTTPException(status_code=400, detail="Cannot deactivate a supplier with outstanding balance")

    supplier.is_active = False
    db.commit()
    return {"message": f"Supplier {supplier.name} deactivated"}


@router.get("/purchases", response_model=list[schemas.PurchaseRead])
def list_purchases(
    limit: int = Query(default=100, ge=1, le=300),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    active_branch_id: int = Depends(get_active_branch_id),
):
    tenant_user_ids = get_tenant_user_ids(current_user, db)
    purchases = db.scalars(
        select(Purchase)
        .where(
            Purchase.user_id.in_(tenant_user_ids),
            Purchase.branch_id == active_branch_id,
        )
        .order_by(Purchase.created_at.desc())
        .limit(limit)
    ).all()

    _attach_purchase_creator_names(purchases, db)
    return purchases


@router.get("/supplier-payments", response_model=list[schemas.SupplierPaymentRead])
def list_supplier_payments(
    limit: int = Query(default=40, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    active_branch_id: int = Depends(get_active_branch_id),
):
    tenant_user_ids = get_tenant_user_ids(current_user, db)
    payments = db.scalars(
        select(SupplierPayment)
        .where(
            SupplierPayment.user_id.in_(tenant_user_ids),
            SupplierPayment.branch_id == active_branch_id,
        )
        .order_by(SupplierPayment.payment_date.desc(), SupplierPayment.created_at.desc())
        .limit(limit)
    ).all()

    _attach_supplier_payment_metadata(payments, db)
    return payments


@router.post("/purchase-orders", response_model=schemas.PurchaseOrderRead, status_code=201)
def create_purchase_order(
    payload: schemas.PurchaseOrderCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    active_branch_id: int = Depends(get_active_branch_id),
):
    tenant_user_ids = get_tenant_user_ids(current_user, db)

    purchases = _create_purchase_records(
        db=db,
        current_user=current_user,
        tenant_user_ids=tenant_user_ids,
        active_branch_id=active_branch_id,
        items=payload.items,
        supplier_id=payload.supplier_id,
        supplier_name=payload.supplier_name,
        invoice_number=payload.invoice_number,
        amount_paid=payload.amount_paid,
        payment_method=payload.payment_method,
        purchase_date=payload.purchase_date,
        due_date=payload.due_date,
        notes=payload.notes,
    )

    db.commit()
    for purchase in purchases:
        db.refresh(purchase)
        purchase.created_by_name = current_user.name

    return _build_purchase_order_response(purchases)


@router.post("/purchases", response_model=schemas.PurchaseRead, status_code=201)
def create_purchase(
    payload: schemas.PurchaseCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    active_branch_id: int = Depends(get_active_branch_id),
):
    tenant_user_ids = get_tenant_user_ids(current_user, db)

    purchases = _create_purchase_records(
        db=db,
        current_user=current_user,
        tenant_user_ids=tenant_user_ids,
        active_branch_id=active_branch_id,
        items=[
            schemas.PurchaseOrderItemCreate(
                product_id=payload.product_id,
                quantity=payload.quantity,
                unit_cost_price=payload.unit_cost_price,
                unit_selling_price=payload.unit_selling_price,
                expiry_date=payload.expiry_date,
            )
        ],
        supplier_id=payload.supplier_id,
        supplier_name=payload.supplier_name,
        invoice_number=payload.invoice_number,
        amount_paid=payload.amount_paid,
        payment_method=payload.payment_method,
        purchase_date=payload.purchase_date,
        due_date=payload.due_date,
        notes=payload.notes,
    )
    purchase = purchases[0]

    db.commit()
    db.refresh(purchase)
    purchase.created_by_name = current_user.name
    return purchase


@router.post("/supplier-payments", response_model=schemas.SupplierPaymentRead, status_code=201)
def create_supplier_payment(
    payload: schemas.SupplierPaymentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    active_branch_id: int = Depends(get_active_branch_id),
):
    tenant_user_ids = get_tenant_user_ids(current_user, db)
    if payload.purchase_id is None and not (payload.order_number or "").strip():
        raise HTTPException(status_code=400, detail="Select a purchase or purchase order to pay")

    payment_amount = _to_money(payload.amount)
    payment_method = payload.payment_method.strip()

    payment: SupplierPayment
    if (payload.order_number or "").strip():
        purchases = _get_purchase_order_rows(db, tenant_user_ids, active_branch_id, payload.order_number or "")
        for purchase in purchases:
            _apply_purchase_payment_state(purchase)

        outstanding_purchases = [purchase for purchase in purchases if _to_money(purchase.amount_due) > MONEY_ZERO]
        if not outstanding_purchases:
            raise HTTPException(status_code=400, detail="This purchase order is already fully paid")

        outstanding_total = sum((_to_money(purchase.amount_due) for purchase in outstanding_purchases), MONEY_ZERO)
        if payment_amount > outstanding_total:
            raise HTTPException(status_code=400, detail="Payment amount cannot exceed the outstanding order balance")

        supplier = _resolve_supplier_for_existing_purchases(db, current_user, tenant_user_ids, purchases)
        payment = SupplierPayment(
            user_id=current_user.id,
            branch_id=active_branch_id,
            supplier_id=supplier.id,
            purchase_id=None,
            order_number=(payload.order_number or "").strip(),
            amount=payment_amount,
            payment_method=payment_method,
            payment_date=payload.payment_date or date.today(),
            notes=(payload.notes or "").strip() or None,
        )
        db.add(payment)

        remaining_payment = payment_amount
        for purchase in outstanding_purchases:
            purchase_due = _to_money(purchase.amount_due)
            applied_amount = min(remaining_payment, purchase_due)
            updated_paid = _to_money(purchase.amount_paid) + applied_amount
            _apply_purchase_payment_state(purchase, updated_paid)
            purchase.payment_method = payment_method
            if purchase.payment_status == "paid":
                purchase.due_date = None
            remaining_payment = (remaining_payment - applied_amount).quantize(MONEY_SCALE)
            if remaining_payment <= MONEY_ZERO:
                break
    else:
        purchase = db.scalar(
            select(Purchase).where(
                Purchase.id == payload.purchase_id,
                Purchase.user_id.in_(tenant_user_ids),
                Purchase.branch_id == active_branch_id,
            )
        )
        if not purchase:
            raise HTTPException(status_code=404, detail="Purchase not found")

        _apply_purchase_payment_state(purchase)
        if purchase.amount_due <= MONEY_ZERO or purchase.payment_status == "paid":
            raise HTTPException(status_code=400, detail="This purchase is already fully paid")

        if payment_amount > purchase.amount_due:
            raise HTTPException(status_code=400, detail="Payment amount cannot exceed the outstanding balance")

        supplier = _resolve_supplier_for_existing_purchases(db, current_user, tenant_user_ids, [purchase])
        payment = SupplierPayment(
            user_id=current_user.id,
            branch_id=active_branch_id,
            supplier_id=supplier.id,
            purchase_id=purchase.id,
            order_number=purchase.order_number,
            amount=payment_amount,
            payment_method=payment_method,
            payment_date=payload.payment_date or date.today(),
            notes=(payload.notes or "").strip() or None,
        )
        db.add(payment)

        updated_paid = _to_money(purchase.amount_paid) + payment_amount
        _apply_purchase_payment_state(purchase, updated_paid)
        purchase.payment_method = payment_method
        if purchase.payment_status == "paid":
            purchase.due_date = None

    db.commit()
    db.refresh(payment)
    _attach_supplier_payment_metadata([payment], db)
    return payment


@router.post("/transfers")
def transfer_stock_between_branches(
    payload: BranchTransferCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    active_branch_id: int = Depends(get_active_branch_id),
):
    if current_user.role != "Admin":
        raise HTTPException(status_code=403, detail="Only Admin can transfer stock between branches")

    tenant_user_ids = get_tenant_user_ids(current_user, db)
    owner_user_id = _get_tenant_owner_id(current_user)

    if payload.to_branch_id == active_branch_id:
        raise HTTPException(status_code=400, detail="Destination branch must be different from source branch")

    source_branch = db.scalar(
        select(Branch).where(
            Branch.id == active_branch_id,
            Branch.owner_user_id == owner_user_id,
            Branch.is_active.is_(True),
        )
    )
    destination_branch = db.scalar(
        select(Branch).where(
            Branch.id == payload.to_branch_id,
            Branch.owner_user_id == owner_user_id,
            Branch.is_active.is_(True),
        )
    )

    if not source_branch or not destination_branch:
        raise HTTPException(status_code=400, detail="Invalid source or destination branch")

    source_product = db.scalar(
        select(Product).where(
            Product.id == payload.product_id,
            Product.user_id.in_(tenant_user_ids),
            Product.branch_id == active_branch_id,
        )
    )
    if not source_product:
        raise HTTPException(status_code=404, detail="Product not found in source branch")

    available_stock = db.scalar(
        select(func.coalesce(func.sum(StockMovement.change), 0)).where(
            StockMovement.product_id == payload.product_id,
            StockMovement.user_id.in_(tenant_user_ids),
            StockMovement.branch_id == active_branch_id,
        )
    )
    available = available_stock if isinstance(available_stock, Decimal) else Decimal(str(available_stock or 0))

    transfer_qty = Decimal(payload.quantity)
    if transfer_qty > available:
        raise HTTPException(
            status_code=400,
            detail=f"Insufficient stock in source branch. Available: {available}",
        )

    destination_product = db.scalar(
        select(Product).where(
            Product.sku == source_product.sku,
            Product.user_id.in_(tenant_user_ids),
            Product.branch_id == payload.to_branch_id,
        )
    )

    if not destination_product:
        destination_product = Product(
            user_id=current_user.id,
            branch_id=payload.to_branch_id,
            sku=source_product.sku,
            name=source_product.name,
            description=source_product.description,
            unit=source_product.unit,
            pack_size=source_product.pack_size,
            category=source_product.category,
            supplier=source_product.supplier,
            expiry_date=source_product.expiry_date,
            cost_price=source_product.cost_price,
            pack_cost_price=source_product.pack_cost_price,
            selling_price=source_product.selling_price,
            pack_selling_price=source_product.pack_selling_price,
        )
        db.add(destination_product)
        db.flush()

    notes_suffix = ""
    if payload.notes and payload.notes.strip():
        notes_suffix = f": {payload.notes.strip()[:120]}"

    move_out = StockMovement(
        product_id=source_product.id,
        user_id=current_user.id,
        branch_id=active_branch_id,
        change=-transfer_qty,
        reason=f"Stock Transfer Out to {destination_branch.name}{notes_suffix}",
        unit_cost_price=source_product.cost_price,
        unit_selling_price=source_product.selling_price,
    )
    move_in = StockMovement(
        product_id=destination_product.id,
        user_id=current_user.id,
        branch_id=payload.to_branch_id,
        change=transfer_qty,
        reason=f"Stock Transfer In from {source_branch.name}{notes_suffix}",
        unit_cost_price=source_product.cost_price,
        unit_selling_price=source_product.selling_price,
    )

    db.add(move_out)
    db.add(move_in)
    db.commit()

    return {
        "message": "Stock transferred successfully",
        "product": source_product.name,
        "quantity": float(transfer_qty),
        "from_branch": source_branch.name,
        "to_branch": destination_branch.name,
    }


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
    owner_user_id = _get_tenant_owner_id(current_user)
    settings = _get_or_create_settings(db, owner_user_id)
    low_stock_threshold = settings.low_stock_threshold
    expiry_warning_days = settings.expiry_warning_days

    # Auto-writeoff expired batches so analytics reflect real stock.
    writeoff_expired_batches(
        db=db,
        actor_user_id=current_user.id,
        tenant_user_ids=tenant_user_ids,
        branch_id=active_branch_id,
        product_id=None,
    )
    db.commit()
    
    # Get all products with their stock levels
    products = db.scalars(
        select(Product).where(
            Product.user_id.in_(tenant_user_ids),
            Product.branch_id == active_branch_id,
        )
    ).all()
    
    stock_by_product_rows = db.execute(
        select(
            StockMovement.product_id,
            func.coalesce(func.sum(StockMovement.change), 0).label("stock"),
        )
        .where(
            StockMovement.user_id.in_(tenant_user_ids),
            StockMovement.branch_id == active_branch_id,
            StockMovement.product_id.in_([p.id for p in products]) if products else False,
        )
        .group_by(StockMovement.product_id)
    ).all() if products else []
    stock_by_product = {
        int(pid): (stock if isinstance(stock, Decimal) else Decimal(str(stock or 0)))
        for pid, stock in stock_by_product_rows
    }

    in_out_totals = db.execute(
        select(
            func.coalesce(
                func.sum(case((StockMovement.change > 0, StockMovement.change), else_=0)),
                0,
            ).label("stock_in"),
            func.coalesce(
                func.sum(case((StockMovement.change < 0, -StockMovement.change), else_=0)),
                0,
            ).label("stock_out"),
        ).where(
            StockMovement.user_id.in_(tenant_user_ids),
            StockMovement.branch_id == active_branch_id,
        )
    ).one()

    # Calculate stock for each product
    low_stock_products = []
    expiring_batches = []
    total_stock_value = Decimal(0)
    total_stock_left = Decimal(0)
    all_time_stock_in = in_out_totals.stock_in if isinstance(in_out_totals.stock_in, Decimal) else Decimal(str(in_out_totals.stock_in or 0))
    all_time_stock_out = in_out_totals.stock_out if isinstance(in_out_totals.stock_out, Decimal) else Decimal(str(in_out_totals.stock_out or 0))
    
    today = datetime.now().date()
    
    for product in products:
        # Calculate total stock from pre-aggregated movements
        total_stock_raw = stock_by_product.get(product.id, Decimal(0))
        total_stock = total_stock_raw if total_stock_raw > 0 else Decimal(0)
        total_stock_left += total_stock
        
        # Stock value (prefer per-batch unit cost; fallback to product cost)
        if total_stock > 0:
            product_cost = Decimal(product.cost_price) if product.cost_price is not None else None
            balances = get_batch_balances(
                db=db,
                tenant_user_ids=tenant_user_ids,
                branch_id=active_branch_id,
                product_id=product.id,
                include_null_expiry=True,
            )
            tracked_total = sum((b.balance for b in balances), Decimal(0))

            batch_numbers = sorted({b.batch_number for b in balances if b.batch_number})
            unit_cost_by_batch: dict[str, Decimal | None] = {}
            if batch_numbers:
                rows = db.execute(
                    select(
                        StockMovement.batch_number,
                        StockMovement.unit_cost_price,
                        StockMovement.created_at,
                    )
                    .where(
                        StockMovement.product_id == product.id,
                        StockMovement.branch_id == active_branch_id,
                        StockMovement.user_id.in_(tenant_user_ids),
                        StockMovement.batch_number.in_(batch_numbers),
                        StockMovement.change > 0,
                    )
                    .order_by(StockMovement.batch_number.asc(), StockMovement.created_at.desc())
                ).all()
                for bn, unit_cost, _created_at in rows:
                    if bn is None:
                        continue
                    bn_str = str(bn)
                    if bn_str not in unit_cost_by_batch:
                        unit_cost_by_batch[bn_str] = unit_cost

            value = Decimal(0)
            for b in balances:
                if b.balance <= 0:
                    continue
                unit_cost = unit_cost_by_batch.get(b.batch_number)
                if unit_cost is None:
                    unit_cost = product_cost
                if unit_cost is None:
                    continue
                value += b.balance * Decimal(unit_cost)

            untracked = total_stock - tracked_total
            if untracked > 0 and product_cost is not None:
                value += untracked * product_cost
            total_stock_value += value
        
        # Low stock check
        if total_stock < low_stock_threshold:
            suggested_reorder = max(float(low_stock_threshold * 2) - float(total_stock), 1.0)
            low_stock_products.append({
                "id": product.id,
                "name": product.name,
                "sku": product.sku,
                "current_stock": float(total_stock),
                "threshold": low_stock_threshold,
                "category": product.category,
                "recommended_reorder": round(suggested_reorder, 2),
            })

        # Expiring batches (true remaining per batch)
        if total_stock > 0:
            balances = get_batch_balances(
                db=db,
                tenant_user_ids=tenant_user_ids,
                branch_id=active_branch_id,
                product_id=product.id,
                include_null_expiry=False,
            )
            for b in balances:
                if b.balance <= 0 or b.expiry_date is None:
                    continue
                days_to_expiry = (b.expiry_date - today).days
                if days_to_expiry <= expiry_warning_days:
                    expiring_batches.append(
                        {
                            "product_id": product.id,
                            "product_name": product.name,
                            "sku": product.sku,
                            "batch_number": b.batch_number,
                            "quantity": float(b.balance),
                            "expiry_date": b.expiry_date.isoformat(),
                            "days_to_expiry": days_to_expiry,
                            "status": "expired"
                            if days_to_expiry < 0
                            else "expiring_soon"
                            if days_to_expiry <= 7
                            else "expiring_30"
                            if days_to_expiry <= 30
                            else "expiring_90",
                        }
                    )
    
    # Movement summary (last 30 days)
    thirty_days_ago = datetime.now() - timedelta(days=30)
    recent_movements = db.scalars(
        select(StockMovement)
        .where(
            and_(
                StockMovement.created_at >= thirty_days_ago,
                StockMovement.user_id.in_(tenant_user_ids),
                or_(
                    StockMovement.branch_id == active_branch_id,
                    StockMovement.branch_id.is_(None),
                ),
            )
        )
    ).all()
    
    movement_summary = {
        "stock_in": 0,
        "stock_out": 0,
    }
    
    for movement in recent_movements:
        change = float(movement.change)
        if change > 0:
            movement_summary["stock_in"] += change
        else:
            movement_summary["stock_out"] += abs(change)

    # Owner-only movement totals (all-time) for this branch.
    owner_in_out = db.execute(
        select(
            func.coalesce(
                func.sum(case((StockMovement.change > 0, StockMovement.change), else_=0)),
                0,
            ).label("stock_in"),
            func.coalesce(
                func.sum(case((StockMovement.change < 0, -StockMovement.change), else_=0)),
                0,
            ).label("stock_out"),
        ).where(
            StockMovement.user_id == owner_user_id,
            StockMovement.branch_id == active_branch_id,
        )
    ).one()
    
    return {
        "stock_by_location": [],
        "low_stock_alerts": low_stock_products,
        "expiring_products": sorted(expiring_batches, key=lambda x: x["days_to_expiry"]),
        "movement_summary": movement_summary,
        "total_stock_left": float(total_stock_left),
        "movement_totals": {
            "stock_in": float(all_time_stock_in),
            "stock_out": float(all_time_stock_out),
        },
        "owner_movement_totals": {
            "stock_in": float(owner_in_out.stock_in),
            "stock_out": float(owner_in_out.stock_out),
        },
        "total_stock_value": float(total_stock_value),
        "total_products": len(products),
    }


@router.get("/movements")
def get_all_movements(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    active_branch_id: int = Depends(get_active_branch_id),
    reason: str | None = Query(None),
    days: int = Query(30, ge=1, le=365),
    start_date: date | None = Query(None, description="Start date (YYYY-MM-DD)"),
    end_date: date | None = Query(None, description="End date (YYYY-MM-DD)"),
):
    """
    Get all stock movements with optional filters.
    """
    tenant_user_ids = get_tenant_user_ids(current_user, db)
    query = select(
        StockMovement.id,
        StockMovement.product_id,
        StockMovement.change,
        StockMovement.reason,
        StockMovement.batch_number,
        StockMovement.expiry_date,
        StockMovement.created_at,
        Product.name,
        Product.sku,
    ).join(
        Product,
        and_(
            Product.id == StockMovement.product_id,
            Product.user_id.in_(tenant_user_ids),
            Product.branch_id == active_branch_id,
        ),
    )
    
    # Filter by date and user
    if start_date or end_date:
        sd = start_date or end_date
        ed = end_date or start_date
        assert sd is not None and ed is not None

        if ed < sd:
            raise HTTPException(status_code=400, detail="end_date must be on or after start_date")

        start_dt = datetime.combine(sd, time.min)
        end_dt = datetime.combine(ed + timedelta(days=1), time.min)
        query = query.where(and_(StockMovement.created_at >= start_dt, StockMovement.created_at < end_dt))
    else:
        since_date = datetime.now() - timedelta(days=days)
        query = query.where(StockMovement.created_at >= since_date)

    query = query.where(
        and_(
            StockMovement.user_id.in_(tenant_user_ids),
            StockMovement.branch_id == active_branch_id,
            Product.user_id.in_(tenant_user_ids),
            Product.branch_id == active_branch_id,
        )
    )
    
    # Filter by reason
    if reason:
        query = query.where(StockMovement.reason == reason)
    
    query = query.order_by(StockMovement.created_at.desc())
    
    movements = db.execute(query).all()
    
    result = []
    for movement in movements:
        result.append({
            "id": movement.id,
            "product_id": movement.product_id,
            "product_name": movement.name,
            "product_sku": movement.sku,
            "change": float(movement.change),
            "reason": movement.reason,
            "batch_number": movement.batch_number,
            "expiry_date": movement.expiry_date.isoformat() if movement.expiry_date else None,
            "created_at": movement.created_at.isoformat(),
        })
    
    return result


@router.get("/movements/export-pdf")
def export_movements_pdf(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    active_branch_id: int = Depends(get_active_branch_id),
    days: int = Query(30, ge=1, le=365),
    start_date: date | None = Query(None, description="Start date (YYYY-MM-DD)"),
    end_date: date | None = Query(None, description="End date (YYYY-MM-DD)"),
    movement_type: str | None = Query(None, description="Filter by: stock_in, stock_out, sale, all"),
):
    """
    Export stock movements to PDF.
    
    Movement types:
    - stock_in: Purchases, restocks, returns (positive movements)
    - stock_out: Damaged, expired, write-offs (negative non-sale movements)
    - sale: Sales transactions
    - all: All movements
    """
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import inch
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
    
    tenant_user_ids = get_tenant_user_ids(current_user, db)
    
    # Fetch movements
    query = select(StockMovement).join(Product)

    range_label: str | None = None
    if start_date or end_date:
        sd = start_date or end_date
        ed = end_date or start_date
        assert sd is not None and ed is not None
        if ed < sd:
            raise HTTPException(status_code=400, detail="end_date must be on or after start_date")
        start_dt = datetime.combine(sd, time.min)
        end_dt = datetime.combine(ed + timedelta(days=1), time.min)
        query = query.where(and_(StockMovement.created_at >= start_dt, StockMovement.created_at < end_dt))
        range_label = f"{sd.isoformat()} to {ed.isoformat()}"
    else:
        since_date = datetime.now() - timedelta(days=days)
        query = query.where(StockMovement.created_at >= since_date)
        range_label = f"Last {days} days"

    query = (
        query.where(
            and_(
                StockMovement.user_id.in_(tenant_user_ids),
                StockMovement.branch_id == active_branch_id,
                Product.user_id.in_(tenant_user_ids),
                Product.branch_id == active_branch_id,
            )
        )
        .order_by(StockMovement.created_at.desc())
    )
    
    movements = db.scalars(query).all()
    
    # Filter by movement type
    filtered_movements = []
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
        
        # Classify movement
        classification = classify_movement(movement.reason, movement.change)
        
        # Determine if it matches filter
        if movement_type and movement_type != "all":
            if movement_type == "stock_in" and classification != "stock_in":
                continue
            if movement_type == "stock_out" and classification not in ("stock_out", "adjustments"):
                continue
            if movement_type == "sale" and classification != "sales":
                continue
        
        filtered_movements.append({
            "date": movement.created_at.strftime("%d %b %Y %H:%M"),
            "product_name": product.name if product else "Unknown",
            "product_sku": product.sku if product else "N/A",
            "change": float(movement.change),
            "reason": movement.reason,
            "batch_number": movement.batch_number or "-",
            "type": "Stock In" if movement.change > 0 else ("Sale" if classification == "sales" else "Stock Out"),
        })
    
    # Generate PDF
    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=landscape(A4),
        rightMargin=30,
        leftMargin=30,
        topMargin=30,
        bottomMargin=30,
    )
    
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        'CustomTitle',
        parent=styles['Heading1'],
        fontSize=18,
        spaceAfter=20,
        alignment=1,  # Center
    )
    
    elements = []
    
    # Title
    type_label = {
        "stock_in": "Stock In (Purchases)",
        "stock_out": "Stock Out",
        "sale": "Sales",
        None: "All Movements",
        "all": "All Movements",
    }.get(movement_type, "All Movements")
    
    title = Paragraph(f"Stock Movement Report - {type_label}", title_style)
    elements.append(title)
    
    # Subtitle with date range
    subtitle_style = ParagraphStyle(
        'Subtitle',
        parent=styles['Normal'],
        fontSize=10,
        textColor=colors.gray,
        alignment=1,
        spaceAfter=20,
    )
    subtitle = Paragraph(
        f"Generated on {datetime.now().strftime('%d %b %Y %H:%M')} | {range_label} | {len(filtered_movements)} records",
        subtitle_style,
    )
    elements.append(subtitle)
    elements.append(Spacer(1, 0.2 * inch))
    
    # Summary statistics
    total_in = sum(m["change"] for m in filtered_movements if m["change"] > 0)
    total_out = abs(sum(m["change"] for m in filtered_movements if m["change"] < 0))
    
    summary_data = [
        ["Summary", ""],
        ["Total Stock In", f"+{total_in:.2f} units"],
        ["Total Stock Out", f"-{total_out:.2f} units"],
        ["Net Change", f"{total_in - total_out:+.2f} units"],
    ]
    
    summary_table = Table(summary_data, colWidths=[2 * inch, 2 * inch])
    summary_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor("#1f2937")),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 10),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 8),
        ('TOPPADDING', (0, 0), (-1, 0), 8),
        ('BACKGROUND', (0, 1), (-1, -1), colors.HexColor("#f9fafb")),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor("#e5e7eb")),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor("#f9fafb")]),
    ]))
    elements.append(summary_table)
    elements.append(Spacer(1, 0.3 * inch))
    
    # Movement table
    if filtered_movements:
        header = ["Date", "Product", "SKU", "Change", "Type", "Reason", "Batch"]
        data = [header]
        
        for m in filtered_movements:
            change_str = f"+{m['change']:.2f}" if m["change"] > 0 else f"{m['change']:.2f}"
            data.append([
                m["date"],
                m["product_name"][:25] + "..." if len(m["product_name"]) > 25 else m["product_name"],
                m["product_sku"],
                change_str,
                m["type"],
                m["reason"],
                m["batch_number"],
            ])
        
        col_widths = [1.2 * inch, 2.0 * inch, 1.0 * inch, 0.8 * inch, 0.9 * inch, 1.2 * inch, 1.1 * inch]
        table = Table(data, colWidths=col_widths, repeatRows=1)
        
        table.setStyle(TableStyle([
            # Header
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor("#1f2937")),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('ALIGN', (0, 0), (-1, 0), 'CENTER'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, 0), 9),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 10),
            ('TOPPADDING', (0, 0), (-1, 0), 10),
            # Body
            ('FONTSIZE', (0, 1), (-1, -1), 8),
            ('ALIGN', (3, 1), (3, -1), 'RIGHT'),  # Change column
            ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor("#e5e7eb")),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor("#f9fafb")]),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('LEFTPADDING', (0, 0), (-1, -1), 6),
            ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ]))
        
        elements.append(table)
    else:
        no_data = Paragraph("No movements found for the selected criteria.", styles['Normal'])
        elements.append(no_data)
    
    doc.build(elements)
    buffer.seek(0)
    
    filename = f"stock_movements_{movement_type or 'all'}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.pdf"
    
    return StreamingResponse(
        buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
