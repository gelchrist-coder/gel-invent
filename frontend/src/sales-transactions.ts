import { Product, Sale } from "./types";

export type SaleTransactionItem = {
  sale: Sale;
  productName: string;
  quantityLabel: string;
  summaryLabel: string;
  unitPrice: number;
  totalPrice: number;
};

export type SaleTransaction = {
  key: string;
  receiptNumber: string;
  primarySale: Sale;
  sales: Sale[];
  items: SaleTransactionItem[];
  created_at: string;
  customer_name: string | null;
  payment_method: string;
  created_by_name: string | null;
  total_price: number;
  amount_paid: number;
  item_count: number;
  partial_payment_method: string | null;
  searchText: string;
};

const LEGACY_TRANSACTION_WINDOW_MS = 5000;

function toFiniteNumber(value: number | string | null | undefined): number {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function normalizeGroupingText(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function getExplicitSaleTransactionToken(sale: Pick<Sale, "client_sale_id">): string | null {
  const raw = String(sale.client_sale_id || "").trim();
  if (!raw) {
    return null;
  }
  return raw.split(":")[0] || null;
}

function getSaleCreatedAtMs(sale: Pick<Sale, "created_at">): number {
  return new Date(sale.created_at).getTime();
}

function canGroupLegacySales(previousSale: Sale, currentSale: Sale): boolean {
  const previousTime = getSaleCreatedAtMs(previousSale);
  const currentTime = getSaleCreatedAtMs(currentSale);

  if (!Number.isFinite(previousTime) || !Number.isFinite(currentTime)) {
    return false;
  }

  if (Math.abs(currentTime - previousTime) > LEGACY_TRANSACTION_WINDOW_MS) {
    return false;
  }

  if (normalizeGroupingText(previousSale.customer_name) !== normalizeGroupingText(currentSale.customer_name)) {
    return false;
  }

  if (normalizeGroupingText(previousSale.payment_method) !== normalizeGroupingText(currentSale.payment_method)) {
    return false;
  }

  if (normalizeGroupingText(previousSale.partial_payment_method) !== normalizeGroupingText(currentSale.partial_payment_method)) {
    return false;
  }

  if (normalizeGroupingText(previousSale.created_by_name) !== normalizeGroupingText(currentSale.created_by_name)) {
    return false;
  }

  const previousNotes = normalizeGroupingText(previousSale.notes);
  const currentNotes = normalizeGroupingText(currentSale.notes);
  if (previousNotes !== currentNotes) {
    return false;
  }

  const isWalkInCashSale =
    !normalizeGroupingText(previousSale.customer_name)
    && !normalizeGroupingText(currentSale.customer_name)
    && normalizeGroupingText(previousSale.payment_method || "cash") === "cash"
    && normalizeGroupingText(currentSale.payment_method || "cash") === "cash";

  if (isWalkInCashSale) {
    return Math.floor(previousTime / 1000) === Math.floor(currentTime / 1000);
  }

  return true;
}

function formatDisplayNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2);
}

export function getSaleDisplayUnitLabel(sale: Pick<Sale, "sale_unit_type" | "pack_quantity" | "quantity">): string {
  const saleUnitType = String(sale.sale_unit_type || "piece").trim().toLowerCase();
  const quantityValue = getSaleQuantityValue(sale);
  if (!saleUnitType || saleUnitType === "piece") {
    return quantityValue === 1 ? "unit" : "units";
  }
  if (saleUnitType === "pack") {
    return quantityValue === 1 ? "pack" : "packs";
  }
  return saleUnitType;
}

function getSaleQuantityValue(sale: Pick<Sale, "sale_unit_type" | "pack_quantity" | "quantity">): number {
  if (sale.sale_unit_type && sale.sale_unit_type !== "piece" && sale.pack_quantity != null) {
    return toFiniteNumber(sale.pack_quantity);
  }
  return toFiniteNumber(sale.quantity);
}

export function getSaleTransactionToken(sale: Pick<Sale, "client_sale_id" | "id">): string {
  const explicitToken = getExplicitSaleTransactionToken(sale);
  if (!explicitToken) {
    return `sale:${sale.id}`;
  }
  return explicitToken;
}

export function getSaleReceiptNumber(sale: Pick<Sale, "client_sale_id" | "id">): string {
  const token = getSaleTransactionToken(sale);
  if (token.startsWith("sale:")) {
    return String(sale.id).padStart(6, "0");
  }
  return token.slice(-8).toUpperCase();
}

export function formatSaleQuantityLabel(sale: Pick<Sale, "sale_unit_type" | "pack_quantity" | "quantity">): string {
  const quantityValue = getSaleQuantityValue(sale);
  return `${formatDisplayNumber(quantityValue)} ${getSaleDisplayUnitLabel(sale)}`;
}

function formatSaleSummaryLabel(productName: string, sale: Pick<Sale, "sale_unit_type" | "pack_quantity" | "quantity">): string {
  const quantityValue = getSaleQuantityValue(sale);
  return `${productName} x${formatDisplayNumber(quantityValue)} ${getSaleDisplayUnitLabel(sale)}`;
}

export function groupSalesIntoTransactions(
  sales: Sale[],
  productById: Map<number, Product>,
): SaleTransaction[] {
  const grouped = new Map<string, SaleTransaction>();
  let previousLegacySale: { sale: Sale; key: string } | null = null;

  for (const sale of sales) {
    const explicitToken = getExplicitSaleTransactionToken(sale);
    const key: string = explicitToken
      ? explicitToken
      : previousLegacySale && canGroupLegacySales(previousLegacySale.sale, sale)
        ? previousLegacySale.key
        : `legacy:${sale.id}`;
    const productName = productById.get(sale.product_id)?.name || `Product #${sale.product_id}`;
    const unitPrice = toFiniteNumber(sale.unit_price);
    const totalPrice = toFiniteNumber(sale.total_price);
    const current = grouped.get(key);

    previousLegacySale = explicitToken ? null : { sale, key };

    if (!current) {
      grouped.set(key, {
        key,
        receiptNumber: getSaleReceiptNumber(sale),
        primarySale: sale,
        sales: [sale],
        items: [
          {
            sale,
            productName,
            quantityLabel: formatSaleQuantityLabel(sale),
            summaryLabel: formatSaleSummaryLabel(productName, sale),
            unitPrice,
            totalPrice,
          },
        ],
        created_at: sale.created_at,
        customer_name: sale.customer_name ?? null,
        payment_method: sale.payment_method || "cash",
        created_by_name: sale.created_by_name ?? null,
        total_price: totalPrice,
        amount_paid: toFiniteNumber(sale.amount_paid),
        item_count: 1,
        partial_payment_method: sale.partial_payment_method ?? null,
        searchText: "",
      });
      continue;
    }

    current.sales.push(sale);
    current.items.push({
      sale,
      productName,
      quantityLabel: formatSaleQuantityLabel(sale),
      summaryLabel: formatSaleSummaryLabel(productName, sale),
      unitPrice,
      totalPrice,
    });
    current.total_price += totalPrice;
    current.amount_paid += toFiniteNumber(sale.amount_paid);
    current.item_count += 1;

    if (!current.customer_name && sale.customer_name) {
      current.customer_name = sale.customer_name;
    }
    if (!current.created_by_name && sale.created_by_name) {
      current.created_by_name = sale.created_by_name;
    }
    if (!current.partial_payment_method && sale.partial_payment_method) {
      current.partial_payment_method = sale.partial_payment_method;
    }
  }

  return Array.from(grouped.values()).map((transaction) => {
    transaction.sales.sort((left, right) => {
      const timeDiff = new Date(left.created_at).getTime() - new Date(right.created_at).getTime();
      if (timeDiff !== 0) return timeDiff;
      return left.id - right.id;
    });
    transaction.items.sort((left, right) => transaction.sales.indexOf(left.sale) - transaction.sales.indexOf(right.sale));
    transaction.searchText = [
      transaction.receiptNumber,
      transaction.customer_name || "walk-in",
      transaction.created_by_name || "",
      transaction.payment_method || "",
      ...transaction.items.map((item) => item.summaryLabel),
    ]
      .join(" ")
      .toLowerCase();
    return transaction;
  });
}