from datetime import timedelta, datetime, timezone
from typing import Optional
import json
import secrets
import os

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel, EmailStr
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User, PasswordResetToken, Branch, SystemSettings
from app.auth import (
    create_access_token,
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

router = APIRouter(prefix="/auth", tags=["auth"])


def _password_rule_error(password: str) -> Optional[str]:
    if len(password) < 8:
        return "Password must be at least 8 characters."
    if not any(c.islower() for c in password):
        return "Password must include a lowercase letter."
    if not any(c.isupper() for c in password):
        return "Password must include an uppercase letter."
    if not any(c.isdigit() for c in password):
        return "Password must include a number."
    if not any(not c.isalnum() for c in password):
        return "Password must include a special character."
    return None


# Schemas
class UserCreate(BaseModel):
    email: EmailStr
    phone: Optional[str] = None
    name: str
    password: str
    business_name: Optional[str] = None
    categories: Optional[list[str]] = None
    branches: Optional[list[str]] = None  # Optional list of branch names


class UserResponse(BaseModel):
    id: int
    email: str
    phone: Optional[str] = None
    name: str
    role: str
    business_name: Optional[str] = None
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


def _serialize_user(user: User) -> UserResponse:
    return UserResponse(
        id=user.id,
        email=user.email,
        phone=getattr(user, "phone", None),
        name=user.name,
        role=user.role,
        business_name=user.business_name,
        categories=_parse_categories(getattr(user, "categories", None)),
        branch_id=getattr(user, "branch_id", None),
        is_active=user.is_active,
    )


def _normalize_email(email: str) -> str:
    return email.strip().lower()


class Token(BaseModel):
    access_token: str
    token_type: str


class TokenData(BaseModel):
    email: Optional[str] = None


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
    categories: Optional[list[str]] = None


@router.post("/signup", response_model=SignupResponse, status_code=status.HTTP_201_CREATED)
def signup(user_data: UserCreate, db: Session = Depends(get_db)):
    """Register a new user."""
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
    
    rule_error = _password_rule_error(user_data.password)
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

    new_user = User(
        supabase_user_id=supabase_user_id,
        email=email,
        phone=phone,
        name=user_data.name,
        hashed_password=get_password_hash(user_data.password),
        business_name=user_data.business_name,
        categories=json.dumps(user_data.categories) if user_data.categories else None,
        role="Admin",
        is_active=True,
    )

    db.add(new_user)
    try:
        db.commit()
    except Exception as exc:
        db.rollback()
        if supabase_user_id:
            try:
                delete_auth_user(supabase_user_id)
            except Exception:
                pass
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to create user") from exc

    db.refresh(new_user)

    # Create branches based on signup input
    if user_data.branches and len(user_data.branches) > 0:
        # User specified branches - create them
        for branch_name in user_data.branches:
            branch = Branch(owner_user_id=new_user.id, name=branch_name.strip(), is_active=True)
            db.add(branch)
        db.commit()
    else:
        # No branches specified - create a single default branch using business name
        default_name = user_data.business_name.strip() if user_data.business_name else "Main Store"
        branch = Branch(owner_user_id=new_user.id, name=default_name, is_active=True)
        db.add(branch)
        db.commit()

    # Create SystemSettings with default values
    settings = SystemSettings(
        owner_user_id=new_user.id,
        uses_expiry_tracking=True,
    )
    db.add(settings)
    db.commit()

    return SignupResponse(**_serialize_user(new_user).model_dump(), verification_code=None)


@router.post("/login", response_model=Token)
def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db)
):
    """Login and get access token."""
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
    
    # Create access token
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user.email}, expires_delta=access_token_expires
    )
    
    return {"access_token": access_token, "token_type": "bearer"}


@router.get("/me", response_model=UserResponse)
def get_current_user_info(
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Get current user information"""
    # Employees should see the business categories configured by the owner.
    categories = _parse_categories(getattr(current_user, "categories", None))
    if not categories and current_user.role != "Admin" and current_user.created_by:
        owner = db.query(User).filter(User.id == current_user.created_by).first()
        if owner:
            categories = _parse_categories(getattr(owner, "categories", None))

    return UserResponse(
        id=current_user.id,
        email=current_user.email,
        phone=getattr(current_user, "phone", None),
        name=current_user.name,
        role=current_user.role,
        business_name=current_user.business_name,
        categories=categories,
        branch_id=getattr(current_user, "branch_id", None),
        is_active=current_user.is_active,
    )


@router.put("/me", response_model=UserResponse)
def update_current_user_info(
    payload: UpdateMeRequest,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Update current user's info.

    Currently supports updating business categories (Admin only).
    """
    if payload.categories is None:
        return _serialize_user(current_user)

    if current_user.role != "Admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only Admin can update categories")

    cleaned: list[str] = []
    seen = set()
    for raw in payload.categories:
        value = str(raw).strip()
        if not value:
            continue
        key = value.lower()
        if key in seen:
            continue
        seen.add(key)
        cleaned.append(value)

    current_user.categories = json.dumps(cleaned) if cleaned else None
    db.add(current_user)
    db.commit()
    db.refresh(current_user)
    return _serialize_user(current_user)




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
    rule_error = _password_rule_error(payload.new_password)
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

    rule_error = _password_rule_error(payload.new_password)
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
