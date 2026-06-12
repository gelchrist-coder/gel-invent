import { useEffect, useState } from "react";
import { NewProductUnitConversion, NewProductVariant, Product, ProductUpdate } from "../types";
import { updateMyCategories } from "../api";
import { useAppCategories } from "../categories";
import { getProductBatchSummary, getProductSearchText, getProductUnitConversionSummary, getProductVariantSummary } from "../product-display";
import { useCapabilities, useExpiryTracking, useSystemSettings } from "../settings";
import { hasUserPermission, readStoredUser } from "../user-storage";

type VariantDraft = {
  label: string;
  attributesText: string;
  isActive: boolean;
};

type UnitConversionDraft = {
  unit_name: string;
  base_quantity: string;
  is_sale_unit: boolean;
  is_purchase_unit: boolean;
};

const cleanOptionalText = (value: string | null | undefined): string | undefined => {
  const normalized = (value ?? "").trim();
  return normalized || undefined;
};

const createVariantDraft = (): VariantDraft => ({
  label: "",
  attributesText: "",
  isActive: true,
});

const createUnitConversionDraft = (): UnitConversionDraft => ({
  unit_name: "",
  base_quantity: "",
  is_sale_unit: true,
  is_purchase_unit: false,
});

const formatVariantAttributes = (attributes: Record<string, unknown> | null | undefined): string =>
  Object.entries(attributes ?? {})
    .map(([key, value]) => `${key}:${String(value ?? "")}`)
    .join(", ");

const parseVariantAttributes = (value: string): { attributes: Record<string, string>; invalidTokens: string[] } => {
  const attributes: Record<string, string> = {};
  const invalidTokens: string[] = [];
  const tokens = value
    .split(/\n|,/)
    .map((token) => token.trim())
    .filter(Boolean);

  tokens.forEach((token) => {
    const separatorIndex = token.includes(":") ? token.indexOf(":") : token.indexOf("=");
    if (separatorIndex <= 0) {
      invalidTokens.push(token);
      return;
    }

    const rawKey = token.slice(0, separatorIndex).trim();
    const rawValue = token.slice(separatorIndex + 1).trim();
    if (!rawKey || !rawValue) {
      invalidTokens.push(token);
      return;
    }

    attributes[rawKey] = rawValue;
  });

  return { attributes, invalidTokens };
};

type Props = {
  products: Product[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onEdit: (id: number, updates: ProductUpdate) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  searchTerm: string;
  filterCategory: string;
  filterExpiry: string;
  filterStock: string;
  filterSupplier: string;
  sortBy: string;
  userRole?: string;
  onOpenInventory: () => void;
};

export default function ProductList({ 
  products, 
  onEdit,
  onDelete,
  searchTerm,
  filterCategory,
  filterExpiry,
  filterStock,
  filterSupplier,
  sortBy,
  userRole = "Admin",
  onOpenInventory,
}: Props) {
  const accessUser = readStoredUser() ?? { role: userRole };
  const canManageCatalog = hasUserPermission("manage_catalog", accessUser);
  const categoryOptions = useAppCategories();
  const capabilities = useCapabilities();
  const usesExpiryTracking = useExpiryTracking();
  const systemSettings = useSystemSettings();
  const showVariantMetadata = capabilities.variants || capabilities.size_color_variants || capabilities.brand_shade_attributes;
  const showBatchMetadata = capabilities.batch_tracking;
  const expiryWarningDays = Number(systemSettings.expiry_warning_days) || 45;
  const expiryWindowMs = expiryWarningDays * 24 * 60 * 60 * 1000;
  const showExpiryStatusFilter = usesExpiryTracking && products.length > 0 && products.some((p) => !!p.expiry_date);
  const effectiveFilterExpiry = showExpiryStatusFilter ? filterExpiry : "all";
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<Partial<Product>>({});
  const [variantDrafts, setVariantDrafts] = useState<VariantDraft[]>([]);
  const [unitConversionDrafts, setUnitConversionDrafts] = useState<UnitConversionDraft[]>([]);
  const [stockData, setStockData] = useState<Record<number, number>>({});
  const [expiryByProduct, setExpiryByProduct] = useState<Record<number, string | null>>({});
  const [busy, setBusy] = useState(false);
  const [isCompactLayout, setIsCompactLayout] = useState(() => window.innerWidth < 980);
  const editingProduct = products.find((product) => product.id === editingId) ?? null;
  const showVariantEditor = capabilities.variants || Boolean(editingProduct?.variants?.length);
  const showUnitConversionEditor = capabilities.unit_conversions || Boolean(editingProduct?.unit_conversions?.length);

  useEffect(() => {
    const onResize = () => setIsCompactLayout(window.innerWidth < 980);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Fetch initial stock data for all products
  useEffect(() => {
    // Stock is already in product.current_stock - use it directly
    const loadAdditionalData = async () => {
      const stockMap: Record<number, number> = {};
      const expiryMap: Record<number, string | null> = {};
      
      for (const product of products) {
        stockMap[product.id] = Math.max(0, Number(product.current_stock ?? 0));
        expiryMap[product.id] = product.expiry_date ?? null;
      }
      
      setStockData(stockMap);
      setExpiryByProduct(expiryMap);
    };
    
    if (products.length > 0) {
      loadAdditionalData();
    }
  }, [products]);

  const startEdit = (product: Product) => {
    setEditingId(product.id);
    setEditForm({
      name: product.name,
      sku: product.sku,
      description: product.description,
      unit: product.unit,
      variant_group: product.variant_group,
      variant_label: product.variant_label,
      brand: product.brand,
      size: product.size,
      color: product.color,
      shade: product.shade,
      pack_size: product.pack_size,
      category: product.category,
      supplier: product.supplier,
      expiry_date: product.expiry_date,
      cost_price: product.cost_price,
      pack_cost_price: product.pack_cost_price,
      selling_price: product.selling_price,
      pack_selling_price: product.pack_selling_price,
    });
    setVariantDrafts(
      product.variants?.length
        ? product.variants.map((variant) => ({
            label: variant.label,
            attributesText: formatVariantAttributes(variant.attributes_json),
            isActive: variant.is_active,
          }))
        : [],
    );
    setUnitConversionDrafts(
      product.unit_conversions?.length
        ? product.unit_conversions.map((conversion) => ({
            unit_name: conversion.unit_name,
            base_quantity: String(conversion.base_quantity ?? ""),
            is_sale_unit: conversion.is_sale_unit,
            is_purchase_unit: conversion.is_purchase_unit,
          }))
        : [],
    );
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({});
    setVariantDrafts([]);
    setUnitConversionDrafts([]);
  };

  const saveEdit = async (id: number) => {
    if (!editForm.name?.trim()) {
      alert("Product name is required");
      return;
    }
    if (!editForm.sku?.trim()) {
      alert("SKU is required");
      return;
    }

    let preparedVariants: NewProductVariant[];
    let preparedUnitConversions: NewProductUnitConversion[];
    try {
      preparedVariants = variantDrafts.reduce<NewProductVariant[]>((items, draft, index) => {
        const label = cleanOptionalText(draft.label);
        const rawAttributes = draft.attributesText.trim();

        if (!label && !rawAttributes) {
          return items;
        }

        if (!label) {
          throw new Error("Each product variant row needs a label.");
        }

        const { attributes, invalidTokens } = parseVariantAttributes(rawAttributes);
        if (invalidTokens.length > 0) {
          throw new Error("Variant attributes must use key:value or key=value format.");
        }

        items.push({
          label,
          attributes_json: attributes,
          is_active: draft.isActive,
          sort_order: index,
        });
        return items;
      }, []);

      preparedUnitConversions = unitConversionDrafts.reduce<NewProductUnitConversion[]>((items, draft, index) => {
        const unitName = cleanOptionalText(draft.unit_name);
        const rawBaseQuantity = draft.base_quantity.trim();

        if (!unitName && !rawBaseQuantity) {
          return items;
        }

        const baseQuantity = Number.parseFloat(rawBaseQuantity);
        if (!unitName || !Number.isFinite(baseQuantity) || baseQuantity <= 0) {
          throw new Error("Each unit conversion needs a unit name and a positive base quantity.");
        }

        items.push({
          unit_name: unitName,
          base_quantity: baseQuantity,
          is_sale_unit: draft.is_sale_unit,
          is_purchase_unit: draft.is_purchase_unit,
          sort_order: index,
        });
        return items;
      }, []);
    } catch (err) {
      alert((err as Error).message || "Failed to prepare product update");
      return;
    }

    setBusy(true);
    try {
      const selectedCategory = (editForm.category ?? "").trim();
      if (selectedCategory) {
        const exists = categoryOptions.some((c) => c.toLowerCase() === selectedCategory.toLowerCase());
        if (!exists) {
          try {
            await updateMyCategories([...categoryOptions, selectedCategory]);
          } catch {
            // Don't block product edits if categories can't be persisted.
          }
        }
      }

      const updates: ProductUpdate = {
        ...editForm,
        unit: cleanOptionalText(editForm.unit) ?? editingProduct?.unit,
        description: cleanOptionalText(editForm.description) ?? null,
        variant_group: cleanOptionalText(editForm.variant_group) ?? null,
        variant_label: cleanOptionalText(editForm.variant_label) ?? null,
        brand: cleanOptionalText(editForm.brand) ?? null,
        size: cleanOptionalText(editForm.size) ?? null,
        color: cleanOptionalText(editForm.color) ?? null,
        shade: cleanOptionalText(editForm.shade) ?? null,
        category: cleanOptionalText(editForm.category) ?? null,
        supplier: cleanOptionalText(editForm.supplier) ?? null,
        expiry_date: editForm.expiry_date || null,
        pack_size: editForm.pack_size ?? null,
        variants: preparedVariants,
        unit_conversions: preparedUnitConversions,
      };

      await onEdit(id, updates);
      setEditingId(null);
      setEditForm({});
      setVariantDrafts([]);
      setUnitConversionDrafts([]);
    } catch (err) {
      alert((err as Error).message || "Failed to update product");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (product: Product) => {
    if (!confirm(`Are you sure you want to delete "${product.name}"? This will also delete all associated stock movements.`)) {
      return;
    }
    setBusy(true);
    try {
      await onDelete(product.id);
    } catch (err) {
      alert((err as Error).message || "Failed to delete product");
    } finally {
      setBusy(false);
    }
  };

  const calculateProfitMargin = (costPrice: number | null | undefined, sellingPrice: number | null | undefined): string => {
    if (!costPrice || !sellingPrice) return "-";
    const cost = Number(costPrice);
    const selling = Number(sellingPrice);
    if (cost === 0) return "-";
    const margin = ((selling - cost) / cost) * 100;
    return `${margin.toFixed(1)}%`;
  };

  const getProductStock = (product: Product): number => {
    const loadedStock = stockData[product.id];
    if (typeof loadedStock === "number") {
      return loadedStock;
    }
    return Math.max(0, Number(product.current_stock ?? 0));
  };

  const getProductMargin = (product: Product): number => {
    if (!product.cost_price || !product.selling_price) {
      return Number.NEGATIVE_INFINITY;
    }
    const cost = Number(product.cost_price);
    const selling = Number(product.selling_price);
    if (cost <= 0) {
      return Number.NEGATIVE_INFINITY;
    }
    return ((selling - cost) / cost) * 100;
  };

  // Filter products based on search and filters
  const filteredProducts = products.filter((p) => {
    // Search filter
    const searchLower = searchTerm.toLowerCase();
    const matchesSearch = !searchTerm || getProductSearchText(p).includes(searchLower);

    // Category filter
    const matchesCategory = filterCategory === "all" || p.category === filterCategory;

    // Supplier filter
    const supplier = p.supplier?.trim() || "";
    const matchesSupplier = filterSupplier === "all" || supplier.toLowerCase() === filterSupplier.toLowerCase();

    // Expiry filter
    let matchesExpiry = true;
    const effectiveExpiry = expiryByProduct[p.id] || p.expiry_date;
    if (effectiveFilterExpiry === "expired") {
      matchesExpiry = effectiveExpiry ? new Date(effectiveExpiry) < new Date() : false;
    } else if (effectiveFilterExpiry === "expiring") {
      matchesExpiry = effectiveExpiry ? 
        new Date(effectiveExpiry) >= new Date() && 
        new Date(effectiveExpiry) <= new Date(Date.now() + expiryWindowMs) : 
        false;
    } else if (effectiveFilterExpiry === "fresh") {
      matchesExpiry = !effectiveExpiry || 
        new Date(effectiveExpiry) > new Date(Date.now() + expiryWindowMs);
    }

    // Stock filter
    const stock = getProductStock(p);
    let matchesStock = true;
    if (filterStock === "in_stock") {
      matchesStock = stock > 5;
    } else if (filterStock === "low_stock") {
      matchesStock = stock > 0 && stock <= 5;
    } else if (filterStock === "out_of_stock") {
      matchesStock = stock <= 0;
    }

    return matchesSearch && matchesCategory && matchesSupplier && matchesExpiry && matchesStock;
  }).sort((a, b) => {
    if (sortBy === "name_desc") {
      return b.name.localeCompare(a.name);
    }
    if (sortBy === "stock_desc") {
      return getProductStock(b) - getProductStock(a);
    }
    if (sortBy === "stock_asc") {
      return getProductStock(a) - getProductStock(b);
    }
    if (sortBy === "margin_desc") {
      return getProductMargin(b) - getProductMargin(a);
    }
    if (sortBy === "newest") {
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    }
    return a.name.localeCompare(b.name);
  });

  if (!products.length) {
    return (
      <div className="card">
        <h2 className="section-title">Products</h2>
        <p style={{ margin: 0, color: "#4a5368" }}>No products yet. Create one to get started.</p>
      </div>
    );
  }

  return (
    <div className="card">
      {/* Edit Product Modal */}
      {editingId !== null && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0, 0, 0, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={cancelEdit}
        >
          <div
            style={{
              background: "white",
              borderRadius: 12,
              padding: 24,
              maxWidth: 680,
              width: "100%",
              maxHeight: "90vh",
              overflowY: "auto",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: "0 0 16px", fontSize: 18, fontWeight: 600 }}>
              Edit Product - {editingProduct?.name}
            </h3>
            {showBatchMetadata && editingProduct ? (
              <div
                style={{
                  marginBottom: 16,
                  padding: 12,
                  borderRadius: 10,
                  border: "1px solid #dbeafe",
                  background: "#eff6ff",
                  color: "#1e3a8a",
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                {getProductBatchSummary(editingProduct, { includeNextExpiry: usesExpiryTracking }) || "No active tracked batches yet."}
              </div>
            ) : null}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <label>
                <span style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, display: "block" }}>
                  Product Name *
                </span>
                <input
                  className="input"
                  type="text"
                  value={editForm.name || ""}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  placeholder="Product name"
                  autoFocus
                  style={{ fontSize: 14, padding: 10 }}
                />
              </label>
              <label>
                <span style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, display: "block" }}>
                  SKU *
                </span>
                <input
                  className="input"
                  type="text"
                  value={editForm.sku || ""}
                  onChange={(e) => setEditForm({ ...editForm, sku: e.target.value })}
                  placeholder="SKU"
                  style={{ fontSize: 14, padding: 10 }}
                />
              </label>
              <label>
                <span style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, display: "block" }}>
                  Category
                </span>
                <input
                  className="input"
                  type="text"
                  value={editForm.category || ""}
                  onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
                  placeholder="e.g., Groceries, Beverages"
                  list="edit-category-suggestions"
                  style={{ fontSize: 14, padding: 10 }}
                />
                <datalist id="edit-category-suggestions">
                  {categoryOptions.map((cat) => (
                    <option key={cat} value={cat} />
                  ))}
                </datalist>
              </label>
              <label>
                <span style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, display: "block" }}>
                  Supplier
                </span>
                <input
                  className="input"
                  type="text"
                  value={editForm.supplier || ""}
                  onChange={(e) => setEditForm({ ...editForm, supplier: e.target.value || null })}
                  placeholder="Supplier name or company"
                  style={{ fontSize: 14, padding: 10 }}
                />
              </label>
              <label>
                <span style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, display: "block" }}>
                  Description
                </span>
                <textarea
                  className="input"
                  value={editForm.description || ""}
                  onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                  placeholder="Optional description"
                  rows={3}
                  style={{ fontSize: 14, padding: 10, resize: "vertical" }}
                />
              </label>
              {showVariantMetadata ? (
                <>
                  {capabilities.variants ? (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <label>
                        <span style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, display: "block" }}>
                          Product Family / Model
                        </span>
                        <input
                          className="input"
                          type="text"
                          value={editForm.variant_group || ""}
                          onChange={(e) => setEditForm({ ...editForm, variant_group: e.target.value || null })}
                          placeholder="e.g. Air Max, Series 5"
                          style={{ fontSize: 14, padding: 10 }}
                        />
                      </label>
                      <label>
                        <span style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, display: "block" }}>
                          Variant Name
                        </span>
                        <input
                          className="input"
                          type="text"
                          value={editForm.variant_label || ""}
                          onChange={(e) => setEditForm({ ...editForm, variant_label: e.target.value || null })}
                          placeholder="e.g. Blue / Medium, 64GB"
                          style={{ fontSize: 14, padding: 10 }}
                        />
                      </label>
                    </div>
                  ) : null}
                  {capabilities.brand_shade_attributes ? (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <label>
                        <span style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, display: "block" }}>
                          Brand
                        </span>
                        <input
                          className="input"
                          type="text"
                          value={editForm.brand || ""}
                          onChange={(e) => setEditForm({ ...editForm, brand: e.target.value || null })}
                          placeholder="e.g. Nike, Samsung"
                          style={{ fontSize: 14, padding: 10 }}
                        />
                      </label>
                      <label>
                        <span style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, display: "block" }}>
                          Shade / Finish
                        </span>
                        <input
                          className="input"
                          type="text"
                          value={editForm.shade || ""}
                          onChange={(e) => setEditForm({ ...editForm, shade: e.target.value || null })}
                          placeholder="e.g. Rose Gold, Matte Nude"
                          style={{ fontSize: 14, padding: 10 }}
                        />
                      </label>
                    </div>
                  ) : null}
                  {capabilities.size_color_variants ? (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <label>
                        <span style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, display: "block" }}>
                          Size
                        </span>
                        <input
                          className="input"
                          type="text"
                          value={editForm.size || ""}
                          onChange={(e) => setEditForm({ ...editForm, size: e.target.value || null })}
                          placeholder="e.g. Medium, 42"
                          style={{ fontSize: 14, padding: 10 }}
                        />
                      </label>
                      <label>
                        <span style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, display: "block" }}>
                          Color
                        </span>
                        <input
                          className="input"
                          type="text"
                          value={editForm.color || ""}
                          onChange={(e) => setEditForm({ ...editForm, color: e.target.value || null })}
                          placeholder="e.g. Black, Blue"
                          style={{ fontSize: 14, padding: 10 }}
                        />
                      </label>
                    </div>
                  ) : null}
                </>
              ) : null}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label>
                  <span style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, display: "block" }}>
                    Cost Price (₵) - Per Piece
                  </span>
                  <input
                    className="input"
                    type="number"
                    step="0.01"
                    min="0"
                    value={editForm.cost_price ?? ""}
                    onChange={(e) => setEditForm({ ...editForm, cost_price: e.target.value ? parseFloat(e.target.value) : null })}
                    placeholder="0.00"
                    style={{ fontSize: 14, padding: 10 }}
                  />
                </label>
                <label>
                  <span style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, display: "block" }}>
                    Selling Price (₵) - Per Piece
                  </span>
                  <input
                    className="input"
                    type="number"
                    step="0.01"
                    min="0"
                    value={editForm.selling_price ?? ""}
                    onChange={(e) => setEditForm({ ...editForm, selling_price: e.target.value ? parseFloat(e.target.value) : null })}
                    placeholder="0.00"
                    style={{ fontSize: 14, padding: 10 }}
                  />
                </label>
              </div>
              {editForm.unit !== "pcs" && editForm.unit !== "unit" && editingProduct?.pack_size && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <label>
                    <span style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, display: "block" }}>
                      Pack Cost Price (₵)
                    </span>
                    <input
                      className="input"
                      type="number"
                      step="0.01"
                      min="0"
                      value={editForm.pack_cost_price ?? ""}
                      onChange={(e) => setEditForm({ ...editForm, pack_cost_price: e.target.value ? parseFloat(e.target.value) : null })}
                      placeholder="0.00"
                      style={{ fontSize: 14, padding: 10 }}
                    />
                    <small style={{ color: "#6b7280", fontSize: 12, display: "block", marginTop: 4 }}>
                      Cost per {editForm.unit} ({editingProduct.pack_size} pieces)
                    </small>
                  </label>
                  <label>
                    <span style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, display: "block" }}>
                      Pack Selling Price (₵)
                    </span>
                    <input
                      className="input"
                      type="number"
                      step="0.01"
                      min="0"
                      value={editForm.pack_selling_price ?? ""}
                      onChange={(e) => setEditForm({ ...editForm, pack_selling_price: e.target.value ? parseFloat(e.target.value) : null })}
                      placeholder="0.00"
                      style={{ fontSize: 14, padding: 10 }}
                    />
                    <small style={{ color: "#6b7280", fontSize: 12, display: "block", marginTop: 4 }}>
                      Selling price per {editForm.unit} ({editingProduct.pack_size} pieces)
                    </small>
                  </label>
                </div>
              )}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    usesExpiryTracking && !!editingProduct?.expiry_date
                      ? "1fr 1fr"
                      : "1fr",
                  gap: 12,
                }}
              >
                <label>
                  <span style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, display: "block" }}>
                    Unit
                  </span>
                  <input
                    className="input"
                    type="text"
                    value={editForm.unit || ""}
                    onChange={(e) => setEditForm({ ...editForm, unit: e.target.value })}
                    placeholder="e.g., pcs, kg, liters"
                    style={{ fontSize: 14, padding: 10 }}
                  />
                </label>
                {usesExpiryTracking && !!editingProduct?.expiry_date && (
                <label>
                  <span style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, display: "block" }}>
                    Expiry Date
                  </span>
                  <input
                    className="input"
                    type="date"
                    value={editForm.expiry_date || ""}
                    onChange={(e) => setEditForm({ ...editForm, expiry_date: e.target.value })}
                    style={{ fontSize: 14, padding: 10 }}
                  />
                </label>
                )}
              </div>
              <label>
                <span style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, display: "block" }}>
                  Pack Size
                </span>
                <input
                  className="input"
                  type="number"
                  min="1"
                  step="1"
                  value={editForm.pack_size ?? ""}
                  onChange={(e) => setEditForm({ ...editForm, pack_size: e.target.value ? parseInt(e.target.value, 10) : null })}
                  placeholder="Units per pack/carton"
                  style={{ fontSize: 14, padding: 10 }}
                />
                <small style={{ color: "#6b7280", fontSize: 12, display: "block", marginTop: 4 }}>
                  Keep using pack size for legacy pack pricing while unit conversions stay additive.
                </small>
              </label>
              {showUnitConversionEditor ? (
                <div style={{ border: "1px solid #dbe5f2", borderRadius: 10, padding: 12, background: "#f8fafc" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 10 }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "#1f2937" }}>Units</div>
                      <div style={{ fontSize: 12, color: "#64748b" }}>Define extra sale or purchase units in base {editForm.unit || editingProduct?.unit || "unit"} quantities.</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setUnitConversionDrafts((previous) => [...previous, createUnitConversionDraft()])}
                      style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #cbd5e1", background: "white", cursor: "pointer", fontSize: 12, fontWeight: 700 }}
                    >
                      Add Unit
                    </button>
                  </div>
                  {unitConversionDrafts.length === 0 ? (
                    <p style={{ margin: 0, fontSize: 13, color: "#64748b" }}>No extra unit conversions yet.</p>
                  ) : (
                    <div style={{ display: "grid", gap: 10 }}>
                      {unitConversionDrafts.map((draft, index) => (
                        <div key={`unit-conversion-${index}`} style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 10, background: "#ffffff" }}>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 10, alignItems: "end" }}>
                            <label>
                              <span style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, display: "block" }}>Unit Name</span>
                              <input
                                className="input"
                                type="text"
                                value={draft.unit_name}
                                onChange={(e) => setUnitConversionDrafts((previous) => previous.map((entry, entryIndex) => entryIndex === index ? { ...entry, unit_name: e.target.value } : entry))}
                                placeholder="e.g. carton, box, dozen"
                                style={{ fontSize: 13, padding: 9 }}
                              />
                            </label>
                            <label>
                              <span style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, display: "block" }}>Base Quantity</span>
                              <input
                                className="input"
                                type="number"
                                min="0.01"
                                step="0.01"
                                value={draft.base_quantity}
                                onChange={(e) => setUnitConversionDrafts((previous) => previous.map((entry, entryIndex) => entryIndex === index ? { ...entry, base_quantity: e.target.value } : entry))}
                                placeholder="12"
                                style={{ fontSize: 13, padding: 9 }}
                              />
                            </label>
                            <button
                              type="button"
                              onClick={() => setUnitConversionDrafts((previous) => previous.filter((_, entryIndex) => entryIndex !== index))}
                              style={{ padding: "9px 10px", borderRadius: 8, border: "1px solid #fecdd3", background: "#fff1f2", color: "#be123c", cursor: "pointer", fontSize: 12, fontWeight: 700 }}
                            >
                              Remove
                            </button>
                          </div>
                          <div style={{ display: "flex", gap: 16, marginTop: 10, flexWrap: "wrap" }}>
                            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#475569" }}>
                              <input
                                type="checkbox"
                                checked={draft.is_sale_unit}
                                onChange={(e) => setUnitConversionDrafts((previous) => previous.map((entry, entryIndex) => entryIndex === index ? { ...entry, is_sale_unit: e.target.checked } : entry))}
                              />
                              Sale unit
                            </label>
                            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#475569" }}>
                              <input
                                type="checkbox"
                                checked={draft.is_purchase_unit}
                                onChange={(e) => setUnitConversionDrafts((previous) => previous.map((entry, entryIndex) => entryIndex === index ? { ...entry, is_purchase_unit: e.target.checked } : entry))}
                              />
                              Purchase unit
                            </label>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
              {showVariantEditor ? (
                <div style={{ border: "1px solid #dbe5f2", borderRadius: 10, padding: 12, background: "#f8fafc" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 10 }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "#1f2937" }}>Variants</div>
                      <div style={{ fontSize: 12, color: "#64748b" }}>Manage sellable variant options and optional JSON-style attributes.</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setVariantDrafts((previous) => [...previous, createVariantDraft()])}
                      style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #cbd5e1", background: "white", cursor: "pointer", fontSize: 12, fontWeight: 700 }}
                    >
                      Add Variant
                    </button>
                  </div>
                  {variantDrafts.length === 0 ? (
                    <p style={{ margin: 0, fontSize: 13, color: "#64748b" }}>No additive variants defined.</p>
                  ) : (
                    <div style={{ display: "grid", gap: 10 }}>
                      {variantDrafts.map((draft, index) => (
                        <div key={`variant-${index}`} style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 10, background: "#ffffff" }}>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "end" }}>
                            <label>
                              <span style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, display: "block" }}>Label</span>
                              <input
                                className="input"
                                type="text"
                                value={draft.label}
                                onChange={(e) => setVariantDrafts((previous) => previous.map((entry, entryIndex) => entryIndex === index ? { ...entry, label: e.target.value } : entry))}
                                placeholder="e.g. Red / XL, 500ml"
                                style={{ fontSize: 13, padding: 9 }}
                              />
                            </label>
                            <button
                              type="button"
                              onClick={() => setVariantDrafts((previous) => previous.filter((_, entryIndex) => entryIndex !== index))}
                              style={{ padding: "9px 10px", borderRadius: 8, border: "1px solid #fecdd3", background: "#fff1f2", color: "#be123c", cursor: "pointer", fontSize: 12, fontWeight: 700 }}
                            >
                              Remove
                            </button>
                          </div>
                          <label style={{ display: "block", marginTop: 10 }}>
                            <span style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, display: "block" }}>Attributes</span>
                            <textarea
                              className="input"
                              value={draft.attributesText}
                              onChange={(e) => setVariantDrafts((previous) => previous.map((entry, entryIndex) => entryIndex === index ? { ...entry, attributesText: e.target.value } : entry))}
                              placeholder="size:XL, color:Red"
                              rows={2}
                              style={{ fontSize: 13, padding: 9, resize: "vertical" }}
                            />
                            <small style={{ color: "#6b7280", fontSize: 12, display: "block", marginTop: 4 }}>
                              Use key:value or key=value pairs separated by commas.
                            </small>
                          </label>
                          <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10, fontSize: 12, color: "#475569" }}>
                            <input
                              type="checkbox"
                              checked={draft.isActive}
                              onChange={(e) => setVariantDrafts((previous) => previous.map((entry, entryIndex) => entryIndex === index ? { ...entry, isActive: e.target.checked } : entry))}
                            />
                            Active for sales
                          </label>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button
                  className="button"
                  onClick={() => saveEdit(editingId)}
                  disabled={busy}
                  style={{ flex: 1, background: "#3b82f6", fontSize: 14 }}
                >
                  Save Changes
                </button>
                <button
                  onClick={cancelEdit}
                  disabled={busy}
                  style={{
                    flex: 1,
                    padding: "10px 16px",
                    fontSize: 14,
                    background: "transparent",
                    border: "1px solid #d1d5db",
                    borderRadius: 8,
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        <h2 className="section-title" style={{ margin: 0 }}>Products</h2>
        <span style={{ fontSize: 14, color: "#6b7280" }}>
          Showing {filteredProducts.length} of {products.length}
        </span>
      </div>
      
      {filteredProducts.length === 0 ? (
        <p style={{ margin: 0, color: "#4a5368", textAlign: "center", padding: "40px 0" }}>
          {searchTerm || filterCategory !== "all" || effectiveFilterExpiry !== "all" || filterSupplier !== "all" || filterStock !== "all"
            ? "No products match your filters" 
            : "No products yet. Create one to get started."}
        </p>
      ) : isCompactLayout ? (
        <div style={{ display: "grid", gap: 12 }}>
          {filteredProducts.map((p) => {
            const stock = stockData[p.id];
            const stockLoaded = stock !== undefined;
            const profitMargin = calculateProfitMargin(p.cost_price, p.selling_price);
            const variantSummary = showVariantMetadata ? getProductVariantSummary(p) : null;
            const unitConversionSummary = capabilities.unit_conversions ? getProductUnitConversionSummary(p) : null;
            const batchSummary = showBatchMetadata ? getProductBatchSummary(p, { includeNextExpiry: usesExpiryTracking }) : null;

            return (
              <div
                key={p.id}
                style={{
                  border: "1px solid #dbe5f2",
                  borderRadius: 12,
                  padding: 12,
                  background: "linear-gradient(180deg, #ffffff 0%, #f8fbff 100%)",
                  boxShadow: "0 8px 22px rgba(15, 23, 42, 0.06)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start", marginBottom: 6 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#111827", marginBottom: 2 }}>{p.name}</div>
                    <div style={{ fontSize: 12, color: "#6b7280" }}>SKU: {p.sku}</div>
                    {variantSummary ? (
                      <div style={{ fontSize: 12, color: "#475569", marginTop: 4 }}>{variantSummary}</div>
                    ) : null}
                    {unitConversionSummary ? (
                      <div style={{ fontSize: 12, color: "#0f766e", marginTop: 4 }}>{unitConversionSummary}</div>
                    ) : null}
                    {p.supplier ? (
                      <div style={{ fontSize: 12, color: "#475569", marginTop: 4 }}>Supplier: {p.supplier}</div>
                    ) : null}
                    {batchSummary ? (
                      <div style={{ fontSize: 12, color: "#1d4ed8", marginTop: 4 }}>{batchSummary}</div>
                    ) : null}
                  </div>
                  <span
                    style={{
                      color: !stockLoaded ? "#6b7280" : stock > 0 ? "#059669" : "#dc2626",
                      background: !stockLoaded ? "#f3f4f6" : stock > 0 ? "#d1fae5" : "#fee2e2",
                      padding: "4px 8px",
                      borderRadius: 999,
                      fontSize: 12,
                      fontWeight: 700,
                      flexShrink: 0,
                    }}
                  >
                    {stockLoaded ? `${stock} in stock` : "Loading..."}
                  </span>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7, marginBottom: 8 }}>
                  <div style={{ background: "#eef4ff", borderRadius: 8, padding: 7 }}>
                    <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 2 }}>Cost Price</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#1f2937" }}>{p.cost_price ? `₵${Number(p.cost_price).toFixed(2)}` : "-"}</div>
                  </div>
                  <div style={{ background: "#f0fdf4", borderRadius: 8, padding: 7 }}>
                    <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 2 }}>Selling Price</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#1f2937" }}>{p.selling_price ? `₵${Number(p.selling_price).toFixed(2)}` : "-"}</div>
                  </div>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", marginBottom: 10 }}>
                  <span style={{ background: "#f1f5f9", color: "#334155", padding: "4px 8px", borderRadius: 6, fontSize: 12, fontWeight: 600 }}>
                    {p.category || "General"}
                  </span>
                  <span style={{ fontSize: 12, color: profitMargin !== "-" && parseFloat(profitMargin) > 0 ? "#059669" : "#6b7280", fontWeight: 700 }}>
                    Margin: {profitMargin}
                  </span>
                </div>

                <div
                  style={{
                    display: "grid",
                    gap: 6,
                  }}
                >
                  <button
                    onClick={onOpenInventory}
                    disabled={busy}
                    style={{
                      padding: "8px 11px",
                      fontSize: 12,
                      background: "#0f766e",
                      color: "white",
                      border: "none",
                      borderRadius: 8,
                      cursor: busy ? "not-allowed" : "pointer",
                      fontWeight: 700,
                    }}
                    title="Open Inventory actions"
                  >
                    Open Inventory
                  </button>
                  {canManageCatalog ? (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                      <button
                        onClick={() => startEdit(p)}
                        disabled={busy}
                        style={{
                          padding: "7px 10px",
                          fontSize: 12,
                          background: "#ffffff",
                          color: "#1e293b",
                          border: "1px solid #cbd5e1",
                          borderRadius: 8,
                          cursor: busy ? "not-allowed" : "pointer",
                          fontWeight: 600,
                        }}
                        title="Edit product"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => void handleDelete(p)}
                        disabled={busy}
                        style={{
                          padding: "7px 10px",
                          fontSize: 12,
                          background: "#fff1f2",
                          color: "#be123c",
                          border: "1px solid #fecdd3",
                          borderRadius: 8,
                          cursor: busy ? "not-allowed" : "pointer",
                          fontWeight: 600,
                        }}
                        title="Delete product"
                      >
                        Delete
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ overflowX: "auto", border: "1px solid #dbe5f2", borderRadius: 12, background: "#ffffff", boxShadow: "0 8px 22px rgba(15, 23, 42, 0.06)" }}>
          <table style={{ 
            width: "100%", 
            borderCollapse: "collapse",
            fontSize: 14,
          }}>
            <thead>
              <tr style={{ 
                background: "linear-gradient(180deg, #f8fbff, #edf3ff)", 
                borderBottom: "2px solid #e5e7eb",
              }}>
                <th style={{ padding: "12px", textAlign: "left", fontWeight: 600, color: "#374151" }}>Name</th>
                <th style={{ padding: "12px", textAlign: "left", fontWeight: 600, color: "#374151" }}>SKU</th>
                <th style={{ padding: "12px", textAlign: "left", fontWeight: 600, color: "#374151" }}>Category</th>
                <th style={{ padding: "12px", textAlign: "right", fontWeight: 600, color: "#374151" }}>Stock</th>
                <th style={{ padding: "12px", textAlign: "right", fontWeight: 600, color: "#374151" }}>Cost Price</th>
                <th style={{ padding: "12px", textAlign: "right", fontWeight: 600, color: "#374151" }}>Selling Price</th>
                <th style={{ padding: "12px", textAlign: "right", fontWeight: 600, color: "#374151" }}>Profit Margin</th>
                <th style={{ padding: "12px", textAlign: "left", fontWeight: 600, color: "#374151" }}>Created By</th>
                <th style={{ padding: "12px", textAlign: "center", fontWeight: 600, color: "#374151", width: "280px" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredProducts.map((p) => {
                const stock = stockData[p.id];
                const stockLoaded = stock !== undefined;
                const profitMargin = calculateProfitMargin(p.cost_price, p.selling_price);
                const variantSummary = showVariantMetadata ? getProductVariantSummary(p) : null;
                const unitConversionSummary = capabilities.unit_conversions ? getProductUnitConversionSummary(p) : null;
                const batchSummary = showBatchMetadata ? getProductBatchSummary(p, { includeNextExpiry: usesExpiryTracking }) : null;

                return (
                  <tr key={p.id} style={{ 
                    borderBottom: "1px solid #e5e7eb",
                    transition: "background 0.15s",
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = "#f9fafb"}
                  onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                  >
                    <td style={{ padding: "12px", fontWeight: 500, color: "#111827" }}>
                      <div>{p.name}</div>
                      {variantSummary ? (
                        <div style={{ fontSize: 12, color: "#475569", marginTop: 4 }}>{variantSummary}</div>
                      ) : null}
                      {unitConversionSummary ? (
                        <div style={{ fontSize: 12, color: "#0f766e", marginTop: 4 }}>{unitConversionSummary}</div>
                      ) : null}
                      {p.supplier ? (
                        <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
                          Supplier: {p.supplier}
                        </div>
                      ) : null}
                      {batchSummary ? (
                        <div style={{ fontSize: 12, color: "#1d4ed8", marginTop: 4 }}>{batchSummary}</div>
                      ) : null}
                    </td>
                    <td style={{ padding: "12px", color: "#6b7280", fontFamily: "monospace", fontSize: 13 }}>
                      {p.sku}
                    </td>
                    <td style={{ padding: "12px", color: "#6b7280" }}>
                      <span style={{ 
                        background: "#f3f4f6", 
                        padding: "4px 8px", 
                        borderRadius: 4, 
                        fontSize: 12,
                        fontWeight: 500,
                      }}>
                        {p.category || "General"}
                      </span>
                    </td>
                    <td style={{ padding: "12px", textAlign: "right", fontWeight: 500 }}>
                      <span style={{ 
                        color: !stockLoaded
                          ? "#6b7280"
                          : stock > 0
                            ? "#059669"
                            : "#dc2626",
                        background: !stockLoaded
                          ? "#f3f4f6"
                          : stock > 0
                            ? "#d1fae5"
                            : "#fee2e2",
                        padding: "4px 8px",
                        borderRadius: 4,
                        fontSize: 13,
                      }}>
                        {stockLoaded ? stock : "..."}
                      </span>
                    </td>
                    <td style={{ padding: "12px", textAlign: "right", color: "#374151" }}>
                      {p.cost_price ? `₵${Number(p.cost_price).toFixed(2)}` : "-"}
                    </td>
                    <td style={{ padding: "12px", textAlign: "right", color: "#374151", fontWeight: 500 }}>
                      {p.selling_price ? `₵${Number(p.selling_price).toFixed(2)}` : "-"}
                    </td>
                    <td style={{ padding: "12px", textAlign: "right", fontWeight: 500 }}>
                      <span style={{
                        color: profitMargin !== "-" && parseFloat(profitMargin) > 0 ? "#059669" : "#6b7280",
                      }}>
                        {profitMargin}
                      </span>
                    </td>
                    <td style={{ padding: "12px", color: "#6b7280", fontSize: 13 }}>
                      <span style={{ 
                        background: "#eff6ff", 
                        padding: "4px 8px", 
                        borderRadius: 4, 
                        fontSize: 12,
                        fontWeight: 500,
                        color: "#1e40af",
                      }}>
                        {p.created_by_name || "Unknown"}
                      </span>
                    </td>
                    <td style={{ padding: "12px" }}>
                      <div
                        style={{
                          display: "grid",
                          gap: 6,
                          gridTemplateColumns: "1fr",
                        }}
                      >
                        <button
                          onClick={onOpenInventory}
                          disabled={busy}
                          style={{
                            padding: "7px 12px",
                            fontSize: 12,
                            background: "#0f766e",
                            color: "white",
                            border: "none",
                            borderRadius: 6,
                            cursor: busy ? "not-allowed" : "pointer",
                            fontWeight: 700,
                          }}
                          title="Open Inventory actions"
                        >
                          Open Inventory
                        </button>
                        {canManageCatalog ? (
                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: "1fr 1fr",
                              gap: 6,
                            }}
                          >
                            <button
                              onClick={() => startEdit(p)}
                              disabled={busy}
                              style={{
                                padding: "6px 10px",
                                fontSize: 12,
                                background: "#ffffff",
                                color: "#1e293b",
                                border: "1px solid #cbd5e1",
                                borderRadius: 6,
                                cursor: busy ? "not-allowed" : "pointer",
                                fontWeight: 600,
                              }}
                              title="Edit product"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => void handleDelete(p)}
                              disabled={busy}
                              style={{
                                padding: "6px 10px",
                                fontSize: 12,
                                background: "#fff1f2",
                                color: "#be123c",
                                border: "1px solid #fecdd3",
                                borderRadius: 6,
                                cursor: busy ? "not-allowed" : "pointer",
                                fontWeight: 600,
                              }}
                              title="Delete product"
                            >
                              Delete
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
