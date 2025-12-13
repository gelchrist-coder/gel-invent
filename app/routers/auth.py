from datetime import timedelta, datetime, timezone
from typing import Optional
import json
import secrets
import os

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User, PasswordResetToken, Branch
from app.auth import (
    create_access_token,
    get_password_hash,
    verify_password,
    get_current_active_user,
    ACCESS_TOKEN_EXPIRE_MINUTES,
)

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
    name: str
    password: str
    business_name: Optional[str] = None
    categories: Optional[list[str]] = None


class UserResponse(BaseModel):
    id: int
    email: str
    name: str
    role: str
    business_name: Optional[str] = None
    categories: Optional[list[str]] = None
    branch_id: Optional[int] = None
    is_active: bool

    class Config:
        from_attributes = True


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
        name=user.name,
        role=user.role,
        business_name=user.business_name,
        categories=_parse_categories(getattr(user, "categories", None)),
        branch_id=getattr(user, "branch_id", None),
        is_active=user.is_active,
    )


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


@router.post("/signup", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def signup(user_data: UserCreate, db: Session = Depends(get_db)):
    """Register a new user"""
    # Check if user already exists
    existing_user = db.query(User).filter(User.email == user_data.email).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )
    
    rule_error = _password_rule_error(user_data.password)
    if rule_error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=rule_error)

    # Create new user
    hashed_password = get_password_hash(user_data.password)
    new_user = User(
        email=user_data.email,
        name=user_data.name,
        hashed_password=hashed_password,
        business_name=user_data.business_name,
        categories=json.dumps(user_data.categories) if user_data.categories else None,
        role="Admin",
        is_active=True
    )
    
    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    # Ensure every business starts with a default branch.
    main_branch = Branch(owner_user_id=new_user.id, name="Main Branch", is_active=True)
    db.add(main_branch)
    db.commit()
    
    return _serialize_user(new_user)


@router.post("/login", response_model=Token)
def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db)
):
    """Login and get access token"""
    # Find user by email (username field in OAuth2PasswordRequestForm)
    user = db.query(User).filter(User.email == form_data.username).first()
    
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Inactive user"
        )
    
    # Create access token
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user.email}, expires_delta=access_token_expires
    )
    
    return {"access_token": access_token, "token_type": "bearer"}


@router.get("/me", response_model=UserResponse)
def get_current_user_info(current_user: User = Depends(get_current_active_user)):
    """Get current user information"""
    return _serialize_user(current_user)


@router.post("/password-reset/request", response_model=PasswordResetRequestResponse)
def request_password_reset(payload: PasswordResetRequest, db: Session = Depends(get_db)):
    """Request a password reset code.

    Note: For production, you typically send this code via email/SMS.
    This API can optionally return the code when PASSWORD_RESET_DEBUG=1.
    """
    user = db.query(User).filter(User.email == payload.email).first()

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
