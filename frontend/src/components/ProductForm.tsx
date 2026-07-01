import React, { useEffect, useMemo, useRef, useState } from "react";

import { Branch, MeasurementType, NewProduct, Supplier } from "../types";
import { useAppCategories, userNeedsExpiryTracking } from "../categories";
import { createSupplier, updateMyCategories } from "../api";
import { startCameraBarcodeScan } from "../barcode-scanner";
import { useCapabilities } from "../settings";
import { hasUserPermission, readStoredUser } from "../user-storage";
import ImagePicker from "./ImagePicker";

type Props = {
  onCreate: (payload: NewProduct, branchIdOverride?: number | null) => Promise<void>;
  onCancel?: () => void;
  onSupplierDirectoryChanged?: () => Promise<void> | void;
  userRole?: string;
  branches?: Branch[];
  activeBranchId?: number | null;
  existingSuppliers?: Supplier[];
  layoutMode?: "card" | "modal";
};

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

const UNIT_SUGGESTIONS = [
  "pcs",
  "unit",
  "box",
  "pack",
  "dozen",
  "carton",
  "bundle",
  "kg",
  "g",
  "litre",
  "ml",
  "meter",
  "cm",
  "bag",
  "sack",
  "rod",
];
const MAX_VISIBLE_SUPPLIER_OPTIONS = 100;

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

export default function ProductForm({
  onCreate,
  onCancel,
  onSupplierDirectoryChanged,
  userRole = "Admin",
  branches,
  activeBranchId,
  existingSuppliers,
  layoutMode = "card",
}: Props) {
  const categoryOptions = useAppCategories();
  const capabilities = useCapabilities();
  // Expiry only applies to businesses that actually sell perishable/dated stock
  // (e.g. Pharmacy, Grocery) — not Construction, Hardware, Fashion, Electronics.
  const expiryEnabled = capabilities.expiry_tracking && userNeedsExpiryTracking();
  const canConfigureMeasurement = capabilities.fractional_sales || capabilities.length_based_sales || capabilities.unit_conversions;
  const canConfigureVariants = capabilities.variants || capabilities.size_color_variants || capabilities.brand_shade_attributes;
  const measurementTypeOptions = useMemo<Array<{ value: MeasurementType; label: string }>>(() => {
    const options: Array<{ value: MeasurementType; label: string }> = [
      { value: "count", label: "Count / Pieces" },
    ];

    if (capabilities.fractional_sales || capabilities.unit_conversions) {
      options.push(
        { value: "weight", label: "Weight" },
        { value: "volume", label: "Volume" },
      );
    }

    if (capabilities.length_based_sales) {
      options.push({ value: "length", label: "Length" });
    }

    return options;
  }, [capabilities.fractional_sales, capabilities.length_based_sales, capabilities.unit_conversions]);

  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [isPerishable, setIsPerishable] = useState(false);
  const [supplierSearchTerm, setSupplierSearchTerm] = useState("");
  const [locallyCreatedSupplierNames, setLocallyCreatedSupplierNames] = useState<string[]>([]);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraStatus, setCameraStatus] = useState<string | null>(null);

  const [selectedBranchId, setSelectedBranchId] = useState<number | null>(null);
  const [variantDrafts, setVariantDrafts] = useState<VariantDraft[]>([]);
  const [unitConversionDrafts, setUnitConversionDrafts] = useState<UnitConversionDraft[]>([]);
  const barcodeInputRef = useRef<HTMLInputElement | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const stopCameraScannerRef = useRef<(() => void) | null>(null);

  const [form, setForm] = useState<NewProduct & {
    category?: string; 
    barcode?: string;
    quantityStep?: string;
    costPrice?: string;
    packCostPrice?: string;
    sellingPrice?: string;
    packSellingPrice?: string;
    initialStock?: string;
    packSize?: string;
    reorderLevel?: string;
    status?: string;
  }>({ 
    sku: "", 
    name: "", 
    description: "", 
    unit: "pcs",
    measurement_type: "count",
    allows_fractional_sales: false,
    variant_group: "",
    variant_label: "",
    brand: "",
    size: "",
    color: "",
    shade: "",
    pack_size: null,
    expiry_date: null,
    category: categoryOptions[0] ?? "",
    barcode: "",
    quantityStep: "1",
    costPrice: "",
    packCostPrice: "",
    sellingPrice: "",
    packSellingPrice: "",
    initialStock: "0",
    packSize: "",
    reorderLevel: "10",
    supplier: "",
    status: "active",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submittingMode, setSubmittingMode] = useState<"save" | "saveAndNew" | null>(null);

  const role = userRole;
  const accessUser = readStoredUser() ?? { role };
  const canManageBranches = hasUserPermission("manage_branches", accessUser);
  const isModalLayout = layoutMode === "modal";
  const modalSectionStyle = isModalLayout
    ? {
        border: "1px solid #e2e8f0",
        borderRadius: 12,
        background: "#f8fafc",
        padding: 12,
      }
    : undefined;

  const visibleBranches = useMemo(() => branches ?? [], [branches]);
  const existingSupplierNames = useMemo(() => {
    const suppliersByKey = new Map<string, string>();

    (existingSuppliers ?? []).forEach((supplier) => {
      const supplierName = (supplier.name || "").trim();
      if (!supplierName) {
        return;
      }

      const normalizedName = supplierName.toLowerCase();
      if (!suppliersByKey.has(normalizedName)) {
        suppliersByKey.set(normalizedName, supplierName);
      }
    });

    return Array.from(suppliersByKey.values()).sort((left, right) => left.localeCompare(right));
  }, [existingSuppliers]);
  const allSupplierNames = useMemo(() => {
    const suppliersByKey = new Map<string, string>();

    existingSupplierNames.forEach((supplierName) => {
      suppliersByKey.set(supplierName.toLowerCase(), supplierName);
    });

    locallyCreatedSupplierNames.forEach((supplierName) => {
      const cleanedName = supplierName.trim();
      if (!cleanedName) {
        return;
      }
      suppliersByKey.set(cleanedName.toLowerCase(), cleanedName);
    });

    return Array.from(suppliersByKey.values()).sort((left, right) => left.localeCompare(right));
  }, [existingSupplierNames, locallyCreatedSupplierNames]);
  const filteredSupplierNames = useMemo(() => {
    const normalizedSearch = supplierSearchTerm.trim().toLowerCase();
    if (!normalizedSearch) {
      return allSupplierNames;
    }

    return allSupplierNames.filter((supplierName) => supplierName.toLowerCase().includes(normalizedSearch));
  }, [allSupplierNames, supplierSearchTerm]);
  const visibleSupplierOptions = useMemo(
    () => filteredSupplierNames.slice(0, MAX_VISIBLE_SUPPLIER_OPTIONS),
    [filteredSupplierNames],
  );
  const hiddenSupplierOptionCount = Math.max(filteredSupplierNames.length - visibleSupplierOptions.length, 0);
  const selectedKnownSupplierName = useMemo(() => {
    const currentSupplierName = (form.supplier || "").trim();
    if (!currentSupplierName) {
      return "";
    }

    return allSupplierNames.find((name) => name.toLowerCase() === currentSupplierName.toLowerCase()) ?? "";
  }, [allSupplierNames, form.supplier]);

  const effectiveBranchId = useMemo(() => {
    if (canManageBranches) {
      if (selectedBranchId != null) return selectedBranchId;
      if (activeBranchId != null) return activeBranchId;
      return visibleBranches[0]?.id ?? null;
    }
    return activeBranchId ?? null;
  }, [canManageBranches, selectedBranchId, activeBranchId, visibleBranches]);

  const generateSKU = () => {
    const prefix = form.category?.substring(0, 3).toUpperCase() || "PRD";
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    setForm({ ...form, sku: `${prefix}-${random}` });
  };

  useEffect(() => {
    if (!cameraOpen) {
      stopCameraScannerRef.current?.();
      stopCameraScannerRef.current = null;
      setCameraStatus(null);
      return;
    }

    const startCamera = async () => {
      setCameraError(null);
      setCameraStatus("Starting camera...");
      const videoElement = cameraVideoRef.current;
      if (!videoElement) {
        setCameraError("Camera preview is not available.");
        setCameraStatus(null);
        return;
      }

      stopCameraScannerRef.current = await startCameraBarcodeScan({
        videoElement,
        onDetected: (rawValue) => {
          setCameraStatus("Barcode detected.");
          setForm((previousForm) => ({ ...previousForm, barcode: rawValue }));
          setCameraOpen(false);
          window.setTimeout(() => {
            barcodeInputRef.current?.focus();
            barcodeInputRef.current?.select();
          }, 0);
        },
        onError: (message) => {
          setCameraError(message);
          setCameraStatus(null);
        },
      });

      if (!cameraError) {
        setCameraStatus("Live scan active. Hold the barcode inside the guide.");
      }
    };

    void startCamera();

    return () => {
      stopCameraScannerRef.current?.();
      stopCameraScannerRef.current = null;
    };
  }, [cameraOpen]);

  useEffect(() => {
    if (expiryEnabled) {
      return;
    }

    setIsPerishable(false);
    setForm((previousForm) => {
      if (!previousForm.expiry_date) {
        return previousForm;
      }
      return { ...previousForm, expiry_date: null };
    });
  }, [expiryEnabled]);

  useEffect(() => {
    setForm((previousForm) => {
      const nextMeasurementType = measurementTypeOptions.some((option) => option.value === previousForm.measurement_type)
        ? (previousForm.measurement_type ?? "count")
        : "count";

      let nextForm = previousForm;
      let changed = false;

      if (previousForm.measurement_type !== nextMeasurementType) {
        nextForm = { ...nextForm, measurement_type: nextMeasurementType };
        changed = true;
      }

      if (!capabilities.fractional_sales) {
        if (nextForm.allows_fractional_sales) {
          nextForm = { ...nextForm, allows_fractional_sales: false };
          changed = true;
        }
        if ((nextForm.quantityStep ?? "1") !== "1") {
          nextForm = { ...nextForm, quantityStep: "1" };
          changed = true;
        }
      }

      return changed ? nextForm : previousForm;
    });
  }, [capabilities.fractional_sales, measurementTypeOptions]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();

    const nativeEvent = e.nativeEvent as SubmitEvent;
    const submitter = nativeEvent.submitter as HTMLButtonElement | null;
    const mode = (submitter?.dataset.saveMode as "save" | "saveAndNew" | undefined) ?? "save";

    const allowsFractionalSales = capabilities.fractional_sales && Boolean(form.allows_fractional_sales);
    const parsedQuantityStep = Number.parseFloat(form.quantityStep ?? "1");
    const quantityStep = allowsFractionalSales && Number.isFinite(parsedQuantityStep) && parsedQuantityStep > 0
      ? parsedQuantityStep
      : 1;
    const measurementType = measurementTypeOptions.some((option) => option.value === form.measurement_type)
      ? (form.measurement_type ?? "count")
      : "count";

    if (expiryEnabled && isPerishable && !form.expiry_date) {
      setError("Expiry date is required for perishable goods");
      return;
    }

    const supplierName = (form.supplier || "").trim();
    if (!supplierName) {
      setError("Supplier is required");
      return;
    }

    const normalizedSupplierName =
      allSupplierNames.find((name) => name.toLowerCase() === supplierName.toLowerCase()) ?? supplierName;

    const isKnownSupplier = allSupplierNames.some((name) => name.toLowerCase() === normalizedSupplierName.toLowerCase());
    const preparedVariants = variantDrafts.reduce<NewProduct["variants"]>((items, draft, index) => {
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
    const preparedUnitConversions = unitConversionDrafts.reduce<NewProduct["unit_conversions"]>((items, draft, index) => {
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

    setBusy(true);
    setSubmittingMode(mode);
    setError(null);
    try {
      if (!isKnownSupplier) {
        try {
          const createdSupplier = await createSupplier({
            name: normalizedSupplierName,
          });
          setLocallyCreatedSupplierNames((previousSuppliers) => {
            if (previousSuppliers.some((name) => name.toLowerCase() === createdSupplier.name.toLowerCase())) {
              return previousSuppliers;
            }
            return [...previousSuppliers, createdSupplier.name];
          });
          if (onSupplierDirectoryChanged) {
            await onSupplierDirectoryChanged();
          }
        } catch (supplierError) {
          const supplierErrorMessage = supplierError instanceof Error ? supplierError.message : "Failed to create supplier";
          if (!/already exists/i.test(supplierErrorMessage)) {
            throw new Error(`Failed to add supplier to supplier directory: ${supplierErrorMessage}`);
          }
          if (onSupplierDirectoryChanged) {
            await onSupplierDirectoryChanged();
          }
        }
      }

      // If user typed a new category, persist it to the business categories list (Admin only).
      const selectedCategory = (form.category ?? "").trim();
      if (selectedCategory) {
        const exists = categoryOptions.some((c) => c.toLowerCase() === selectedCategory.toLowerCase());
        if (!exists) {
          try {
            await updateMyCategories([...categoryOptions, selectedCategory]);
          } catch {
            // Don't block product creation if categories can't be persisted.
          }
        }
      }

      // Calculate actual stock based on unit type
      let actualStock = form.initialStock ? parseFloat(form.initialStock) : undefined;
      
      // If unit is pack/box/carton/etc (not pcs/unit) and pack_size exists, multiply
      if (form.unit !== "pcs" && form.unit !== "unit" && form.packSize && actualStock) {
        const packSize = parseInt(form.packSize);
        actualStock = actualStock * packSize;
      }
      
      await onCreate({ 
        sku: form.sku,
        barcode: (form.barcode || "").trim() || undefined,
        name: form.name,
        description: form.description || undefined,
        unit: form.unit || "pcs",
        measurement_type: measurementType,
        allows_fractional_sales: allowsFractionalSales,
        quantity_step: quantityStep,
        variant_group: cleanOptionalText(form.variant_group),
        variant_label: cleanOptionalText(form.variant_label),
        brand: cleanOptionalText(form.brand),
        size: cleanOptionalText(form.size),
        color: cleanOptionalText(form.color),
        shade: cleanOptionalText(form.shade),
        pack_size: form.packSize ? parseInt(form.packSize) : undefined,
        category: form.category || undefined,
        supplier: normalizedSupplierName,
        expiry_date: expiryEnabled && isPerishable ? (form.expiry_date || undefined) : undefined,
        cost_price: form.costPrice ? parseFloat(form.costPrice) : undefined,
        pack_cost_price: form.packCostPrice ? parseFloat(form.packCostPrice) : undefined,
        selling_price: form.sellingPrice ? parseFloat(form.sellingPrice) : undefined,
        pack_selling_price: form.packSellingPrice ? parseFloat(form.packSellingPrice) : undefined,
        image: form.image ?? undefined,
        initial_stock: actualStock,
        variants: preparedVariants,
        unit_conversions: preparedUnitConversions,
      }, canManageBranches ? effectiveBranchId : null);
      
      if (mode === "saveAndNew") {
        // Clear form but keep category and unit
        setForm({ 
          sku: "", 
          name: "", 
          description: "", 
          unit: form.unit,
          measurement_type: measurementType,
          allows_fractional_sales: allowsFractionalSales,
          variant_group: "",
          variant_label: "",
          brand: "",
          size: "",
          color: "",
          shade: "",
          pack_size: null,
          expiry_date: null,
          category: form.category,
          barcode: "",
          quantityStep: String(quantityStep),
          costPrice: "",
          packCostPrice: "",
          sellingPrice: "",
          packSellingPrice: "",
          initialStock: "0",
          packSize: "",
          reorderLevel: form.reorderLevel,
          supplier: normalizedSupplierName,
          status: form.status || "active",
        });
        setVariantDrafts([]);
        setUnitConversionDrafts([]);
        setIsPerishable(false);
        // Focus on name field
        setTimeout(() => {
          const nameInput = document.querySelector('input[name="name"]') as HTMLInputElement;
          nameInput?.focus();
        }, 0);
      } else if (onCancel) {
        onCancel();
      }
    } catch (err) {
      setError((err as Error).message || "Failed to create product");
    } finally {
      setBusy(false);
      setSubmittingMode(null);
    }
  };

  return (
    <div className={isModalLayout ? undefined : "card"} style={{ maxWidth: 900, margin: "0 auto", paddingTop: isModalLayout ? 8 : 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: isModalLayout ? 16 : 24, gap: 12 }}>
        <div>
          <h2 className="section-title" style={{ margin: 0 }}>Add New Product</h2>
          {isModalLayout ? <p style={{ margin: "4px 0 0", fontSize: 13, color: "#64748b" }}>Set essentials first, then optional fields below.</p> : null}
        </div>
        <button
          type="button"
          className="button"
          onClick={generateSKU}
          style={{
            background: isModalLayout ? "#334155" : "#6b7280",
            padding: isModalLayout ? "7px 12px" : "8px 14px",
            fontSize: isModalLayout ? 12 : undefined,
            borderRadius: isModalLayout ? 999 : undefined,
            fontWeight: 700,
          }}
        >
          Generate SKU
        </button>
      </div>

      <form onSubmit={submit} className="grid" style={{ gap: isModalLayout ? 14 : 20 }}>
        {/* Core */}
        <div style={modalSectionStyle}>
          <h3 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 12px", color: "#1a2235" }}>
            Core
          </h3>
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "block", marginBottom: 8, fontSize: 14, fontWeight: 500 }}>Product Photo</label>
            <ImagePicker
              value={form.image}
              onChange={(url) => setForm({ ...form, image: url ?? undefined })}
              disabled={busy}
            />
          </div>
          <div className="grid" style={{ gap: 12 }}>
            <div className="form-row">
              <label>
                Product Name *
                <input
                  className="input"
                  name="name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g., Coca Cola 500ml"
                  required
                  minLength={1}
                  autoFocus
                />
              </label>
              <label>
                SKU / Product Code *
                <input
                  className="input"
                  value={form.sku}
                  onChange={(e) => setForm({ ...form, sku: e.target.value })}
                  placeholder="Auto-generate or enter manually"
                  required
                  minLength={1}
                />
              </label>
            </div>
            <div className="form-row">
              <label>
                Category
                {categoryOptions.length > 0 && !addingCategory ? (
                  <select
                    className="input"
                    value={form.category}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (value === "__add_new__") {
                        setAddingCategory(true);
                        setNewCategoryName("");
                        return;
                      }
                      setForm({ ...form, category: value });
                    }}
                  >
                    {categoryOptions.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                    <option value="__add_new__">+ Add new category…</option>
                  </select>
                ) : (
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      className="input"
                      value={addingCategory ? newCategoryName : (form.category ?? "")}
                      onChange={(e) => {
                        const value = e.target.value;
                        if (addingCategory) setNewCategoryName(value);
                        else setForm({ ...form, category: value });
                      }}
                      placeholder="Type a category"
                    />
                    {categoryOptions.length > 0 && addingCategory && (
                      <>
                        <button
                          type="button"
                          className="button"
                          onClick={async () => {
                            const value = newCategoryName.trim();
                            if (!value) return;
                            setForm({ ...form, category: value });
                            setAddingCategory(false);
                            setNewCategoryName("");
                            try {
                              await updateMyCategories([...categoryOptions, value]);
                            } catch {
                              // Ignore; category will still be saved on the product.
                            }
                          }}
                        >
                          Add
                        </button>
                        <button
                          type="button"
                          className="button"
                          onClick={() => {
                            setAddingCategory(false);
                            setNewCategoryName("");
                          }}
                        >
                          Cancel
                        </button>
                      </>
                    )}
                  </div>
                )}
              </label>
              <label>
                Barcode
                <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
                  <input
                    ref={barcodeInputRef}
                    className="input"
                    value={form.barcode}
                    onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                    placeholder="Scan or enter barcode"
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    className="button"
                    onClick={() => {
                      setCameraError(null);
                      setCameraStatus("Starting camera...");
                      setCameraOpen(true);
                    }}
                    style={{
                      padding: isModalLayout ? "0 14px" : "0 16px",
                      minWidth: 78,
                      background: "#1d4ed8",
                      borderRadius: 10,
                      fontSize: 13,
                      fontWeight: 700,
                    }}
                  >
                    Scan
                  </button>
                </div>
                <small style={{ color: "#6b7280", fontSize: 12, marginTop: 4, display: "block" }}>
                  Use a barcode scanner while this field is focused, or tap Scan to use the camera.
                </small>
              </label>
            </div>
            <label>
              Description
              <textarea
                className="textarea"
                value={form.description ?? ""}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Product details, features, etc."
                rows={3}
              />
            </label>
            <label>
              Saved Suppliers
              <input
                className="input"
                value={supplierSearchTerm}
                onChange={(e) => setSupplierSearchTerm(e.target.value)}
                placeholder={allSupplierNames.length > MAX_VISIBLE_SUPPLIER_OPTIONS ? "Search suppliers by name" : "Filter saved suppliers"}
                style={{ marginBottom: 8 }}
              />
              <select
                className="input"
                value={selectedKnownSupplierName}
                onChange={(e) => {
                  const supplierName = e.target.value;
                  if (!supplierName) {
                    return;
                  }
                  setForm({ ...form, supplier: supplierName });
                }}
                disabled={allSupplierNames.length === 0}
              >
                <option value="">{allSupplierNames.length === 0 ? "No saved suppliers available" : `Select an existing supplier (${allSupplierNames.length} saved)`}</option>
                {visibleSupplierOptions.map((supplierName) => (
                  <option key={supplierName} value={supplierName}>
                    {supplierName}
                  </option>
                ))}
              </select>
              <small style={{ color: "#6b7280", fontSize: 12, marginTop: 4, display: "block" }}>
                Pick a supplier from your supplier directory or type a new one below. This supplier is used to match products in Purchasing.
              </small>
              {hiddenSupplierOptionCount > 0 ? (
                <small style={{ color: "#1d4ed8", fontSize: 12, marginTop: 4, display: "block", fontWeight: 600 }}>
                  Showing first {MAX_VISIBLE_SUPPLIER_OPTIONS} results. Refine search to find the remaining {hiddenSupplierOptionCount} suppliers.
                </small>
              ) : null}
            </label>
            <label>
              Supplier Name *
              <input
                className="input"
                value={form.supplier}
                onChange={(e) => setForm({ ...form, supplier: e.target.value })}
                placeholder="Supplier name or company"
                required
              />
            </label>
          </div>
        </div>

        {/* Expiry — only for businesses that sell perishable/dated stock */}
        {expiryEnabled && (
        <div style={modalSectionStyle}>
          <h3 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 12px", color: "#1a2235" }}>
            Expiry
          </h3>
            <div className="grid" style={{ gap: 12 }}>
              <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="perishableType"
                    checked={!isPerishable}
                    onChange={() => {
                      setIsPerishable(false);
                      setForm({ ...form, expiry_date: null });
                    }}
                    style={{ width: 18, height: 18, accentColor: "#3b82f6" }}
                  />
                  <span style={{ fontSize: 14 }}>Non-Perishable</span>
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="perishableType"
                    checked={isPerishable}
                    onChange={() => setIsPerishable(true)}
                    style={{ width: 18, height: 18, accentColor: "#3b82f6" }}
                  />
                  <span style={{ fontSize: 14 }}>Perishable</span>
                </label>
              </div>
              <label>
                Expiry Date {isPerishable ? "*" : ""}
                <input
                  className="input"
                  type="date"
                  value={form.expiry_date ?? ""}
                  onChange={(e) => setForm({ ...form, expiry_date: e.target.value || null })}
                  min={new Date().toISOString().split("T")[0]}
                  required={isPerishable}
                  disabled={!isPerishable}
                />
                <small style={{ color: isPerishable ? "#ef4444" : "#6b7280", fontSize: 12, marginTop: 4, display: "block" }}>
                  {isPerishable ? "Required for perishable goods." : "Optional while this product is marked non-perishable."}
                </small>
              </label>
            </div>
        </div>
        )}

        {/* Units */}
        <div style={modalSectionStyle}>
          <h3 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 12px", color: "#1a2235" }}>
            Units
          </h3>
          <div className="grid" style={{ gap: 12 }}>
            <div className="form-row">
              <label>
                Cost Price (Per Piece)
                <input
                  className="input"
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.costPrice}
                  onChange={(e) => setForm({ ...form, costPrice: e.target.value })}
                  placeholder="0.00"
                />
                <small style={{ color: "#6b7280", fontSize: 12, marginTop: 4, display: "block" }}>
                  Cost per individual piece
                </small>
              </label>
              <label>
                Selling Price (Per Piece)
                <input
                  className="input"
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.sellingPrice}
                  onChange={(e) => setForm({ ...form, sellingPrice: e.target.value })}
                  placeholder="0.00"
                />
                <small style={{ color: "#6b7280", fontSize: 12, marginTop: 4, display: "block" }}>
                  Selling price per individual piece
                </small>
              </label>
            </div>
            
            {/* Pack Pricing - only show if unit is not pcs/unit */}
            {form.unit !== "pcs" && form.unit !== "unit" && form.packSize && (
              <div className="form-row">
                <label>
                  Pack Cost Price
                  <input
                    className="input"
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.packCostPrice}
                    onChange={(e) => setForm({ ...form, packCostPrice: e.target.value })}
                    placeholder="0.00"
                  />
                  <small style={{ color: "#6b7280", fontSize: 12, marginTop: 4, display: "block" }}>
                    Cost per {form.unit} ({form.packSize} pieces)
                  </small>
                </label>
                <label>
                  Pack Selling Price
                  <input
                    className="input"
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.packSellingPrice}
                    onChange={(e) => setForm({ ...form, packSellingPrice: e.target.value })}
                    placeholder="0.00"
                  />
                  <small style={{ color: "#6b7280", fontSize: 12, marginTop: 4, display: "block" }}>
                    Selling price per {form.unit} ({form.packSize} pieces)
                  </small>
                </label>
              </div>
            )}
            <div className="form-row">
              <label>
                Unit of Measure
                <input
                  className="input"
                  list="product-unit-suggestions"
                  value={form.unit}
                  onChange={(e) => setForm({ ...form, unit: e.target.value })}
                  placeholder="e.g. pcs, kg, litre, meter"
                />
                <datalist id="product-unit-suggestions">
                  {UNIT_SUGGESTIONS.map((unit) => (
                    <option key={unit} value={unit} />
                  ))}
                </datalist>
              </label>
              {form.unit !== "pcs" && form.unit !== "unit" && (
                <label>
                  Pack Size (Items per {form.unit})
                  <input
                    className="input"
                    type="number"
                    min="1"
                    value={form.packSize}
                    onChange={(e) => setForm({ ...form, packSize: e.target.value })}
                    placeholder="e.g., 24 bottles per carton"
                  />
                  <small style={{ color: "#6b7280", fontSize: 12, marginTop: 4, display: "block" }}>
                    How many items in one {form.unit}?
                  </small>
                </label>
              )}
            </div>
            {canConfigureMeasurement ? (
              <>
                <div className="form-row">
                  <label>
                    Measurement Type
                    <select
                      className="input"
                      value={form.measurement_type ?? "count"}
                      onChange={(e) => setForm({ ...form, measurement_type: e.target.value as MeasurementType })}
                    >
                      {measurementTypeOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                    <small style={{ color: "#6b7280", fontSize: 12, marginTop: 4, display: "block" }}>
                      Choose how this product's quantity is measured at sale time.
                    </small>
                  </label>
                  {capabilities.fractional_sales ? (
                    <label>
                      Fractional Sales
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          minHeight: 42,
                          padding: "0 12px",
                          border: "1px solid #d1d5db",
                          borderRadius: 8,
                          background: "#fff",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={Boolean(form.allows_fractional_sales)}
                          onChange={(e) => setForm({
                            ...form,
                            allows_fractional_sales: e.target.checked,
                            quantityStep: e.target.checked ? (form.quantityStep || "0.25") : "1",
                          })}
                        />
                        <span style={{ fontSize: 14, color: "#111827" }}>Allow fractional sales for this product</span>
                      </div>
                      <small style={{ color: "#6b7280", fontSize: 12, marginTop: 4, display: "block" }}>
                        Use this for measured products sold in steps like 0.25 or 0.50.
                      </small>
                    </label>
                  ) : null}
                </div>
                {capabilities.fractional_sales ? (
                  <div className="form-row">
                    <label>
                      Quantity Step
                      <input
                        className="input"
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={form.quantityStep ?? "1"}
                        onChange={(e) => setForm({ ...form, quantityStep: e.target.value })}
                        disabled={!form.allows_fractional_sales}
                        placeholder="1.00"
                      />
                      <small style={{ color: "#6b7280", fontSize: 12, marginTop: 4, display: "block" }}>
                        {form.allows_fractional_sales
                          ? "Customers must buy in multiples of this quantity."
                          : "Whole-number quantities only while fractional sales are disabled."}
                      </small>
                    </label>
                  </div>
                ) : null}
              </>
            ) : null}
            {capabilities.unit_conversions ? (
              <div style={{ display: "grid", gap: 10, padding: 12, borderRadius: 10, background: "#f8fafc", border: "1px solid #e2e8f0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a" }}>Alternate Sale Units</div>
                    <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                      Define additional sale units like sack, half-bag, or rod using this product&apos;s base unit.
                    </div>
                  </div>
                  <button
                    type="button"
                    className="button"
                    onClick={() => setUnitConversionDrafts((previous) => [...previous, createUnitConversionDraft()])}
                    style={{ padding: "8px 12px", fontSize: 12, fontWeight: 700 }}
                  >
                    Add Unit
                  </button>
                </div>
                {unitConversionDrafts.length === 0 ? (
                  <div style={{ fontSize: 12, color: "#64748b" }}>
                    No extra sale units yet. Base sales will use {form.unit || "the chosen unit"}.
                  </div>
                ) : (
                  unitConversionDrafts.map((draft, index) => (
                    <div key={`unit-conversion-${index}`} style={{ display: "grid", gap: 8, padding: 10, borderRadius: 8, border: "1px solid #dbe5f2", background: "#fff" }}>
                      <div className="form-row">
                        <label>
                          Unit Name
                          <input
                            className="input"
                            value={draft.unit_name}
                            onChange={(e) => setUnitConversionDrafts((previous) => previous.map((entry, entryIndex) => entryIndex === index ? { ...entry, unit_name: e.target.value } : entry))}
                            placeholder="e.g. sack, half-bag, rod"
                          />
                        </label>
                        <label>
                          Base Quantity
                          <input
                            className="input"
                            type="number"
                            min="0.01"
                            step="0.01"
                            value={draft.base_quantity}
                            onChange={(e) => setUnitConversionDrafts((previous) => previous.map((entry, entryIndex) => entryIndex === index ? { ...entry, base_quantity: e.target.value } : entry))}
                            placeholder={`How many ${form.unit || "base units"}?`}
                          />
                        </label>
                      </div>
                      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
                        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#334155" }}>
                          <input
                            type="checkbox"
                            checked={draft.is_sale_unit}
                            onChange={(e) => setUnitConversionDrafts((previous) => previous.map((entry, entryIndex) => entryIndex === index ? { ...entry, is_sale_unit: e.target.checked } : entry))}
                          />
                          Available in POS
                        </label>
                        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#334155" }}>
                          <input
                            type="checkbox"
                            checked={draft.is_purchase_unit}
                            onChange={(e) => setUnitConversionDrafts((previous) => previous.map((entry, entryIndex) => entryIndex === index ? { ...entry, is_purchase_unit: e.target.checked } : entry))}
                          />
                          Available in purchasing
                        </label>
                        <button
                          type="button"
                          onClick={() => setUnitConversionDrafts((previous) => previous.filter((_, entryIndex) => entryIndex !== index))}
                          style={{ border: "none", background: "transparent", color: "#dc2626", fontWeight: 700, cursor: "pointer", padding: 0 }}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            ) : null}
            <div className="form-row">
              <label>
                Initial Stock
                <input
                  className="input"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step={capabilities.fractional_sales && form.allows_fractional_sales ? (form.quantityStep || "0.01") : "1"}
                  value={form.initialStock}
                  onChange={(e) => setForm({ ...form, initialStock: e.target.value })}
                  placeholder={capabilities.fractional_sales && form.allows_fractional_sales ? "0.00" : "0"}
                />
                <small style={{ color: "#6b7280", fontSize: 12, marginTop: 4, display: "block" }}>
                  {form.unit !== "pcs" && form.unit !== "unit" && form.packSize 
                    ? `Number of ${form.unit}s (will be × ${form.packSize} = ${(parseFloat(form.initialStock || "0") * parseInt(form.packSize)).toFixed(0)} pieces)`
                    : "Number of pieces"}
                </small>
              </label>
              <label>
                Branch
                {canManageBranches && visibleBranches.length > 0 ? (
                  <select
                    className="input"
                    value={String(effectiveBranchId ?? visibleBranches[0].id)}
                    onChange={(e) => setSelectedBranchId(Number(e.target.value))}
                  >
                    {visibleBranches.map((b) => (
                      <option key={b.id} value={String(b.id)}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    className="input"
                    value={
                      visibleBranches.length > 0
                        ? (visibleBranches.find((b) => b.id === effectiveBranchId)?.name ?? visibleBranches[0]?.name ?? "Branch")
                        : "No branch available"
                    }
                    readOnly
                  />
                )}
              </label>
            </div>
            <label>
              Reorder Level (Low Stock Alert)
              <input
                className="input"
                type="number"
                min="0"
                value={form.reorderLevel}
                onChange={(e) => setForm({ ...form, reorderLevel: e.target.value })}
                placeholder="10"
              />
            </label>
          </div>
        </div>

        {/* Variants */}
        <div style={modalSectionStyle}>
          <h3 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 12px", color: "#1a2235" }}>
            Variants
          </h3>
          <div className="grid" style={{ gap: 12 }}>
            {canConfigureVariants ? (
              <>
                {capabilities.variants ? (
                  <div className="form-row">
                    <label>
                      Product Family / Model
                      <input
                        className="input"
                        type="text"
                        value={form.variant_group ?? ""}
                        onChange={(e) => setForm({ ...form, variant_group: e.target.value })}
                        placeholder="e.g. Air Max, Series 5"
                      />
                    </label>
                    <label>
                      Variant Name
                      <input
                        className="input"
                        type="text"
                        value={form.variant_label ?? ""}
                        onChange={(e) => setForm({ ...form, variant_label: e.target.value })}
                        placeholder="e.g. Blue / Medium, 64GB"
                      />
                    </label>
                  </div>
                ) : null}

                {capabilities.brand_shade_attributes ? (
                  <div className="form-row">
                    <label>
                      Brand
                      <input
                        className="input"
                        type="text"
                        value={form.brand ?? ""}
                        onChange={(e) => setForm({ ...form, brand: e.target.value })}
                        placeholder="e.g. Nike, Samsung"
                      />
                    </label>
                    <label>
                      Shade / Finish
                      <input
                        className="input"
                        type="text"
                        value={form.shade ?? ""}
                        onChange={(e) => setForm({ ...form, shade: e.target.value })}
                        placeholder="e.g. Rose Gold, Matte Nude"
                      />
                    </label>
                  </div>
                ) : null}

                {capabilities.size_color_variants ? (
                  <div className="form-row">
                    <label>
                      Size
                      <input
                        className="input"
                        type="text"
                        value={form.size ?? ""}
                        onChange={(e) => setForm({ ...form, size: e.target.value })}
                        placeholder="e.g. Medium, 42"
                      />
                    </label>
                    <label>
                      Color
                      <input
                        className="input"
                        type="text"
                        value={form.color ?? ""}
                        onChange={(e) => setForm({ ...form, color: e.target.value })}
                        placeholder="e.g. Black, Blue"
                      />
                    </label>
                  </div>
                ) : null}
              </>
            ) : (
              <p style={{ margin: 0, color: "#64748b", fontSize: 14 }}>
                Variant controls are currently disabled for this business type.
              </p>
            )}

            {(capabilities.variants || capabilities.size_color_variants || capabilities.brand_shade_attributes) ? (
              <div style={{ display: "grid", gap: 10, padding: 12, borderRadius: 10, background: "#f8fafc", border: "1px solid #e2e8f0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a" }}>Variant Options</div>
                    <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                      Add optional sellable variants. Use attributes like size=42 or color=navy.
                    </div>
                  </div>
                  <button
                    type="button"
                    className="button"
                    onClick={() => setVariantDrafts((previous) => [...previous, createVariantDraft()])}
                    style={{ padding: "8px 12px", fontSize: 12, fontWeight: 700 }}
                  >
                    Add Variant
                  </button>
                </div>
                {variantDrafts.length === 0 ? (
                  <div style={{ fontSize: 12, color: "#64748b" }}>
                    No product variants added yet. Leave this empty if one product row is enough.
                  </div>
                ) : (
                  variantDrafts.map((draft, index) => (
                    <div key={`variant-draft-${index}`} style={{ display: "grid", gap: 8, padding: 10, borderRadius: 8, border: "1px solid #dbe5f2", background: "#fff" }}>
                      <div className="form-row">
                        <label>
                          Variant Label
                          <input
                            className="input"
                            value={draft.label}
                            onChange={(e) => setVariantDrafts((previous) => previous.map((entry, entryIndex) => entryIndex === index ? { ...entry, label: e.target.value } : entry))}
                            placeholder="e.g. Medium / Navy"
                          />
                        </label>
                        <label>
                          Attributes
                          <textarea
                            className="textarea"
                            rows={2}
                            value={draft.attributesText}
                            onChange={(e) => setVariantDrafts((previous) => previous.map((entry, entryIndex) => entryIndex === index ? { ...entry, attributesText: e.target.value } : entry))}
                            placeholder="size=42, color=navy, shade=matte"
                          />
                        </label>
                      </div>
                      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
                        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#334155" }}>
                          <input
                            type="checkbox"
                            checked={draft.isActive}
                            onChange={(e) => setVariantDrafts((previous) => previous.map((entry, entryIndex) => entryIndex === index ? { ...entry, isActive: e.target.checked } : entry))}
                          />
                          Active in POS
                        </label>
                        <button
                          type="button"
                          onClick={() => setVariantDrafts((previous) => previous.filter((_, entryIndex) => entryIndex !== index))}
                          style={{ border: "none", background: "transparent", color: "#dc2626", fontWeight: 700, cursor: "pointer", padding: 0 }}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            ) : null}
          </div>
        </div>

        {error ? <p style={{ color: "#d14343", margin: 0 }}>{error}</p> : null}

        {/* Action Buttons */}
        <div style={{ display: "flex", gap: 10, paddingTop: 12, borderTop: "1px solid #e6e9f2", flexWrap: "wrap", justifyContent: isModalLayout ? "flex-end" : "flex-start" }}>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              style={{
                padding: isModalLayout ? "9px 14px" : "10px 20px",
                background: "transparent",
                border: "1px solid #d8dce8",
                borderRadius: 10,
                cursor: "pointer",
                fontWeight: 600,
                color: "#475569",
              }}
            >
              Cancel
            </button>
          )}
          <button
            className="button"
            type="submit"
            disabled={busy}
            data-save-mode="save"
            style={{ flex: isModalLayout ? undefined : 1, minWidth: isModalLayout ? 160 : undefined }}
          >
            {busy && submittingMode === "save" ? "Saving..." : "Save Product"}
          </button>
          <button
            className="button"
            type="submit"
            disabled={busy}
            data-save-mode="saveAndNew"
            style={{ flex: isModalLayout ? undefined : 1, minWidth: isModalLayout ? 168 : undefined, background: "#10b981" }}
          >
            {busy && submittingMode === "saveAndNew" ? "Saving..." : "Save & Add Another"}
          </button>
        </div>
      </form>

      {cameraOpen && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(15, 23, 42, 0.78)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1050,
            padding: 16,
          }}
          onClick={() => setCameraOpen(false)}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 520,
              background: "#020617",
              borderRadius: 12,
              border: "1px solid #1e293b",
              padding: 14,
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <h3 style={{ margin: 0, fontSize: 16, color: "#e2e8f0" }}>Scan Product Barcode</h3>
              <button
                type="button"
                onClick={() => setCameraOpen(false)}
                style={{
                  border: "1px solid #334155",
                  borderRadius: 6,
                  background: "#0f172a",
                  color: "#e2e8f0",
                  fontSize: 12,
                  fontWeight: 700,
                  padding: "6px 10px",
                  cursor: "pointer",
                }}
              >
                Close
              </button>
            </div>
            <div style={{ position: "relative", borderRadius: 10, overflow: "hidden", background: "#0b1220" }}>
              <video
                ref={cameraVideoRef}
                autoPlay
                muted
                playsInline
                style={{ width: "100%", background: "#0b1220", minHeight: 280, objectFit: "cover", display: "block" }}
              />
              <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
                <div
                  style={{
                    position: "absolute",
                    top: 12,
                    left: 12,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    background: "rgba(15, 23, 42, 0.84)",
                    color: "#e2e8f0",
                    border: "1px solid rgba(51, 65, 85, 0.9)",
                    borderRadius: 999,
                    padding: "7px 12px",
                    fontSize: 12,
                    fontWeight: 700,
                    maxWidth: "calc(100% - 24px)",
                  }}
                >
                  <span
                    style={{
                      width: 9,
                      height: 9,
                      borderRadius: "50%",
                      background: cameraError ? "#f87171" : "#22c55e",
                      boxShadow: cameraError ? "0 0 12px rgba(248, 113, 113, 0.55)" : "0 0 12px rgba(34, 197, 94, 0.7)",
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {cameraError ? "Scan unavailable" : (cameraStatus || "Live scan active")}
                  </span>
                </div>
                <div
                  style={{
                    position: "absolute",
                    left: "50%",
                    top: "50%",
                    width: "70%",
                    height: "34%",
                    transform: "translate(-50%, -50%)",
                    borderRadius: 18,
                    border: "2px solid rgba(34, 197, 94, 0.88)",
                    boxShadow: "0 0 0 9999px rgba(2, 6, 23, 0.16)",
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    left: "20%",
                    right: "20%",
                    top: "50%",
                    height: 2,
                    transform: "translateY(-50%)",
                    background: "linear-gradient(90deg, transparent, rgba(34, 197, 94, 0.95), transparent)",
                    boxShadow: "0 0 18px rgba(34, 197, 94, 0.55)",
                  }}
                />
              </div>
            </div>
            <p style={{ margin: "10px 0 0", fontSize: 12, color: "#94a3b8" }}>
              Align the product barcode inside the guide. Move closer until the barcode fills most of the box.
            </p>
            {cameraError ? (
              <p style={{ margin: "8px 0 0", fontSize: 12, color: "#fca5a5" }}>{cameraError}</p>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
