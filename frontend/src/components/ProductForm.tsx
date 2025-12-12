import React, { useState } from "react";

import { NewProduct } from "../types";

type Props = {
  onCreate: (payload: NewProduct) => Promise<void>;
  onCancel?: () => void;
};

const CATEGORIES = [
  "Groceries",
  "Beverages",
  "Household",
  "Electronics",
  "Clothing",
  "Health & Beauty",
  "Office Supplies",
  "Tools & Hardware",
  "Sports & Outdoors",
  "Other",
];

const UNITS = ["pcs", "box", "pack", "dozen", "carton", "bundle", "unit"];

export default function ProductForm({ onCreate, onCancel }: Props) {
  const [form, setForm] = useState<NewProduct & { 
    category?: string; 
    barcode?: string;
    costPrice?: string;
    packCostPrice?: string;
    sellingPrice?: string;
    packSellingPrice?: string;
    initialStock?: string;
    initialLocation?: string;
    packSize?: string;
    reorderLevel?: string;
    supplier?: string;
    status?: string;
  }>({ 
    sku: "", 
    name: "", 
    description: "", 
    unit: "pcs",
    pack_size: null,
    expiry_date: null,
    category: CATEGORIES[0],
    barcode: "",
    costPrice: "",
    packCostPrice: "",
    sellingPrice: "",
    packSellingPrice: "",
    initialStock: "0",
    initialLocation: "Main Store",
    packSize: "",
    reorderLevel: "10",
    supplier: "",
    status: "active",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveMode, setSaveMode] = useState<"save" | "saveAndNew">("save");

  const generateSKU = () => {
    const prefix = form.category?.substring(0, 3).toUpperCase() || "PRD";
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    setForm({ ...form, sku: `${prefix}-${random}` });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // Calculate actual stock based on unit type
      let actualStock = form.initialStock ? parseFloat(form.initialStock) : undefined;
      
      // If unit is pack/box/carton/etc (not pcs/unit) and pack_size exists, multiply
      if (form.unit !== "pcs" && form.unit !== "unit" && form.packSize && actualStock) {
        const packSize = parseInt(form.packSize);
        actualStock = actualStock * packSize;
      }
      
      await onCreate({ 
        sku: form.sku,
        name: form.name,
        description: form.description || undefined,
        unit: form.unit || "pcs",
        pack_size: form.packSize ? parseInt(form.packSize) : undefined,
        category: form.category || undefined,
        expiry_date: form.expiry_date || undefined,
        cost_price: form.costPrice ? parseFloat(form.costPrice) : undefined,
        pack_cost_price: form.packCostPrice ? parseFloat(form.packCostPrice) : undefined,
        selling_price: form.sellingPrice ? parseFloat(form.sellingPrice) : undefined,
        pack_selling_price: form.packSellingPrice ? parseFloat(form.packSellingPrice) : undefined,
        initial_stock: actualStock,
        initial_location: form.initialLocation || undefined,
      });
      
      if (saveMode === "saveAndNew") {
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
          supplier: "",
          status: "active",
        });
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
    }
  };

  return (
    <div className="card" style={{ maxWidth: 900, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h2 className="section-title" style={{ margin: 0 }}>Add New Product</h2>
        <button
          type="button"
          className="button"
          onClick={generateSKU}
          style={{ background: "#6b7280", padding: "8px 14px" }}
        >
          🔄 Generate SKU
        </button>
      </div>

      <form onSubmit={submit} className="grid" style={{ gap: 20 }}>
        {/* Basic Information */}
        <div>
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
                <select
                  className="input"
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                >
                  {CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </label>
              <label>
                Barcode
                <input
                  className="input"
                  value={form.barcode}
                  onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                  placeholder="Scan or enter barcode"
                />
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
              Expiry Date (Optional)
              <input
                className="input"
                type="date"
                value={form.expiry_date ?? ""}
                onChange={(e) => setForm({ ...form, expiry_date: e.target.value || null })}
                min={new Date().toISOString().split('T')[0]}
              />
              <small style={{ color: "#6b7280", fontSize: 12, marginTop: 4, display: "block" }}>
                Leave empty for non-perishable items
              </small>
            </label>
          </div>
        </div>

        {/* Pricing & Inventory */}
        <div>
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
                Initial Location
                <select
                  className="input"
                  value={form.initialLocation}
                  onChange={(e) => setForm({ ...form, initialLocation: e.target.value })}
                >
                  <option value="Main Store">Main Store</option>
                  <option value="Warehouse A">Warehouse A</option>
                  <option value="Warehouse B">Warehouse B</option>
                  <option value="Cold Storage">Cold Storage</option>
                  <option value="Display Area">Display Area</option>
                  <option value="Back Room">Back Room</option>
                </select>
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
        <div>
          <h3 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 12px", color: "#1a2235" }}>
            Additional Details
          </h3>
          <div className="grid" style={{ gap: 12 }}>
            <label>
              Supplier
              <input
                className="input"
                value={form.supplier}
                onChange={(e) => setForm({ ...form, supplier: e.target.value })}
                placeholder="Supplier name or company"
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
        <div style={{ display: "flex", gap: 12, paddingTop: 12, borderTop: "1px solid #e6e9f2" }}>
          <button
            className="button"
            type="submit"
            disabled={busy}
            onClick={() => setSaveMode("save")}
            style={{ flex: 1 }}
          >
            {busy && saveMode === "save" ? "Saving..." : "💾 Save Product"}
          </button>
          <button
            className="button"
            type="submit"
            disabled={busy}
            onClick={() => setSaveMode("saveAndNew")}
            style={{ flex: 1, background: "#10b981" }}
          >
            {busy && saveMode === "saveAndNew" ? "Saving..." : "➕ Save & Add Another"}
          </button>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              style={{
                padding: "10px 20px",
                background: "transparent",
                border: "1px solid #d8dce8",
                borderRadius: 10,
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              Cancel
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
