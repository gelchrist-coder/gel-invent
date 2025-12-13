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

type JsonObject = Record<string, unknown>;
type JsonArray = Record<string, unknown>[];

type StockMovementResponse = Omit<StockMovement, "change"> & { change: string | number };

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
    headers["X-Branch-Id"] = activeBranchId;
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

  return response.json() as Promise<T>;
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
  return jsonRequest<Product[]>("/products/");
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
  return jsonRequest<Product>("/products/", {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
}

export async function createMovement(
  productId: number,
  payload: NewMovement,
): Promise<StockMovement> {
  const data = await jsonRequest<StockMovementResponse>(`/products/${productId}/movements`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return { ...data, change: Number(data.change) };
}

export async function updateProduct(id: number, updates: Partial<Product>): Promise<Product> {
  return jsonRequest<Product>(`/products/${id}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
}

export async function deleteProduct(productId: number): Promise<void> {
  await fetch(`${API_BASE}/products/${productId}`, {
    method: "DELETE",
  });
}

// Sales API

export async function fetchSales(): Promise<Sale[]> {
  return jsonRequest<Sale[]>("/sales");
}

export async function createSale(payload: NewSale): Promise<Sale> {
  return jsonRequest<Sale>("/sales", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function deleteSale(saleId: number): Promise<void> {
  await fetch(`${API_BASE}/sales/${saleId}`, {
    method: "DELETE",
  });
}

// Inventory API

export async function fetchInventoryAnalytics(): Promise<JsonObject> {
  return jsonRequest<JsonObject>("/inventory/analytics");
}

export async function fetchAllMovements(days: number = 30, location?: string, reason?: string): Promise<JsonArray> {
  const params = new URLSearchParams({ days: days.toString() });
  if (location) params.append("location", location);
  if (reason) params.append("reason", reason);
  return jsonRequest<JsonArray>(`/inventory/movements?${params.toString()}`);
}

// Revenue API

export async function fetchRevenueAnalytics(period: string = "30d", startDate?: string, endDate?: string): Promise<JsonObject> {
  const params = new URLSearchParams({ period });
  if (startDate) params.append("start_date", startDate);
  if (endDate) params.append("end_date", endDate);
  return jsonRequest<JsonObject>(`/revenue/analytics?${params.toString()}`);
}

// Reports API

export async function fetchSalesDashboard(): Promise<JsonObject> {
  return jsonRequest<JsonObject>("/reports/sales-dashboard");
}
