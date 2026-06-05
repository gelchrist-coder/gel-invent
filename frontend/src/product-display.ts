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

const formatNumberLabel = (value: number): string => {
  if (!Number.isFinite(value)) return "0";
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2).replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
};

const getActiveVariants = (product: Product) => {
  return (product.variants ?? [])
    .filter((variant) => variant.is_active !== false)
    .sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0) || left.label.localeCompare(right.label));
};

export const getProductVariantSummary = (product: Product): string | null => {
  const extensionVariants = getActiveVariants(product);
  if (extensionVariants.length > 0) {
    const visibleLabels = extensionVariants
      .slice(0, 3)
      .map((variant) => cleanText(variant.label))
      .filter((value): value is string => Boolean(value));

    if (visibleLabels.length === 0) {
      return `${extensionVariants.length} variants`;
    }

    const remainingCount = extensionVariants.length - visibleLabels.length;
    return remainingCount > 0
      ? `${visibleLabels.join(" • ")} • +${remainingCount} more`
      : visibleLabels.join(" • ");
  }

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

export const getProductUnitConversionSummary = (product: Product): string | null => {
  const saleUnits = (product.unit_conversions ?? [])
    .filter((conversion) => conversion.is_sale_unit !== false)
    .sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0) || left.unit_name.localeCompare(right.unit_name));

  if (saleUnits.length === 0) {
    return null;
  }

  const visibleUnits = saleUnits
    .slice(0, 2)
    .map((conversion) => `${conversion.unit_name} (${formatNumberLabel(Number(conversion.base_quantity || 0))} ${product.unit})`);

  const remainingCount = saleUnits.length - visibleUnits.length;
  return remainingCount > 0
    ? `Sale units: ${visibleUnits.join(", ")} +${remainingCount} more`
    : `Sale units: ${visibleUnits.join(", ")}`;
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
    ...(product.variants ?? []).flatMap((variant) => [
      variant.label,
      ...Object.keys(variant.attributes_json ?? {}),
      ...Object.values(variant.attributes_json ?? {}).map((value) => String(value ?? "")),
    ]),
    ...(product.unit_conversions ?? []).flatMap((conversion) => [
      conversion.unit_name,
      String(conversion.base_quantity ?? ""),
    ]),
  ]
    .map(cleanText)
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();
};