import { useCallback, useEffect, useMemo, useState } from "react";

import { createPurchase, createSupplier, fetchPurchases, fetchSuppliers } from "../api";
import type { Product, Purchase, Supplier } from "../types";

type Props = {
  products: Product[];
  usesExpiryTracking?: boolean;
  onPurchaseRecorded?: () => Promise<void> | void;
};

const emptySupplierForm = {
  name: "",
  contact_person: "",
  phone: "",
  email: "",
  address: "",
  notes: "",
};

function toISODate(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function trimOrUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export default function PurchasingPanel({
  products,
  usesExpiryTracking = true,
  onPurchaseRecorded,
}: Props) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<number | null>(null);
  const [selectedSupplierId, setSelectedSupplierId] = useState<number | null>(null);
  const [manualSupplierName, setManualSupplierName] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unitCostPrice, setUnitCostPrice] = useState("");
  const [unitSellingPrice, setUnitSellingPrice] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(() => toISODate(new Date()));
  const [expiryDate, setExpiryDate] = useState("");
  const [notes, setNotes] = useState("");
  const [supplierForm, setSupplierForm] = useState(emptySupplierForm);
  const [loading, setLoading] = useState(true);
  const [submittingPurchase, setSubmittingPurchase] = useState(false);
  const [submittingSupplier, setSubmittingSupplier] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadPanelData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [supplierData, purchaseData] = await Promise.all([
        fetchSuppliers(),
        fetchPurchases(),
      ]);
      setSuppliers(supplierData);
      setPurchases(purchaseData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load purchasing data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPanelData();
  }, [loadPanelData]);

  useEffect(() => {
    if (products.length === 0) {
      setSelectedProductId(null);
      return;
    }

    setSelectedProductId((prev) => {
      if (prev != null && products.some((product) => product.id === prev)) {
        return prev;
      }
      return products[0].id;
    });
  }, [products]);

  const selectedProduct = useMemo(
    () => products.find((product) => product.id === selectedProductId) ?? null,
    [products, selectedProductId],
  );
  const isPerishableProduct = usesExpiryTracking && !!selectedProduct?.expiry_date;
  const totalPurchaseValue = useMemo(
    () => purchases.reduce((sum, purchase) => sum + Number(purchase.total_cost || 0), 0),
    [purchases],
  );

  useEffect(() => {
    if (!selectedProduct) {
      return;
    }

    setUnitCostPrice(selectedProduct.cost_price != null ? String(selectedProduct.cost_price) : "");
    setUnitSellingPrice(selectedProduct.selling_price != null ? String(selectedProduct.selling_price) : "");
    setExpiryDate("");

    if (selectedProduct.supplier) {
      const matchedSupplier = suppliers.find(
        (supplier) => supplier.name.toLowerCase() === selectedProduct.supplier?.toLowerCase(),
      );
      if (matchedSupplier) {
        setSelectedSupplierId(matchedSupplier.id);
        setManualSupplierName("");
      } else {
        setSelectedSupplierId(null);
        setManualSupplierName(selectedProduct.supplier);
      }
    } else {
      setSelectedSupplierId(null);
      setManualSupplierName("");
    }
  }, [selectedProduct?.id, suppliers]);

  const handleCreateSupplier = async () => {
    if (!supplierForm.name.trim()) {
      setError("Supplier name is required");
      return;
    }

    setSubmittingSupplier(true);
    setError(null);
    setNotice(null);
    try {
      const created = await createSupplier({
        name: supplierForm.name.trim(),
        contact_person: trimOrUndefined(supplierForm.contact_person),
        phone: trimOrUndefined(supplierForm.phone),
        email: trimOrUndefined(supplierForm.email),
        address: trimOrUndefined(supplierForm.address),
        notes: trimOrUndefined(supplierForm.notes),
      });
      setSupplierForm(emptySupplierForm);
      setSelectedSupplierId(created.id);
      setManualSupplierName("");
      setNotice(`Supplier ${created.name} added`);
      await loadPanelData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create supplier");
    } finally {
      setSubmittingSupplier(false);
    }
  };

  const handleRecordPurchase = async () => {
    if (!selectedProductId) {
      setError("Select a product first");
      return;
    }

    const quantityValue = Number(quantity);
    const unitCostValue = Number(unitCostPrice);
    const unitSellingValue = unitSellingPrice.trim() === "" ? null : Number(unitSellingPrice);

    if (!Number.isFinite(quantityValue) || quantityValue <= 0) {
      setError("Enter a valid purchase quantity");
      return;
    }

    if (!Number.isFinite(unitCostValue) || unitCostValue < 0) {
      setError("Enter a valid unit cost price");
      return;
    }

    if (unitSellingValue != null && (!Number.isFinite(unitSellingValue) || unitSellingValue < 0)) {
      setError("Enter a valid unit selling price");
      return;
    }

    if (isPerishableProduct && !expiryDate) {
      setError("Expiry date is required for this perishable product");
      return;
    }

    if (selectedSupplierId == null && !manualSupplierName.trim()) {
      setError("Select a supplier or type a supplier name");
      return;
    }

    setSubmittingPurchase(true);
    setError(null);
    setNotice(null);
    try {
      const purchase = await createPurchase({
        product_id: selectedProductId,
        supplier_id: selectedSupplierId ?? undefined,
        supplier_name: selectedSupplierId == null ? manualSupplierName.trim() : undefined,
        invoice_number: trimOrUndefined(invoiceNumber),
        quantity: quantityValue,
        unit_cost_price: unitCostValue,
        unit_selling_price: unitSellingValue ?? undefined,
        purchase_date: purchaseDate || undefined,
        expiry_date: isPerishableProduct ? (expiryDate || undefined) : undefined,
        notes: trimOrUndefined(notes),
      });

      setInvoiceNumber("");
      setQuantity("1");
      setNotes("");
      setExpiryDate("");
      setNotice(`Purchase recorded for ${purchase.product_name}`);
      await loadPanelData();
      if (onPurchaseRecorded) {
        await onPurchaseRecorded();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record purchase");
    } finally {
      setSubmittingPurchase(false);
    }
  };

  const formatCurrency = (value: number) => `GHS ${value.toFixed(2)}`;
  const formatDate = (value: string | null | undefined) => {
    if (!value) return "-";
    return new Date(value).toLocaleDateString();
  };

  return (
    <div style={{ display: "grid", gap: 20 }}>
      {error ? (
        <div style={{ padding: "12px 14px", borderRadius: 10, border: "1px solid #fecaca", background: "#fef2f2", color: "#991b1b", fontSize: 14 }}>
          {error}
        </div>
      ) : null}
      {notice ? (
        <div style={{ padding: "12px 14px", borderRadius: 10, border: "1px solid #bbf7d0", background: "#f0fdf4", color: "#166534", fontSize: 14 }}>
          {notice}
        </div>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
        <div style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 14, padding: 18 }}>
          <div style={{ fontSize: 13, color: "#64748b", marginBottom: 6 }}>Active Suppliers</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: "#0f172a" }}>{suppliers.length}</div>
        </div>
        <div style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 14, padding: 18 }}>
          <div style={{ fontSize: 13, color: "#64748b", marginBottom: 6 }}>Recent Purchases</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: "#0f172a" }}>{purchases.length}</div>
        </div>
        <div style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 14, padding: 18 }}>
          <div style={{ fontSize: 13, color: "#64748b", marginBottom: 6 }}>Purchase Value</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: "#0f172a" }}>{formatCurrency(totalPurchaseValue)}</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 20, alignItems: "start" }}>
        <div className="card" style={{ marginBottom: 0 }}>
          <div style={{ marginBottom: 16 }}>
            <h3 style={{ margin: "0 0 6px", fontSize: 18, fontWeight: 700 }}>Supplier Directory</h3>
            <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>
              Save suppliers once, then reuse them when recording purchases.
            </p>
          </div>

          <div style={{ display: "grid", gap: 12 }}>
            <label>
              <span style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 600, color: "#374151" }}>Supplier Name</span>
              <input
                className="input"
                value={supplierForm.name}
                onChange={(e) => setSupplierForm((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="e.g. Kasapreko Distributor"
              />
            </label>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
              <label>
                <span style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 600, color: "#374151" }}>Contact Person</span>
                <input
                  className="input"
                  value={supplierForm.contact_person}
                  onChange={(e) => setSupplierForm((prev) => ({ ...prev, contact_person: e.target.value }))}
                  placeholder="Optional"
                />
              </label>
              <label>
                <span style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 600, color: "#374151" }}>Phone</span>
                <input
                  className="input"
                  value={supplierForm.phone}
                  onChange={(e) => setSupplierForm((prev) => ({ ...prev, phone: e.target.value }))}
                  placeholder="024..."
                />
              </label>
            </div>

            <label>
              <span style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 600, color: "#374151" }}>Email</span>
              <input
                className="input"
                value={supplierForm.email}
                onChange={(e) => setSupplierForm((prev) => ({ ...prev, email: e.target.value }))}
                placeholder="supplier@example.com"
              />
            </label>

            <label>
              <span style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 600, color: "#374151" }}>Address / Notes</span>
              <textarea
                className="textarea"
                value={`${supplierForm.address}${supplierForm.address && supplierForm.notes ? "\n" : ""}${supplierForm.notes}`}
                onChange={(e) => {
                  const [firstLine, ...rest] = e.target.value.split("\n");
                  setSupplierForm((prev) => ({
                    ...prev,
                    address: firstLine,
                    notes: rest.join("\n"),
                  }));
                }}
                rows={3}
                placeholder="Address on the first line, extra notes below"
              />
            </label>

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                type="button"
                className="button"
                onClick={() => void handleCreateSupplier()}
                disabled={submittingSupplier}
              >
                {submittingSupplier ? "Saving..." : "Add Supplier"}
              </button>
            </div>
          </div>

          <div style={{ marginTop: 18, borderTop: "1px solid #e5e7eb", paddingTop: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#334155", marginBottom: 10 }}>Saved Suppliers</div>
            {loading && suppliers.length === 0 ? (
              <p style={{ margin: 0, color: "#6b7280", fontSize: 14 }}>Loading suppliers...</p>
            ) : suppliers.length === 0 ? (
              <p style={{ margin: 0, color: "#6b7280", fontSize: 14 }}>No suppliers yet.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {suppliers.slice(0, 6).map((supplier) => (
                  <button
                    key={supplier.id}
                    type="button"
                    onClick={() => {
                      setSelectedSupplierId(supplier.id);
                      setManualSupplierName("");
                    }}
                    style={{
                      textAlign: "left",
                      padding: "10px 12px",
                      borderRadius: 10,
                      border: supplier.id === selectedSupplierId ? "1px solid #2563eb" : "1px solid #e2e8f0",
                      background: supplier.id === selectedSupplierId ? "#eff6ff" : "#ffffff",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a" }}>{supplier.name}</div>
                    <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                      {supplier.contact_person || supplier.phone || supplier.email || "No contact details yet"}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="card" style={{ marginBottom: 0 }}>
          <div style={{ marginBottom: 16 }}>
            <h3 style={{ margin: "0 0 6px", fontSize: 18, fontWeight: 700 }}>Record Purchase</h3>
            <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>
              Record supplier purchases and turn them into stock-in with cost details.
            </p>
          </div>

          <div style={{ display: "grid", gap: 12 }}>
            <label>
              <span style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 600, color: "#374151" }}>Product</span>
              <select
                className="input"
                value={selectedProductId ?? ""}
                onChange={(e) => setSelectedProductId(e.target.value ? Number(e.target.value) : null)}
                disabled={products.length === 0 || submittingPurchase}
              >
                {products.length === 0 ? <option value="">No products available</option> : null}
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name} ({product.sku})
                  </option>
                ))}
              </select>
            </label>

            {selectedProduct ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, padding: 12, border: "1px solid #e2e8f0", background: "#f8fafc", borderRadius: 10 }}>
                <div>
                  <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>Current Stock</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a" }}>{Number(selectedProduct.current_stock || 0)}</div>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>Current Supplier</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a" }}>{selectedProduct.supplier || "Not set"}</div>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>Perishability</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: isPerishableProduct ? "#b45309" : "#334155" }}>
                    {isPerishableProduct ? "Perishable" : "Non-perishable"}
                  </div>
                </div>
              </div>
            ) : null}

            <label>
              <span style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 600, color: "#374151" }}>Supplier</span>
              <select
                className="input"
                value={selectedSupplierId ?? ""}
                onChange={(e) => setSelectedSupplierId(e.target.value ? Number(e.target.value) : null)}
                disabled={submittingPurchase}
              >
                <option value="">Type supplier name manually</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </select>
            </label>

            {selectedSupplierId == null ? (
              <label>
                <span style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 600, color: "#374151" }}>Supplier Name</span>
                <input
                  className="input"
                  value={manualSupplierName}
                  onChange={(e) => setManualSupplierName(e.target.value)}
                  placeholder="Type a supplier name"
                  disabled={submittingPurchase}
                />
              </label>
            ) : null}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
              <label>
                <span style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 600, color: "#374151" }}>Invoice Number</span>
                <input
                  className="input"
                  value={invoiceNumber}
                  onChange={(e) => setInvoiceNumber(e.target.value)}
                  placeholder="Optional"
                  disabled={submittingPurchase}
                />
              </label>
              <label>
                <span style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 600, color: "#374151" }}>Purchase Date</span>
                <input
                  className="input"
                  type="date"
                  value={purchaseDate}
                  onChange={(e) => setPurchaseDate(e.target.value)}
                  disabled={submittingPurchase}
                />
              </label>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
              <label>
                <span style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 600, color: "#374151" }}>Quantity</span>
                <input
                  className="input"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  disabled={submittingPurchase}
                />
              </label>
              <label>
                <span style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 600, color: "#374151" }}>Unit Cost Price</span>
                <input
                  className="input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={unitCostPrice}
                  onChange={(e) => setUnitCostPrice(e.target.value)}
                  disabled={submittingPurchase}
                />
              </label>
              <label>
                <span style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 600, color: "#374151" }}>Unit Selling Price</span>
                <input
                  className="input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={unitSellingPrice}
                  onChange={(e) => setUnitSellingPrice(e.target.value)}
                  disabled={submittingPurchase}
                />
              </label>
            </div>

            {isPerishableProduct ? (
              <label>
                <span style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 600, color: "#374151" }}>Batch Expiry Date</span>
                <input
                  className="input"
                  type="date"
                  value={expiryDate}
                  onChange={(e) => setExpiryDate(e.target.value)}
                  disabled={submittingPurchase}
                />
              </label>
            ) : null}

            <label>
              <span style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 600, color: "#374151" }}>Notes</span>
              <textarea
                className="textarea"
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional purchase note"
                disabled={submittingPurchase}
              />
            </label>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div style={{ fontSize: 13, color: "#475569" }}>
                Estimated total: <strong>{formatCurrency((Number(quantity || 0) || 0) * (Number(unitCostPrice || 0) || 0))}</strong>
              </div>
              <button
                type="button"
                className="button"
                onClick={() => void handleRecordPurchase()}
                disabled={submittingPurchase || products.length === 0}
              >
                {submittingPurchase ? "Recording..." : "Record Purchase"}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 0 }}>
        <div style={{ marginBottom: 16 }}>
          <h3 style={{ margin: "0 0 6px", fontSize: 18, fontWeight: 700 }}>Recent Purchases</h3>
          <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>
            Review recent stock purchases and supplier activity for this branch.
          </p>
        </div>

        {loading && purchases.length === 0 ? (
          <p style={{ margin: 0, color: "#6b7280" }}>Loading purchase history...</p>
        ) : purchases.length === 0 ? (
          <p style={{ margin: 0, color: "#6b7280" }}>No purchases recorded yet.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
              <thead>
                <tr style={{ background: "#f8fafc" }}>
                  <th style={{ padding: 12, textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>Date</th>
                  <th style={{ padding: 12, textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>Supplier</th>
                  <th style={{ padding: 12, textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>Product</th>
                  <th style={{ padding: 12, textAlign: "right", borderBottom: "1px solid #e5e7eb" }}>Qty</th>
                  <th style={{ padding: 12, textAlign: "right", borderBottom: "1px solid #e5e7eb" }}>Unit Cost</th>
                  <th style={{ padding: 12, textAlign: "right", borderBottom: "1px solid #e5e7eb" }}>Total</th>
                  <th style={{ padding: 12, textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>Invoice</th>
                </tr>
              </thead>
              <tbody>
                {purchases.map((purchase) => (
                  <tr key={purchase.id} style={{ borderBottom: "1px solid #e5e7eb" }}>
                    <td style={{ padding: 12, fontSize: 14 }}>{formatDate(purchase.purchase_date || purchase.created_at)}</td>
                    <td style={{ padding: 12, fontSize: 14 }}>
                      <div style={{ fontWeight: 700, color: "#0f172a" }}>{purchase.supplier_name}</div>
                      <div style={{ color: "#6b7280", fontSize: 12 }}>{purchase.created_by_name || "System"}</div>
                    </td>
                    <td style={{ padding: 12, fontSize: 14 }}>
                      <div style={{ fontWeight: 700, color: "#0f172a" }}>{purchase.product_name}</div>
                      <div style={{ color: "#6b7280", fontSize: 12 }}>{purchase.product_sku}</div>
                    </td>
                    <td style={{ padding: 12, fontSize: 14, textAlign: "right" }}>{Number(purchase.quantity).toFixed(2)}</td>
                    <td style={{ padding: 12, fontSize: 14, textAlign: "right" }}>{formatCurrency(Number(purchase.unit_cost_price || 0))}</td>
                    <td style={{ padding: 12, fontSize: 14, textAlign: "right", fontWeight: 700 }}>{formatCurrency(Number(purchase.total_cost || 0))}</td>
                    <td style={{ padding: 12, fontSize: 14, color: "#475569" }}>{purchase.invoice_number || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
