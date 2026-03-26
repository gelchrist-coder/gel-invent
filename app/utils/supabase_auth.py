import json
import os
from dataclasses import dataclass
from typing import Any
from urllib import error, request

from app.utils.phone import to_e164_phone


@dataclass
class SupabaseAuthResult:
    user_id: str
    email: str


class SupabaseAuthError(Exception):
    def __init__(self, message: str, status_code: int | None = None):
        super().__init__(message)
        self.status_code = status_code


def is_supabase_auth_sync_enabled() -> bool:
    return bool(os.getenv("SUPABASE_URL") and os.getenv("SUPABASE_SERVICE_ROLE_KEY"))


def _auth_base_url() -> str:
    base = (os.getenv("SUPABASE_URL") or "").strip().rstrip("/")
    if not base:
        raise SupabaseAuthError("SUPABASE_URL is not configured")
    return f"{base}/auth/v1"


def _service_key() -> str:
    key = (os.getenv("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    if not key:
        raise SupabaseAuthError("SUPABASE_SERVICE_ROLE_KEY is not configured")
    return key


def _request_json(method: str, url: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    service_key = _service_key()
    req = request.Request(
        url,
        data=body,
        method=method,
        headers={
            "Content-Type": "application/json",
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
        },
    )

    try:
        with request.urlopen(req, timeout=15) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except error.HTTPError as exc:
        raw = exc.read().decode("utf-8") if exc.fp else ""
        detail = ""
        if raw:
            try:
                parsed = json.loads(raw)
                detail = (
                    str(parsed.get("msg") or parsed.get("error_description") or parsed.get("error") or "")
                ).strip()
            except Exception:
                detail = raw.strip()
        message = detail or f"Supabase Auth request failed ({exc.code})"
        raise SupabaseAuthError(message, status_code=exc.code) from exc
    except error.URLError as exc:
        raise SupabaseAuthError(f"Supabase Auth connection failed: {exc.reason}") from exc


def create_auth_user(
    email: str,
    password: str,
    name: str | None = None,
    phone: str | None = None,
) -> SupabaseAuthResult:
    data = {
        "email": email,
        "password": password,
        "email_confirm": True,
    }

    metadata: dict[str, Any] = {}
    if name:
        metadata["name"] = name
    if phone:
        metadata["phone"] = phone

    phone_e164 = to_e164_phone(phone)
    if phone_e164:
        data["phone"] = phone_e164
        data["phone_confirm"] = True

    if metadata:
        data["user_metadata"] = metadata

    resp = _request_json("POST", f"{_auth_base_url()}/admin/users", data)
    user_id = str(resp.get("id") or "").strip()
    user_email = str(resp.get("email") or email).strip()
    if not user_id:
        raise SupabaseAuthError("Supabase Auth did not return a user ID")
    return SupabaseAuthResult(user_id=user_id, email=user_email)


def delete_auth_user(user_id: str) -> None:
    cleaned = (user_id or "").strip()
    if not cleaned:
        return
    _request_json("DELETE", f"{_auth_base_url()}/admin/users/{cleaned}")
