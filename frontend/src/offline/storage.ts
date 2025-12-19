import type { NewSale, Product } from "../types";

export type OutboxSale = {
  id: string;
  branchId: string | null;
  createdAt: number;
  sale: NewSale;
};

const PRODUCTS_KEY_PREFIX = "offline_products:";
const OUTBOX_KEY = "offline_sales_outbox";

function safeParseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function getBranchId(): string | null {
  const activeBranchId = localStorage.getItem("activeBranchId");
  return activeBranchId ? String(activeBranchId) : null;
}

function uuid(): string {
  // crypto.randomUUID is widely supported in modern browsers.
  // Fall back to a simple random string if needed.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c: any = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `offline_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function dispatchOutboxChanged(): void {
  window.dispatchEvent(new CustomEvent("offlineOutboxChanged"));
}

export function cacheProducts(products: Product[], branchIdOverride?: string | null): void {
  const branchId = branchIdOverride ?? getBranchId();
  const key = `${PRODUCTS_KEY_PREFIX}${branchId ?? "none"}`;
  const payload = {
    cachedAt: Date.now(),
    products,
  };
  localStorage.setItem(key, JSON.stringify(payload));
}

export function loadCachedProducts(branchIdOverride?: string | null): Product[] | null {
  const branchId = branchIdOverride ?? getBranchId();
  const key = `${PRODUCTS_KEY_PREFIX}${branchId ?? "none"}`;
  const parsed = safeParseJson<{ cachedAt: number; products: Product[] }>(localStorage.getItem(key));
  return parsed?.products ?? null;
}

export function applyLocalSaleToCachedProducts(sales: NewSale[], branchIdOverride?: string | null): Product[] | null {
  const branchId = branchIdOverride ?? getBranchId();
  const products = loadCachedProducts(branchId);
  if (!products) return null;

  const next = products.map((p) => ({ ...p }));
  for (const s of sales) {
    const product = next.find((p) => p.id === s.product_id);
    if (!product) continue;
    const current = Number(product.current_stock ?? 0);
    const qty = Number(s.quantity ?? 0);
    if (Number.isFinite(current) && Number.isFinite(qty)) {
      product.current_stock = Math.max(0, current - qty);
    }
  }

  cacheProducts(next, branchId);
  return next;
}

export function getSalesOutbox(): OutboxSale[] {
  return safeParseJson<OutboxSale[]>(localStorage.getItem(OUTBOX_KEY)) ?? [];
}

export function getSalesOutboxCount(): number {
  return getSalesOutbox().length;
}

export function enqueueSales(sales: NewSale[], branchIdOverride?: string | null): OutboxSale[] {
  const branchId = branchIdOverride ?? getBranchId();
  const outbox = getSalesOutbox();

  const createdAt = Date.now();
  const items: OutboxSale[] = sales.map((sale) => ({
    id: uuid(),
    branchId,
    createdAt,
    sale,
  }));

  const next = [...outbox, ...items];
  localStorage.setItem(OUTBOX_KEY, JSON.stringify(next));
  dispatchOutboxChanged();
  return items;
}

export function removeOutboxItem(id: string): void {
  const outbox = getSalesOutbox();
  const next = outbox.filter((x) => x.id !== id);
  localStorage.setItem(OUTBOX_KEY, JSON.stringify(next));
  dispatchOutboxChanged();
}

export function clearSalesOutbox(): void {
  localStorage.removeItem(OUTBOX_KEY);
  dispatchOutboxChanged();
}
