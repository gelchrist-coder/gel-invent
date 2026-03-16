from __future__ import annotations

import os
import urllib.error
import urllib.parse
import urllib.request


def _normalize_phone(phone: str) -> str:
    cleaned = "".join(ch for ch in phone if ch.isdigit() or ch == "+")
    if cleaned.startswith("00"):
        cleaned = "+" + cleaned[2:]
    if not cleaned.startswith("+"):
        cleaned = "+" + cleaned
    return cleaned


def whatsapp_configured() -> bool:
    return bool((os.getenv("CALLMEBOT_API_KEY") or "").strip())


def send_whatsapp_message(*, to_number: str, message: str) -> None:
    """Send a WhatsApp message using CallMeBot HTTP API.

    Required env vars:
    - CALLMEBOT_API_KEY

    The destination number should include country code, e.g. +233XXXXXXXXX.
    """
    api_key = (os.getenv("CALLMEBOT_API_KEY") or "").strip()
    if not api_key:
        raise RuntimeError("CALLMEBOT_API_KEY is not configured")

    phone = _normalize_phone(to_number)
    text = (message or "").strip()
    if not text:
        raise RuntimeError("WhatsApp message cannot be empty")

    params = urllib.parse.urlencode({"phone": phone, "text": text, "apikey": api_key})
    url = f"https://api.callmebot.com/whatsapp.php?{params}"

    request = urllib.request.Request(url, method="GET")
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            status = int(getattr(response, "status", 200))
            body = response.read().decode("utf-8", errors="replace")
            if status >= 400:
                raise RuntimeError(f"WhatsApp send failed ({status}): {body}")
            lowered = body.lower()
            if "error" in lowered and "queued" not in lowered and "sent" not in lowered:
                raise RuntimeError(f"WhatsApp send failed: {body}")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace") if hasattr(exc, "read") else str(exc)
        raise RuntimeError(f"WhatsApp HTTP error: {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"WhatsApp network error: {exc}") from exc
