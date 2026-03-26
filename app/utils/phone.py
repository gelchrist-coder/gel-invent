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


def to_e164_phone(phone: str | None) -> str | None:
    """Convert normalized phone input to E.164 when possible.

    Returns None when the value cannot be safely mapped.
    """
    if not phone:
        return None

    raw = phone.strip()
    if raw.startswith("+"):
        digits = normalize_phone(raw)
        if digits and 8 <= len(digits) <= 15:
            return f"+{digits}"
        return None

    digits = normalize_phone(raw)
    if not digits:
        return None

    # Common local Ghana format (0XXXXXXXXX) -> +233XXXXXXXXX
    if len(digits) == 10 and digits.startswith("0"):
        return f"+233{digits[1:]}"

    # Country code provided without '+'
    if digits.startswith("233") and len(digits) == 12:
        return f"+{digits}"

    # Fallback: accept already country-coded numbers.
    if 8 <= len(digits) <= 15 and not digits.startswith("0"):
        return f"+{digits}"

    return None
