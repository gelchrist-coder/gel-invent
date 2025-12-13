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

export const readUserCategories = (): string[] => {
  try {
    const raw = localStorage.getItem("user");
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];

    const record = parsed as Record<string, unknown>;
    const value = record.categories;

    if (Array.isArray(value)) {
      return uniqCaseInsensitive(value.map((c) => String(c)));
    }

    // Fallback if older shape stored categories as a string
    if (typeof value === "string") {
      return uniqCaseInsensitive(value.split(",").map((c) => c.trim()));
    }

    return [];
  } catch {
    return [];
  }
};

export const getAppCategories = (): string[] =>
  uniqCaseInsensitive([...readUserCategories(), ...DEFAULT_CATEGORIES]);

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
    () => uniqCaseInsensitive([...userCategories, ...DEFAULT_CATEGORIES]),
    [userCategories],
  );
};
