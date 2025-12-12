"""
Multi-tenant utility functions.

This module provides helper functions for tenant-based data filtering.
In this system:
- Admin users can see their own data + data from employees they created
- Employee users can only see data from their admin (creator)
"""

from sqlalchemy.orm import Session
from app import models


def get_tenant_user_ids(current_user: models.User, db: Session) -> list[int]:
    """
    Get all user IDs that belong to the same tenant as the current user.
    
    For Admin users: Returns their own ID + IDs of all employees they created
    For Employee users: Returns their creator's (admin's) ID + all sibling employees
    
    Args:
        current_user: The currently authenticated user
        db: Database session
    
    Returns:
        List of user IDs that share the same tenant
    """
    if current_user.role == "Admin":
        # Admin sees their own data + their employees' data
        employee_ids = db.query(models.User.id).filter(
            models.User.created_by == current_user.id
        ).all()
        user_ids = [current_user.id] + [emp_id[0] for emp_id in employee_ids]
    else:
        # Employee sees data from their admin + sibling employees
        if current_user.created_by:
            # Get the admin who created this employee
            admin_id = current_user.created_by
            # Get all employees under the same admin
            sibling_ids = db.query(models.User.id).filter(
                models.User.created_by == admin_id
            ).all()
            user_ids = [admin_id] + [sib_id[0] for sib_id in sibling_ids]
        else:
            # Fallback: user created by unknown, only see their own data
            user_ids = [current_user.id]
    
    return user_ids
