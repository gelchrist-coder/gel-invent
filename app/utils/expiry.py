from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from sqlalchemy import and_, func, select

from app import models


@dataclass(frozen=True)
class BatchBalance:
    batch_number: str
    expiry_date: date | None
    location: str | None
    balance: Decimal
    first_seen: date | None


def get_batch_balances(
    *,
    db,
    tenant_user_ids: list[int],
    branch_id: int,
    product_id: int,
    include_null_expiry: bool = True,
) -> list[BatchBalance]:
    """Return per-batch balances for a product.

    Notes:
    - This is based on summing movements *that have batch_number*.
    - Older historical deductions (without batch_number) remain unallocated.
    """

    where = [
        models.StockMovement.product_id == product_id,
        models.StockMovement.branch_id == branch_id,
        models.StockMovement.user_id.in_(tenant_user_ids),
        models.StockMovement.batch_number.is_not(None),
    ]

    if not include_null_expiry:
        where.append(models.StockMovement.expiry_date.is_not(None))

    rows = db.execute(
        select(
            models.StockMovement.batch_number,
            models.StockMovement.expiry_date,
            models.StockMovement.location,
            func.coalesce(func.sum(models.StockMovement.change), 0).label("balance"),
            func.min(models.StockMovement.created_at).label("first_seen"),
        )
        .where(and_(*where))
        .group_by(
            models.StockMovement.batch_number,
            models.StockMovement.expiry_date,
            models.StockMovement.location,
        )
    ).all()

    balances: list[BatchBalance] = []
    for batch_number, expiry_dt, location, balance, first_seen in rows:
        bal = balance if isinstance(balance, Decimal) else Decimal(str(balance or 0))
        if not batch_number:
            continue
        balances.append(
            BatchBalance(
                batch_number=str(batch_number),
                expiry_date=expiry_dt,
                location=location,
                balance=bal,
                first_seen=first_seen.date() if hasattr(first_seen, "date") and first_seen else None,
            )
        )
    return balances


def writeoff_expired_batches(
    *,
    db,
    actor_user_id: int,
    tenant_user_ids: list[int],
    branch_id: int,
    product_id: int | None = None,
) -> int:
    """Create negative movements to write off any expired batch balances.

    This function is idempotent: it only writes off batches that currently have
    a positive remaining balance.
    """
    today = date.today()

    where = [
        models.StockMovement.branch_id == branch_id,
        models.StockMovement.user_id.in_(tenant_user_ids),
        models.StockMovement.batch_number.is_not(None),
        models.StockMovement.expiry_date.is_not(None),
        models.StockMovement.expiry_date < today,
    ]
    if product_id is not None:
        where.append(models.StockMovement.product_id == product_id)

    rows = db.execute(
        select(
            models.StockMovement.product_id,
            models.StockMovement.batch_number,
            models.StockMovement.expiry_date,
            models.StockMovement.location,
            func.coalesce(func.sum(models.StockMovement.change), 0).label("balance"),
        )
        .where(and_(*where))
        .group_by(
            models.StockMovement.product_id,
            models.StockMovement.batch_number,
            models.StockMovement.expiry_date,
            models.StockMovement.location,
        )
        .having(func.sum(models.StockMovement.change) > 0)
    ).all()

    created = 0
    for pid, batch_number, expiry_dt, location, balance in rows:
        bal = balance if isinstance(balance, Decimal) else Decimal(str(balance or 0))
        if bal <= 0:
            continue

        # Try to copy the latest known unit cost for this batch (from stock-in movements).
        unit_cost_price = None
        try:
            unit_cost_price = db.scalar(
                select(models.StockMovement.unit_cost_price)
                .where(
                    models.StockMovement.product_id == int(pid),
                    models.StockMovement.branch_id == branch_id,
                    models.StockMovement.user_id.in_(tenant_user_ids),
                    models.StockMovement.batch_number == str(batch_number),
                    models.StockMovement.change > 0,
                )
                .order_by(models.StockMovement.created_at.desc())
            )
        except Exception:
            unit_cost_price = None
        db.add(
            models.StockMovement(
                user_id=actor_user_id,
                branch_id=branch_id,
                product_id=int(pid),
                change=-bal,
                reason="Expired",
                batch_number=str(batch_number),
                expiry_date=expiry_dt,
                unit_cost_price=unit_cost_price,
                location=location or "Main Store",
            )
        )
        created += 1

    if created:
        db.flush()
    return created
