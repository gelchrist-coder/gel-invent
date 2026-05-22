import os
import uuid
import urllib.request
from pathlib import Path


def is_supabase_storage_enabled() -> bool:
    base = (os.getenv("SUPABASE_URL") or "").strip()
    key = (os.getenv("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    return bool(base and key)


def get_supabase_storage_bucket() -> str:
    return (os.getenv("SUPABASE_STORAGE_BUCKET") or "business-logos").strip()


def upload_public_logo(file_bytes: bytes, content_type: str | None, filename: str | None) -> str:
    base = (os.getenv("SUPABASE_URL") or "").strip().rstrip("/")
    key = (os.getenv("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    bucket = get_supabase_storage_bucket()
    if not base or not key:
        raise RuntimeError("Supabase storage is not configured")

    suffix = ""
    if filename:
        suffix = Path(filename).suffix.lower()
        if suffix and not suffix.startswith("."):
            suffix = f".{suffix}"

    object_name = f"logos/{uuid.uuid4().hex}{suffix}"
    url = f"{base}/storage/v1/object/{bucket}/{object_name}?upsert=true"

    headers = {
        "Authorization": f"Bearer {key}",
        "apikey": key,
        "Content-Type": content_type or "application/octet-stream",
    }

    request = urllib.request.Request(url, data=file_bytes, headers=headers, method="PUT")
    with urllib.request.urlopen(request, timeout=20) as response:
        status = response.getcode()
        if status not in (200, 201):
            raise RuntimeError(f"Supabase upload failed with status {status}")

    public_url = f"{base}/storage/v1/object/public/{bucket}/{object_name}"
    return public_url
