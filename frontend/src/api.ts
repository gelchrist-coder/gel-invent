import { Branch, NewMovement, NewProduct, NewSale, Product, Sale, StockMovement } from "./types";

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

// API base URL (configure via VITE_API_URL on Vercel/Netlify/etc)
const API_BASE = normalizeBaseUrl(
  (import.meta.env.VITE_API_URL as string | undefined) ?? "https://gel-invent-production.up.railway.app"
);

// Export for use in other components
export { API_BASE };

// ============ DATA CACHE FOR INSTANT NAVIGATION ============
// Cache data to make sidebar navigation feel instant
type CacheEntry<T> = {
  data: T;
  timestamp: number;
  branchId: string | null;
};

const dataCache = new Map<string, CacheEntry<unknown>>();
const CACHE_TTL = 30000; // 30 seconds - data is considered fresh

function getCacheKey(key: string): string {
  const branchId = localStorage.getItem("activeBranchId");
  return `${key}:${branchId || "default"}`;
}

function getCached<T>(key: string): T | null {
  const cacheKey = getCacheKey(key);
  const entry = dataCache.get(cacheKey) as CacheEntry<T> | undefined;
  if (!entry) return null;
  
  const branchId = localStorage.getItem("activeBranchId");
  if (entry.branchId !== branchId) return null;
  
  return entry.data;
}

function setCache<T>(key: string, data: T): void {
  const cacheKey = getCacheKey(key);
  const branchId = localStorage.getItem("activeBranchId");
  dataCache.set(cacheKey, { data, timestamp: Date.now(), branchId });
}

function isCacheFresh(key: string): boolean {
  const cacheKey = getCacheKey(key);
  const entry = dataCache.get(cacheKey);
  if (!entry) return false;
  return Date.now() - entry.timestamp < CACHE_TTL;
}

export function clearDataCache(): void {
  dataCache.clear();
}

// Get cached data synchronously (for instant UI population)
export function getCachedProducts(): Product[] | null {
  return getCached<Product[]>("products");
}

export function getCachedSales(): Sale[] | null {
  return getCached<Sale[]>("sales");
}

// Clear cache when branch changes
window.addEventListener("activeBranchChanged", () => {
  dataCache.clear();
});
// ============ END DATA CACHE ============

export type AuthUser = {
  id: number;
  email: string;
  name: string;
  role: string;
  business_name?: string | null;
  categories?: string[] | null;
  branch_id?: number | null;
  is_active: boolean;
};

export async function updateMyCategories(categories: string[]): Promise<AuthUser> {
  const updated = await jsonRequest<AuthUser>("/auth/me", {
    method: "PUT",
    body: JSON.stringify({ categories }),
  });
  localStorage.setItem("user", JSON.stringify(updated));
  window.dispatchEvent(new CustomEvent("userChanged", { detail: updated }));
  return updated;
}

export type SystemSettings = {
  low_stock_threshold: number;
  expiry_warning_days: number;
  auto_backup: boolean;
  email_notifications: boolean;
};

type JsonObject = Record<string, unknown>;
type JsonArray = Record<string, unknown>[];

type StockMovementResponse = Omit<StockMovement, "change"> & { change: string | number };

export function buildAuthHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = localStorage.getItem("token");
  const activeBranchId = localStorage.getItem("activeBranchId");
  const headers: Record<string, string> = { ...(extra ?? {}) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (activeBranchId) {
    const parsed = Number.parseInt(activeBranchId, 10);
    if (Number.isFinite(parsed) && parsed > 0) headers["X-Branch-Id"] = String(parsed);
  }
  return headers;
}

async function jsonRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem("token");
  const activeBranchId = localStorage.getItem("activeBranchId");
  const headers: Record<string, string> = { 
    "Content-Type": "application/json", 
    ...(options?.headers as Record<string, string> ?? {}) 
  };
  
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  if (activeBranchId) {
    const parsed = Number.parseInt(activeBranchId, 10);
    if (Number.isFinite(parsed) && parsed > 0) headers["X-Branch-Id"] = String(parsed);
  }
  
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    if (response.status === 401) {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      window.dispatchEvent(new CustomEvent("userChanged", { detail: null }));
      throw new Error("Not authenticated");
    }
    const body = await response.text();
    try {
      const parsed = body ? (JSON.parse(body) as Record<string, unknown>) : {};
      const detail = parsed?.detail ?? parsed?.message;
      const message = typeof detail === "string" ? detail : response.statusText;
      throw new Error(message || "Request failed");
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(body || response.statusText);
      }
      throw error;
    }
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  if (!text) {
    return undefined as T;
  }
  return JSON.parse(text) as T;
}

// Data Export/Import (Admin only)

export async function exportData(): Promise<{ blob: Blob; filename: string | null }> {
  const response = await fetch(`${API_BASE}/data/export`, {
    method: "GET",
    headers: buildAuthHeaders(),
  });

  if (!response.ok) {
    if (response.status === 401) {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      window.dispatchEvent(new CustomEvent("userChanged", { detail: null }));
      throw new Error("Not authenticated");
    }
    const body = await response.text();
    try {
      const parsed = body ? (JSON.parse(body) as Record<string, unknown>) : {};
      const detail = parsed?.detail ?? parsed?.message;
      const message = typeof detail === "string" ? detail : response.statusText;
      throw new Error(message || "Request failed");
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(body || response.statusText);
      }
      throw error;
    }
  }

  const blob = await response.blob();
  const contentDisposition = response.headers.get("content-disposition");
  let filename: string | null = null;
  if (contentDisposition) {
    const match = contentDisposition.match(/filename="?([^";]+)"?/i);
    if (match?.[1]) filename = match[1];
  }
  return { blob, filename };
}

export async function exportDataXlsx(days: number = 30): Promise<{ blob: Blob; filename: string | null }> {
  const response = await fetch(`${API_BASE}/data/export/xlsx?days=${encodeURIComponent(String(days))}`, {
    method: "GET",
    headers: buildAuthHeaders(),
  });

  if (!response.ok) {
    if (response.status === 401) {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      window.dispatchEvent(new CustomEvent("userChanged", { detail: null }));
      throw new Error("Not authenticated");
    }
    const body = await response.text();
    try {
      const parsed = body ? (JSON.parse(body) as Record<string, unknown>) : {};
      const detail = parsed?.detail ?? parsed?.message;
      const message = typeof detail === "string" ? detail : response.statusText;
      throw new Error(message || "Request failed");
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(body || response.statusText);
      }
      throw error;
    }
  }

  const blob = await response.blob();
  const contentDisposition = response.headers.get("content-disposition");
  let filename: string | null = null;
  if (contentDisposition) {
    const match = contentDisposition.match(/filename="?([^";]+)"?/i);
    if (match?.[1]) filename = match[1];
  }
  return { blob, filename };
}

export async function importData(payload: unknown, force: boolean = false): Promise<{ message: string }> {
  const response = await fetch(`${API_BASE}/data/import?force=${force ? "true" : "false"}`,
    {
      method: "POST",
      headers: buildAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    }
  );

  if (!response.ok) {
    if (response.status === 401) {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      window.dispatchEvent(new CustomEvent("userChanged", { detail: null }));
      throw new Error("Not authenticated");
    }
    const body = await response.text();
    let message = response.statusText || "Request failed";
    try {
      const parsed = body ? (JSON.parse(body) as Record<string, unknown>) : {};
      const detail = parsed?.detail ?? parsed?.message;
      if (typeof detail === "string" && detail.trim()) message = detail;
    } catch {
      if (body?.trim()) message = body;
    }
    throw new Error(`${response.status}: ${message}`);
  }

  const text = await response.text();
  if (!text) return { message: "Import completed" };
  return JSON.parse(text) as { message: string };
}

// Branches API

export async function fetchBranches(): Promise<Branch[]> {
  return jsonRequest<Branch[]>("/branches");
}

export async function createBranch(payload: { name: string }): Promise<Branch> {
  return jsonRequest<Branch>("/branches", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateBranch(branchId: number, payload: { name: string }): Promise<Branch> {
  return jsonRequest<Branch>(`/branches/${branchId}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function deleteBranch(branchId: number): Promise<{ message: string }> {
  return jsonRequest<{ message: string }>(`/branches/${branchId}`, {
    method: "DELETE",
  });
}

export async function fetchMe(): Promise<AuthUser> {
  return jsonRequest<AuthUser>("/auth/me");
}

export async function changePassword(payload: {
  current_password: string;
  new_password: string;
}): Promise<{ message: string }> {
  return jsonRequest<{ message: string }>("/auth/password/change", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function fetchProducts(): Promise<Product[]> {
  // Return cached data immediately if available
  const cached = getCached<Product[]>("products");
  if (cached && isCacheFresh("products")) {
    return cached;
  }
  
  const data = await jsonRequest<Product[]>("/products/");
  setCache("products", data);
  return data;
}

// Fetch products with background refresh - returns cached immediately, refreshes in background
export async function fetchProductsCached(onUpdate?: (products: Product[]) => void): Promise<Product[]> {
  const cached = getCached<Product[]>("products");
  
  // If we have cached data, return it immediately and refresh in background
  if (cached) {
    // Refresh in background
    jsonRequest<Product[]>("/products/").then(fresh => {
      setCache("products", fresh);
      if (onUpdate) onUpdate(fresh);
    }).catch(() => { /* ignore background refresh errors */ });
    return cached;
  }
  
  // No cache, fetch fresh
  const data = await jsonRequest<Product[]>("/products/");
  setCache("products", data);
  return data;
}

export async function fetchMovements(productId: number): Promise<StockMovement[]> {
  const data = await jsonRequest<StockMovementResponse[]>(`/products/${productId}/movements`);
  return data.map((m) => ({ ...m, change: Number(m.change) }));
}

export async function createProduct(payload: NewProduct, branchIdOverride?: number | null): Promise<Product> {
  const headers: Record<string, string> = {};
  if (branchIdOverride != null) {
    headers["X-Branch-Id"] = String(branchIdOverride);
  }
  const result = await jsonRequest<Product>("/products/", {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  // Invalidate products cache
  dataCache.delete(getCacheKey("products"));
  return result;
}

export async function createMovement(
  productId: number,
  payload: NewMovement,
): Promise<StockMovement> {
  const data = await jsonRequest<StockMovementResponse>(`/products/${productId}/movements`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  // Invalidate caches since stock changed
  dataCache.delete(getCacheKey("products"));
  dataCache.delete(getCacheKey("inventoryAnalytics"));
  return { ...data, change: Number(data.change) };
}

export async function updateProduct(id: number, updates: Partial<Product>): Promise<Product> {
  const result = await jsonRequest<Product>(`/products/${id}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
  // Invalidate products cache since data changed
  dataCache.delete(getCacheKey("products"));
  return result;
}

export async function deleteProduct(productId: number): Promise<void> {
  await jsonRequest<void>(`/products/${productId}`, { method: "DELETE" });
  // Invalidate products cache
  dataCache.delete(getCacheKey("products"));
}

// Sales API

export async function fetchSales(): Promise<Sale[]> {
  // Return cached data immediately if available
  const cached = getCached<Sale[]>("sales");
  if (cached && isCacheFresh("sales")) {
    return cached;
  }
  
  const data = await jsonRequest<Sale[]>("/sales");
  setCache("sales", data);
  return data;
}

// Fetch sales with background refresh
export async function fetchSalesCached(onUpdate?: (sales: Sale[]) => void): Promise<Sale[]> {
  const cached = getCached<Sale[]>("sales");
  
  if (cached) {
    // Refresh in background
    jsonRequest<Sale[]>("/sales").then(fresh => {
      setCache("sales", fresh);
      if (onUpdate) onUpdate(fresh);
    }).catch(() => {});
    return cached;
  }
  
  const data = await jsonRequest<Sale[]>("/sales");
  setCache("sales", data);
  return data;
}

export async function createSale(payload: NewSale): Promise<Sale> {
  const result = await jsonRequest<Sale>("/sales", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  // Invalidate related caches
  dataCache.delete(getCacheKey("sales"));
  dataCache.delete(getCacheKey("products"));
  dataCache.delete(getCacheKey("salesDashboard"));
  return result;
}

export async function createSalesBulk(payloads: NewSale[]): Promise<Sale[]> {
  const result = await jsonRequest<Sale[]>("/sales/bulk", {
    method: "POST",
    body: JSON.stringify(payloads),
  });
  // Invalidate related caches
  dataCache.delete(getCacheKey("sales"));
  dataCache.delete(getCacheKey("products"));
  dataCache.delete(getCacheKey("salesDashboard"));
  return result;
}

export async function createSaleForBranch(payload: NewSale, branchIdOverride: string | number | null): Promise<Sale> {
  const headers: Record<string, string> = {};
  if (branchIdOverride != null) {
    headers["X-Branch-Id"] = String(branchIdOverride);
  }
  const result = await jsonRequest<Sale>("/sales", {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  // Invalidate related caches
  dataCache.delete(getCacheKey("sales"));
  dataCache.delete(getCacheKey("products"));
  dataCache.delete(getCacheKey("salesDashboard"));
  return result;
}

export async function deleteSale(saleId: number): Promise<void> {
  await jsonRequest<void>(`/sales/${saleId}`, { method: "DELETE" });
  // Invalidate related caches
  dataCache.delete(getCacheKey("sales"));
  dataCache.delete(getCacheKey("products"));
  dataCache.delete(getCacheKey("salesDashboard"));
}

// Inventory API

export async function fetchInventoryAnalytics(): Promise<JsonObject> {
  const cached = getCached<JsonObject>("inventoryAnalytics");
  if (cached && isCacheFresh("inventoryAnalytics")) {
    return cached;
  }
  
  const data = await jsonRequest<JsonObject>("/inventory/analytics");
  setCache("inventoryAnalytics", data);
  return data;
}

// Settings API

export async function fetchSystemSettings(): Promise<SystemSettings> {
  return jsonRequest<SystemSettings>("/settings/system");
}

export async function updateSystemSettings(payload: SystemSettings): Promise<SystemSettings> {
  return jsonRequest<SystemSettings>("/settings/system", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function fetchAllMovements(days: number = 30, location?: string, reason?: string): Promise<JsonArray> {
  const cacheKey = `movements:${days}:${location || ""}:${reason || ""}`;
  const cached = getCached<JsonArray>(cacheKey);
  if (cached && isCacheFresh(cacheKey)) {
    return cached;
  }
  
  const params = new URLSearchParams({ days: days.toString() });
  if (location) params.append("location", location);
  if (reason) params.append("reason", reason);
  const data = await jsonRequest<JsonArray>(`/inventory/movements?${params.toString()}`);
  setCache(cacheKey, data);
  return data;
}

// Revenue API

export async function fetchRevenueAnalytics(period: string = "30d", startDate?: string, endDate?: string): Promise<JsonObject> {
  const cacheKey = `revenue:${period}:${startDate || ""}:${endDate || ""}`;
  const cached = getCached<JsonObject>(cacheKey);
  if (cached && isCacheFresh(cacheKey)) {
    return cached;
  }
  
  const params = new URLSearchParams({ period });
  if (startDate) params.append("start_date", startDate);
  if (endDate) params.append("end_date", endDate);
  const data = await jsonRequest<JsonObject>(`/revenue/analytics?${params.toString()}`);
  setCache(cacheKey, data);
  return data;
}

// Reports API

export async function fetchSalesDashboard(): Promise<JsonObject> {
  const cached = getCached<JsonObject>("salesDashboard");
  if (cached && isCacheFresh("salesDashboard")) {
    return cached;
  }
  
  const data = await jsonRequest<JsonObject>("/reports/sales-dashboard");
  setCache("salesDashboard", data);
  return data;
}
