from __future__ import annotations

import json
from typing import Any


CAPABILITY_KEYS = (
    "expiry_tracking",
    "batch_tracking",
    "variants",
    "size_color_variants",
    "brand_shade_attributes",
    "unit_conversions",
    "fractional_sales",
    "length_based_sales",
    # Sell at both wholesale and retail prices (asked at registration).
    "wholesale_pricing",
    # "Leave in store — collect later" reserved-goods flow (asked at
    # registration; defaults on for business types where it's the norm).
    "supply_tracking",
    # Separate storage locations that receive stock and replenish branches.
    "warehouse_management",
    # Website/API order reservation and fulfilment (implemented in phase 2).
)

DEFAULT_CAPABILITIES: dict[str, bool] = {key: False for key in CAPABILITY_KEYS}

BUSINESS_TYPE_CAPABILITIES: dict[str, dict[str, bool]] = {
    "Pharmacy": {
        "expiry_tracking": True,
        "batch_tracking": True,
    },
    "Grocery": {
        "expiry_tracking": True,
        "batch_tracking": True,
        "fractional_sales": True,
    },
    "Cosmetics": {
        "expiry_tracking": True,
        "batch_tracking": True,
        "variants": True,
        "brand_shade_attributes": True,
    },
    "Fashion": {
        "variants": True,
        "size_color_variants": True,
    },
    "Hardware": {
        "unit_conversions": True,
        "fractional_sales": True,
        "length_based_sales": True,
    },
    "Construction Materials": {
        "unit_conversions": True,
        "fractional_sales": True,
        "length_based_sales": True,
        "supply_tracking": True,
    },
    "Agro": {
        "expiry_tracking": True,
        "batch_tracking": True,
        "unit_conversions": True,
        "fractional_sales": True,
        "supply_tracking": True,
    },
    "Electronics": {
        "variants": True,
    },
}


def _normalize_capability_key(value: str) -> str:
    return (value or "").strip().lower()


def _coerce_bool(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"true", "1", "yes", "on"}:
            return True
        if normalized in {"false", "0", "no", "off"}:
            return False
    return None


def normalize_capability_overrides(value: str | dict[str, Any] | None) -> dict[str, bool]:
    if value is None:
        return {}

    raw: Any = value
    if isinstance(value, str):
        text_value = value.strip()
        if not text_value:
            return {}
        try:
            raw = json.loads(text_value)
        except Exception:
            return {}

    if not isinstance(raw, dict):
        return {}

    normalized: dict[str, bool] = {}
    for key, raw_value in raw.items():
        normalized_key = _normalize_capability_key(str(key))
        if normalized_key not in DEFAULT_CAPABILITIES:
            continue

        coerced = _coerce_bool(raw_value)
        if coerced is None:
            continue
        normalized[normalized_key] = coerced

    return normalized


def serialize_capability_overrides(value: dict[str, Any] | None) -> str | None:
    normalized = normalize_capability_overrides(value)
    if not normalized:
        return None
    return json.dumps(normalized, sort_keys=True)


def resolve_effective_capabilities(
    *,
    business_types: list[str] | None,
    capability_overrides: str | dict[str, Any] | None,
    uses_expiry_tracking: bool | None = None,
) -> dict[str, bool]:
    capabilities = dict(DEFAULT_CAPABILITIES)

    for business_type in business_types or []:
        mapped = BUSINESS_TYPE_CAPABILITIES.get((business_type or "").strip())
        if not mapped:
            continue
        capabilities.update(mapped)

    # The original column defaulted to true for every tenant, so treating true
    # as an override would incorrectly enable expiry for every business type.
    # A legacy false value is still respected; explicit capability overrides
    # below are the authoritative owner choice in either direction.
    if uses_expiry_tracking is False:
        capabilities["expiry_tracking"] = False

    capabilities.update(normalize_capability_overrides(capability_overrides))
    return capabilities


def get_effective_capabilities_for_user(db, user) -> dict[str, bool]:
    """Resolve tenant capabilities for backend validation and stock logic."""
    from sqlalchemy import select

    from app import models

    owner_user_id = int(user.created_by or user.id)
    owner = db.get(models.User, owner_user_id)
    settings = db.scalar(
        select(models.SystemSettings).where(models.SystemSettings.owner_user_id == owner_user_id)
    )

    business_types: list[str] = []
    raw_business_types = getattr(owner, "business_types", None) if owner else None
    if raw_business_types:
        try:
            parsed = json.loads(raw_business_types)
            if isinstance(parsed, list):
                business_types = [str(value).strip() for value in parsed if str(value).strip()]
        except Exception:
            business_types = []

    return resolve_effective_capabilities(
        business_types=business_types,
        capability_overrides=getattr(settings, "capability_overrides", None) if settings else None,
        uses_expiry_tracking=getattr(settings, "uses_expiry_tracking", None) if settings else None,
    )
