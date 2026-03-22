import re


def normalize_phone(phone: str | None) -> str | None:
    """Normalize a phone number for storage/lookup.

    Keeps digits only so formats like +233 24 123 4567 and 233241234567
    map to the same value.
    """
    if phone is None:
        return None
    cleaned = re.sub(r"\D", "", phone)
    return cleaned or None


def is_valid_phone(phone: str | None) -> bool:
    normalized = normalize_phone(phone)
    if normalized is None:
        return False
    return 7 <= len(normalized) <= 15
