export type FrontendPermission =
  | "delete_sales"
  | "manage_branches"
  | "manage_business_profile"
  | "manage_catalog"
  | "manage_creditors"
  | "manage_data"
  | "manage_employees"
  | "manage_inventory"
  | "manage_procurement"
  | "manage_settings"
  | "process_returns"
  | "process_sales"
  | "send_sale_receipts"
  | "transfer_stock_between_branches"
  | "view_catalog"
  | "view_creditors"
  | "view_inventory"
  | "view_procurement"
  | "view_reports"
  | "view_revenue"
  | "view_runtime_health";

type EffectiveRole = "Admin" | "Manager" | "Sales";

const ALL_PERMISSIONS = new Set<FrontendPermission>([
  "delete_sales",
  "manage_branches",
  "manage_business_profile",
  "manage_catalog",
  "manage_creditors",
  "manage_data",
  "manage_employees",
  "manage_inventory",
  "manage_procurement",
  "manage_settings",
  "process_returns",
  "process_sales",
  "send_sale_receipts",
  "transfer_stock_between_branches",
  "view_catalog",
  "view_creditors",
  "view_inventory",
  "view_procurement",
  "view_reports",
  "view_revenue",
  "view_runtime_health",
]);

const ROLE_ALIASES: Record<string, EffectiveRole> = {
  admin: "Admin",
  manager: "Manager",
  sales: "Sales",
};

const ROLE_PERMISSIONS: Record<EffectiveRole, readonly FrontendPermission[]> = {
  Admin: [
    "delete_sales",
    "manage_branches",
    "manage_business_profile",
    "manage_catalog",
    "manage_creditors",
    "manage_data",
    "manage_employees",
    "manage_inventory",
    "manage_procurement",
    "manage_settings",
    "process_returns",
    "process_sales",
    "send_sale_receipts",
    "transfer_stock_between_branches",
    "view_catalog",
    "view_creditors",
    "view_inventory",
    "view_procurement",
    "view_reports",
    "view_revenue",
    "view_runtime_health",
  ],
  Manager: [
    "manage_catalog",
    "manage_creditors",
    "manage_inventory",
    "manage_procurement",
    "process_returns",
    "process_sales",
    "send_sale_receipts",
    "view_catalog",
    "view_creditors",
    "view_inventory",
    "view_procurement",
    "view_reports",
    "view_revenue",
  ],
  Sales: [
    "manage_creditors",
    "process_returns",
    "process_sales",
    "send_sale_receipts",
    "view_catalog",
    "view_creditors",
    "view_inventory",
  ],
};

export type StoredUser = {
  id?: number;
  name?: string;
  email?: string;
  phone?: string | null;
  business_name?: string;
  brandmark_url?: string | null;
  business_types?: string[] | null;
  product_categories?: string[] | null;
  categories?: string[] | null;
  role?: string;
  permissions?: FrontendPermission[] | null;
  branch_id?: number | null;
};

export type StoredBusinessInfo = {
  name?: string;
  owner?: string;
  phone?: string;
  email?: string;
  address?: string;
  taxId?: string;
  currency?: string;
  logoUrl?: string;
};

type PermissionAwareUser = Pick<StoredUser, "role" | "permissions"> | null | undefined;

function readStoredString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeRole(role: string | null | undefined): EffectiveRole {
  const value = String(role || "").trim().toLowerCase();
  if (value in ROLE_ALIASES) {
    return ROLE_ALIASES[value];
  }
  if (value === "") {
    return "Admin";
  }
  return "Sales";
}

function normalizePermissions(
  permissions: FrontendPermission[] | string[] | null | undefined,
  fallbackRole: EffectiveRole,
): FrontendPermission[] {
  const normalized = new Set<FrontendPermission>();
  for (const value of permissions ?? []) {
    if (typeof value !== "string") {
      continue;
    }
    if (ALL_PERMISSIONS.has(value as FrontendPermission)) {
      normalized.add(value as FrontendPermission);
    }
  }

  if (normalized.size > 0) {
    return Array.from(normalized).sort();
  }

  return [...ROLE_PERMISSIONS[fallbackRole]];
}

export function getEffectiveUserRole(user: PermissionAwareUser | string | null | undefined): EffectiveRole {
  if (typeof user === "string" || user == null) {
    return normalizeRole(user);
  }
  return normalizeRole(user.role);
}

export function getUserPermissions(user: PermissionAwareUser = readStoredUser()): FrontendPermission[] {
  const role = getEffectiveUserRole(user);
  return normalizePermissions(user?.permissions, role);
}

export function hasUserPermission(permission: FrontendPermission, user: PermissionAwareUser = readStoredUser()): boolean {
  return getUserPermissions(user).includes(permission);
}

export function hasAnyUserPermission(
  permissions: FrontendPermission[],
  user: PermissionAwareUser = readStoredUser(),
): boolean {
  const available = new Set(getUserPermissions(user));
  return permissions.some((permission) => available.has(permission));
}

export function readStoredUser(): StoredUser | null {
  const raw = localStorage.getItem("user");
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as StoredUser;
    const role = getEffectiveUserRole(parsed);
    return {
      ...parsed,
      role,
      permissions: getUserPermissions(parsed),
    };
  } catch {
    return null;
  }
}

export function normalizeBusinessLogoUrl(value: unknown): string | null {
  const rawValue = typeof value === "string" ? value.trim() : "";
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = new URL(rawValue);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.toString();
    }
  } catch {
    return null;
  }

  return null;
}

export function readStoredBusinessInfo(): StoredBusinessInfo | null {
  const raw = localStorage.getItem("businessInfo");
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      name: readStoredString(parsed.name),
      owner: readStoredString(parsed.owner),
      phone: readStoredString(parsed.phone),
      email: readStoredString(parsed.email),
      address: readStoredString(parsed.address),
      taxId: readStoredString(parsed.taxId),
      currency: readStoredString(parsed.currency),
      logoUrl: readStoredString(parsed.logoUrl),
    };
  } catch {
    return null;
  }
}

export function getDisplayBusinessName(user: StoredUser | null = readStoredUser()): string {
  const businessInfo = readStoredBusinessInfo();
  return businessInfo?.name || user?.business_name || "Business";
}

export function getDisplayBusinessLogoUrl(user: StoredUser | null = readStoredUser()): string | null {
  const businessInfo = readStoredBusinessInfo();
  return normalizeBusinessLogoUrl(businessInfo?.logoUrl) ?? normalizeBusinessLogoUrl(user?.brandmark_url);
}