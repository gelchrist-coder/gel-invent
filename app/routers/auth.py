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
from app.models import User, PasswordResetToken, EmailVerificationToken, Branch, PendingSignup
from app.auth import (
    create_access_token,
    get_password_hash,
    verify_password,
    get_current_active_user,
    ACCESS_TOKEN_EXPIRE_MINUTES,
)
from app.utils.email import send_email, smtp_configured

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
    email_verified: bool = True

    class Config:
        from_attributes = True


class SignupResponse(UserResponse):
    verification_code: Optional[str] = None


class PendingSignupResponse(BaseModel):
    message: str
    email: EmailStr
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
        name=user.name,
        role=user.role,
        business_name=user.business_name,
        categories=_parse_categories(getattr(user, "categories", None)),
        branch_id=getattr(user, "branch_id", None),
        is_active=user.is_active,
        email_verified=getattr(user, "email_verified", True),
    )


def _normalize_email(email: str) -> str:
    return email.strip().lower()


def _send_verification_code(*, user: User, db: Session) -> Optional[str]:
    """Create a verification token and send the code via email.

    Returns the raw code only in debug mode.
    """
    now = datetime.now(timezone.utc)

    # Throttle: 1 code/minute
    recent = (
        db.query(EmailVerificationToken)
        .filter(
            EmailVerificationToken.user_id == user.id,
            EmailVerificationToken.created_at > (now - timedelta(seconds=60)),
        )
        .order_by(EmailVerificationToken.created_at.desc())
        .first()
    )
    if recent:
        return None

    code = f"{secrets.randbelow(1_000_000):06d}"
    token = EmailVerificationToken(
        user_id=user.id,
        code_hash=get_password_hash(code),
        expires_at=now + timedelta(minutes=15),
        used_at=None,
    )
    db.add(token)
    db.commit()

    subject = "Verify your Gel Invent email"
    body = (
        f"Hello {user.name},\n\n"
        f"Your Gel Invent verification code is: {code}\n\n"
        "This code expires in 15 minutes.\n"
        "If you did not create an account, you can ignore this email.\n"
    )

    if smtp_configured():
        send_email(to_email=user.email, subject=subject, body_text=body)

    debug = os.getenv("EMAIL_VERIFICATION_DEBUG") == "1"
    return code if debug else None


def _send_pending_signup_code(*, pending: PendingSignup, db: Session) -> Optional[str]:
    """Send/refresh a verification code for a pending signup.

    Returns the raw code only in debug mode.
    """
    now = datetime.now(timezone.utc)

    # Throttle: 1 code/minute
    if pending.code_sent_at and pending.code_sent_at > (now - timedelta(seconds=60)):
        return None

    code = f"{secrets.randbelow(1_000_000):06d}"
    pending.code_hash = get_password_hash(code)
    pending.code_expires_at = now + timedelta(minutes=15)
    pending.code_sent_at = now
    pending.code_used_at = None

    db.add(pending)
    db.commit()
    db.refresh(pending)

    subject = "Verify your Gel Invent email"
    body = (
        f"Hello {pending.name},\n\n"
        f"Your Gel Invent verification code is: {code}\n\n"
        "This code expires in 15 minutes.\n"
        "If you did not create an account, you can ignore this email.\n"
    )

    if smtp_configured():
        send_email(to_email=pending.email, subject=subject, body_text=body)

    debug = os.getenv("EMAIL_VERIFICATION_DEBUG") == "1"
    return code if debug else None


class EmailVerifyRequest(BaseModel):
    email: EmailStr
    code: str


class EmailResendRequest(BaseModel):
    email: EmailStr


class EmailResendResponse(BaseModel):
    message: str
    verification_code: Optional[str] = None


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


@router.post("/signup", response_model=PendingSignupResponse, status_code=status.HTTP_201_CREATED)
def signup(user_data: UserCreate, db: Session = Depends(get_db)):
    """Start signup by emailing a verification code.

    NOTE: This does NOT create a User record until email is verified.
    """
    email = _normalize_email(str(user_data.email))
    # Check if user already exists
    existing_user = db.query(User).filter(User.email == email).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )
    
    rule_error = _password_rule_error(user_data.password)
    if rule_error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=rule_error)

    now = datetime.now(timezone.utc)
    pending = db.query(PendingSignup).filter(PendingSignup.email == email).first()
    if not pending:
        code = f"{secrets.randbelow(1_000_000):06d}"
        pending = PendingSignup(
            email=email,
            name=user_data.name,
            hashed_password=get_password_hash(user_data.password),
            business_name=user_data.business_name,
            categories=json.dumps(user_data.categories) if user_data.categories else None,
            code_hash=get_password_hash(code),
            code_expires_at=now + timedelta(minutes=15),
            code_sent_at=now,
            code_used_at=None,
        )
        db.add(pending)
        db.commit()
        db.refresh(pending)

        # Send email
        verification_code: Optional[str] = None
        try:
            subject = "Verify your Gel Invent email"
            body = (
                f"Hello {pending.name},\n\n"
                f"Your Gel Invent verification code is: {code}\n\n"
                "This code expires in 15 minutes.\n"
                "If you did not create an account, you can ignore this email.\n"
            )
            if smtp_configured():
                send_email(to_email=pending.email, subject=subject, body_text=body)
            if os.getenv("EMAIL_VERIFICATION_DEBUG") == "1":
                verification_code = code
        except Exception as e:
            print(f"⚠️  Could not send verification email: {e}")

        return PendingSignupResponse(
            message="Verification code sent. Please verify to complete registration.",
            email=pending.email,
            verification_code=verification_code,
        )

    # Pending already exists: resend (throttled)
    verification_code = None
    try:
        verification_code = _send_pending_signup_code(pending=pending, db=db)
    except Exception as e:
        print(f"⚠️  Could not send verification email: {e}")

    return PendingSignupResponse(
        message="Verification code sent. Please verify to complete registration.",
        email=pending.email,
        verification_code=verification_code,
    )


@router.post("/login", response_model=Token)
def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db)
):
    """Login and get access token"""
    # Find user by email (username field in OAuth2PasswordRequestForm)
    email = _normalize_email(form_data.username)
    user = db.query(User).filter(User.email == email).first()
    
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

    if not getattr(user, "email_verified", True):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Email not verified. Please verify your email.",
        )
    
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
        name=current_user.name,
        role=current_user.role,
        business_name=current_user.business_name,
        categories=categories,
        branch_id=getattr(current_user, "branch_id", None),
        is_active=current_user.is_active,
        email_verified=getattr(current_user, "email_verified", True),
    )


@router.post("/email/verify")
def verify_email(payload: EmailVerifyRequest, db: Session = Depends(get_db)):
    """Verify a user's email using a 6-digit code."""
    email = _normalize_email(str(payload.email))
    now = datetime.now(timezone.utc)

    # Backward-compat: existing users that were created unverified
    user = db.query(User).filter(User.email == email).first()
    if user:
        if not user.is_active:
            raise HTTPException(status_code=400, detail="Invalid verification code")

        if getattr(user, "email_verified", True):
            return {"message": "Email already verified"}

        token = (
            db.query(EmailVerificationToken)
            .filter(
                EmailVerificationToken.user_id == user.id,
                EmailVerificationToken.used_at.is_(None),
                EmailVerificationToken.expires_at > now,
            )
            .order_by(EmailVerificationToken.created_at.desc())
            .first()
        )

        if not token or not verify_password(payload.code, token.code_hash):
            raise HTTPException(status_code=400, detail="Invalid verification code")

        user.email_verified = True
        token.used_at = now
        db.commit()
        return {"message": "Email verified successfully"}

    # New flow: finalize pending signup
    pending = db.query(PendingSignup).filter(PendingSignup.email == email).first()
    if not pending or pending.code_used_at is not None or pending.code_expires_at <= now:
        raise HTTPException(status_code=400, detail="Invalid verification code")

    if not verify_password(payload.code, pending.code_hash):
        raise HTTPException(status_code=400, detail="Invalid verification code")

    # Create the user only after verification
    new_user = User(
        email=pending.email,
        name=pending.name,
        hashed_password=pending.hashed_password,
        business_name=pending.business_name,
        categories=pending.categories,
        role="Admin",
        is_active=True,
        email_verified=True,
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    main_branch = Branch(owner_user_id=new_user.id, name="Main Branch", is_active=True)
    db.add(main_branch)

    pending.code_used_at = now
    db.add(pending)
    db.commit()

    # Cleanup
    try:
        db.delete(pending)
        db.commit()
    except Exception:
        pass

    return {"message": "Email verified successfully"}


@router.post("/email/resend", response_model=EmailResendResponse)
def resend_verification(payload: EmailResendRequest, db: Session = Depends(get_db)):
    """Resend email verification code. Always responds 200 to avoid email enumeration."""
    email = _normalize_email(str(payload.email))
    user = db.query(User).filter(User.email == email).first()

    pending = None
    if not user:
        pending = db.query(PendingSignup).filter(PendingSignup.email == email).first()

    message = "If an account exists for this email, a verification code has been sent."
    if (not user or not user.is_active) and not pending:
        return EmailResendResponse(message=message)

    if user and getattr(user, "email_verified", True):
        return EmailResendResponse(message="Email already verified")

    verification_code: Optional[str] = None

    try:
        if user:
            verification_code = _send_verification_code(user=user, db=db)
        elif pending:
            verification_code = _send_pending_signup_code(pending=pending, db=db)
    except Exception as e:
        print(f"⚠️  Could not send verification email: {e}")

    return EmailResendResponse(message=message, verification_code=verification_code)


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
