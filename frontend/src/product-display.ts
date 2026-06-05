import type { Product } from "./types";

const cleanText = (value?: string | null): string | null => {
  const normalized = (value ?? "").trim();
  return normalized || null;
};

const formatShortDate = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

export const getProductVariantSummary = (product: Product): string | null => {
  const parts: string[] = [];

  const brand = cleanText(product.brand);
  const variantGroup = cleanText(product.variant_group);
  const variantLabel = cleanText(product.variant_label);
  const size = cleanText(product.size);
  const color = cleanText(product.color);
  const shade = cleanText(product.shade);

  if (brand) parts.push(brand);
  if (variantGroup) parts.push(variantGroup);
  if (variantLabel) parts.push(variantLabel);
  if (size) parts.push(`Size ${size}`);
  if (color) parts.push(`Color ${color}`);
  if (shade) parts.push(`Shade ${shade}`);

  return parts.length > 0 ? parts.join(" • ") : null;
};

export const getProductBatchSummary = (
  product: Product,
  options?: { includeNextExpiry?: boolean },
): string | null => {
  const activeBatchCount = Number(product.active_batch_count ?? 0);
  if (!Number.isFinite(activeBatchCount) || activeBatchCount <= 0) {
    return null;
  }

  const batchLabel = `${activeBatchCount} active ${activeBatchCount === 1 ? "batch" : "batches"}`;
  if (!options?.includeNextExpiry || !product.next_batch_expiry_date) {
    return batchLabel;
  }

  return `${batchLabel} • Next expiry ${formatShortDate(product.next_batch_expiry_date)}`;
};

export const getProductSearchText = (product: Product): string => {
  return [
    product.name,
    product.sku,
    product.barcode,
    product.description,
    product.supplier,
    product.category,
    product.brand,
    product.variant_group,
    product.variant_label,
    product.size,
    product.color,
    product.shade,
  ]
    .map(cleanText)
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();
};