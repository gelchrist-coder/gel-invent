from __future__ import annotations

import base64
import hashlib
import hmac
import ipaddress
import json
import os
import socket
import urllib.error
import urllib.request
from datetime import datetime, timezone
from urllib.parse import urlparse

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models
from app.database import SessionLocal


WEBHOOK_EVENTS = (
    "fulfillment.order.created",
    "fulfillment.order.picking",
    "fulfillment.order.packed",
    "fulfillment.order.dispatched",
    "fulfillment.order.delivered",
    "fulfillment.order.cancelled",
)


class _NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001
        return None


def validate_webhook_url(url: str) -> str:
    normalized = (url or "").strip()
    parsed = urlparse(normalized)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("Webhook URL must be a public HTTPS URL without embedded credentials")
    if parsed.port not in {None, 443}:
        raise ValueError("Webhook URL must use the standard HTTPS port")
    return normalized


def _ensure_public_destination(url: str) -> None:
    parsed = urlparse(validate_webhook_url(url))
    try:
        addresses = socket.getaddrinfo(parsed.hostname, 443, type=socket.SOCK_STREAM)
    except OSError as exc:
        raise ValueError("Webhook hostname could not be resolved") from exc
    for address in addresses:
        ip = ipaddress.ip_address(address[4][0])
        if not ip.is_global:
            raise ValueError("Webhook URL must resolve only to public internet addresses")


def _master_secret() -> bytes:
    value = (os.getenv("WEBHOOK_SIGNING_SECRET") or os.getenv("SECRET_KEY") or os.getenv("JWT_SECRET_KEY") or "").strip()
    if not value:
        raise RuntimeError("WEBHOOK_SIGNING_SECRET or SECRET_KEY must be configured")
    return value.encode("utf-8")


def webhook_secret_for_endpoint(endpoint_id: int, owner_user_id: int) -> str:
    digest = hmac.new(
        _master_secret(),
        f"gel-invent:webhook:{owner_user_id}:{endpoint_id}".encode("utf-8"),
        hashlib.sha256,
    ).digest()
    return base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")


def parse_webhook_events(value: str | list[str]) -> list[str]:
    raw = value
    if isinstance(value, str):
        try:
            raw = json.loads(value)
        except Exception:
            raw = []
    if not isinstance(raw, list):
        return []
    return [event for event in WEBHOOK_EVENTS if event in {str(item).strip() for item in raw}]


def enqueue_webhook_event(db: Session, *, owner_user_id: int, event_type: str, data: dict) -> list[int]:
    if event_type not in WEBHOOK_EVENTS:
        return []
    endpoints = db.scalars(select(models.WebhookEndpoint).where(
        models.WebhookEndpoint.owner_user_id == owner_user_id,
        models.WebhookEndpoint.is_active.is_(True),
    )).all()
    delivery_ids: list[int] = []
    for endpoint in endpoints:
        if event_type not in parse_webhook_events(endpoint.events):
            continue
        delivery = models.WebhookDelivery(
            owner_user_id=owner_user_id,
            endpoint_id=endpoint.id,
            event_type=event_type,
            payload=json.dumps({
                "event": event_type,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "data": data,
            }, separators=(",", ":"), default=str),
            status="pending",
        )
        db.add(delivery)
        db.flush()
        delivery_ids.append(delivery.id)
    db.commit()
    return delivery_ids


def deliver_webhook(delivery_id: int) -> None:
    db = SessionLocal()
    try:
        delivery = db.scalar(
            select(models.WebhookDelivery)
            .where(models.WebhookDelivery.id == delivery_id)
            .with_for_update()
        )
        if not delivery or delivery.status == "delivered":
            return
        endpoint = delivery.endpoint
        if not endpoint.is_active:
            delivery.status = "failed"
            delivery.last_error = "Webhook endpoint is inactive"
            db.commit()
            return

        delivery.attempts = int(delivery.attempts or 0) + 1
        timestamp = str(int(datetime.now(timezone.utc).timestamp()))
        body = delivery.payload.encode("utf-8")
        signing_payload = f"{timestamp}.".encode("utf-8") + body
        secret = webhook_secret_for_endpoint(endpoint.id, endpoint.owner_user_id)
        signature = hmac.new(secret.encode("utf-8"), signing_payload, hashlib.sha256).hexdigest()
        try:
            _ensure_public_destination(endpoint.url)
            request = urllib.request.Request(
                endpoint.url,
                data=body,
                method="POST",
                headers={
                    "Content-Type": "application/json",
                    "User-Agent": "GelInvent-Webhooks/1.0",
                    "X-GelInvent-Event": delivery.event_type,
                    "X-GelInvent-Delivery": str(delivery.id),
                    "X-GelInvent-Timestamp": timestamp,
                    "X-GelInvent-Signature": f"v1={signature}",
                },
            )
            opener = urllib.request.build_opener(_NoRedirectHandler())
            with opener.open(request, timeout=12) as response:
                delivery.response_status = int(response.status)
                if 200 <= response.status < 300:
                    delivery.status = "delivered"
                    delivery.delivered_at = datetime.now(timezone.utc)
                    delivery.last_error = None
                else:
                    delivery.status = "failed"
                    delivery.last_error = f"Webhook returned HTTP {response.status}"
        except urllib.error.HTTPError as exc:
            delivery.response_status = int(exc.code)
            delivery.status = "failed"
            delivery.last_error = f"Webhook returned HTTP {exc.code}"
        except Exception as exc:
            delivery.status = "failed"
            delivery.last_error = str(exc)[:1000]
        db.commit()
    finally:
        db.close()
