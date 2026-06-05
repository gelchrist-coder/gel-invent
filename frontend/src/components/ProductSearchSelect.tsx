import { useEffect, useId, useMemo, useRef, useState } from "react";

import { getProductBatchSummary, getProductSearchText, getProductVariantSummary } from "../product-display";
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
  const barcode = (product.barcode || "").toLowerCase();
  const supplier = (product.supplier || "").toLowerCase();
  const category = (product.category || "").toLowerCase();
  const variantSummary = (getProductVariantSummary(product) || "").toLowerCase();
  const searchText = getProductSearchText(product);

  if (name === query || sku === query || barcode === query) return 0;
  if (name.startsWith(query) || sku.startsWith(query) || barcode.startsWith(query)) return 1;
  if (name.includes(query)) return 2;
  if (sku.includes(query)) return 3;
  if (variantSummary.startsWith(query)) return 4;
  if (variantSummary.includes(query)) return 5;
  if (supplier.includes(query)) return 6;
  if (category.includes(query)) return 7;
  if (searchText.includes(query)) return 8;
  return Number.POSITIVE_INFINITY;
}

export default function ProductSearchSelect({
  label,
  products,
  selectedProductId,
  onChange,
  disabled = false,
  searchPlaceholder = "Search by product name, SKU, barcode, brand, or variant",
  emptyLabel = "No matching products",
}: Props) {
  const [searchTerm, setSearchTerm] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const searchInputId = useId();
  const listboxId = useId();
  const optionIdPrefix = useId();

  const selectedProduct = useMemo(
    () => products.find((product) => product.id === selectedProductId) ?? null,
    [products, selectedProductId],
  );

  const normalizedSearch = searchTerm.trim().toLowerCase();

  const matchingProducts = useMemo(() => {
    if (!normalizedSearch) {
      return [] as Product[];
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
    return matchingProducts.slice(0, MAX_VISIBLE_RESULTS);
  }, [matchingProducts]);

  const activeProduct = activeIndex >= 0 ? visibleProducts[activeIndex] ?? null : null;

  useEffect(() => {
    if (!isOpen) {
      setActiveIndex(-1);
      return;
    }

    if (visibleProducts.length === 0) {
      setActiveIndex(-1);
      return;
    }

    setActiveIndex((previousIndex) => {
      if (previousIndex < 0) return 0;
      return Math.min(previousIndex, visibleProducts.length - 1);
    });
  }, [isOpen, visibleProducts]);

  useEffect(() => {
    if (!isOpen || activeIndex < 0) {
      return;
    }

    const activeOption = document.getElementById(`${optionIdPrefix}-${activeIndex}`);
    activeOption?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, isOpen, optionIdPrefix]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [isOpen]);

  const selectProduct = (product: Product) => {
    onChange(product.id);
    setSearchTerm("");
    setIsOpen(false);
    setActiveIndex(-1);
  };

  const clearSearch = () => {
    setSearchTerm("");
    setIsOpen(false);
    setActiveIndex(-1);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled || products.length === 0) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        return;
      }
      if (visibleProducts.length === 0) {
        return;
      }
      setActiveIndex((previousIndex) => Math.min(previousIndex + 1, visibleProducts.length - 1));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        return;
      }
      if (visibleProducts.length === 0) {
        return;
      }
      setActiveIndex((previousIndex) => (previousIndex <= 0 ? 0 : previousIndex - 1));
      return;
    }

    if (event.key === "Enter") {
      if (!isOpen || !activeProduct) {
        return;
      }
      event.preventDefault();
      selectProduct(activeProduct);
      return;
    }

    if (event.key === "Escape") {
      if (!isOpen && !searchTerm) {
        return;
      }
      event.preventDefault();
      setIsOpen(false);
      setActiveIndex(-1);
    }
  };

  const matchSummary = (() => {
    if (products.length === 0) {
      return "No products available yet.";
    }

    if (!normalizedSearch) {
      return `Start typing to search ${products.length} product${products.length === 1 ? "" : "s"}. Use arrow keys and Enter to select quickly.`;
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
    <div ref={containerRef} style={{ display: "grid", gap: 10, position: "relative" }}>
      <div style={{ display: "grid", gap: 6 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <label htmlFor={searchInputId} style={{ fontSize: 13, color: "#374151", fontWeight: 600 }}>
            Find Product
          </label>
          {searchTerm ? (
            <button
              type="button"
              onClick={clearSearch}
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
          role="combobox"
          aria-expanded={isOpen}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={activeIndex >= 0 ? `${optionIdPrefix}-${activeIndex}` : undefined}
          value={searchTerm}
          onChange={(event) => {
            setSearchTerm(event.target.value);
            setIsOpen(true);
          }}
          onFocus={() => {
            if (!disabled && products.length > 0) {
              setIsOpen(true);
            }
          }}
          onKeyDown={handleKeyDown}
          placeholder={searchPlaceholder}
          disabled={disabled || products.length === 0}
        />
        <div style={{ fontSize: 12, color: "#64748b" }}>{matchSummary}</div>
      </div>

      {isOpen ? (
        <div
          id={listboxId}
          role="listbox"
          aria-label={`${label} search results`}
          style={{
            maxHeight: 320,
            overflowY: "auto",
            borderRadius: 14,
            border: "1px solid #dbe5f2",
            background: "#ffffff",
            boxShadow: "0 18px 30px rgba(15, 23, 42, 0.08)",
            padding: 8,
            display: "grid",
            gap: 6,
          }}
        >
          {!normalizedSearch ? (
            <div style={{ padding: "12px 14px", borderRadius: 10, background: "#f8fafc", color: "#64748b", fontSize: 13 }}>
              Start typing a product name, SKU, barcode, brand, or variant to narrow the list quickly.
            </div>
          ) : visibleProducts.length === 0 ? (
            <div style={{ padding: "12px 14px", borderRadius: 10, background: "#f8fafc", color: "#64748b", fontSize: 13 }}>
              {emptyLabel}
            </div>
          ) : (
            visibleProducts.map((product, index) => {
              const isActive = index === activeIndex;
              const isSelected = product.id === selectedProductId;
              const variantSummary = getProductVariantSummary(product);
              const batchSummary = getProductBatchSummary(product, { includeNextExpiry: true });
              return (
                <button
                  key={product.id}
                  id={`${optionIdPrefix}-${index}`}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => selectProduct(product)}
                  onMouseEnter={() => setActiveIndex(index)}
                  style={{
                    padding: "12px 14px",
                    borderRadius: 10,
                    border: isActive ? "1px solid #2563eb" : isSelected ? "1px solid #bfdbfe" : "1px solid #e2e8f0",
                    background: isActive ? "#eff6ff" : isSelected ? "#f8fbff" : "#ffffff",
                    textAlign: "left",
                    cursor: "pointer",
                    display: "grid",
                    gap: 4,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: "#0f172a" }}>{product.name}</span>
                    <span style={{ fontSize: 12, color: "#475569", fontWeight: 700 }}>{product.sku}</span>
                  </div>
                  {variantSummary ? (
                    <div style={{ fontSize: 12, color: "#334155", fontWeight: 600 }}>{variantSummary}</div>
                  ) : null}
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 12, color: "#64748b" }}>
                    <span>Stock {Number(product.current_stock || 0)}</span>
                    {product.supplier ? <span>Supplier {product.supplier}</span> : null}
                    {product.category ? <span>Category {product.category}</span> : null}
                    {batchSummary ? <span>{batchSummary}</span> : null}
                  </div>
                </button>
              );
            })
          )}
        </div>
      ) : null}

      <div style={{ display: "grid", gap: 6 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>{label}</div>
        <div
          style={{
            padding: "12px 14px",
            borderRadius: 12,
            border: "1px solid #e2e8f0",
            background: selectedProduct ? "#f8fbff" : "#f8fafc",
            display: "grid",
            gap: 4,
          }}
        >
          {selectedProduct ? (
            <>
              {(() => {
                const variantSummary = getProductVariantSummary(selectedProduct);
                const batchSummary = getProductBatchSummary(selectedProduct, { includeNextExpiry: true });

                return (
                  <>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a" }}>{selectedProduct.name}</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#475569" }}>{selectedProduct.sku}</div>
              </div>
              {variantSummary ? (
                <div style={{ fontSize: 12, color: "#334155", fontWeight: 600 }}>{variantSummary}</div>
              ) : null}
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 12, color: "#64748b" }}>
                <span>Stock {Number(selectedProduct.current_stock || 0)}</span>
                {selectedProduct.supplier ? <span>Supplier {selectedProduct.supplier}</span> : null}
                {selectedProduct.category ? <span>Category {selectedProduct.category}</span> : null}
                {batchSummary ? <span>{batchSummary}</span> : null}
              </div>
                  </>
                );
              })()}
            </>
          ) : (
            <div style={{ fontSize: 13, color: "#64748b" }}>No product selected yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}