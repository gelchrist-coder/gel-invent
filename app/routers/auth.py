from datetime import timedelta, datetime, timezone
from typing import Optional
import json
import secrets
import os
import urllib.error
import urllib.parse
import urllib.request

from fastapi import APIRouter, Depends, HTTPException, status, Request, UploadFile, File, Form
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel, EmailStr
from sqlalchemy import or_
from sqlalchemy.orm import Session
from starlette.datastructures import UploadFile as StarletteUploadFile

from app.database import get_db
from app.models import User, PasswordResetToken, Branch, SystemSettings
from app.auth import (
    create_access_token,
    get_password_rule_error,
    get_password_hash,
    verify_password,
    get_current_active_user,
    ACCESS_TOKEN_EXPIRE_MINUTES,
)
from app.utils.supabase_auth import (
    SupabaseAuthError,
    create_auth_user,
    delete_auth_user,
    is_supabase_auth_sync_enabled,
)
from app.utils.email import send_email, smtp_configured
from app.utils.phone import is_valid_phone, normalize_phone
from app.utils.supabase_storage import is_supabase_storage_enabled, upload_public_logo
from app.permissions import ensure_permission, get_effective_role_name, get_role_permissions, is_admin

router = APIRouter(prefix="/auth", tags=["auth"])

BUSINESS_TYPE_ALIASES = {
    "pharmacy": "Pharmacy",
    "grocery": "Grocery",
    "groceries": "Grocery",
    "cosmetics": "Cosmetics",
    "fashion": "Fashion",
    "hardware": "Hardware",
    "construction": "Construction Materials",
    "construction material": "Construction Materials",
    "construction materials": "Construction Materials",
    "building material": "Construction Materials",
    "building materials": "Construction Materials",
    "agro": "Agro",
    "agro input": "Agro",
    "agro inputs": "Agro",
    "electronic": "Electronics",
    "electronics": "Electronics",
}


# Schemas
class UserCreate(BaseModel):
    email: EmailStr
    phone: Optional[str] = None
    name: str
    password: str
    business_name: Optional[str] = None
    business_location: Optional[str] = None
    recaptcha_token: Optional[str] = None
    business_logo_url: Optional[str] = None
    business_types: Optional[list[str]] = None
    product_categories: Optional[list[str]] = None
    # Legacy input kept for compatibility during migration.
    categories: Optional[list[str]] = None
    branches: Optional[list[str]] = None  # Optional list of branch names


class UserResponse(BaseModel):
    id: int
    email: str
    phone: Optional[str] = None
    name: str
    role: str
    permissions: list[str]
    business_name: Optional[str] = None
    business_logo_url: Optional[str] = None
    business_types: Optional[list[str]] = None
    product_categories: Optional[list[str]] = None
    # Legacy compatibility alias for product_categories.
    categories: Optional[list[str]] = None
    branch_id: Optional[int] = None
    is_active: bool

    class Config:
        from_attributes = True


class SignupResponse(UserResponse):
    verification_code: Optional[str] = None


def _parse_categories(value: Optional[str]) -> Optional[list[str]]:
    if not value:
        return None
    try:
        parsed = json.loads(value)
        if isinstance(parsed, list):
            cleaned = [str(v).strip() for v in parsed if str(v).strip()]
            return cleaned or None
    except Exception:
        pass
    # Fallback: treat as comma-separated
    cleaned = [v.strip() for v in value.split(",") if v.strip()]
    return cleaned or None


def _clean_string_list(values: Optional[list[str]]) -> Optional[list[str]]:
    if not values:
        return None

    cleaned: list[str] = []
    seen: set[str] = set()
    for raw in values:
        value = str(raw).strip()
        if not value:
            continue
        key = value.lower()
        if key in seen:
            continue
        seen.add(key)
        cleaned.append(value)
    return cleaned or None


def _normalize_business_type(value: str) -> str | None:
    normalized = " ".join(str(value or "").strip().lower().replace("_", " ").replace("-", " ").split())
    if not normalized:
        return None
    return BUSINESS_TYPE_ALIASES.get(normalized)


def _normalize_business_types(values: Optional[list[str]]) -> Optional[list[str]]:
    if not values:
        return None

    normalized_values: list[str] = []
    seen: set[str] = set()
    for raw in values:
        normalized = _normalize_business_type(str(raw))
        if not normalized:
            continue
        key = normalized.lower()
        if key in seen:
            continue
        seen.add(key)
        normalized_values.append(normalized)
    return normalized_values or None


def _effective_business_types(user: User | None) -> Optional[list[str]]:
    if user is None:
        return None

    explicit = _normalize_business_types(_parse_categories(getattr(user, "business_types", None)))
    if explicit:
        return explicit

    legacy_categories = _parse_categories(getattr(user, "categories", None))
    return _normalize_business_types(legacy_categories)


def _effective_product_categories(user: User | None) -> Optional[list[str]]:
    if user is None:
        return None

    explicit = _clean_string_list(_parse_categories(getattr(user, "product_categories", None)))
    if explicit:
        return explicit

    return _clean_string_list(_parse_categories(getattr(user, "categories", None)))


def _get_owner_profile_user(user: User, db: Session | None) -> User | None:
    if db is None or is_admin(user) or not user.created_by:
        return None
    return db.query(User).filter(User.id == user.created_by).first()


def _ordered_branch_names(primary_location: Optional[str], branches: Optional[list[str]]) -> list[str]:
    ordered: list[str] = []
    seen: set[str] = set()

    for raw_name in [primary_location, *(branches or [])]:
        name = str(raw_name or "").strip()
        if not name:
            continue
        normalized = name.lower()
        if normalized in seen:
            continue
        seen.add(normalized)
        ordered.append(name)

    return ordered


def _verify_recaptcha_or_raise(token: Optional[str]) -> None:
    secret = (os.getenv("RECAPTCHA_SECRET_KEY") or "").strip()
    if not secret:
        return

    if not token:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Please complete the reCAPTCHA checkbox")

    payload = urllib.parse.urlencode({"secret": secret, "response": token}).encode("utf-8")
    request = urllib.request.Request(
        "https://www.google.com/recaptcha/api/siteverify",
        data=payload,
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            verification = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not verify reCAPTCHA") from exc

    if not verification.get("success"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="reCAPTCHA verification failed. Use a reCAPTCHA v2 checkbox site key and secret.",
        )


def _serialize_user(user: User, db: Session | None = None) -> UserResponse:
    owner = _get_owner_profile_user(user, db)
    business_types = _effective_business_types(user) or _effective_business_types(owner)
    product_categories = _effective_product_categories(user) or _effective_product_categories(owner)

    return UserResponse(
        id=user.id,
        email=user.email,
        phone=getattr(user, "phone", None),
        name=user.name,
        role=get_effective_role_name(user),
        permissions=get_role_permissions(user),
        business_name=user.business_name,
        business_logo_url=getattr(user, "business_logo_url", None),
        business_types=business_types,
        product_categories=product_categories,
        categories=product_categories,
        branch_id=getattr(user, "branch_id", None),
        is_active=user.is_active,
    )


def _normalize_email(email: str) -> str:
    return email.strip().lower()


class Token(BaseModel):
    access_token: str
    token_type: str
    user: UserResponse


def _build_token_response(user: User, db: Session | None = None) -> dict[str, object]:
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user.email}, expires_delta=access_token_expires
    )
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": _serialize_user(user, db),
    }


class TokenData(BaseModel):
    email: Optional[str] = None


def _parse_list_input(value: object) -> Optional[list[str]]:
    if value is None:
        return None
    if isinstance(value, list):
        cleaned = [str(v).strip() for v in value if str(v).strip()]
        return cleaned or None
    if isinstance(value, str):
        raw = value.strip()
        if not raw:
            return None
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list):
                cleaned = [str(v).strip() for v in parsed if str(v).strip()]
                return cleaned or None
        except Exception:
            pass
        cleaned = [v.strip() for v in raw.split(",") if v.strip()]
        return cleaned or None
    return None


async def _parse_signup_request(request: Request) -> tuple[UserCreate, UploadFile | StarletteUploadFile | None]:
    content_type = (request.headers.get("content-type") or "").lower()
    if "multipart/form-data" in content_type:
        form = await request.form()
        email = str(form.get("email") or "").strip()
        phone = str(form.get("phone") or "").strip() or None
        name = str(form.get("name") or "").strip()
        password = str(form.get("password") or "")
        business_name = str(form.get("business_name") or "").strip() or None
        business_location = str(form.get("business_location") or "").strip() or None
        recaptcha_token = str(form.get("recaptcha_token") or "").strip() or None
        business_types = _parse_list_input(form.get("business_types"))
        product_categories = _parse_list_input(form.get("product_categories"))
        categories = _parse_list_input(form.get("categories"))
        branches = _parse_list_input(form.get("branches"))
        logo_file = form.get("business_logo")
        if not isinstance(logo_file, (UploadFile, StarletteUploadFile)):
            logo_file = None
        user_data = UserCreate(
            email=email,
            phone=phone,
            name=name,
            password=password,
            business_name=business_name,
            business_location=business_location,
            recaptcha_token=recaptcha_token,
            business_types=business_types,
            product_categories=product_categories,
            categories=categories,
            branches=branches,
        )
        return user_data, logo_file

    payload = await request.json()
    user_data = UserCreate(**payload)
    return user_data, None


class PasswordResetRequest(BaseModel):
    email: EmailStr


class PasswordResetRequestResponse(BaseModel):
    message: str
    reset_code: Optional[str] = None


class PasswordResetConfirm(BaseModel):
    email: EmailStr
    code: str
    new_password: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class DeleteAccountRequest(BaseModel):
    current_password: str


class UpdateMeRequest(BaseModel):
    business_types: Optional[list[str]] = None
    product_categories: Optional[list[str]] = None
    # Legacy compatibility alias for product_categories.
    categories: Optional[list[str]] = None


@router.post("/signup", response_model=Token, status_code=status.HTTP_201_CREATED)
async def signup(request: Request, db: Session = Depends(get_db)):
    """Register a new user."""
    user_data, logo_file = await _parse_signup_request(request)
    _verify_recaptcha_or_raise(user_data.recaptcha_token)
    email = _normalize_email(str(user_data.email))
    # Check if user already exists
    existing_user = db.query(User).filter(User.email == email).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )

    phone = normalize_phone(user_data.phone)
    if user_data.phone and not is_valid_phone(user_data.phone):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Phone number is invalid")
    if phone:
        existing_phone_user = db.query(User).filter(User.phone == phone).first()
        if existing_phone_user:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Phone number already registered")
    
    rule_error = get_password_rule_error(user_data.password)
    if rule_error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=rule_error)

    supabase_user_id: str | None = None
    if is_supabase_auth_sync_enabled():
        try:
            auth_user = create_auth_user(
                email=email,
                password=user_data.password,
                name=user_data.name,
                phone=phone,
            )
            supabase_user_id = auth_user.user_id
        except SupabaseAuthError as exc:
            # Surface duplicate-email and provisioning failures from Auth.
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST if exc.status_code in {400, 409, 422} else status.HTTP_502_BAD_GATEWAY,
                detail=str(exc),
            ) from exc

    logo_url: str | None = None
    if logo_file is not None:
        if not is_supabase_storage_enabled():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Logo upload is not configured")
        if not (logo_file.content_type or "").startswith("image/"):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Logo must be an image")
        logo_bytes = await logo_file.read()
        if len(logo_bytes) > 2 * 1024 * 1024:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Logo must be under 2MB")
        try:
            logo_url = upload_public_logo(logo_bytes, logo_file.content_type, logo_file.filename)
        except Exception as exc:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    normalized_business_types = _normalize_business_types(user_data.business_types) or _normalize_business_types(user_data.categories)
    normalized_product_categories = _clean_string_list(user_data.product_categories) or _clean_string_list(user_data.categories)

    new_user = User(
        supabase_user_id=supabase_user_id,
        email=email,
        phone=phone,
        name=user_data.name,
        hashed_password=get_password_hash(user_data.password),
        business_name=user_data.business_name,
        business_logo_url=logo_url,
        categories=json.dumps(normalized_product_categories) if normalized_product_categories else None,
        business_types=json.dumps(normalized_business_types) if normalized_business_types else None,
        product_categories=json.dumps(normalized_product_categories) if normalized_product_categories else None,
        role="Admin",
        is_active=True,
    )

    # The requested business location becomes the first branch name.
    branch_names = _ordered_branch_names(user_data.business_location, user_data.branches)
    if not branch_names:
        branch_names = ["Main Store"]

    try:
        db.add(new_user)
        db.flush()

        for branch_name in branch_names:
            db.add(Branch(owner_user_id=new_user.id, name=branch_name, is_active=True))

        # Create SystemSettings with default values
        db.add(
            SystemSettings(
                owner_user_id=new_user.id,
                uses_expiry_tracking=True,
            )
        )

        db.commit()
        db.refresh(new_user)
    except Exception as exc:
        db.rollback()
        if supabase_user_id:
            try:
                delete_auth_user(supabase_user_id)
            except Exception:
                # Keep original failure path; orphan cleanup can be retried manually.
                pass
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to create user") from exc

    return _build_token_response(new_user, db)


@router.post("/login", response_model=Token)
def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    recaptcha_token: str | None = Form(default=None),
    db: Session = Depends(get_db)
):
    """Login and get access token."""
    _verify_recaptcha_or_raise(recaptcha_token)
    # username field accepts either email or phone number.
    identifier = (form_data.username or "").strip()
    if not identifier:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email/phone or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    email = _normalize_email(identifier)
    phone = normalize_phone(identifier)
    if "@" in identifier:
        user = db.query(User).filter(User.email == email).first()
    elif phone:
        user = db.query(User).filter(or_(User.phone == phone, User.email == email)).first()
    else:
        user = db.query(User).filter(User.email == email).first()
    
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email/phone or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Inactive user"
        )

    # Email verification disabled.
    
    return _build_token_response(user, db)


@router.get("/me", response_model=UserResponse)
def get_current_user_info(
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Get current user information"""
    return _serialize_user(current_user, db)


@router.put("/me", response_model=UserResponse)
def update_current_user_info(
    payload: UpdateMeRequest,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Update current user's info.

    Supports updating business types and product categories (Admin only).
    """
    next_product_categories = payload.product_categories if payload.product_categories is not None else payload.categories
    if next_product_categories is None and payload.business_types is None:
        return _serialize_user(current_user, db)

    ensure_permission(current_user, "manage_business_profile", "Only Admin can update business profile")

    if payload.business_types is not None:
        normalized_business_types = _normalize_business_types(payload.business_types)
        current_user.business_types = json.dumps(normalized_business_types) if normalized_business_types else None

    if next_product_categories is not None:
        cleaned_product_categories = _clean_string_list(next_product_categories)
        serialized_categories = json.dumps(cleaned_product_categories) if cleaned_product_categories else None
        current_user.product_categories = serialized_categories
        current_user.categories = serialized_categories
    db.add(current_user)
    db.commit()
    db.refresh(current_user)
    return _serialize_user(current_user, db)


@router.post("/me/logo", response_model=UserResponse)
async def upload_business_logo(
    logo: UploadFile = File(...),
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    ensure_permission(current_user, "manage_business_profile", "Only Admin can update business logo")

    if not is_supabase_storage_enabled():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Logo upload is not configured")

    if not (logo.content_type or "").startswith("image/"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Logo must be an image")

    logo_bytes = await logo.read()
    if len(logo_bytes) > 2 * 1024 * 1024:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Logo must be under 2MB")

    try:
        logo_url = upload_public_logo(logo_bytes, logo.content_type, logo.filename)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    current_user.business_logo_url = logo_url
    db.add(current_user)
    db.commit()
    db.refresh(current_user)
    return _serialize_user(current_user, db)




@router.post("/password-reset/request", response_model=PasswordResetRequestResponse)
def request_password_reset(payload: PasswordResetRequest, db: Session = Depends(get_db)):
    """Request a password reset code.

    Note: For production, you typically send this code via email/SMS.
    This API can optionally return the code when PASSWORD_RESET_DEBUG=1.
    """
    email = _normalize_email(str(payload.email))
    user = db.query(User).filter(User.email == email).first()

    # Always respond 200 to avoid leaking whether email exists.
    message = "If an account exists for this email, a reset code has been generated."
    if not user or not user.is_active:
        return PasswordResetRequestResponse(message=message)

    code = f"{secrets.randbelow(1_000_000):06d}"
    code_hash = get_password_hash(code)
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=15)

    token = PasswordResetToken(
        user_id=user.id,
        code_hash=code_hash,
        expires_at=expires_at,
        used_at=None,
    )
    db.add(token)
    db.commit()

    if smtp_configured():
        try:
            send_email(
                to_email=email,
                subject="Your Gel Invent Password Reset Code",
                body_text=(
                    f"Hello {user.name},\n\n"
                    f"Your password reset code is: {code}\n"
                    "This code expires in 15 minutes.\n\n"
                    "If you did not request a password reset, you can ignore this email."
                ),
            )
        except Exception as exc:
            # Do not leak account existence or internals to caller.
            print(f"⚠️ Password reset email failed for {email}: {type(exc).__name__}: {exc}")

    debug = os.getenv("PASSWORD_RESET_DEBUG") == "1"
    return PasswordResetRequestResponse(message=message, reset_code=code if debug else None)


@router.post("/password-reset/confirm")
def confirm_password_reset(payload: PasswordResetConfirm, db: Session = Depends(get_db)):
    """Confirm reset code and set a new password."""
    rule_error = get_password_rule_error(payload.new_password)
    if rule_error:
        raise HTTPException(status_code=400, detail=rule_error)

    user = db.query(User).filter(User.email == payload.email).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=400, detail="Invalid reset code")

    now = datetime.now(timezone.utc)

    token = (
        db.query(PasswordResetToken)
        .filter(
            PasswordResetToken.user_id == user.id,
            PasswordResetToken.used_at.is_(None),
            PasswordResetToken.expires_at > now,
        )
        .order_by(PasswordResetToken.created_at.desc())
        .first()
    )

    if not token or not verify_password(payload.code, token.code_hash):
        raise HTTPException(status_code=400, detail="Invalid reset code")

    user.hashed_password = get_password_hash(payload.new_password)
    token.used_at = now
    db.commit()
    return {"message": "Password updated successfully"}


@router.post("/password/change")
def change_password(
    payload: ChangePasswordRequest,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Change password for the currently authenticated user."""
    if not verify_password(payload.current_password, current_user.hashed_password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect")

    rule_error = get_password_rule_error(payload.new_password)
    if rule_error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=rule_error)

    current_user.hashed_password = get_password_hash(payload.new_password)
    db.add(current_user)
    db.commit()
    return {"message": "Password changed successfully"}


@router.delete("/me")
def delete_current_user_account(
    payload: DeleteAccountRequest,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Delete the currently authenticated user's account and tenant data."""
    if not verify_password(payload.current_password, current_user.hashed_password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect")

    supabase_user_id = getattr(current_user, "supabase_user_id", None)

    try:
        db.delete(current_user)
        db.commit()
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to delete account") from exc

    if supabase_user_id:
        try:
            delete_auth_user(supabase_user_id)
        except Exception:
            # Local account is already removed; ignore external cleanup failures.
            pass

    return {"message": "Account deleted successfully"}
