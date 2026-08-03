from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import select

from app import models


@dataclass
class WarehouseLotBalance:
    batch_number: str | None
    expiry_date: date | None
    unit_cost_price: Decimal | None
    quantity: Decimal
    received_at: datetime
    movement_id: int


def _decimal(value: Decimal | int | float | None) -> Decimal:
    return value if isinstance(value, Decimal) else Decimal(str(value or 0))


def _consume_lots(lots: list[WarehouseLotBalance], quantity: Decimal) -> Decimal:
    remaining = quantity
    for lot in lots:
        if remaining <= 0:
            break
        if lot.quantity <= 0:
            continue
        consumed = min(lot.quantity, remaining)
        lot.quantity -= consumed
        remaining -= consumed
    return remaining


def get_warehouse_lot_balances(
    db,
    *,
    warehouse_id: int,
    item_id: int,
) -> list[WarehouseLotBalance]:
    """Rebuild remaining receipt lots from the warehouse movement ledger.

    Older outbound movements did not store batch metadata. They are allocated
    to the oldest expiring stock first so existing ledgers remain consistent.
    """
    movements = db.scalars(
        select(models.WarehouseStockMovement)
        .where(
            models.WarehouseStockMovement.warehouse_id == warehouse_id,
            models.WarehouseStockMovement.item_id == item_id,
        )
        .order_by(
            models.WarehouseStockMovement.created_at.asc(),
            models.WarehouseStockMovement.id.asc(),
        )
    ).all()

    lots: list[WarehouseLotBalance] = []
    for movement in movements:
        change = _decimal(movement.change)
        if change > 0:
            lots.append(
                WarehouseLotBalance(
                    batch_number=movement.batch_number,
                    expiry_date=movement.expiry_date,
                    unit_cost_price=movement.unit_cost_price,
                    quantity=change,
                    received_at=movement.created_at,
                    movement_id=movement.id,
                )
            )
            continue
        if change >= 0:
            continue

        outbound = -change
        if movement.batch_number is not None:
            matching = [
                lot
                for lot in lots
                if lot.batch_number == movement.batch_number
                and lot.expiry_date == movement.expiry_date
            ]
            outbound = _consume_lots(matching, outbound)
        if outbound > 0:
            available = sorted(
                (lot for lot in lots if lot.quantity > 0),
                key=lambda lot: (
                    lot.expiry_date is None,
                    lot.expiry_date or date.max,
                    lot.received_at,
                    lot.movement_id,
                ),
            )
            _consume_lots(available, outbound)

    return [lot for lot in lots if lot.quantity > 0]


def allocate_warehouse_outbound(
    db,
    *,
    warehouse_id: int,
    item_id: int,
    quantity: Decimal,
) -> list[WarehouseLotBalance]:
    """Return FEFO lot slices for a warehouse outbound operation."""
    requested = _decimal(quantity)
    if requested <= 0:
        return []

    lots = sorted(
        get_warehouse_lot_balances(db, warehouse_id=warehouse_id, item_id=item_id),
        key=lambda lot: (
            lot.expiry_date is None,
            lot.expiry_date or date.max,
            lot.received_at,
            lot.movement_id,
        ),
    )
    available = sum((lot.quantity for lot in lots), Decimal("0"))
    if requested > available:
        return []

    slices: list[WarehouseLotBalance] = []
    remaining = requested
    for lot in lots:
        if remaining <= 0:
            break
        allocated = min(lot.quantity, remaining)
        if allocated <= 0:
            continue
        slices.append(
            WarehouseLotBalance(
                batch_number=lot.batch_number,
                expiry_date=lot.expiry_date,
                unit_cost_price=lot.unit_cost_price,
                quantity=allocated,
                received_at=lot.received_at,
                movement_id=lot.movement_id,
            )
        )
        remaining -= allocated
    return slices
