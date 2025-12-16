from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.database import get_db
from app.auth import get_current_active_user
from app import models
from app.utils.tenant import get_tenant_user_ids


router = APIRouter(prefix="/data", tags=["data"])


def _require_admin(current_user: models.User) -> None:
    if getattr(current_user, "role", None) != "Admin":
        raise HTTPException(status_code=403, detail="Admin access required")


def _serialize_dt(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, datetime):
        # Use ISO format; keep timezone if present
        return value.isoformat()
    # Dates from SQLAlchemy Date columns may be `datetime.date`
    try:
        return value.isoformat()
    except Exception:
        return str(value)


def _serialize_decimal(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, Decimal):
        # Preserve exact value as string
        return str(value)
    return value


@router.get("/export")
def export_data(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    """Export tenant data (admin-only) as a JSON file."""
    _require_admin(current_user)

    tenant_user_ids = get_tenant_user_ids(current_user, db)

    branches = (
        db.query(models.Branch)
        .filter(models.Branch.owner_user_id == current_user.id)
        .order_by(models.Branch.id.asc())
        .all()
    )

    products = (
        db.query(models.Product)
        .filter(models.Product.user_id.in_(tenant_user_ids))
        .order_by(models.Product.id.asc())
        .all()
    )

    movements = (
        db.query(models.StockMovement)
        .filter(models.StockMovement.user_id.in_(tenant_user_ids))
        .order_by(models.StockMovement.id.asc())
        .all()
    )

    sales = (
        db.query(models.Sale)
        .filter(models.Sale.user_id.in_(tenant_user_ids))
        .order_by(models.Sale.id.asc())
        .all()
    )

    creditors = (
        db.query(models.Creditor)
        .filter(models.Creditor.user_id.in_(tenant_user_ids))
        .order_by(models.Creditor.id.asc())
        .all()
    )

    credit_transactions = (
        db.query(models.CreditTransaction)
        .filter(models.CreditTransaction.user_id.in_(tenant_user_ids))
        .order_by(models.CreditTransaction.id.asc())
        .all()
    )

    payload: dict[str, Any] = {
        "export_version": 1,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "tenant": {
            "admin_email": current_user.email,
            "admin_name": current_user.name,
            "business_name": current_user.business_name,
        },
        "branches": [
            {
                "id": b.id,
                "name": b.name,
                "is_active": b.is_active,
                "created_at": _serialize_dt(b.created_at),
            }
            for b in branches
        ],
        "products": [
            {
                "id": p.id,
                "branch_id": p.branch_id,
                "sku": p.sku,
                "name": p.name,
                "description": p.description,
                "unit": p.unit,
                "pack_size": p.pack_size,
                "category": p.category,
                "expiry_date": _serialize_dt(p.expiry_date),
                "cost_price": _serialize_decimal(p.cost_price),
                "pack_cost_price": _serialize_decimal(p.pack_cost_price),
                "selling_price": _serialize_decimal(p.selling_price),
                "pack_selling_price": _serialize_decimal(p.pack_selling_price),
                "created_at": _serialize_dt(p.created_at),
                "updated_at": _serialize_dt(p.updated_at),
            }
            for p in products
        ],
        "stock_movements": [
            {
                "id": m.id,
                "branch_id": m.branch_id,
                "product_id": m.product_id,
                "change": _serialize_decimal(m.change),
                "reason": m.reason,
                "batch_number": m.batch_number,
                "expiry_date": _serialize_dt(m.expiry_date),
                "location": m.location,
                "created_at": _serialize_dt(m.created_at),
            }
            for m in movements
        ],
        "sales": [
            {
                "id": s.id,
                "branch_id": s.branch_id,
                "product_id": s.product_id,
                "quantity": _serialize_decimal(s.quantity),
                "unit_price": _serialize_decimal(s.unit_price),
                "total_price": _serialize_decimal(s.total_price),
                "customer_name": s.customer_name,
                "payment_method": s.payment_method,
                "amount_paid": _serialize_decimal(s.amount_paid),
                "notes": s.notes,
                "created_at": _serialize_dt(s.created_at),
            }
            for s in sales
        ],
        "creditors": [
            {
                "id": c.id,
                "branch_id": c.branch_id,
                "name": c.name,
                "phone": c.phone,
                "email": c.email,
                "total_debt": _serialize_decimal(c.total_debt),
                "notes": c.notes,
                "created_at": _serialize_dt(c.created_at),
                "updated_at": _serialize_dt(c.updated_at),
            }
            for c in creditors
        ],
        "credit_transactions": [
            {
                "id": ct.id,
                "branch_id": ct.branch_id,
                "creditor_id": ct.creditor_id,
                "sale_id": ct.sale_id,
                "amount": _serialize_decimal(ct.amount),
                "transaction_type": ct.transaction_type,
                "notes": ct.notes,
                "created_at": _serialize_dt(ct.created_at),
            }
            for ct in credit_transactions
        ],
    }

    import json

    filename = f"gel-invent-export-{datetime.now().strftime('%Y-%m-%d')}.json"
    content = json.dumps(payload, ensure_ascii=False).encode("utf-8")

    return Response(
        content=content,
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _as_decimal(value: Any) -> Decimal:
    return Decimal(str(value))


@router.post("/import")
def import_data(
    payload: dict[str, Any],
    force: bool = Query(False, description="If true, clears tenant data before import"),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    """Import tenant data from a previous export (admin-only)."""
    _require_admin(current_user)

    if not isinstance(payload, dict) or payload.get("export_version") != 1:
        raise HTTPException(status_code=400, detail="Unsupported export format")

    tenant_user_ids = get_tenant_user_ids(current_user, db)

    # Safety: avoid accidental duplication unless explicitly forced.
    has_any_data = (
        db.query(models.Product.id).filter(models.Product.user_id.in_(tenant_user_ids)).first()
        or db.query(models.Sale.id).filter(models.Sale.user_id.in_(tenant_user_ids)).first()
        or db.query(models.StockMovement.id)
        .filter(models.StockMovement.user_id.in_(tenant_user_ids))
        .first()
        or db.query(models.Creditor.id).filter(models.Creditor.user_id.in_(tenant_user_ids)).first()
        or db.query(models.CreditTransaction.id)
        .filter(models.CreditTransaction.user_id.in_(tenant_user_ids))
        .first()
    )

    if has_any_data and not force:
        raise HTTPException(
            status_code=409,
            detail="Existing data found. Clear data first or re-try with force=true.",
        )

    if has_any_data and force:
        # Delete in dependency order. Keep users/branches.
        db.query(models.CreditTransaction).filter(
            models.CreditTransaction.user_id.in_(tenant_user_ids)
        ).delete(synchronize_session=False)
        db.query(models.Sale).filter(models.Sale.user_id.in_(tenant_user_ids)).delete(
            synchronize_session=False
        )
        db.query(models.StockMovement).filter(
            models.StockMovement.user_id.in_(tenant_user_ids)
        ).delete(synchronize_session=False)
        db.query(models.Creditor).filter(models.Creditor.user_id.in_(tenant_user_ids)).delete(
            synchronize_session=False
        )
        db.query(models.Product).filter(models.Product.user_id.in_(tenant_user_ids)).delete(
            synchronize_session=False
        )
        db.flush()

    branch_id_map: dict[int, int] = {}
    product_id_map: dict[int, int] = {}
    creditor_id_map: dict[int, int] = {}
    sale_id_map: dict[int, int] = {}

    # Branches: upsert by name (for this admin).
    for b in payload.get("branches", []) or []:
        try:
            legacy_id = int(b.get("id"))
            name = str(b.get("name") or "").strip()
        except Exception:
            continue
        if not name:
            continue

        existing = (
            db.query(models.Branch)
            .filter(models.Branch.owner_user_id == current_user.id, models.Branch.name == name)
            .first()
        )
        if existing:
            branch_id_map[legacy_id] = existing.id
            continue

        created = models.Branch(owner_user_id=current_user.id, name=name, is_active=bool(b.get("is_active", True)))
        db.add(created)
        db.flush()
        branch_id_map[legacy_id] = created.id

    # Products
    for p in payload.get("products", []) or []:
        try:
            legacy_id = int(p.get("id"))
            name = str(p.get("name") or "").strip()
            sku = str(p.get("sku") or "").strip()
        except Exception:
            continue
        if not name or not sku:
            continue

        legacy_branch_id = p.get("branch_id")
        new_branch_id = None
        if legacy_branch_id is not None:
            try:
                new_branch_id = branch_id_map.get(int(legacy_branch_id))
            except Exception:
                new_branch_id = None

        # If a product with the same name already exists in this branch, reuse it.
        q = db.query(models.Product).filter(models.Product.user_id == current_user.id)
        if new_branch_id is not None:
            q = q.filter(models.Product.branch_id == new_branch_id)
        existing = q.filter(models.Product.name.ilike(name)).first()
        if existing:
            product_id_map[legacy_id] = existing.id
            continue

        product = models.Product(
            user_id=current_user.id,
            branch_id=new_branch_id,
            sku=sku,
            name=name,
            description=p.get("description"),
            unit=str(p.get("unit") or "unit"),
            pack_size=p.get("pack_size"),
            category=p.get("category"),
            expiry_date=p.get("expiry_date"),
            cost_price=_as_decimal(p.get("cost_price")) if p.get("cost_price") is not None else None,
            pack_cost_price=_as_decimal(p.get("pack_cost_price")) if p.get("pack_cost_price") is not None else None,
            selling_price=_as_decimal(p.get("selling_price")) if p.get("selling_price") is not None else None,
            pack_selling_price=_as_decimal(p.get("pack_selling_price")) if p.get("pack_selling_price") is not None else None,
        )
        db.add(product)
        db.flush()
        product_id_map[legacy_id] = product.id

    # Stock movements
    for m in payload.get("stock_movements", []) or []:
        try:
            legacy_product_id = int(m.get("product_id"))
        except Exception:
            continue
        new_product_id = product_id_map.get(legacy_product_id)
        if not new_product_id:
            continue

        legacy_branch_id = m.get("branch_id")
        new_branch_id = None
        if legacy_branch_id is not None:
            try:
                new_branch_id = branch_id_map.get(int(legacy_branch_id))
            except Exception:
                new_branch_id = None

        movement = models.StockMovement(
            user_id=current_user.id,
            branch_id=new_branch_id,
            product_id=new_product_id,
            change=_as_decimal(m.get("change", 0)),
            reason=str(m.get("reason") or "adjustment"),
            batch_number=m.get("batch_number"),
            expiry_date=m.get("expiry_date"),
            location=m.get("location") or "Main Store",
        )
        db.add(movement)

    # Sales
    for s in payload.get("sales", []) or []:
        try:
            legacy_product_id = int(s.get("product_id"))
        except Exception:
            continue
        new_product_id = product_id_map.get(legacy_product_id)
        if not new_product_id:
            continue

        legacy_branch_id = s.get("branch_id")
        new_branch_id = None
        if legacy_branch_id is not None:
            try:
                new_branch_id = branch_id_map.get(int(legacy_branch_id))
            except Exception:
                new_branch_id = None

        sale = models.Sale(
            user_id=current_user.id,
            branch_id=new_branch_id,
            product_id=new_product_id,
            quantity=_as_decimal(s.get("quantity", 0)),
            unit_price=_as_decimal(s.get("unit_price", 0)),
            total_price=_as_decimal(s.get("total_price", 0)),
            customer_name=s.get("customer_name"),
            payment_method=str(s.get("payment_method") or "cash"),
            amount_paid=_as_decimal(s.get("amount_paid")) if s.get("amount_paid") is not None else None,
            notes=s.get("notes"),
        )
        db.add(sale)
        db.flush()
        # Not all exports will have stable IDs; keep map only if present.
        if s.get("id") is not None:
            try:
                sale_id_map[int(s.get("id"))] = sale.id
            except Exception:
                pass

    # Creditors
    for c in payload.get("creditors", []) or []:
        try:
            legacy_id = int(c.get("id"))
            name = str(c.get("name") or "").strip()
        except Exception:
            continue
        if not name:
            continue

        legacy_branch_id = c.get("branch_id")
        new_branch_id = None
        if legacy_branch_id is not None:
            try:
                new_branch_id = branch_id_map.get(int(legacy_branch_id))
            except Exception:
                new_branch_id = None

        creditor = models.Creditor(
            user_id=current_user.id,
            branch_id=new_branch_id,
            name=name,
            phone=c.get("phone"),
            email=c.get("email"),
            total_debt=_as_decimal(c.get("total_debt")) if c.get("total_debt") is not None else _as_decimal(0),
            notes=c.get("notes"),
        )
        db.add(creditor)
        db.flush()
        creditor_id_map[legacy_id] = creditor.id

    # Credit transactions
    for ct in payload.get("credit_transactions", []) or []:
        legacy_creditor_id = ct.get("creditor_id")
        if legacy_creditor_id is None:
            continue
        try:
            new_creditor_id = creditor_id_map.get(int(legacy_creditor_id))
        except Exception:
            new_creditor_id = None
        if not new_creditor_id:
            continue

        legacy_sale_id = ct.get("sale_id")
        new_sale_id = None
        if legacy_sale_id is not None:
            try:
                new_sale_id = sale_id_map.get(int(legacy_sale_id))
            except Exception:
                new_sale_id = None

        legacy_branch_id = ct.get("branch_id")
        new_branch_id = None
        if legacy_branch_id is not None:
            try:
                new_branch_id = branch_id_map.get(int(legacy_branch_id))
            except Exception:
                new_branch_id = None

        txn = models.CreditTransaction(
            user_id=current_user.id,
            branch_id=new_branch_id,
            creditor_id=new_creditor_id,
            sale_id=new_sale_id,
            amount=_as_decimal(ct.get("amount", 0)),
            transaction_type=str(ct.get("transaction_type") or "debt"),
            notes=ct.get("notes"),
        )
        db.add(txn)

    db.commit()

    return {"message": "Import completed"}
