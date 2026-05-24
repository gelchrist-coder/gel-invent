import { useId, useMemo, useState } from "react";

import type { Product } from "../types";

type Props = {
  label: string;
  products: Product[];
  selectedProductId: number | null;
  onChange: (productId: number | null) => void;
  disabled?: boolean;
  searchPlaceholder?: string;
  emptyLabel?: string;
};

const MAX_VISIBLE_RESULTS = 60;

function getProductMatchRank(product: Product, query: string): number {
  const name = product.name.toLowerCase();
  const sku = product.sku.toLowerCase();
  const supplier = (product.supplier || "").toLowerCase();
  const category = (product.category || "").toLowerCase();

  if (name === query || sku === query) return 0;
  if (name.startsWith(query) || sku.startsWith(query)) return 1;
  if (name.includes(query)) return 2;
  if (sku.includes(query)) return 3;
  if (supplier.includes(query)) return 4;
  if (category.includes(query)) return 5;
  return Number.POSITIVE_INFINITY;
}

export default function ProductSearchSelect({
  label,
  products,
  selectedProductId,
  onChange,
  disabled = false,
  searchPlaceholder = "Search by product name, SKU, supplier, or category",
  emptyLabel = "No matching products",
}: Props) {
  const [searchTerm, setSearchTerm] = useState("");
  const searchInputId = useId();
  const selectId = useId();

  const selectedProduct = useMemo(
    () => products.find((product) => product.id === selectedProductId) ?? null,
    [products, selectedProductId],
  );

  const normalizedSearch = searchTerm.trim().toLowerCase();

  const matchingProducts = useMemo(() => {
    if (!normalizedSearch) {
      return [...products].sort((left, right) => {
        const nameCompare = left.name.localeCompare(right.name);
        if (nameCompare !== 0) return nameCompare;
        return left.sku.localeCompare(right.sku);
      });
    }

    return products
      .map((product) => ({
        product,
        rank: getProductMatchRank(product, normalizedSearch),
      }))
      .filter((entry) => Number.isFinite(entry.rank))
      .sort((left, right) => {
        if (left.rank !== right.rank) return left.rank - right.rank;
        const nameCompare = left.product.name.localeCompare(right.product.name);
        if (nameCompare !== 0) return nameCompare;
        return left.product.sku.localeCompare(right.product.sku);
      })
      .map((entry) => entry.product);
  }, [normalizedSearch, products]);

  const visibleProducts = useMemo(() => {
    const limitedMatches = matchingProducts.slice(0, MAX_VISIBLE_RESULTS);
    if (!selectedProduct) {
      return limitedMatches;
    }

    if (limitedMatches.some((product) => product.id === selectedProduct.id)) {
      return limitedMatches;
    }

    return [selectedProduct, ...limitedMatches.slice(0, Math.max(MAX_VISIBLE_RESULTS - 1, 0))];
  }, [matchingProducts, selectedProduct]);

  const matchSummary = (() => {
    if (products.length === 0) {
      return "No products available yet.";
    }

    if (!normalizedSearch) {
      return `${products.length} product${products.length === 1 ? "" : "s"} available.`;
    }

    const totalMatches = matchingProducts.length;
    if (totalMatches === 0) {
      return "No products matched that search.";
    }

    if (totalMatches > visibleProducts.length) {
      return `${totalMatches} matches found. Showing the first ${visibleProducts.length}.`;
    }

    return `${totalMatches} match${totalMatches === 1 ? "" : "es"} found.`;
  })();

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "grid", gap: 6 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <label htmlFor={searchInputId} style={{ fontSize: 13, color: "#374151", fontWeight: 600 }}>
            Find Product
          </label>
          {searchTerm ? (
            <button
              type="button"
              onClick={() => setSearchTerm("")}
              style={{
                padding: "4px 8px",
                borderRadius: 999,
                border: "1px solid #d1d5db",
                background: "white",
                color: "#475569",
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
              }}
              disabled={disabled}
            >
              Clear Search
            </button>
          ) : null}
        </div>
        <input
          id={searchInputId}
          className="input"
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          placeholder={searchPlaceholder}
          disabled={disabled || products.length === 0}
        />
        <div style={{ fontSize: 12, color: "#64748b" }}>{matchSummary}</div>
      </div>

      <label>
        <span style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 600, color: "#374151" }}>{label}</span>
        <select
          id={selectId}
          className="input"
          value={selectedProductId ?? ""}
          onChange={(event) => onChange(event.target.value ? Number(event.target.value) : null)}
          disabled={disabled || products.length === 0}
        >
          {visibleProducts.length === 0 ? <option value="">{emptyLabel}</option> : null}
          {visibleProducts.map((product) => (
            <option key={product.id} value={product.id}>
              {product.name} ({product.sku})
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}