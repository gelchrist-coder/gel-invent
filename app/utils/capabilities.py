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
    },
    "Agro": {
        "expiry_tracking": True,
        "batch_tracking": True,
        "unit_conversions": True,
        "fractional_sales": True,
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

    # Preserve the legacy settings toggle while capability resolution rolls out.
    if uses_expiry_tracking is not None and uses_expiry_tracking:
        capabilities["expiry_tracking"] = True

    capabilities.update(normalize_capability_overrides(capability_overrides))
    return capabilities