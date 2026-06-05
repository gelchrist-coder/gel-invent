import React, { useEffect, useMemo, useRef, useState } from "react";

import { Branch, NewProduct, Supplier } from "../types";
import { useAppCategories } from "../categories";
import { createSupplier, updateMyCategories } from "../api";
import { startCameraBarcodeScan } from "../barcode-scanner";
import { hasUserPermission, readStoredUser } from "../user-storage";

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

const UNITS = ["pcs", "box", "pack", "dozen", "carton", "bundle", "unit"];
const MAX_VISIBLE_SUPPLIER_OPTIONS = 100;

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

  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [isPerishable, setIsPerishable] = useState(false);
  const [supplierSearchTerm, setSupplierSearchTerm] = useState("");
  const [locallyCreatedSupplierNames, setLocallyCreatedSupplierNames] = useState<string[]>([]);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const [selectedBranchId, setSelectedBranchId] = useState<number | null>(null);
  const barcodeInputRef = useRef<HTMLInputElement | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const stopCameraScannerRef = useRef<(() => void) | null>(null);

  const [form, setForm] = useState<NewProduct & {
    category?: string; 
    barcode?: string;
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
    pack_size: null,
    expiry_date: null,
    category: categoryOptions[0] ?? "",
    barcode: "",
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
      return;
    }

    const startCamera = async () => {
      setCameraError(null);
      const videoElement = cameraVideoRef.current;
      if (!videoElement) {
        setCameraError("Camera preview is not available.");
        return;
      }

      stopCameraScannerRef.current = await startCameraBarcodeScan({
        videoElement,
        onDetected: (rawValue) => {
          setForm((previousForm) => ({ ...previousForm, barcode: rawValue }));
          setCameraOpen(false);
          window.setTimeout(() => {
            barcodeInputRef.current?.focus();
            barcodeInputRef.current?.select();
          }, 0);
        },
        onError: setCameraError,
      });
    };

    void startCamera();

    return () => {
      stopCameraScannerRef.current?.();
      stopCameraScannerRef.current = null;
    };
  }, [cameraOpen]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();

    const nativeEvent = e.nativeEvent as SubmitEvent;
    const submitter = nativeEvent.submitter as HTMLButtonElement | null;
    const mode = (submitter?.dataset.saveMode as "save" | "saveAndNew" | undefined) ?? "save";

    if (isPerishable && !form.expiry_date) {
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
        pack_size: form.packSize ? parseInt(form.packSize) : undefined,
        category: form.category || undefined,
        supplier: normalizedSupplierName,
        expiry_date: isPerishable ? (form.expiry_date || undefined) : undefined,
        cost_price: form.costPrice ? parseFloat(form.costPrice) : undefined,
        pack_cost_price: form.packCostPrice ? parseFloat(form.packCostPrice) : undefined,
        selling_price: form.sellingPrice ? parseFloat(form.sellingPrice) : undefined,
        pack_selling_price: form.packSellingPrice ? parseFloat(form.packSellingPrice) : undefined,
        initial_stock: actualStock,
      }, canManageBranches ? effectiveBranchId : null);
      
      if (mode === "saveAndNew") {
        // Clear form but keep category and unit
        setForm({ 
          sku: "", 
          name: "", 
          description: "", 
          unit: form.unit,
          pack_size: null,
          expiry_date: null,
          category: form.category,
          barcode: "",
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
        {/* Basic Information */}
        <div style={modalSectionStyle}>
          <h3 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 12px", color: "#1a2235" }}>
            Basic Information
          </h3>
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

            <div style={{ marginTop: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, display: "block" }}>Product Type</span>
              <div style={{ display: "flex", gap: 24, marginBottom: 12 }}>
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

              {isPerishable && (
                <label>
                  Expiry Date *
                  <input
                    className="input"
                    type="date"
                    value={form.expiry_date ?? ""}
                    onChange={(e) => setForm({ ...form, expiry_date: e.target.value || null })}
                    min={new Date().toISOString().split("T")[0]}
                    required
                  />
                  <small style={{ color: "#ef4444", fontSize: 12, marginTop: 4, display: "block" }}>
                    Required for perishable goods
                  </small>
                </label>
              )}
            </div>
          </div>
        </div>

        {/* Pricing & Inventory */}
        <div style={modalSectionStyle}>
          <h3 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 12px", color: "#1a2235" }}>
            Pricing & Inventory
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
                <select
                  className="input"
                  value={form.unit}
                  onChange={(e) => setForm({ ...form, unit: e.target.value })}
                >
                  {UNITS.map((u) => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
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
            <div className="form-row">
              <label>
                Initial Stock
                <input
                  className="input"
                  type="number"
                  min="0"
                  value={form.initialStock}
                  onChange={(e) => setForm({ ...form, initialStock: e.target.value })}
                  placeholder="0"
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

        {/* Additional Details */}
        <div style={modalSectionStyle}>
          <h3 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 12px", color: "#1a2235" }}>
            Additional Details
          </h3>
          <div className="grid" style={{ gap: 12 }}>
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
            <label>
              Status
              <div style={{ display: "flex", gap: 16, marginTop: 8 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="status"
                    value="active"
                    checked={form.status === "active"}
                    onChange={(e) => setForm({ ...form, status: e.target.value })}
                  />
                  <span>Active</span>
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="status"
                    value="inactive"
                    checked={form.status === "inactive"}
                    onChange={(e) => setForm({ ...form, status: e.target.value })}
                  />
                  <span>Inactive</span>
                </label>
              </div>
            </label>
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
            <video
              ref={cameraVideoRef}
              autoPlay
              muted
              playsInline
              style={{ width: "100%", borderRadius: 10, background: "#0b1220", minHeight: 280, objectFit: "cover" }}
            />
            <p style={{ margin: "10px 0 0", fontSize: 12, color: "#94a3b8" }}>
              Align the product barcode inside the frame. The code will fill the barcode field automatically.
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
