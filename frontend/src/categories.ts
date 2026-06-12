import { useEffect, useMemo, useState } from "react";

export const DEFAULT_CATEGORIES = [
  "Groceries",
  "Beverages",
  "Household",
  "Electronics",
  "Clothing",
  "Health & Beauty",
  "Office Supplies",
  "Tools & Hardware",
  "Sports & Outdoors",
  "Other",
];

// Smart default categories per business type. Mirrors the backend
// BUSINESS_TYPE_CAPABILITIES map so a business sees categories relevant to
// what it actually sells (a construction shop should not default to "Groceries").
// Keys must match the stored business_types values used at signup.
export const BUSINESS_TYPE_CATEGORIES: Record<string, string[]> = {
  Pharmacy: ["Prescription Drugs", "Over-the-Counter", "Supplements & Vitamins", "First Aid", "Personal Care", "Baby Care", "Medical Devices"],
  Grocery: ["Staples & Grains", "Beverages", "Snacks", "Canned & Packaged", "Dairy & Eggs", "Frozen Foods", "Cleaning & Household", "Personal Care"],
  Cosmetics: ["Skincare", "Makeup", "Haircare", "Fragrances", "Nail Care", "Tools & Accessories"],
  Fashion: ["Men's Wear", "Women's Wear", "Kids' Wear", "Footwear", "Bags", "Accessories"],
  Hardware: ["Hand Tools", "Power Tools", "Fasteners", "Plumbing", "Electrical", "Paint & Adhesives", "Safety Gear"],
  "Construction Materials": ["Cement & Aggregates", "Steel & Rods", "Roofing", "Blocks & Bricks", "Plumbing", "Electrical", "Tiles & Finishing"],
  Agro: ["Seeds", "Fertilizers", "Pesticides", "Animal Feed", "Farm Tools", "Irrigation"],
  Electronics: ["Phones & Tablets", "Computers", "Accessories", "Audio", "TV & Home", "Cables & Chargers"],
};

const uniqCaseInsensitive = (values: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const v = raw.trim();
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(v);
  }
  return result;
};

const readStringListField = (record: Record<string, unknown>, fieldName: string): string[] => {
  const value = record[fieldName];

  if (Array.isArray(value)) {
    return uniqCaseInsensitive(value.map((item) => String(item)));
  }

  if (typeof value === "string") {
    return uniqCaseInsensitive(value.split(",").map((item) => item.trim()));
  }

  return [];
};

export const readUserCategories = (): string[] => {
  try {
    const raw = localStorage.getItem("user");
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];

    const record = parsed as Record<string, unknown>;
    const productCategories = readStringListField(record, "product_categories");
    if (productCategories.length > 0) {
      return productCategories;
    }

    // Fallback for legacy user payloads that still only expose `categories`.
    return readStringListField(record, "categories");
  } catch {
    return [];
  }
};

export const readUserBusinessTypes = (): string[] => {
  try {
    const raw = localStorage.getItem("user");
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
    return readStringListField(parsed as Record<string, unknown>, "business_types");
  } catch {
    return [];
  }
};

// Union of relevant categories for the given business types (+ "Other"),
// falling back to the generic defaults when no business type maps.
export const categoriesForBusinessTypes = (types: string[]): string[] => {
  const collected: string[] = [];
  for (const type of types) {
    const mapped = BUSINESS_TYPE_CATEGORIES[type.trim()];
    if (mapped) collected.push(...mapped);
  }
  if (collected.length === 0) return DEFAULT_CATEGORIES;
  return uniqCaseInsensitive([...collected, "Other"]);
};

// Smart fallback used when a business hasn't set its own categories yet.
export const getDefaultCategoriesForUser = (): string[] => categoriesForBusinessTypes(readUserBusinessTypes());

// Business types that deal in perishable / dated stock and therefore need
// expiry tracking. Mirrors the backend BUSINESS_TYPE_CAPABILITIES expiry map.
export const EXPIRY_TRACKING_BUSINESS_TYPES = new Set<string>([
  "Pharmacy",
  "Grocery",
  "Cosmetics",
  "Agro",
]);

// Whether the given business types call for expiry tracking. When no business
// type is set we return true so legacy accounts keep their existing behavior.
export const businessTypesNeedExpiry = (types: string[]): boolean => {
  if (types.length === 0) return true;
  return types.some((type) => EXPIRY_TRACKING_BUSINESS_TYPES.has(type.trim()));
};

export const userNeedsExpiryTracking = (): boolean => businessTypesNeedExpiry(readUserBusinessTypes());

// Business types where customers commonly pay in full but leave goods in the
// store to collect later (e.g. bags of cement, animal feed). These need supply
// tracking so the app stock and the physical store stock can be reconciled.
export const SUPPLY_TRACKING_BUSINESS_TYPES = new Set<string>([
  "Construction Materials",
  "Agro",
  "Hardware",
]);

// Whether the given business types call for supply / collect-later tracking.
// Unlike expiry, this defaults OFF for accounts with no business type set so
// the toggle/tab stay hidden unless a relevant business type is chosen.
export const businessTypesNeedSupplyTracking = (types: string[]): boolean => {
  if (types.length === 0) return false;
  return types.some((type) => SUPPLY_TRACKING_BUSINESS_TYPES.has(type.trim()));
};

export const userNeedsSupplyTracking = (): boolean =>
  businessTypesNeedSupplyTracking(readUserBusinessTypes());

export const getAppCategories = (): string[] => {
  const userCats = readUserCategories();
  // No custom categories yet → fall back to categories relevant to the business type.
  return userCats.length > 0 ? uniqCaseInsensitive(userCats) : getDefaultCategoriesForUser();
};

export const useAppCategories = (): string[] => {
  const [userCategories, setUserCategories] = useState<string[]>(() => readUserCategories());

  useEffect(() => {
    const update = () => setUserCategories(readUserCategories());

    const handleStorage = (e: StorageEvent) => {
      if (e.key === "user") update();
    };

    const handleUserChanged = () => update();

    window.addEventListener("storage", handleStorage);
    window.addEventListener("userChanged", handleUserChanged);

    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("userChanged", handleUserChanged);
    };
  }, []);

  return useMemo(
    () => {
      // No custom categories yet → fall back to categories relevant to the business type.
      return userCategories.length > 0
        ? uniqCaseInsensitive(userCategories)
        : getDefaultCategoriesForUser();
    },
    [userCategories],
  );
};
