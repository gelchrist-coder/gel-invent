from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User, Branch
from app.auth import get_current_active_user, get_password_hash
from app.utils.branch import get_owner_user_id, ensure_main_branch

router = APIRouter(prefix="/employees", tags=["employees"])


# Schemas
class EmployeeCreate(BaseModel):
    email: EmailStr
    name: str
    password: str
    role: str = "Sales"  # Default role for employees
    branch_id: Optional[int] = None


class EmployeeResponse(BaseModel):
    id: int
    email: str
    name: str
    role: str
    branch_id: Optional[int] = None
    is_active: bool
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class EmployeeUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    is_active: Optional[bool] = None
    branch_id: Optional[int] = None


@router.post("/", response_model=EmployeeResponse, status_code=status.HTTP_201_CREATED)
def create_employee(
    employee_data: EmployeeCreate,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db)
):
    """Create a new employee (Owner only)"""
    # Only Owner/Admin can create employees
    if current_user.role != "Admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only business owners can add employees"
        )
    
    email = str(employee_data.email).strip().lower()

    # Check if email already exists
    existing_user = db.query(User).filter(User.email == email).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )
    
    # Create new employee
    owner_user_id = get_owner_user_id(current_user)

    branch_id = employee_data.branch_id
    if branch_id is None:
        branch_id = ensure_main_branch(db, owner_user_id).id
    else:
        branch = (
            db.query(Branch)
            .filter(
                Branch.id == branch_id,
                Branch.owner_user_id == owner_user_id,
                Branch.is_active.is_(True),
            )
            .first()
        )
        if not branch:
            raise HTTPException(status_code=400, detail="Invalid branch")

    hashed_password = get_password_hash(employee_data.password)
    new_employee = User(
        email=email,
        name=employee_data.name,
        hashed_password=hashed_password,
        role=employee_data.role,
        created_by=current_user.id,
        branch_id=branch_id,
        business_name=current_user.business_name,  # Inherit owner's business
        is_active=True,
        email_verified=True,
    )
    
    db.add(new_employee)
    db.commit()
    db.refresh(new_employee)
    
    return new_employee


@router.get("/", response_model=List[EmployeeResponse])
def list_employees(
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db)
):
    """List all employees for the current business owner"""
    # Only Owner/Admin can view employee list
    if current_user.role != "Admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only business owners can view employees"
        )
    
    # Get all employees created by this owner
    employees = db.query(User).filter(User.created_by == current_user.id).all()
    return employees


@router.get("/{employee_id}", response_model=EmployeeResponse)
def get_employee(
    employee_id: int,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db)
):
    """Get a specific employee's details"""
    if current_user.role != "Admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only business owners can view employee details"
        )
    
    employee = db.query(User).filter(
        User.id == employee_id,
        User.created_by == current_user.id
    ).first()
    
    if not employee:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Employee not found"
        )
    
    return employee


@router.patch("/{employee_id}", response_model=EmployeeResponse)
def update_employee(
    employee_id: int,
    employee_data: EmployeeUpdate,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db)
):
    """Update employee details"""
    if current_user.role != "Admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only business owners can update employees"
        )
    
    employee = db.query(User).filter(
        User.id == employee_id,
        User.created_by == current_user.id
    ).first()
    
    if not employee:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Employee not found"
        )
    
    # Update fields
    if employee_data.name is not None:
        employee.name = employee_data.name
    if employee_data.role is not None:
        employee.role = employee_data.role
    if employee_data.is_active is not None:
        employee.is_active = employee_data.is_active
    if employee_data.branch_id is not None:
        owner_user_id = get_owner_user_id(current_user)
        branch = (
            db.query(Branch)
            .filter(
                Branch.id == employee_data.branch_id,
                Branch.owner_user_id == owner_user_id,
                Branch.is_active.is_(True),
            )
            .first()
        )
        if not branch:
            raise HTTPException(status_code=400, detail="Invalid branch")
        employee.branch_id = branch.id
    
    db.commit()
    db.refresh(employee)
    
    return employee


@router.delete("/{employee_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_employee(
    employee_id: int,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db)
):
    """Delete/deactivate an employee"""
    if current_user.role != "Admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only business owners can delete employees"
        )
    
    employee = db.query(User).filter(
        User.id == employee_id,
        User.created_by == current_user.id
    ).first()
    
    if not employee:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Employee not found"
        )
    
    # Soft delete - just deactivate
    employee.is_active = False
    db.commit()
    
    return None
