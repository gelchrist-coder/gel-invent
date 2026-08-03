from __future__ import annotations

from typing import Final, Literal

from fastapi import HTTPException, status

from app import models

PermissionName = Literal[
    "delete_sales",
    "manage_branches",
    "manage_business_profile",
    "manage_catalog",
    "manage_creditors",
    "manage_data",
    "manage_employees",
    "manage_inventory",
    "manage_warehouses",
    "manage_procurement",
    "manage_settings",
    "process_returns",
    "process_sales",
    "send_sale_receipts",
    "transfer_stock_between_branches",
    "view_catalog",
    "view_creditors",
    "view_inventory",
    "view_warehouses",
    "view_procurement",
    "view_reports",
    "view_revenue",
    "view_runtime_health",
]

ROLE_ALIASES: Final[dict[str, str]] = {
    "admin": "Admin",
    "manager": "Manager",
    "sales": "Sales",
    "custom": "Custom",
    "warehouse": "Warehouse",
    "warehouse manager": "Warehouse",
}

ROLE_PERMISSIONS: Final[dict[str, tuple[PermissionName, ...]]] = {
    "Admin": (
        "delete_sales",
        "manage_branches",
        "manage_business_profile",
        "manage_catalog",
        "manage_creditors",
        "manage_data",
        "manage_employees",
        "manage_inventory",
        "manage_warehouses",
        "manage_procurement",
        "manage_settings",
        "process_returns",
        "process_sales",
        "send_sale_receipts",
        "transfer_stock_between_branches",
        "view_catalog",
        "view_creditors",
        "view_inventory",
        "view_warehouses",
        "view_procurement",
        "view_reports",
        "view_revenue",
        "view_runtime_health",
    ),
    "Manager": (
        "manage_catalog",
        "manage_creditors",
        "manage_inventory",
        "manage_warehouses",
        "manage_procurement",
        "process_returns",
        "process_sales",
        "send_sale_receipts",
        "view_catalog",
        "view_creditors",
        "view_inventory",
        "view_warehouses",
        "view_procurement",
        "view_reports",
        "view_revenue",
    ),
    "Sales": (
        "process_sales",
        "send_sale_receipts",
        "view_catalog",
        "view_inventory",
    ),
    "Custom": (),
    "Warehouse": (
        "manage_procurement",
        "manage_warehouses",
        "view_procurement",
        "view_warehouses",
    ),
}

# Business owners keep sensitive administration permissions to themselves.
# Every other permission can be delegated as an employee responsibility.
OWNER_ONLY_PERMISSIONS: Final[frozenset[PermissionName]] = frozenset({
    "delete_sales",
    "manage_branches",
    "manage_business_profile",
    "manage_data",
    "manage_employees",
    "manage_settings",
    "transfer_stock_between_branches",
    "view_runtime_health",
})
DELEGATABLE_PERMISSIONS: Final[frozenset[PermissionName]] = frozenset(
    permission
    for role_permissions in ROLE_PERMISSIONS.values()
    for permission in role_permissions
    if permission not in OWNER_ONLY_PERMISSIONS
)


def get_effective_role_name(user_or_role: models.User | str | None, *, created_by: int | None = None) -> str:
    role_value = user_or_role
    if isinstance(user_or_role, models.User):
        role_value = user_or_role.role
        created_by = user_or_role.created_by

    normalized = " ".join(str(role_value or "").strip().split())
    alias = ROLE_ALIASES.get(normalized.lower())
    if alias:
        return alias

    if created_by:
        return "Sales"
    return "Admin"


def get_role_permissions(user_or_role: models.User | str | None, *, created_by: int | None = None) -> list[str]:
    role_name = get_effective_role_name(user_or_role, created_by=created_by)
    if isinstance(user_or_role, models.User) and role_name != "Admin":
        overrides = getattr(user_or_role, "permission_overrides", None)
        if isinstance(overrides, list):
            return sorted({
                permission
                for permission in overrides
                if isinstance(permission, str) and permission in DELEGATABLE_PERMISSIONS
            })
    return sorted(ROLE_PERMISSIONS[role_name])


def has_permission(user: models.User, permission: PermissionName) -> bool:
    return permission in get_role_permissions(user)


def ensure_permission(user: models.User, permission: PermissionName, detail: str | None = None) -> None:
    if has_permission(user, permission):
        return

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail=detail or "You do not have permission to perform this action",
    )


def is_admin(user: models.User) -> bool:
    return get_effective_role_name(user) == "Admin"
