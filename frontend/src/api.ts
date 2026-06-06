import {
  Branch,
  NewMovement,
  NewProduct,
  NewPurchaseOrder,
  NewPurchaseReturn,
  NewSale,
  NewSupplier,
  NewSupplierPayment,
  Product,
  ProductUpdate,
  Purchase,
  PurchaseOrder,
  PurchaseReturn,
  Sale,
  SaleBatchOption,
  StockMovement,
  Supplier,
  SupplierPayment,
} from "./types";

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

const PLACEHOLDER_API_URL = "https://your-backend.vercel.app";
const SAME_ORIGIN_API_BASE = "/api";

function isAbsoluteHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

function hasConfiguredApiBase(url: string): boolean {
  return url.length > 0 && url !== PLACEHOLDER_API_URL;
}

function normalizeApiPath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

function resolveApiBaseUrl(): string {
  const configured = normalizeBaseUrl((import.meta.env.VITE_API_URL as string | undefined)?.trim() || "");

  // Respect an explicit backend URL in any environment. When none is set,
  // fall back to same-origin /api so local Vite proxy and host rewrites still work.
  if (hasConfiguredApiBase(configured)) {
    return configured;
  }

  return "/api";
}

// API base URL (configure via VITE_API_URL on Vercel/Netlify/etc)
const API_BASE = normalizeBaseUrl(resolveApiBaseUrl());

export function buildApiUrl(path: string, base: string = API_BASE): string {
  return `${normalizeBaseUrl(base)}${normalizeApiPath(path)}`;
}

function canRetryViaSameOriginProxy(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  if (!isAbsoluteHttpUrl(API_BASE)) {
    return false;
  }

  return normalizeBaseUrl(window.location.origin) !== normalizeBaseUrl(API_BASE);
}

function isTransportAccessError(error: unknown): boolean {
  if (error instanceof TypeError) {
    return true;
  }

  return error instanceof Error && /failed to fetch|networkerror|access_denied|err_access_denied/i.test(error.message);
}

export async function fetchWithSameOriginApiFallback(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(buildApiUrl(path), init);
  } catch (error) {
    if (!canRetryViaSameOriginProxy() || !isTransportAccessError(error)) {
      throw error;
    }

    return fetch(buildApiUrl(path, SAME_ORIGIN_API_BASE), init);
  }
}

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
const REQUEST_TIMEOUT_MS = 45000;
const REPORT_REQUEST_TIMEOUT_MS = 60000;
const GET_RETRY_ATTEMPTS = 2;
const COLD_START_RETRY_STATUS_CODES = new Set([500, 502, 503, 504]);
const COLD_START_WARM_TIMEOUT_MS = 90000;
const COLD_START_WARM_PROBE_TIMEOUT_MS = 35000;
const COLD_START_WARM_RETRY_INTERVAL_MS = 2000;
const AUTH_LOGOUT_GRACE_MS = 120000;
const AUTH_LAST_LOGIN_AT_KEY = "lastSuccessfulLoginAt";

function shouldDeferLogoutForUnauthorized(): boolean {
  const raw = localStorage.getItem(AUTH_LAST_LOGIN_AT_KEY);
  if (!raw) return false;
  const ts = Number(raw);
  if (!Number.isFinite(ts) || ts <= 0) return false;
  return Date.now() - ts < AUTH_LOGOUT_GRACE_MS;
}

function clearAuthSession(): void {
  localStorage.removeItem("token");
  localStorage.removeItem("user");
  window.dispatchEvent(new CustomEvent("userChanged", { detail: null }));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export async function resilientFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  options?: { timeoutMs?: number; retries?: number },
): Promise<Response> {
  const timeoutMs = options?.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const retries = Math.max(0, options?.retries ?? 1);
  const method = (init?.method || "GET").toUpperCase();
  const maxAttempts = method === "GET" ? retries + 1 : 1;

  let response: Response | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

    try {
      response = await fetch(input, {
        ...(init ?? {}),
        method,
        signal: controller.signal,
      });
    } catch (error) {
      const canRetry = method === "GET" && attempt < maxAttempts;
      if (canRetry && (isAbortError(error) || error instanceof TypeError)) {
        await delay(500 * attempt);
        continue;
      }

      if (isAbortError(error)) {
        throw new Error("Server is taking longer than expected. Please tap Retry.");
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

    if (method === "GET" && [502, 503, 504].includes(response.status) && attempt < maxAttempts) {
      await delay(500 * attempt);
      response = null;
      continue;
    }

    break;
  }

  if (!response) {
    throw new Error("Unable to reach the server right now. Please try again.");
  }

  return response;
}

export function isTemporaryServerDelayError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("server is taking longer than expected") ||
    message.includes("server is still starting up") ||
    message.includes("temporarily unavailable while the server finishes starting up")
  );
}

export async function warmBackend(
  path: string,
  waitForHealthy: boolean = false,
  options?: {
    timeoutMs?: number;
    probeTimeoutMs?: number;
    retryIntervalMs?: number;
  },
): Promise<boolean> {
  const overallTimeoutMs = options?.timeoutMs ?? 20000;
  const probeTimeoutMs = options?.probeTimeoutMs ?? 5000;
  const retryIntervalMs = options?.retryIntervalMs ?? 1200;
  const startedAt = Date.now();
  const targetPath = path.startsWith("http://") || path.startsWith("https://")
    ? path
    : `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;

  do {
    try {
      const response = await resilientFetch(
        targetPath,
        {
          method: "GET",
          headers: buildAuthHeaders(),
        },
        {
          timeoutMs: probeTimeoutMs,
          retries: 0,
        },
      );

      if (response.ok) {
        return true;
      }

      if (!waitForHealthy && response.status < 500) {
        return false;
      }
    } catch (error) {
      if (!waitForHealthy && !isTemporaryServerDelayError(error)) {
        return false;
      }
    }

    if (!waitForHealthy) {
      return false;
    }

    if (Date.now() - startedAt >= overallTimeoutMs) {
      break;
    }

    await delay(retryIntervalMs);
  } while (Date.now() - startedAt < overallTimeoutMs);

  return false;
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

function invalidateCachePrefix(prefix: string): void {
  for (const key of Array.from(dataCache.keys())) {
    if (key.startsWith(`${prefix}:`)) {
      dataCache.delete(key);
    }
  }
}

function invalidatePurchasingCaches(options?: { includeProducts?: boolean }): void {
  invalidateCachePrefix("suppliers");
  invalidateCachePrefix("purchases");
  invalidateCachePrefix("supplierPayments");
  invalidateCachePrefix("purchaseReturns");

  if (options?.includeProducts) {
    dataCache.delete(getCacheKey("products"));
    dataCache.delete(getCacheKey("inventoryAnalytics"));
  }
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
  permissions?: string[] | null;
  business_name?: string | null;
  business_logo_url?: string | null;
  business_types?: string[] | null;
  product_categories?: string[] | null;
  // Legacy compatibility alias for product_categories.
  categories?: string[] | null;
  branch_id?: number | null;
  is_active: boolean;
};

type UploadBusinessLogoOptions = {
  sourceInput?: HTMLInputElement | null;
};

type BrandingImageFormMessage = {
  type: "branding-image-upload-result";
  ok: boolean;
  request_id?: string | null;
  user?: AuthUser | null;
  error?: string | null;
};

function isBrandingImageFormMessage(data: unknown): data is BrandingImageFormMessage {
  if (!data || typeof data !== "object") {
    return false;
  }

  const candidate = data as Record<string, unknown>;
  return candidate.type === "branding-image-upload-result";
}

function readBrandingImageFormPayload(iframe: HTMLIFrameElement): BrandingImageFormMessage | null {
  try {
    const doc = iframe.contentDocument;
    const payloadNode = doc?.getElementById("branding-upload-result");
    const rawPayload = payloadNode?.textContent?.trim();
    if (!rawPayload) {
      return null;
    }

    const parsed = JSON.parse(rawPayload) as unknown;
    return isBrandingImageFormMessage(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function uploadBusinessLogoViaNativeForm(sourceInput: HTMLInputElement): Promise<AuthUser> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("Native logo upload is unavailable in this environment.");
  }

  const token = localStorage.getItem("token");
  if (!token) {
    throw new Error("Not authenticated");
  }

  if (!sourceInput.files || sourceInput.files.length === 0) {
    throw new Error("Please choose a logo file.");
  }

  const originalParent = sourceInput.parentNode;
  if (!originalParent) {
    throw new Error("Unable to access the selected logo file.");
  }

  const originalNextSibling = sourceInput.nextSibling;
  const originalName = sourceInput.name;
  const requestId = `branding-upload-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const iframe = document.createElement("iframe");
  iframe.name = `${requestId}-target`;
  iframe.style.display = "none";

  const form = document.createElement("form");
  form.method = "POST";
  form.enctype = "multipart/form-data";
  form.action = buildApiUrl("/auth/me/branding-image-form", SAME_ORIGIN_API_BASE);
  form.target = iframe.name;
  form.style.display = "none";

  const tokenInput = document.createElement("input");
  tokenInput.type = "hidden";
  tokenInput.name = "access_token";
  tokenInput.value = token;

  const requestIdInput = document.createElement("input");
  requestIdInput.type = "hidden";
  requestIdInput.name = "request_id";
  requestIdInput.value = requestId;

  const restoreSourceInput = () => {
    sourceInput.name = originalName;
    if (sourceInput.parentNode !== form) {
      return;
    }

    if (originalNextSibling && originalNextSibling.parentNode === originalParent) {
      originalParent.insertBefore(sourceInput, originalNextSibling);
      return;
    }

    originalParent.appendChild(sourceInput);
  };

  return await new Promise<AuthUser>((resolve, reject) => {
    let settled = false;
    let hasSubmitted = false;

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener("message", handleMessage);
      iframe.removeEventListener("load", handleLoad);
      restoreSourceInput();
      iframe.remove();
      form.remove();
    };

    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      callback();
    };

    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) {
        return;
      }
      if (!isBrandingImageFormMessage(event.data)) {
        return;
      }
      if (event.data.request_id !== requestId) {
        return;
      }

      if (event.data.ok && event.data.user) {
        finish(() => resolve(event.data.user));
        return;
      }

      finish(() => reject(new Error(event.data.error || "Failed to update logo.")));
    };

    const handleLoad = () => {
      if (!hasSubmitted) {
        return;
      }

      const payload = readBrandingImageFormPayload(iframe);
      if (!payload || payload.request_id !== requestId) {
        return;
      }

      if (payload.ok && payload.user) {
        finish(() => resolve(payload.user));
        return;
      }

      finish(() => reject(new Error(payload.error || "Failed to update logo.")));
    };

    const timeoutId = window.setTimeout(() => {
      finish(() => reject(new Error("Logo upload timed out. Please try again.")));
    }, 60000);

    window.addEventListener("message", handleMessage);
    iframe.addEventListener("load", handleLoad);

    sourceInput.name = "logo";
    form.appendChild(tokenInput);
    form.appendChild(requestIdInput);
    form.appendChild(sourceInput);
    document.body.appendChild(iframe);
    document.body.appendChild(form);

    try {
      hasSubmitted = true;
      form.submit();
    } catch (error) {
      finish(() => reject(error instanceof Error ? error : new Error("Failed to submit logo upload.")));
    }
  });
}

export async function updateMyCategories(categories: string[]): Promise<AuthUser> {
  const updated = await jsonRequest<AuthUser>("/auth/me", {
    method: "PUT",
    body: JSON.stringify({ product_categories: categories, categories }),
  });
  localStorage.setItem("user", JSON.stringify(updated));
  window.dispatchEvent(new CustomEvent("userChanged", { detail: updated }));
  return updated;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

async function readFileAsDataUrl(file: File): Promise<string> {
  const contentType = file.type || "application/octet-stream";

  if (typeof file.arrayBuffer === "function") {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      return `data:${contentType};base64,${encodeBase64(bytes)}`;
    } catch {
      // Fall back to FileReader for browsers that expose File but fail arrayBuffer reads.
    }
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => reject(new Error("Could not read logo file"));
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("Could not read logo file"));
    };

    reader.readAsDataURL(file);
  });
}

export async function uploadBusinessLogo(file: File, options?: UploadBusinessLogoOptions): Promise<AuthUser> {
  if (options?.sourceInput) {
    return uploadBusinessLogoViaNativeForm(options.sourceInput);
  }

  const token = localStorage.getItem("token");
  const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};
  const shouldPreferSameOrigin = typeof window !== "undefined"
    && isAbsoluteHttpUrl(API_BASE)
    && normalizeBaseUrl(window.location.origin) !== normalizeBaseUrl(API_BASE);

  const sendBrandingUpload = async (requestInit: RequestInit) => {
    if (shouldPreferSameOrigin) {
      try {
        return await fetch(buildApiUrl("/auth/me/branding-image", SAME_ORIGIN_API_BASE), requestInit);
      } catch (error) {
        if (!isTransportAccessError(error)) {
          throw error;
        }
      }
    }

    return fetchWithSameOriginApiFallback("/auth/me/branding-image", requestInit);
  };

  const requestMultipartBrandingUpload = async () => {
    const formData = new FormData();
    formData.append("logo", file);

    return sendBrandingUpload({
      method: "POST",
      headers: authHeaders,
      body: formData,
    });
  };

  const requestJsonBrandingUpload = async () => {
    const requestInit: RequestInit = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders,
      },
      body: JSON.stringify({
        data_base64: await readFileAsDataUrl(file),
        content_type: file.type || null,
        filename: file.name || null,
      }),
    };

    return sendBrandingUpload(requestInit);
  };

  const requestUpload = async () => {
    try {
      const multipartResponse = await requestMultipartBrandingUpload();
      if (![400, 404, 405, 415, 422].includes(multipartResponse.status)) {
        return multipartResponse;
      }
    } catch (error) {
      if (!isTransportAccessError(error)) {
        throw error;
      }
    }

    try {
      return await requestJsonBrandingUpload();
    } catch (error) {
      if (error instanceof Error && error.message === "Could not read logo file") {
        throw new Error("Logo upload could not prepare the selected file in this browser.");
      }
      throw error;
    }
  };

  let response: Response;

  try {
    response = await requestUpload();

    if (response.status >= 500) {
      const isReady = await warmBackend("/health/db", true, {
        timeoutMs: COLD_START_WARM_TIMEOUT_MS,
        probeTimeoutMs: COLD_START_WARM_PROBE_TIMEOUT_MS,
        retryIntervalMs: COLD_START_WARM_RETRY_INTERVAL_MS,
      });

      if (!isReady) {
        throw new Error("Logo upload is temporarily unavailable while the server starts up. Please try again in a moment.");
      }

      response = await requestUpload();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    const shouldWarmAndRetry =
      isTemporaryServerDelayError(error)
      || message.includes("unable to reach the server right now")
      || message.includes("server is taking longer than expected");

    if (!shouldWarmAndRetry) {
      throw error;
    }

    const isReady = await warmBackend("/health/db", true, {
      timeoutMs: COLD_START_WARM_TIMEOUT_MS,
      probeTimeoutMs: COLD_START_WARM_PROBE_TIMEOUT_MS,
      retryIntervalMs: COLD_START_WARM_RETRY_INTERVAL_MS,
    });

    if (!isReady) {
      throw new Error("Logo upload is temporarily unavailable while the server starts up. Please try again in a moment.");
    }

    response = await requestUpload();
  }

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
      throw new Error(message || "Failed to upload logo");
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(body || response.statusText || "Failed to upload logo");
      }
      throw error;
    }
  }

  const updated = await response.json() as AuthUser;
  localStorage.setItem("user", JSON.stringify(updated));
  window.dispatchEvent(new CustomEvent("userChanged", { detail: updated }));
  return updated;
}

export type SystemSettings = {
  capability_overrides: CapabilityOverrides;
  effective_capabilities: CapabilityMap;
  low_stock_threshold: number;
  expiry_warning_days: number;
  uses_expiry_tracking: boolean;
  currency_code: string;
  auto_backup: boolean;
  email_notifications: boolean;
};

export type CapabilityKey =
  | "expiry_tracking"
  | "batch_tracking"
  | "variants"
  | "size_color_variants"
  | "brand_shade_attributes"
  | "unit_conversions"
  | "fractional_sales"
  | "length_based_sales";

export type CapabilityMap = Record<CapabilityKey, boolean>;
export type CapabilityOverrides = Partial<CapabilityMap>;

export const DEFAULT_EFFECTIVE_CAPABILITIES: CapabilityMap = {
  expiry_tracking: true,
  batch_tracking: false,
  variants: false,
  size_color_variants: false,
  brand_shade_attributes: false,
  unit_conversions: false,
  fractional_sales: false,
  length_based_sales: false,
};

export type SystemSettingsUpdate = {
  low_stock_threshold: number;
  expiry_warning_days: number;
  uses_expiry_tracking: boolean;
  capability_overrides?: CapabilityOverrides;
  currency_code: string;
  auto_backup: boolean;
  email_notifications: boolean;
};

type JsonObject = Record<string, unknown>;
type JsonArray = Record<string, unknown>[];

type StockMovementResponse = Omit<StockMovement, "change"> & { change: string | number };
type ProductResponse = Omit<
  Product,
  | "quantity_step"
  | "cost_price"
  | "pack_cost_price"
  | "selling_price"
  | "pack_selling_price"
  | "current_stock"
  | "variants"
  | "unit_conversions"
> & {
  quantity_step?: string | number | null;
  cost_price?: string | number | null;
  pack_cost_price?: string | number | null;
  selling_price?: string | number | null;
  pack_selling_price?: string | number | null;
  current_stock?: string | number | null;
  variants?: Product["variants"];
  unit_conversions?: Array<
    Omit<NonNullable<Product["unit_conversions"]>[number], "base_quantity"> & {
      base_quantity: string | number;
    }
  >;
};

function toOptionalNumber(value: string | number | null | undefined): number | null | undefined {
  if (value == null || value === "") return value ?? undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeProduct(product: ProductResponse): Product {
  return {
    ...product,
    quantity_step: toOptionalNumber(product.quantity_step),
    cost_price: toOptionalNumber(product.cost_price),
    pack_cost_price: toOptionalNumber(product.pack_cost_price),
    selling_price: toOptionalNumber(product.selling_price),
    pack_selling_price: toOptionalNumber(product.pack_selling_price),
    current_stock: toOptionalNumber(product.current_stock),
    variants: (product.variants ?? []).map((variant) => ({
      ...variant,
      attributes_json: variant.attributes_json ?? {},
    })),
    unit_conversions: (product.unit_conversions ?? []).map((conversion) => ({
      ...conversion,
      base_quantity: Number(conversion.base_quantity ?? 0),
    })),
  };
}

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
  return jsonRequestWithBehavior(path, options);
}

async function jsonRequestWithBehavior<T>(
  path: string,
  options?: RequestInit,
  behavior?: { timeoutMs?: number; retries?: number; branchRetryDone?: boolean },
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

    const request = () => resilientFetch(
      `${API_BASE}${path}`,
      {
        ...options,
        method,
        headers,
      },
      {
        timeoutMs: behavior?.timeoutMs ?? REQUEST_TIMEOUT_MS,
        retries: method === "GET" ? (behavior?.retries ?? GET_RETRY_ATTEMPTS) : 0,
      },
    );

    let response: Response;
    try {
      response = await request();
    } catch (error) {
      if (method === "GET" && isTemporaryServerDelayError(error)) {
        const isReady = await warmBackend("/health/db", true, {
          timeoutMs: COLD_START_WARM_TIMEOUT_MS,
          probeTimeoutMs: COLD_START_WARM_PROBE_TIMEOUT_MS,
          retryIntervalMs: COLD_START_WARM_RETRY_INTERVAL_MS,
        });

        if (isReady) {
          response = await request();
        } else {
          throw error;
        }
      } else {
        throw error;
      }
    }

    if (method === "GET" && COLD_START_RETRY_STATUS_CODES.has(response.status)) {
      const isReady = await warmBackend("/health/db", true, {
        timeoutMs: COLD_START_WARM_TIMEOUT_MS,
        probeTimeoutMs: COLD_START_WARM_PROBE_TIMEOUT_MS,
        retryIntervalMs: COLD_START_WARM_RETRY_INTERVAL_MS,
      });

      if (isReady) {
        response = await request();
      }
    }

    if (!response.ok) {
      const body = await response.text();
      let message = response.statusText || "Request failed";
      try {
        const parsed = body ? (JSON.parse(body) as Record<string, unknown>) : {};
        const detail = parsed?.detail ?? parsed?.message;
        if (typeof detail === "string" && detail.trim()) {
          message = detail;
        }
      } catch {
        if (body?.trim()) {
          message = body;
        }
      }

      const isBranchContextError =
        response.status === 400
        && /invalid branch|no active branch/i.test(message)
        && !!localStorage.getItem("activeBranchId");

      if (isBranchContextError && !behavior?.branchRetryDone) {
        localStorage.removeItem("activeBranchId");
        window.dispatchEvent(new CustomEvent("activeBranchChanged", { detail: null }));
        return jsonRequestWithBehavior<T>(path, options, {
          ...behavior,
          branchRetryDone: true,
        });
      }

      if (response.status === 401) {
        if (shouldDeferLogoutForUnauthorized()) {
          throw new Error("Authentication is still initializing. Please retry.");
        }
        clearAuthSession();
        throw new Error("Not authenticated");
      }
      throw new Error(message || "Request failed");
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

export type ClearAllDataResponse = {
  message: string;
  truncated_tables: string[];
  truncated_count: number;
};

const CLIENT_DATA_CLEAR_KEYS = [
  "token",
  "user",
  "activeBranchId",
  "lastSuccessfulLoginAt",
  "businessInfo",
  "userInfo",
  "enableSupplierAutoSync",
  "offline_sales_outbox",
  "pos_suspended_carts_v1",
] as const;

const CLIENT_DATA_CLEAR_PREFIXES = ["offline_products:"] as const;

function clearLocalStoragePrefix(prefix: string): void {
  const keys: string[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key && key.startsWith(prefix)) {
      keys.push(key);
    }
  }

  for (const key of keys) {
    localStorage.removeItem(key);
  }
}

export async function clearAllData(): Promise<ClearAllDataResponse> {
  const response = await resilientFetch(`${API_BASE}/data/clear`, {
    method: "POST",
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
  if (!text) {
    return { message: "Application database reset completed.", truncated_tables: [], truncated_count: 0 };
  }

  return JSON.parse(text) as ClearAllDataResponse;
}

export async function clearClientOperationalData(): Promise<void> {
  clearDataCache();

  for (const key of CLIENT_DATA_CLEAR_KEYS) {
    localStorage.removeItem(key);
  }

  for (const prefix of CLIENT_DATA_CLEAR_PREFIXES) {
    clearLocalStoragePrefix(prefix);
  }

  if (typeof window !== "undefined" && "caches" in window) {
    const cacheNames = await window.caches.keys();
    await Promise.all(
      cacheNames
        .filter((name) => name.startsWith("gel-invent-"))
        .map((name) => window.caches.delete(name)),
    );
  }

  window.dispatchEvent(new CustomEvent("userChanged", { detail: null }));
  window.dispatchEvent(new Event("offlineOutboxChanged"));
  window.dispatchEvent(new Event("productsUpdated"));
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
  
  const data = await jsonRequest<ProductResponse[]>("/products");
  const normalized = data.map(normalizeProduct);
  setCache("products", normalized);
  return normalized;
}

// Fetch products with background refresh - returns cached immediately, refreshes in background
export async function fetchProductsCached(onUpdate?: (products: Product[]) => void): Promise<Product[]> {
  const cached = getCached<Product[]>("products");
  
  // If we have cached data, return it immediately and refresh in background
  if (cached) {
    // Refresh in background
    jsonRequest<ProductResponse[]>("/products").then((fresh) => {
      const normalized = fresh.map(normalizeProduct);
      setCache("products", normalized);
      if (onUpdate) onUpdate(normalized);
    }).catch(() => { /* ignore background refresh errors */ });
    return cached;
  }
  
  // No cache, fetch fresh
  const data = await jsonRequest<ProductResponse[]>("/products");
  const normalized = data.map(normalizeProduct);
  setCache("products", normalized);
  return normalized;
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
  const result = await jsonRequest<ProductResponse>("/products", {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  // Invalidate products cache
  dataCache.delete(getCacheKey("products"));
  return normalizeProduct(result);
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

export async function updateProduct(id: number, updates: ProductUpdate): Promise<Product> {
  const result = await jsonRequest<ProductResponse>(`/products/${id}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
  // Invalidate products cache since data changed
  dataCache.delete(getCacheKey("products"));
  return normalizeProduct(result);
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

export async function fetchSaleBatchOptions(
  productId: number,
  variantId?: number | null,
): Promise<SaleBatchOption[]> {
  const params = new URLSearchParams();
  if (variantId != null) {
    params.set("variant_id", String(variantId));
  }
  const query = params.toString();
  return jsonRequest<SaleBatchOption[]>(`/sales/products/${productId}/batch-options${query ? `?${query}` : ""}`);
}

export async function assignSaleCustomer(
  saleId: number,
  payload: {
    customer_name: string;
    phone?: string;
    email?: string;
    notes?: string;
  },
): Promise<Sale> {
  const result = await jsonRequest<Sale>(`/sales/${saleId}/customer`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  dataCache.delete(getCacheKey("sales"));
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

// Purchasing API

export async function fetchSuppliers(): Promise<Supplier[]> {
  const cached = getCached<Supplier[]>("suppliers");
  if (cached && isCacheFresh("suppliers")) {
    return cached;
  }

  const data = await jsonRequest<Supplier[]>("/inventory/suppliers");
  setCache("suppliers", data);
  return data;
}

export async function fetchSuppliersCached(onUpdate?: (suppliers: Supplier[]) => void): Promise<Supplier[]> {
  const cached = getCached<Supplier[]>("suppliers");

  if (cached) {
    jsonRequest<Supplier[]>("/inventory/suppliers")
      .then((fresh) => {
        setCache("suppliers", fresh);
        if (onUpdate) onUpdate(fresh);
      })
      .catch(() => {});
    return cached;
  }

  const data = await jsonRequest<Supplier[]>("/inventory/suppliers");
  setCache("suppliers", data);
  return data;
}

export async function createSupplier(payload: NewSupplier): Promise<Supplier> {
  const result = await jsonRequest<Supplier>("/inventory/suppliers", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  invalidatePurchasingCaches();
  return result;
}

export async function fetchPurchases(limit: number = 100): Promise<Purchase[]> {
  const cacheKey = `purchases:${limit}`;
  const cached = getCached<Purchase[]>(cacheKey);
  if (cached && isCacheFresh(cacheKey)) {
    return cached;
  }

  const data = await jsonRequest<Purchase[]>(`/inventory/purchases?limit=${encodeURIComponent(String(limit))}`);
  setCache(cacheKey, data);
  return data;
}

export async function fetchPurchasesCached(
  limit: number = 100,
  onUpdate?: (purchases: Purchase[]) => void,
): Promise<Purchase[]> {
  const cacheKey = `purchases:${limit}`;
  const cached = getCached<Purchase[]>(cacheKey);

  if (cached) {
    jsonRequest<Purchase[]>(`/inventory/purchases?limit=${encodeURIComponent(String(limit))}`)
      .then((fresh) => {
        setCache(cacheKey, fresh);
        if (onUpdate) onUpdate(fresh);
      })
      .catch(() => {});
    return cached;
  }

  const data = await jsonRequest<Purchase[]>(`/inventory/purchases?limit=${encodeURIComponent(String(limit))}`);
  setCache(cacheKey, data);
  return data;
}

export async function createPurchaseOrder(payload: NewPurchaseOrder): Promise<PurchaseOrder> {
  const result = await jsonRequest<PurchaseOrder>("/inventory/purchase-orders", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  invalidatePurchasingCaches({ includeProducts: true });
  return result;
}

export async function fetchSupplierPayments(limit: number = 40): Promise<SupplierPayment[]> {
  const cacheKey = `supplierPayments:${limit}`;
  const cached = getCached<SupplierPayment[]>(cacheKey);
  if (cached && isCacheFresh(cacheKey)) {
    return cached;
  }

  const data = await jsonRequest<SupplierPayment[]>(`/inventory/supplier-payments?limit=${encodeURIComponent(String(limit))}`);
  setCache(cacheKey, data);
  return data;
}

export async function fetchSupplierPaymentsCached(
  limit: number = 40,
  onUpdate?: (payments: SupplierPayment[]) => void,
): Promise<SupplierPayment[]> {
  const cacheKey = `supplierPayments:${limit}`;
  const cached = getCached<SupplierPayment[]>(cacheKey);

  if (cached) {
    jsonRequest<SupplierPayment[]>(`/inventory/supplier-payments?limit=${encodeURIComponent(String(limit))}`)
      .then((fresh) => {
        setCache(cacheKey, fresh);
        if (onUpdate) onUpdate(fresh);
      })
      .catch(() => {});
    return cached;
  }

  const data = await jsonRequest<SupplierPayment[]>(`/inventory/supplier-payments?limit=${encodeURIComponent(String(limit))}`);
  setCache(cacheKey, data);
  return data;
}

export async function createSupplierPayment(payload: NewSupplierPayment): Promise<SupplierPayment> {
  const result = await jsonRequest<SupplierPayment>("/inventory/supplier-payments", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  invalidatePurchasingCaches();
  return result;
}

export async function supportsPurchaseReturns(): Promise<boolean> {
  const response = await resilientFetch(`${API_BASE}/inventory/purchase-returns?limit=1`, {
    method: "GET",
    headers: buildAuthHeaders(),
  });

  if (response.status === 401) {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    window.dispatchEvent(new CustomEvent("userChanged", { detail: null }));
    throw new Error("Not authenticated");
  }

  return response.status !== 404 && response.status !== 405;
}

export async function fetchPurchaseReturns(limit: number = 40): Promise<PurchaseReturn[]> {
  const cacheKey = `purchaseReturns:${limit}`;
  const cached = getCached<PurchaseReturn[]>(cacheKey);
  if (cached && isCacheFresh(cacheKey)) {
    return cached;
  }

  const data = await jsonRequest<PurchaseReturn[]>(`/inventory/purchase-returns?limit=${encodeURIComponent(String(limit))}`);
  setCache(cacheKey, data);
  return data;
}

export async function fetchPurchaseReturnsCached(
  limit: number = 40,
  onUpdate?: (purchaseReturns: PurchaseReturn[]) => void,
): Promise<PurchaseReturn[]> {
  const cacheKey = `purchaseReturns:${limit}`;
  const cached = getCached<PurchaseReturn[]>(cacheKey);

  if (cached) {
    jsonRequest<PurchaseReturn[]>(`/inventory/purchase-returns?limit=${encodeURIComponent(String(limit))}`)
      .then((fresh) => {
        setCache(cacheKey, fresh);
        if (onUpdate) onUpdate(fresh);
      })
      .catch(() => {});
    return cached;
  }

  const data = await jsonRequest<PurchaseReturn[]>(`/inventory/purchase-returns?limit=${encodeURIComponent(String(limit))}`);
  setCache(cacheKey, data);
  return data;
}

export async function createPurchaseReturn(payload: NewPurchaseReturn): Promise<PurchaseReturn> {
  const result = await jsonRequest<PurchaseReturn>("/inventory/purchase-returns", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  invalidatePurchasingCaches({ includeProducts: true });
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

export async function updateSystemSettings(payload: SystemSettingsUpdate): Promise<SystemSettings> {
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
  const data = await jsonRequest<JsonObject>(`/revenue/analytics?${params.toString()}`);
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
    timeoutMs: REPORT_REQUEST_TIMEOUT_MS,
  });
  
  // Only cache if no custom date
  if (!filterDate) {
    setCache("salesDashboard", data);
  }
  return data;
}

export async function fetchInventoryStatusReport(): Promise<JsonObject> {
  const cacheKey = "inventoryStatusReport";
  const cached = getCached<JsonObject>(cacheKey);
  if (cached && isCacheFresh(cacheKey)) {
    return cached;
  }

  const data = await jsonRequestWithBehavior<JsonObject>("/reports/inventory-status", undefined, {
    timeoutMs: REPORT_REQUEST_TIMEOUT_MS,
  });
  setCache(cacheKey, data);
  return data;
}

export async function fetchCreditorsSummaryReport(): Promise<JsonObject> {
  const cacheKey = "creditorsSummaryReport";
  const cached = getCached<JsonObject>(cacheKey);
  if (cached && isCacheFresh(cacheKey)) {
    return cached;
  }

  const data = await jsonRequestWithBehavior<JsonObject>("/reports/creditors-summary", undefined, {
    timeoutMs: REPORT_REQUEST_TIMEOUT_MS,
  });
  setCache(cacheKey, data);
  return data;
}

export async function fetchMorningSummary(): Promise<JsonObject> {
  const cacheKey = "morningSummary";
  const cached = getCached<JsonObject>(cacheKey);
  if (cached && isCacheFresh(cacheKey)) {
    return cached;
  }

  const data = await jsonRequestWithBehavior<JsonObject>("/reports/morning-summary", undefined, {
    timeoutMs: REPORT_REQUEST_TIMEOUT_MS,
  });
  setCache(cacheKey, data);
  return data;
}
