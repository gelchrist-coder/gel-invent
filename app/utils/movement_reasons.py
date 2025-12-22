from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal


def _norm(reason: str | None) -> str:
    return (reason or "").strip().lower()


@dataclass(frozen=True)
class ReasonRules:
    positive_only: set[str]
    negative_only: set[str]
    adjustment: set[str]


RULES = ReasonRules(
    positive_only={
        "initial stock",
        "new stock",
        "restock",
        "stock transfer in",
    },
    negative_only={
        "expired",
        "damaged",
        "lost",
        "lost/stolen",
        "write-off",
        "spoiled",
        "destroyed",
        "stock transfer out",
    },
    adjustment={
        "stock count",
        "correction",
        "adjustment",
        "inventory correction",
    },
)


def is_return(reason: str | None) -> bool:
    r = _norm(reason)
    return r.startswith("returned")


def is_sale(reason: str | None) -> bool:
    return _norm(reason) == "sale"


def is_adjustment(reason: str | None) -> bool:
    return _norm(reason) in RULES.adjustment


def validate_reason_and_change(reason: str | None, change: Decimal) -> str | None:
    """Return an error message if invalid, else None."""
    r = _norm(reason)

    if not r:
        return "Reason is required"

    if is_return(r) and change <= 0:
        return "Returned must be a positive quantity"

    if r in RULES.positive_only and change <= 0:
        # e.g. New Stock, Restock, Stock Transfer In
        return f"{reason} must be a positive quantity"

    if r in RULES.negative_only and change >= 0:
        return f"{reason} must be a negative quantity"

    return None


def classify_movement(reason: str | None, change: Decimal) -> str:
    """Classify movement into one of: sales, adjustments, stock_in, stock_out."""
    if is_sale(reason):
        return "sales"
    if is_adjustment(reason):
        return "adjustments"
    if is_return(reason):
        return "stock_in"
    return "stock_in" if change > 0 else "stock_out"
