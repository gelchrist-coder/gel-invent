import { Branch, NewMovement, NewProduct, NewPurchase, NewPurchaseOrder, NewPurchaseReturn, NewSale, NewSupplier, NewSupplierPayment, Product, Purchase, PurchaseOrder, PurchaseReturn, Sale, StockMovement, Supplier, SupplierDetail, SupplierPayment, SupplierUpdate } from "./types";

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

function isHostedVercelFrontend(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  return window.location.hostname.endsWith(".vercel.app");
}

function resolveApiBaseUrl(): string {
  const configured = (import.meta.env.VITE_API_URL as string | undefined)?.trim();

  // Use the same-origin /api proxy by default. The Vercel frontend rewrites
  // /api/* to the backend, avoiding CORS preflights for authenticated requests.
  if (!configured || configured === "https://your-backend.vercel.app") {
    return "/api";
  }

  // Strip trailing /api if someone included it in the URL — backend routes
  // are mounted at /products, /sales etc., not /api/products, /api/sales.
  const normalized = configured.replace(/\/api\/?$/, "");

  if (isHostedVercelFrontend()) {
    try {
      const configuredUrl = new URL(normalized);
      if (configuredUrl.origin !== window.location.origin) {
        return "/api";
      }
    } catch {
      // Non-URL values like /api should flow through unchanged below.
    }
  }

  return normalized;
}

// API base URL (configure via VITE_API_URL on Vercel/Netlify/etc)
const API_BASE = normalizeBaseUrl(resolveApiBaseUrl());

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
const inflightGetRequests = new Map<string, Promise<unknown>>();
const inflightWarmupRequests = new Map<string, Promise<boolean>>();
const REQUEST_TIMEOUT_MS = 25000;
const GET_REQUEST_TIMEOUT_MS = 35000;
const GET_RETRY_ATTEMPTS = 1;
const STARTUP_REQUEST_TIMEOUT_MS = GET_REQUEST_TIMEOUT_MS;
export const TEMPORARY_SERVER_DELAY_MESSAGE = "Server is taking longer than expected. Please tap Retry.";
export const PURCHASE_RETURNS_NOT_SUPPORTED_MESSAGE = "Purchase returns are not available on this deployment yet.";
const STARTUP_RETRY_STATUS_CODES = new Set([502, 503, 504]);
let purchaseReturnsSupportCache: boolean | null = null;
let purchaseReturnsSupportPromise: Promise<boolean> | null = null;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function isTemporaryServerDelayError(error: unknown): boolean {
  return error instanceof Error && error.message === TEMPORARY_SERVER_DELAY_MESSAGE;
}

export function warmBackend(
  path: string = "/health/db",
  force = false,
  options?: { timeoutMs?: number; probeTimeoutMs?: number; retryIntervalMs?: number },
): Promise<boolean> {
  const separator = path.includes("?") ? "&" : "?";
  const existing = inflightWarmupRequests.get(path);
  const timeoutMs = Math.max(1000, options?.timeoutMs ?? 30000);
  const probeTimeoutMs = Math.max(1000, Math.min(timeoutMs, options?.probeTimeoutMs ?? 10000));
  const retryIntervalMs = Math.max(250, options?.retryIntervalMs ?? 1500);

  if (!force && existing) {
    return existing;
  }

  const request = (async () => {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), probeTimeoutMs);

      try {
        const response = await fetch(`${API_BASE}${path}${separator}ts=${Date.now()}`, {
          cache: "no-store",
          headers: buildAuthHeaders(),
          signal: controller.signal,
        });
        if (response.ok) {
          return true;
        }
      } catch {
        // keep probing until the deadline expires
      } finally {
        window.clearTimeout(timeoutId);
      }

      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        break;
      }
      await delay(Math.min(retryIntervalMs, remainingMs));
    }

    return false;
  })()
    .finally(() => {
      inflightWarmupRequests.delete(path);
    });

  inflightWarmupRequests.set(path, request);
  return request;
}

export async function resilientFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  options?: {
    timeoutMs?: number;
    retries?: number;
    allowWarmupRetry?: boolean;
    warmupPath?: string;
    warmupTimeoutMs?: number;
    warmupProbeTimeoutMs?: number;
    warmupRetryIntervalMs?: number;
  },
): Promise<Response> {
  const method = (init?.method || "GET").toUpperCase();
  const timeoutMs = options?.timeoutMs ?? (method === "GET" ? GET_REQUEST_TIMEOUT_MS : REQUEST_TIMEOUT_MS);
  const retries = Math.max(0, options?.retries ?? 1);
  const maxAttempts = method === "GET" ? retries + 1 : 1;
  const allowWarmupRetry = options?.allowWarmupRetry ?? method === "GET";
  const maxTotalAttempts = maxAttempts + (allowWarmupRetry ? 1 : 0);
  let warmupRetryAvailable = allowWarmupRetry;

  let response: Response | null = null;

  const warmAndRetry = async (): Promise<boolean> => {
    if (!warmupRetryAvailable) {
      return false;
    }

    warmupRetryAvailable = false;
    return warmBackend(options?.warmupPath ?? "/health/db", true, {
      timeoutMs: options?.warmupTimeoutMs ?? 30000,
      probeTimeoutMs: options?.warmupProbeTimeoutMs ?? 10000,
      retryIntervalMs: options?.warmupRetryIntervalMs ?? 1500,
    });
  };

  for (let attempt = 1; attempt <= maxTotalAttempts; attempt += 1) {
    const canRetry = method === "GET" && attempt < maxAttempts;
    const hasAnotherAttempt = attempt < maxTotalAttempts;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

    try {
      response = await fetch(input, {
        ...(init ?? {}),
        method,
        signal: controller.signal,
      });
    } catch (error) {
      if (hasAnotherAttempt && isAbortError(error)) {
        const isReady = await warmAndRetry();
        if (isReady) {
          continue;
        }
      }

      if (hasAnotherAttempt && error instanceof TypeError && navigator.onLine) {
        const isReady = await warmAndRetry();
        if (isReady) {
          continue;
        }
      }

      if (canRetry && (isAbortError(error) || error instanceof TypeError)) {
        await delay(500 * attempt);
        continue;
      }

      if (isAbortError(error)) {
        throw new Error(TEMPORARY_SERVER_DELAY_MESSAGE);
      }

      if (error instanceof TypeError) {
        throw new Error(
          navigator.onLine
            ? "Unable to reach the server right now. Please try again."
            : "You appear to be offline. Please check your internet connection."
        );
      }

      throw error;
    } finally {
      window.clearTimeout(timeout);
    }

    if (!response) {
      continue;
    }

    if (method === "GET" && STARTUP_RETRY_STATUS_CODES.has(response.status)) {
      if (hasAnotherAttempt) {
        const isReady = await warmAndRetry();
        if (isReady) {
          response = null;
          continue;
        }
      }

      if (canRetry) {
        await delay(500 * attempt);
        response = null;
        continue;
      }
    }

    break;
  }

  if (!response) {
    throw new Error("Unable to reach the server right now. Please try again.");
  }

  return response;
}

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
  phone?: string | null;
  name: string;
  role: string;
  business_name?: string | null;
  business_logo_url?: string | null;
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

export async function uploadBusinessLogo(file: File): Promise<AuthUser> {
  const formData = new FormData();
  formData.append("logo", file);

  const response = await resilientFetch(`${API_BASE}/auth/me/logo`, {
    method: "POST",
    headers: buildAuthHeaders(),
    body: formData,
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

  const text = await response.text();
  const updated = text ? (JSON.parse(text) as AuthUser) : ({} as AuthUser);
  localStorage.setItem("user", JSON.stringify(updated));
  window.dispatchEvent(new CustomEvent("userChanged", { detail: updated }));
  return updated;
}

export type SystemSettings = {
  low_stock_threshold: number;
  expiry_warning_days: number;
  uses_expiry_tracking: boolean;
  currency_code: string;
  auto_backup: boolean;
  email_notifications: boolean;
};

type JsonObject = Record<string, unknown>;
type JsonArray = Record<string, unknown>[];
type OpenApiDocument = {
  paths?: Record<string, unknown>;
};

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
  return jsonRequestWithBehavior<T>(path, options);
}

async function jsonRequestWithBehavior<T>(
  path: string,
  options?: RequestInit,
  behavior?: { timeoutMs?: number; retries?: number },
): Promise<T> {
  const token = localStorage.getItem("token");
  const activeBranchId = localStorage.getItem("activeBranchId");
  const method = (options?.method || "GET").toUpperCase();
  const inflightKey = `${method}:${path}:${activeBranchId || "default"}`;

  if (method === "GET") {
    const pending = inflightGetRequests.get(inflightKey);
    if (pending) {
      return pending as Promise<T>;
    }
  }

  const execute = async (): Promise<T> => {
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

    const response = await resilientFetch(
      `${API_BASE}${path}`,
      {
        ...options,
        method,
        headers,
      },
      {
        timeoutMs: behavior?.timeoutMs ?? (method === "GET" ? GET_REQUEST_TIMEOUT_MS : REQUEST_TIMEOUT_MS),
        retries: method === "GET" ? (behavior?.retries ?? GET_RETRY_ATTEMPTS) : 0,
      },
    );

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
  };

  if (method !== "GET") {
    return execute();
  }

  const requestPromise = execute().finally(() => {
    inflightGetRequests.delete(inflightKey);
  });
  inflightGetRequests.set(inflightKey, requestPromise as Promise<unknown>);
  return requestPromise;
}

// Data Export/Import (Admin only)

export async function exportData(): Promise<{ blob: Blob; filename: string | null }> {
  const response = await resilientFetch(`${API_BASE}/data/export`, {
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
  const response = await resilientFetch(`${API_BASE}/data/export/xlsx?days=${encodeURIComponent(String(days))}`, {
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
  const response = await resilientFetch(`${API_BASE}/data/import?force=${force ? "true" : "false"}`,
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
  const cached = getCached<Branch[]>("branches");
  if (cached && isCacheFresh("branches")) {
    return cached;
  }

  const data = await jsonRequest<Branch[]>("/branches");
  setCache("branches", data);
  return data;
}

export async function fetchBranchesCached(onUpdate?: (branches: Branch[]) => void): Promise<Branch[]> {
  const cached = getCached<Branch[]>("branches");
  if (cached) {
    jsonRequest<Branch[]>("/branches")
      .then((fresh) => {
        setCache("branches", fresh);
        if (onUpdate) onUpdate(fresh);
      })
      .catch(() => {});
    return cached;
  }

  const data = await jsonRequest<Branch[]>("/branches");
  setCache("branches", data);
  return data;
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
  return jsonRequestWithBehavior<AuthUser>("/auth/me", undefined, {
    timeoutMs: STARTUP_REQUEST_TIMEOUT_MS,
    retries: 1,
  });
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

export async function deleteMyAccount(payload: {
  current_password: string;
}): Promise<{ message: string }> {
  return jsonRequest<{ message: string }>("/auth/me", {
    method: "DELETE",
    body: JSON.stringify(payload),
  });
}

export async function fetchProducts(): Promise<Product[]> {
  // Return cached data immediately if available
  const cached = getCached<Product[]>("products");
  if (cached && isCacheFresh("products")) {
    return cached;
  }
  
  const data = await jsonRequest<Product[]>("/products");
  setCache("products", data);
  return data;
}

// Fetch products with background refresh - returns cached immediately, refreshes in background
export async function fetchProductsCached(onUpdate?: (products: Product[]) => void): Promise<Product[]> {
  const cached = getCached<Product[]>("products");
  
  // If we have cached data, return it immediately and refresh in background
  if (cached) {
    // Refresh in background
    jsonRequest<Product[]>("/products").then(fresh => {
      setCache("products", fresh);
      if (onUpdate) onUpdate(fresh);
    }).catch(() => { /* ignore background refresh errors */ });
    return cached;
  }
  
  // No cache, fetch fresh
  const data = await jsonRequest<Product[]>("/products");
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
  const result = await jsonRequest<Product>("/products", {
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

export async function sendSalesReceiptEmail(payload: {
  sale_ids: number[];
  to_email: string;
  customer_name?: string;
}): Promise<{ message: string }> {
  return jsonRequest<{ message: string }>("/sales/send-receipt", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export type AssignSaleCustomerPayload = {
  customer_name: string;
  phone?: string;
  email?: string;
  notes?: string;
};

export async function assignSaleCustomer(saleId: number, payload: AssignSaleCustomerPayload): Promise<Sale> {
  const result = await jsonRequest<Sale>(`/sales/${saleId}/customer`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  dataCache.delete(getCacheKey("sales"));
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

// ============ Sale Returns API ============

export type SaleReturn = {
  id: number;
  sale_id: number;
  product_id: number;
  product_name: string | null;
  quantity_returned: number;
  refund_amount: number;
  refund_method: string;
  reason: string | null;
  restock: boolean;
  created_at: string;
  created_by_name: string | null;
};

export type NewSaleReturn = {
  sale_id: number;
  quantity_returned: number;
  refund_amount: number;
  refund_method: string;
  reason?: string;
  restock?: boolean;
};

export async function createSaleReturn(payload: NewSaleReturn): Promise<SaleReturn> {
  const result = await jsonRequest<SaleReturn>("/returns", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  // Invalidate related caches
  dataCache.delete(getCacheKey("sales"));
  dataCache.delete(getCacheKey("products"));
  dataCache.delete(getCacheKey("salesDashboard"));
  dataCache.delete(getCacheKey("inventoryAnalytics"));
  return result;
}

export async function fetchReturns(): Promise<SaleReturn[]> {
  return jsonRequest<SaleReturn[]>("/returns");
}

export async function fetchReturnsForSale(saleId: number): Promise<SaleReturn[]> {
  return jsonRequest<SaleReturn[]>(`/returns/sale/${saleId}`);
}

export async function fetchReturnsSummary(): Promise<{
  total_returns: number;
  total_quantity_returned: number;
  total_refund_amount: number;
}> {
  return jsonRequest("/returns/summary");
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

export async function createBranchTransfer(payload: {
  product_id: number;
  to_branch_id: number;
  quantity: number;
  notes?: string;
}): Promise<{ message: string }> {
  const result = await jsonRequest<{ message: string }>("/inventory/transfers", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  clearDataCache();
  return result;
}

export async function fetchSuppliers(): Promise<Supplier[]> {
  const cached = getCached<Supplier[]>("suppliers");
  if (cached && isCacheFresh("suppliers")) {
    return cached;
  }

  const data = await jsonRequest<Supplier[]>('/inventory/suppliers');
  setCache("suppliers", data);
  return data;
}

export async function fetchSuppliersCached(onUpdate?: (suppliers: Supplier[]) => void): Promise<Supplier[]> {
  const cached = getCached<Supplier[]>("suppliers");
  if (cached) {
    jsonRequest<Supplier[]>('/inventory/suppliers')
      .then((fresh) => {
        setCache("suppliers", fresh);
        if (onUpdate) onUpdate(fresh);
      })
      .catch(() => {});
    return cached;
  }

  return fetchSuppliers();
}

export async function createSupplier(payload: NewSupplier): Promise<Supplier> {
  const result = await jsonRequest<Supplier>('/inventory/suppliers', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  clearDataCache();
  return result;
}

export async function fetchSupplierDetail(supplierId: number): Promise<SupplierDetail> {
  return jsonRequest<SupplierDetail>(`/inventory/suppliers/${supplierId}`);
}

export async function updateSupplier(supplierId: number, payload: SupplierUpdate): Promise<Supplier> {
  const result = await jsonRequest<Supplier>(`/inventory/suppliers/${supplierId}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  clearDataCache();
  return result;
}

export async function deactivateSupplier(supplierId: number): Promise<{ message: string }> {
  const result = await jsonRequest<{ message: string }>(`/inventory/suppliers/${supplierId}`, {
    method: 'DELETE',
  });
  clearDataCache();
  return result;
}

export async function fetchPurchases(limit = 40): Promise<Purchase[]> {
  const cacheKey = `purchases:${limit}`;
  const cached = getCached<Purchase[]>(cacheKey);
  if (cached && isCacheFresh(cacheKey)) {
    return cached;
  }

  const params = new URLSearchParams({ limit: String(limit) });
  const data = await jsonRequest<Purchase[]>(`/inventory/purchases?${params.toString()}`);
  setCache(cacheKey, data);
  return data;
}

export async function fetchPurchasesCached(limit = 40, onUpdate?: (purchases: Purchase[]) => void): Promise<Purchase[]> {
  const cacheKey = `purchases:${limit}`;
  const cached = getCached<Purchase[]>(cacheKey);
  const params = new URLSearchParams({ limit: String(limit) });

  if (cached) {
    jsonRequest<Purchase[]>(`/inventory/purchases?${params.toString()}`)
      .then((fresh) => {
        setCache(cacheKey, fresh);
        if (onUpdate) onUpdate(fresh);
      })
      .catch(() => {});
    return cached;
  }

  return fetchPurchases(limit);
}

export async function createPurchase(payload: NewPurchase): Promise<Purchase> {
  const result = await jsonRequest<Purchase>('/inventory/purchases', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  clearDataCache();
  return result;
}

export async function createPurchaseOrder(payload: NewPurchaseOrder): Promise<PurchaseOrder> {
  const result = await jsonRequest<PurchaseOrder>('/inventory/purchase-orders', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  clearDataCache();
  return result;
}

export async function fetchSupplierPayments(limit = 40): Promise<SupplierPayment[]> {
  const cacheKey = `supplierPayments:${limit}`;
  const cached = getCached<SupplierPayment[]>(cacheKey);
  if (cached && isCacheFresh(cacheKey)) {
    return cached;
  }

  const params = new URLSearchParams({ limit: String(limit) });
  const data = await jsonRequest<SupplierPayment[]>(`/inventory/supplier-payments?${params.toString()}`);
  setCache(cacheKey, data);
  return data;
}

export async function fetchSupplierPaymentsCached(
  limit = 40,
  onUpdate?: (payments: SupplierPayment[]) => void,
): Promise<SupplierPayment[]> {
  const cacheKey = `supplierPayments:${limit}`;
  const cached = getCached<SupplierPayment[]>(cacheKey);
  const params = new URLSearchParams({ limit: String(limit) });

  if (cached) {
    jsonRequest<SupplierPayment[]>(`/inventory/supplier-payments?${params.toString()}`)
      .then((fresh) => {
        setCache(cacheKey, fresh);
        if (onUpdate) onUpdate(fresh);
      })
      .catch(() => {});
    return cached;
  }

  return fetchSupplierPayments(limit);
}

export async function createSupplierPayment(payload: NewSupplierPayment): Promise<SupplierPayment> {
  const result = await jsonRequest<SupplierPayment>('/inventory/supplier-payments', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  clearDataCache();
  return result;
}

export async function supportsPurchaseReturns(force = false): Promise<boolean> {
  if (!force && purchaseReturnsSupportCache != null) {
    return purchaseReturnsSupportCache;
  }

  if (!force && purchaseReturnsSupportPromise) {
    return purchaseReturnsSupportPromise;
  }

  const request = (async () => {
    try {
      const response = await resilientFetch(`${API_BASE}/openapi.json`, {
        method: "GET",
        headers: buildAuthHeaders(),
      });

      if (!response.ok) {
        purchaseReturnsSupportCache = false;
        return false;
      }

      const text = await response.text();
      if (!text) {
        purchaseReturnsSupportCache = false;
        return false;
      }

      const openApi = JSON.parse(text) as OpenApiDocument;
      const supported = Object.prototype.hasOwnProperty.call(openApi.paths ?? {}, "/inventory/purchase-returns");
      purchaseReturnsSupportCache = supported;
      return supported;
    } catch {
      purchaseReturnsSupportCache = false;
      return false;
    } finally {
      purchaseReturnsSupportPromise = null;
    }
  })();

  purchaseReturnsSupportPromise = request;
  return request;
}

export async function fetchPurchaseReturns(limit = 40): Promise<PurchaseReturn[]> {
  const cacheKey = `purchaseReturns:${limit}`;
  const supported = await supportsPurchaseReturns();
  if (!supported) {
    setCache(cacheKey, []);
    return [];
  }

  const cached = getCached<PurchaseReturn[]>(cacheKey);
  if (cached && isCacheFresh(cacheKey)) {
    return cached;
  }

  const params = new URLSearchParams({ limit: String(limit) });
  const data = await jsonRequest<PurchaseReturn[]>(`/inventory/purchase-returns?${params.toString()}`);
  setCache(cacheKey, data);
  return data;
}

export async function fetchPurchaseReturnsCached(
  limit = 40,
  onUpdate?: (purchaseReturns: PurchaseReturn[]) => void,
): Promise<PurchaseReturn[]> {
  const cacheKey = `purchaseReturns:${limit}`;
  const supported = await supportsPurchaseReturns();
  if (!supported) {
    setCache(cacheKey, []);
    if (onUpdate) onUpdate([]);
    return [];
  }

  const cached = getCached<PurchaseReturn[]>(cacheKey);
  const params = new URLSearchParams({ limit: String(limit) });

  if (cached) {
    jsonRequest<PurchaseReturn[]>(`/inventory/purchase-returns?${params.toString()}`)
      .then((fresh) => {
        setCache(cacheKey, fresh);
        if (onUpdate) onUpdate(fresh);
      })
      .catch(() => {});
    return cached;
  }

  return fetchPurchaseReturns(limit);
}

export async function createPurchaseReturn(payload: NewPurchaseReturn): Promise<PurchaseReturn> {
  const supported = await supportsPurchaseReturns();
  if (!supported) {
    throw new Error(PURCHASE_RETURNS_NOT_SUPPORTED_MESSAGE);
  }

  const result = await jsonRequest<PurchaseReturn>('/inventory/purchase-returns', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  clearDataCache();
  return result;
}

// Settings API

export async function fetchSystemSettings(): Promise<SystemSettings> {
  const cached = getCached<SystemSettings>("systemSettings");
  if (cached && isCacheFresh("systemSettings")) {
    return cached;
  }

  const data = await jsonRequest<SystemSettings>("/settings/system");
  setCache("systemSettings", data);
  return data;
}

export async function fetchSystemSettingsCached(onUpdate?: (settings: SystemSettings) => void): Promise<SystemSettings> {
  const cached = getCached<SystemSettings>("systemSettings");
  if (cached) {
    jsonRequest<SystemSettings>("/settings/system")
      .then((fresh) => {
        setCache("systemSettings", fresh);
        if (onUpdate) onUpdate(fresh);
      })
      .catch(() => {});
    return cached;
  }

  const data = await jsonRequest<SystemSettings>("/settings/system");
  setCache("systemSettings", data);
  return data;
}

export async function updateSystemSettings(payload: SystemSettings): Promise<SystemSettings> {
  const updated = await jsonRequest<SystemSettings>("/settings/system", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
  setCache("systemSettings", updated);
  return updated;
}

export async function convertBusinessCurrency(payload: {
  target_currency: string;
  convert_existing: boolean;
}): Promise<{
  currency_code: string;
  previous_currency: string;
  conversion_rate: number;
  converted_existing: boolean;
}> {
  const result = await jsonRequest<{
    currency_code: string;
    previous_currency: string;
    conversion_rate: number;
    converted_existing: boolean;
  }>("/settings/system/currency/convert", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  // Refresh cached settings after conversion.
  try {
    const fresh = await jsonRequest<SystemSettings>("/settings/system");
    setCache("systemSettings", fresh);
  } catch {
    // non-blocking
  }

  return result;
}

export type MovementsQuery = {
  days?: number;
  reason?: string;
  startDate?: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD
};

export async function fetchAllMovements(query: MovementsQuery = {}): Promise<JsonArray> {
  const days = query.days ?? 30;
  const reason = query.reason;
  const startDate = query.startDate;
  const endDate = query.endDate;

  const cacheKey = `movements:${startDate || ""}:${endDate || ""}:${days}:${reason || ""}`;
  const cached = getCached<JsonArray>(cacheKey);
  if (cached && isCacheFresh(cacheKey)) {
    return cached;
  }

  const params = new URLSearchParams();
  if (startDate || endDate) {
    if (startDate) params.append("start_date", startDate);
    if (endDate) params.append("end_date", endDate);
  } else {
    params.append("days", days.toString());
  }
  if (reason) params.append("reason", reason);

  const data = await jsonRequest<JsonArray>(`/inventory/movements?${params.toString()}`);
  setCache(cacheKey, data);
  return data;
}

export async function exportMovementsPdf(
  query: { days?: number; startDate?: string; endDate?: string } = {},
  movementType?: string,
): Promise<Blob> {
  const params = new URLSearchParams();
  if (query.startDate || query.endDate) {
    if (query.startDate) params.append("start_date", query.startDate);
    if (query.endDate) params.append("end_date", query.endDate);
  } else {
    params.append("days", String(query.days ?? 30));
  }
  if (movementType && movementType !== "all") {
    params.append("movement_type", movementType);
  }
  
  const headers = buildAuthHeaders();
  
  const resp = await resilientFetch(`${API_BASE}/inventory/movements/export-pdf?${params.toString()}`, {
    method: "GET",
    headers,
  });
  
  if (!resp.ok) {
    const errorText = await resp.text();
    throw new Error(errorText || `Failed to export PDF: ${resp.status}`);
  }
  
  return resp.blob();
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
  const data = await jsonRequestWithBehavior<JsonObject>(`/revenue/analytics?${params.toString()}`, undefined, {
    timeoutMs: STARTUP_REQUEST_TIMEOUT_MS,
    retries: 1,
  });
  setCache(cacheKey, data);
  return data;
}

// Reports API

export async function fetchSalesDashboard(filterDate?: string): Promise<JsonObject> {
  // Don't use cache if custom date is specified
  if (!filterDate) {
    const cached = getCached<JsonObject>("salesDashboard");
    if (cached && isCacheFresh("salesDashboard")) {
      return cached;
    }
  }
  
  const url = filterDate 
    ? `/reports/sales-dashboard?filter_date=${filterDate}` 
    : "/reports/sales-dashboard";
  
  const data = await jsonRequestWithBehavior<JsonObject>(url, undefined, {
    timeoutMs: STARTUP_REQUEST_TIMEOUT_MS,
    retries: 1,
  });
  
  // Only cache if no custom date
  if (!filterDate) {
    setCache("salesDashboard", data);
  }
  return data;
}

export async function fetchInventoryStatusReport(): Promise<JsonObject> {
  return jsonRequestWithBehavior<JsonObject>("/reports/inventory-status", undefined, {
    timeoutMs: STARTUP_REQUEST_TIMEOUT_MS,
    retries: 1,
  });
}

export async function fetchCreditorsSummaryReport(): Promise<JsonObject> {
  return jsonRequestWithBehavior<JsonObject>("/reports/creditors-summary", undefined, {
    timeoutMs: STARTUP_REQUEST_TIMEOUT_MS,
    retries: 1,
  });
}
