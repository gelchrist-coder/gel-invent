import { NewMovement, NewProduct, NewSale, Product, Sale, StockMovement } from "./types";

// Use HTTPS Railway URL in production, localhost in development
const API_BASE = import.meta.env.VITE_API_URL 
  || import.meta.env.VITE_API_BASE 
  || (import.meta.env.PROD ? "https://gel-invent-production.up.railway.app" : "http://127.0.0.1:8000");

// Export for use in other components
export { API_BASE };

type StockMovementResponse = Omit<StockMovement, "change"> & { change: string | number };

async function jsonRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem("token");
  const headers: Record<string, string> = { 
    "Content-Type": "application/json", 
    ...(options?.headers as Record<string, string> ?? {}) 
  };
  
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  
  const response = await fetch(`${API_BASE}${path}`, {
    headers,
    ...options,
  });

  if (!response.ok) {
    if (response.status === 401) {
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

export async function fetchProducts(): Promise<Product[]> {
  return jsonRequest<Product[]>("/products");
}

export async function fetchMovements(productId: number): Promise<StockMovement[]> {
  const data = await jsonRequest<StockMovementResponse[]>(`/products/${productId}/movements`);
  return data.map((m) => ({ ...m, change: Number(m.change) }));
}

export async function createProduct(payload: NewProduct): Promise<Product> {
  return jsonRequest<Product>("/products", {
    method: "POST",
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

export async function fetchInventoryAnalytics(): Promise<any> {
  return jsonRequest<any>("/inventory/analytics");
}

export async function fetchAllMovements(days: number = 30, location?: string, reason?: string): Promise<any[]> {
  const params = new URLSearchParams({ days: days.toString() });
  if (location) params.append("location", location);
  if (reason) params.append("reason", reason);
  return jsonRequest<any[]>(`/inventory/movements?${params.toString()}`);
}

// Revenue API

export async function fetchRevenueAnalytics(period: string = "30d", startDate?: string, endDate?: string): Promise<any> {
  const params = new URLSearchParams({ period });
  if (startDate) params.append("start_date", startDate);
  if (endDate) params.append("end_date", endDate);
  return jsonRequest<any>(`/revenue/analytics?${params.toString()}`);
}

// Reports API

export async function fetchSalesDashboard(): Promise<any> {
  return jsonRequest<any>("/reports/sales-dashboard");
}
