from __future__ import annotations

import hashlib
import json
import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models
from app.auth import get_current_active_user
from app.deps import get_db
from app.permissions import ensure_permission
from app.routers.warehouses import (
    FulfillmentOrderCreate,
    FulfillmentOrderItemCreate,
    FulfillmentOrderRead,
    _serialize_order,
    create_fulfillment_order,
    list_warehouse_stock,
)
from app.utils.branch import get_owner_user_id
from app.utils.webhooks import (
    WEBHOOK_EVENTS,
    deliver_webhook,
    parse_webhook_events,
    validate_webhook_url,
    webhook_secret_for_endpoint,
)

router = APIRouter(prefix="/integrations", tags=["integrations"])

API_SCOPES = ("inventory:read", "orders:read", "orders:write")


class ApiKeyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    scopes: list[str] = Field(min_length=1)


class ApiKeyRead(BaseModel):
    id: int
    name: str
    key_prefix: str
    scopes: list[str]
    is_active: bool
    last_used_at: datetime | None
    expires_at: datetime | None
    created_at: datetime
    secret: str | None = None


class WebhookCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    url: str = Field(min_length=1, max_length=2000)
    events: list[str] = Field(min_length=1)


class WebhookRead(BaseModel):
    id: int
    name: str
    url: str
    events: list[str]
    is_active: bool
    created_at: datetime
    signing_secret: str | None = None


class PublicOrderCreate(BaseModel):
    warehouse_id: int = Field(gt=0)
    external_order_id: str = Field(min_length=1, max_length=120)
    customer_name: str = Field(min_length=1, max_length=255)
    customer_phone: str | None = Field(default=None, max_length=50)
    customer_email: str | None = Field(default=None, max_length=255)
    delivery_address: str | None = Field(default=None, max_length=2000)
    notes: str | None = Field(default=None, max_length=2000)
    items: list[FulfillmentOrderItemCreate] = Field(min_length=1, max_length=100)


class PublicAvailabilityRead(BaseModel):
    item_id: int
    warehouse_id: int
    sku: str
    name: str
    unit: str
    category: str | None
    selling_price: float | None
    available_quantity: float


class IntegrationPrincipal:
    def __init__(self, api_key: models.IntegrationApiKey, owner: models.User, scopes: set[str]):
        self.api_key = api_key
        self.owner = owner
        self.scopes = scopes


def _parse_scopes(value: str) -> list[str]:
    try:
        raw = json.loads(value)
    except Exception:
        return []
    if not isinstance(raw, list):
        return []
    return [scope for scope in API_SCOPES if scope in {str(item) for item in raw}]


def _extract_api_token(x_api_key: str | None, authorization: str | None) -> str:
    if x_api_key and x_api_key.strip():
        return x_api_key.strip()
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    raise HTTPException(status_code=401, detail="A website API key is required")


def get_integration_principal(
    x_api_key: str | None = Header(default=None, alias="X-API-Key"),
    authorization: str | None = Header(default=None, alias="Authorization"),
    db: Session = Depends(get_db),
) -> IntegrationPrincipal:
    token = _extract_api_token(x_api_key, authorization)
    if not token.startswith("gi_live_") or len(token) < 40:
        raise HTTPException(status_code=401, detail="Invalid website API key")
    key_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    api_key = db.scalar(select(models.IntegrationApiKey).where(
        models.IntegrationApiKey.key_hash == key_hash,
        models.IntegrationApiKey.is_active.is_(True),
    ))
    now = datetime.now(timezone.utc)
    if not api_key or (api_key.expires_at and api_key.expires_at <= now):
        raise HTTPException(status_code=401, detail="Invalid or expired website API key")
    owner = db.scalar(select(models.User).where(
        models.User.id == api_key.owner_user_id,
        models.User.is_active.is_(True),
    ))
    if not owner:
        raise HTTPException(status_code=401, detail="Integration owner is inactive")
    api_key.last_used_at = now
    db.commit()
    return IntegrationPrincipal(api_key, owner, set(_parse_scopes(api_key.scopes)))


def require_scope(scope: str):
    def dependency(principal: IntegrationPrincipal = Depends(get_integration_principal)) -> IntegrationPrincipal:
        if scope not in principal.scopes:
            raise HTTPException(status_code=403, detail=f"API key requires the {scope} scope")
        return principal
    return dependency


def _serialize_key(api_key: models.IntegrationApiKey, secret: str | None = None) -> ApiKeyRead:
    return ApiKeyRead(
        id=api_key.id, name=api_key.name, key_prefix=api_key.key_prefix,
        scopes=_parse_scopes(api_key.scopes), is_active=api_key.is_active,
        last_used_at=api_key.last_used_at, expires_at=api_key.expires_at,
        created_at=api_key.created_at, secret=secret,
    )


def _serialize_webhook(endpoint: models.WebhookEndpoint, *, include_secret: bool = False) -> WebhookRead:
    return WebhookRead(
        id=endpoint.id, name=endpoint.name, url=endpoint.url,
        events=parse_webhook_events(endpoint.events), is_active=endpoint.is_active,
        created_at=endpoint.created_at,
        signing_secret=webhook_secret_for_endpoint(endpoint.id, endpoint.owner_user_id) if include_secret else None,
    )


@router.get("/api-keys", response_model=list[ApiKeyRead])
def list_api_keys(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_active_user)):
    ensure_permission(current_user, "manage_settings")
    owner_user_id = get_owner_user_id(current_user)
    rows = db.scalars(select(models.IntegrationApiKey).where(
        models.IntegrationApiKey.owner_user_id == owner_user_id,
    ).order_by(models.IntegrationApiKey.created_at.desc())).all()
    return [_serialize_key(row) for row in rows]


@router.post("/api-keys", response_model=ApiKeyRead)
def create_api_key(payload: ApiKeyCreate, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_active_user)):
    ensure_permission(current_user, "manage_settings")
    scopes = [scope for scope in API_SCOPES if scope in set(payload.scopes)]
    if not scopes or len(scopes) != len(set(payload.scopes)):
        raise HTTPException(status_code=422, detail=f"Scopes must be selected from: {', '.join(API_SCOPES)}")
    secret = "gi_live_" + secrets.token_urlsafe(32)
    api_key = models.IntegrationApiKey(
        owner_user_id=get_owner_user_id(current_user),
        name=payload.name.strip(),
        key_prefix=secret[:16],
        key_hash=hashlib.sha256(secret.encode("utf-8")).hexdigest(),
        scopes=json.dumps(scopes),
        is_active=True,
    )
    db.add(api_key)
    db.commit()
    db.refresh(api_key)
    return _serialize_key(api_key, secret)


@router.delete("/api-keys/{key_id}")
def revoke_api_key(key_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_active_user)):
    ensure_permission(current_user, "manage_settings")
    api_key = db.scalar(select(models.IntegrationApiKey).where(
        models.IntegrationApiKey.id == key_id,
        models.IntegrationApiKey.owner_user_id == get_owner_user_id(current_user),
    ))
    if not api_key:
        raise HTTPException(status_code=404, detail="API key not found")
    api_key.is_active = False
    db.commit()
    return {"message": "API key revoked"}


@router.get("/webhooks", response_model=list[WebhookRead])
def list_webhooks(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_active_user)):
    ensure_permission(current_user, "manage_settings")
    rows = db.scalars(select(models.WebhookEndpoint).where(
        models.WebhookEndpoint.owner_user_id == get_owner_user_id(current_user),
    ).order_by(models.WebhookEndpoint.created_at.desc())).all()
    return [_serialize_webhook(row) for row in rows]


@router.post("/webhooks", response_model=WebhookRead)
def create_webhook(payload: WebhookCreate, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_active_user)):
    ensure_permission(current_user, "manage_settings")
    try:
        url = validate_webhook_url(payload.url)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    events = parse_webhook_events(payload.events)
    if not events or len(events) != len(set(payload.events)):
        raise HTTPException(status_code=422, detail="One or more webhook events are invalid")
    endpoint = models.WebhookEndpoint(
        owner_user_id=get_owner_user_id(current_user),
        name=payload.name.strip(), url=url, events=json.dumps(events), is_active=True,
    )
    try:
        db.add(endpoint)
        db.flush()
        db.refresh(endpoint)
        result = _serialize_webhook(endpoint, include_secret=True)
        db.commit()
        return result
    except RuntimeError as exc:
        db.rollback()
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.delete("/webhooks/{endpoint_id}")
def deactivate_webhook(endpoint_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_active_user)):
    ensure_permission(current_user, "manage_settings")
    endpoint = db.scalar(select(models.WebhookEndpoint).where(
        models.WebhookEndpoint.id == endpoint_id,
        models.WebhookEndpoint.owner_user_id == get_owner_user_id(current_user),
    ))
    if not endpoint:
        raise HTTPException(status_code=404, detail="Webhook endpoint not found")
    endpoint.is_active = False
    db.commit()
    return {"message": "Webhook endpoint disabled"}


@router.get("/webhook-deliveries")
def list_webhook_deliveries(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_active_user)):
    ensure_permission(current_user, "manage_settings")
    rows = db.scalars(select(models.WebhookDelivery).where(
        models.WebhookDelivery.owner_user_id == get_owner_user_id(current_user),
    ).order_by(models.WebhookDelivery.created_at.desc()).limit(200)).all()
    return [{
        "id": row.id, "endpoint_id": row.endpoint_id, "event_type": row.event_type,
        "status": row.status, "attempts": row.attempts, "response_status": row.response_status,
        "last_error": row.last_error, "delivered_at": row.delivered_at, "created_at": row.created_at,
    } for row in rows]


@router.post("/webhook-deliveries/{delivery_id}/retry")
def retry_webhook(delivery_id: int, background_tasks: BackgroundTasks, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_active_user)):
    ensure_permission(current_user, "manage_settings")
    delivery = db.scalar(select(models.WebhookDelivery).where(
        models.WebhookDelivery.id == delivery_id,
        models.WebhookDelivery.owner_user_id == get_owner_user_id(current_user),
    ))
    if not delivery:
        raise HTTPException(status_code=404, detail="Webhook delivery not found")
    delivery.status = "pending"
    db.commit()
    background_tasks.add_task(deliver_webhook, delivery.id)
    return {"message": "Webhook retry queued"}


@router.get("/v1/warehouses")
def public_warehouses(principal: IntegrationPrincipal = Depends(require_scope("inventory:read")), db: Session = Depends(get_db)):
    rows = db.scalars(select(models.Warehouse).where(
        models.Warehouse.owner_user_id == principal.owner.id,
        models.Warehouse.is_active.is_(True),
    ).order_by(models.Warehouse.name)).all()
    return [{"id": row.id, "name": row.name} for row in rows]


@router.get("/v1/availability", response_model=list[PublicAvailabilityRead])
def public_availability(warehouse_id: int, principal: IntegrationPrincipal = Depends(require_scope("inventory:read")), db: Session = Depends(get_db)):
    rows = list_warehouse_stock(warehouse_id, db, principal.owner)
    return [PublicAvailabilityRead(
        item_id=row.item_id, warehouse_id=row.warehouse_id, sku=row.sku, name=row.name,
        unit=row.unit, category=row.category,
        selling_price=float(row.selling_price) if row.selling_price is not None else None,
        available_quantity=float(row.available_quantity),
    ) for row in rows]


@router.post("/v1/orders", response_model=FulfillmentOrderRead)
def public_create_order(
    payload: PublicOrderCreate,
    background_tasks: BackgroundTasks,
    principal: IntegrationPrincipal = Depends(require_scope("orders:write")),
    db: Session = Depends(get_db),
):
    existing = db.scalar(select(models.FulfillmentOrder).where(
        models.FulfillmentOrder.owner_user_id == principal.owner.id,
        models.FulfillmentOrder.source == "website",
        models.FulfillmentOrder.external_order_id == payload.external_order_id,
    ))
    if existing:
        return _serialize_order(existing)
    internal_payload = FulfillmentOrderCreate(
        external_order_id=payload.external_order_id,
        source="website",
        customer_name=payload.customer_name,
        customer_phone=payload.customer_phone,
        customer_email=payload.customer_email,
        delivery_address=payload.delivery_address,
        notes=payload.notes,
        items=payload.items,
    )
    return create_fulfillment_order(payload.warehouse_id, internal_payload, background_tasks, db, principal.owner)


@router.get("/v1/orders/{external_order_id}", response_model=FulfillmentOrderRead)
def public_get_order(external_order_id: str, principal: IntegrationPrincipal = Depends(require_scope("orders:read")), db: Session = Depends(get_db)):
    order = db.scalar(select(models.FulfillmentOrder).where(
        models.FulfillmentOrder.owner_user_id == principal.owner.id,
        models.FulfillmentOrder.source == "website",
        models.FulfillmentOrder.external_order_id == external_order_id,
    ))
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    return _serialize_order(order)
