import { useCallback, useEffect, useState } from "react";
import type { ComponentProps } from "react";
import { createBranchTransfer, createMovement, deleteProduct, fetchAllMovements, fetchBranches, fetchInventoryAnalytics, fetchProducts, exportMovementsPdf } from "../api";
import InventoryOverview from "../components/InventoryOverview";
import StockAlerts from "../components/StockAlerts";
import MovementHistory from "../components/MovementHistory";
import { useExpiryTracking } from "../settings";
import type { Branch, Product } from "../types";

type InventoryAnalytics = ComponentProps<typeof InventoryOverview>["analytics"];
type MovementHistoryRow = ComponentProps<typeof MovementHistory>["movements"][number];

export default function Inventory() {
  // Check if current user is Admin
  const currentUser = localStorage.getItem("user");
  const userRole = currentUser ? JSON.parse(currentUser).role : null;
  const isAdmin = userRole === "Admin";
  const usesExpiryTracking = useExpiryTracking();

  const [analytics, setAnalytics] = useState<InventoryAnalytics | null>(null);
  const [movements, setMovements] = useState<MovementHistoryRow[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<number | null>(null);
  const [actionType, setActionType] = useState<"new_stock" | "damage" | "transfer" | "delete">("new_stock");
  const [quantity, setQuantity] = useState<string>("");
  const [stockReason, setStockReason] = useState<string>("New Stock");
  const [damageReason, setDamageReason] = useState<string>("Damaged");
  const [notes, setNotes] = useState<string>("");
  const [destinationBranchId, setDestinationBranchId] = useState<number | null>(null);
  const [expiryDate, setExpiryDate] = useState<string>("");
  const [unitCostPrice, setUnitCostPrice] = useState<string>("");
  const [unitSellingPrice, setUnitSellingPrice] = useState<string>("");
  const [submittingAction, setSubmittingAction] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const toISODate = (d: Date) => {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  };

  const todayISO = toISODate(new Date());
  const defaultFrom = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 29);
    return toISODate(d);
  })();

  const [draftMovementFrom, setDraftMovementFrom] = useState<string>(defaultFrom);
  const [draftMovementTo, setDraftMovementTo] = useState<string>(todayISO);
  const [movementFrom, setMovementFrom] = useState<string>(defaultFrom);
  const [movementTo, setMovementTo] = useState<string>(todayISO);
  const [exporting, setExporting] = useState(false);
  const [exportType, setExportType] = useState<string>("all");

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [analyticsData, movementsData, productsData] = await Promise.all([
        fetchInventoryAnalytics(),
        fetchAllMovements({ startDate: movementFrom, endDate: movementTo }),
        fetchProducts(),
      ]);
      const branchData = await fetchBranches();
      setAnalytics(analyticsData as InventoryAnalytics);
      setMovements(movementsData as MovementHistoryRow[]);
      setBranches(branchData);
      const typedProducts = productsData as Product[];
      setProducts(typedProducts);
      const rawActiveBranchId = localStorage.getItem("activeBranchId");
      const activeBranchId = rawActiveBranchId ? Number(rawActiveBranchId) : null;
      const nextDestination = branchData.find((b) => b.id !== activeBranchId)?.id ?? null;
      setDestinationBranchId((prev) => (prev == null ? nextDestination : prev));
      if (typedProducts.length > 0) {
        setSelectedProductId((prev) => prev ?? typedProducts[0].id);
      } else {
        setSelectedProductId(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load inventory data");
    } finally {
      setLoading(false);
    }
  }, [movementFrom, movementTo]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    const handler = () => {
      void loadData();
    };
    window.addEventListener("activeBranchChanged", handler as EventListener);
    return () => window.removeEventListener("activeBranchChanged", handler as EventListener);
  }, [loadData]);

  const selectedProduct = products.find((p) => p.id === selectedProductId) ?? null;
  const selectedProductStock = selectedProduct ? Math.max(0, Number(selectedProduct.current_stock ?? 0)) : 0;
  const rawActiveBranchId = localStorage.getItem("activeBranchId");
  const activeBranchId = rawActiveBranchId ? Number(rawActiveBranchId) : null;
  const destinationBranches = branches.filter((b) => b.id !== activeBranchId);
  const destinationBranch = destinationBranches.find((b) => b.id === destinationBranchId) ?? null;
  const isNewStockAction = actionType === "new_stock";
  const isDamageAction = actionType === "damage";
  const isTransferAction = actionType === "transfer";
  const isDeleteAction = actionType === "delete";
  const isPerishableProduct = usesExpiryTracking && !!selectedProduct?.expiry_date;

  const resetActionForm = () => {
    setQuantity("");
    setStockReason("New Stock");
    setDamageReason("Damaged");
    setNotes("");
    setExpiryDate("");
    setUnitCostPrice("");
    setUnitSellingPrice("");
  };

  const handleSubmitAction = async () => {
    if (!selectedProductId) {
      alert("Select a product first");
      return;
    }

    if (actionType === "delete") {
      if (!isAdmin) {
        alert("Only Admin can delete products");
        return;
      }

      if (!confirm(`Delete ${selectedProduct?.name || "this product"}? This also deletes associated stock movements.`)) {
        return;
      }

      setSubmittingAction(true);
      try {
        await deleteProduct(selectedProductId);
        resetActionForm();
        await loadData();
      } catch (err) {
        alert(err instanceof Error ? err.message : "Failed to delete product");
      } finally {
        setSubmittingAction(false);
      }
      return;
    }

    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      alert("Enter a valid quantity");
      return;
    }

    if (actionType === "damage" && qty > selectedProductStock) {
      alert(`Cannot damage more than available stock (${selectedProductStock})`);
      return;
    }

    if (isTransferAction) {
      if (!isAdmin) {
        alert("Only Admin can transfer stock between branches");
        return;
      }
      if (!destinationBranchId) {
        alert("Select a destination branch");
        return;
      }
      if (qty > selectedProductStock) {
        alert(`Cannot transfer more than available stock (${selectedProductStock})`);
        return;
      }

      setSubmittingAction(true);
      try {
        await createBranchTransfer({
          product_id: selectedProductId,
          to_branch_id: destinationBranchId,
          quantity: qty,
          notes: notes.trim() || undefined,
        });
        resetActionForm();
        await loadData();
      } catch (err) {
        alert(err instanceof Error ? err.message : "Failed to transfer stock");
      } finally {
        setSubmittingAction(false);
      }
      return;
    }

    if (isNewStockAction && isPerishableProduct && !expiryDate) {
      alert("This product is perishable. Please set an expiry date for the new stock batch.");
      return;
    }

    const reasonPrefix = actionType === "new_stock" ? stockReason : damageReason;
    const reason = notes.trim() ? `${reasonPrefix}: ${notes.trim()}` : reasonPrefix;
    const change = actionType === "new_stock" ? qty : -qty;
    const parsedCost = unitCostPrice.trim() === "" ? null : Number(unitCostPrice);
    const parsedSelling = unitSellingPrice.trim() === "" ? null : Number(unitSellingPrice);

    setSubmittingAction(true);
    try {
      await createMovement(selectedProductId, {
        change,
        reason,
        expiry_date: isNewStockAction && isPerishableProduct ? (expiryDate || null) : null,
        unit_cost_price: isNewStockAction && Number.isFinite(parsedCost) ? parsedCost : null,
        unit_selling_price: isNewStockAction && Number.isFinite(parsedSelling) ? parsedSelling : null,
      });
      resetActionForm();
      await loadData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to record stock movement");
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleExportPdf = async () => {
    setExporting(true);
    try {
      const blob = await exportMovementsPdf({ startDate: movementFrom, endDate: movementTo }, exportType);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `stock_movements_${exportType}_${movementFrom}_to_${movementTo}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to export PDF");
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return (
      <div className="app-shell">
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 24 }}>Inventory Tracking</h1>
        <div className="card">
          <p style={{ margin: 0, color: "#6b7280" }}>Loading inventory data...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="app-shell">
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 24 }}>Inventory Tracking</h1>
        <div className="card">
          <p style={{ margin: 0, color: "#ef4444" }}>Error: {error}</p>
          <button
            onClick={loadData}
            style={{
              marginTop: 16,
              padding: "8px 16px",
              borderRadius: 6,
              border: "none",
              backgroundColor: "#3b82f6",
              color: "white",
              cursor: "pointer",
            }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!analytics) {
    return null;
  }

  return (
    <div className="app-shell">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>Inventory Tracking</h1>
        <button
          onClick={loadData}
          style={{
            padding: "8px 16px",
            borderRadius: 6,
            border: "1px solid #d1d5db",
            backgroundColor: "white",
            cursor: "pointer",
            fontSize: 14,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          Refresh
        </button>
      </div>

      {/* Overview Cards */}
      <div style={{ marginBottom: 24 }}>
        <InventoryOverview analytics={analytics} usesExpiryTracking={usesExpiryTracking} />
      </div>

      {/* Stock Alerts */}
      <div style={{ marginBottom: 24 }}>
        <StockAlerts
          lowStock={analytics.low_stock_alerts}
          expiring={usesExpiryTracking ? analytics.expiring_products : []}
          hideExpiringSection={!usesExpiryTracking}
        />
      </div>

      {/* Stock Actions */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div style={{ marginBottom: 16 }}>
          <h3 style={{ margin: "0 0 6px", fontSize: 18, fontWeight: 700 }}>Stock Actions</h3>
          <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>
            Select a product, choose what you want to do, then save. Every action is recorded in movement history and reports.
          </p>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 12,
            marginBottom: 12,
            padding: 12,
            background: "#f8fafc",
            border: "1px solid #e2e8f0",
            borderRadius: 10,
          }}
        >
          <div>
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>Selected product</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a" }}>
              {selectedProduct ? `${selectedProduct.name} (${selectedProduct.sku})` : "No product selected"}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>Current stock</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: selectedProductStock > 0 ? "#059669" : "#dc2626" }}>
              {selectedProductStock}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>Perishability</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: isPerishableProduct ? "#b45309" : "#334155" }}>
              {isPerishableProduct ? "Perishable (expiry required)" : "Non-perishable (no expiry needed)"}
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
          <label>
            <span style={{ display: "block", marginBottom: 6, fontSize: 13, color: "#374151", fontWeight: 600 }}>Product</span>
            <select
              value={selectedProductId ?? ""}
              onChange={(e) => setSelectedProductId(e.target.value ? Number(e.target.value) : null)}
              style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 14 }}
              disabled={submittingAction || products.length === 0}
            >
              {products.length === 0 ? <option value="">No products available</option> : null}
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name} ({product.sku})
                </option>
              ))}
            </select>
          </label>

          <div>
            <span style={{ display: "block", marginBottom: 6, fontSize: 13, color: "#374151", fontWeight: 600 }}>Action</span>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => setActionType("new_stock")}
                disabled={submittingAction}
                style={{
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid #d1d5db",
                  background: actionType === "new_stock" ? "#dcfce7" : "white",
                  color: actionType === "new_stock" ? "#166534" : "#334155",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: submittingAction ? "not-allowed" : "pointer",
                }}
              >
                Add Stock
              </button>
              <button
                type="button"
                onClick={() => setActionType("damage")}
                disabled={submittingAction}
                style={{
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid #d1d5db",
                  background: actionType === "damage" ? "#fef3c7" : "white",
                  color: actionType === "damage" ? "#92400e" : "#334155",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: submittingAction ? "not-allowed" : "pointer",
                }}
              >
                Record Damage
              </button>
              {isAdmin ? (
                <button
                  type="button"
                  onClick={() => setActionType("transfer")}
                  disabled={submittingAction}
                  style={{
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: "1px solid #d1d5db",
                    background: actionType === "transfer" ? "#dbeafe" : "white",
                    color: actionType === "transfer" ? "#1d4ed8" : "#334155",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: submittingAction ? "not-allowed" : "pointer",
                  }}
                >
                  Transfer Stock
                </button>
              ) : null}
              {isAdmin ? (
                <button
                  type="button"
                  onClick={() => setActionType("delete")}
                  disabled={submittingAction}
                  style={{
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: "1px solid #d1d5db",
                    background: actionType === "delete" ? "#fee2e2" : "white",
                    color: actionType === "delete" ? "#b91c1c" : "#334155",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: submittingAction ? "not-allowed" : "pointer",
                  }}
                >
                  Delete Product
                </button>
              ) : null}
            </div>
          </div>

          {!isDeleteAction ? (
            <label>
              <span style={{ display: "block", marginBottom: 6, fontSize: 13, color: "#374151", fontWeight: 600 }}>
                {isTransferAction ? "Quantity to Transfer" : isDamageAction ? "Quantity Damaged" : "Quantity Added"}
              </span>
              <input
                type="number"
                min="1"
                step="1"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder={isTransferAction ? "Enter quantity to transfer" : isNewStockAction ? "Enter stock added" : "Enter quantity damaged"}
                style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 14 }}
                disabled={submittingAction}
              />
              {isDamageAction || isTransferAction ? (
                <small style={{ color: "#6b7280", fontSize: 12 }}>Available stock: {selectedProductStock}</small>
              ) : null}
            </label>
          ) : null}

          {isTransferAction ? (
            <label>
              <span style={{ display: "block", marginBottom: 6, fontSize: 13, color: "#374151", fontWeight: 600 }}>Destination Branch</span>
              <select
                value={destinationBranchId ?? ""}
                onChange={(e) => setDestinationBranchId(e.target.value ? Number(e.target.value) : null)}
                style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 14 }}
                disabled={submittingAction}
              >
                {destinationBranches.length === 0 ? <option value="">No destination branch available</option> : null}
                {destinationBranches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
              {destinationBranch ? (
                <small style={{ color: "#6b7280", fontSize: 12 }}>Transfer destination: {destinationBranch.name}</small>
              ) : null}
            </label>
          ) : null}

          {isNewStockAction ? (
            <label>
              <span style={{ display: "block", marginBottom: 6, fontSize: 13, color: "#374151", fontWeight: 600 }}>Reason</span>
              <select
                value={stockReason}
                onChange={(e) => setStockReason(e.target.value)}
                style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 14 }}
                disabled={submittingAction}
              >
                <option value="New Stock">New Stock</option>
                <option value="Restock">Restock</option>
              </select>
            </label>
          ) : null}

          {isDamageAction ? (
            <label>
              <span style={{ display: "block", marginBottom: 6, fontSize: 13, color: "#374151", fontWeight: 600 }}>Damage Type</span>
              <select
                value={damageReason}
                onChange={(e) => setDamageReason(e.target.value)}
                style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 14 }}
                disabled={submittingAction}
              >
                <option value="Damaged">Damaged</option>
                <option value="Expired">Expired</option>
                <option value="Lost/Stolen">Lost/Stolen</option>
                <option value="Write-off">Write-off</option>
              </select>
            </label>
          ) : null}

          {isNewStockAction && isPerishableProduct ? (
            <label>
              <span style={{ display: "block", marginBottom: 6, fontSize: 13, color: "#374151", fontWeight: 600 }}>Expiry Date *</span>
              <input
                type="date"
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
                style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 14 }}
                disabled={submittingAction}
              />
              <small style={{ color: "#6b7280", fontSize: 12 }}>Required for perishable stock-in.</small>
            </label>
          ) : null}

          {isNewStockAction ? (
            <label>
              <span style={{ display: "block", marginBottom: 6, fontSize: 13, color: "#374151", fontWeight: 600 }}>Unit Cost Price (Optional)</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={unitCostPrice}
                onChange={(e) => setUnitCostPrice(e.target.value)}
                placeholder="e.g. 12.50"
                style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 14 }}
                disabled={submittingAction}
              />
            </label>
          ) : null}

          {isNewStockAction ? (
            <label>
              <span style={{ display: "block", marginBottom: 6, fontSize: 13, color: "#374151", fontWeight: 600 }}>Unit Selling Price (Optional)</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={unitSellingPrice}
                onChange={(e) => setUnitSellingPrice(e.target.value)}
                placeholder="e.g. 15.00"
                style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 14 }}
                disabled={submittingAction}
              />
            </label>
          ) : null}

          {!isDeleteAction ? (
            <label style={{ gridColumn: "1 / -1" }}>
              <span style={{ display: "block", marginBottom: 6, fontSize: 13, color: "#374151", fontWeight: 600 }}>Notes (Optional)</span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder={isTransferAction ? "Optional transfer note" : isNewStockAction ? "Optional stock note" : "Optional damage details"}
                style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 14, resize: "vertical" }}
                disabled={submittingAction}
              />
            </label>
          ) : null}

          {isDeleteAction ? (
            <div style={{ gridColumn: "1 / -1", padding: 10, borderRadius: 8, border: "1px solid #fecaca", background: "#fef2f2", color: "#991b1b", fontSize: 13 }}>
              Deleting a product will permanently remove the product and its stock movement history.
            </div>
          ) : null}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
          <button
            onClick={handleSubmitAction}
            disabled={submittingAction || !selectedProductId}
            style={{
              padding: "8px 14px",
              borderRadius: 6,
              border: "none",
              backgroundColor:
                isDeleteAction ? "#ef4444" : isDamageAction ? "#f59e0b" : isTransferAction ? "#3b82f6" : "#10b981",
              color: "white",
              cursor: submittingAction || !selectedProductId ? "not-allowed" : "pointer",
              fontWeight: 600,
              opacity: submittingAction || !selectedProductId ? 0.7 : 1,
            }}
          >
            {submittingAction
              ? "Saving..."
              : isDeleteAction
                ? "Delete Product"
                : isTransferAction
                  ? "Transfer Stock"
                : isDamageAction
                  ? "Record Damage"
                  : "Add Stock"}
          </button>
        </div>
      </div>

      {/* Movement History */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Movement History</h3>
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <label style={{ fontSize: 14, color: "#6b7280" }}>From:</label>
              <input
                type="date"
                value={draftMovementFrom}
                onChange={(e) => setDraftMovementFrom(e.target.value)}
                style={{
                  padding: "6px 10px",
                  borderRadius: 6,
                  border: "1px solid #d1d5db",
                  fontSize: 14,
                }}
              />
              <label style={{ fontSize: 14, color: "#6b7280" }}>To:</label>
              <input
                type="date"
                value={draftMovementTo}
                onChange={(e) => setDraftMovementTo(e.target.value)}
                style={{
                  padding: "6px 10px",
                  borderRadius: 6,
                  border: "1px solid #d1d5db",
                  fontSize: 14,
                }}
              />

              <button
                onClick={() => {
                  const today = toISODate(new Date());
                  setDraftMovementFrom(today);
                  setDraftMovementTo(today);
                }}
                style={{
                  padding: "6px 10px",
                  borderRadius: 6,
                  border: "1px solid #d1d5db",
                  background: "white",
                  cursor: "pointer",
                  fontSize: 13,
                }}
              >
                Today
              </button>

              <button
                onClick={() => {
                  const now = new Date();
                  const day = now.getDay();
                  const diffToMonday = (day + 6) % 7; // Mon=0 ... Sun=6
                  const monday = new Date(now);
                  monday.setDate(now.getDate() - diffToMonday);
                  const sunday = new Date(monday);
                  sunday.setDate(monday.getDate() + 6);
                  setDraftMovementFrom(toISODate(monday));
                  setDraftMovementTo(toISODate(sunday));
                }}
                style={{
                  padding: "6px 10px",
                  borderRadius: 6,
                  border: "1px solid #d1d5db",
                  background: "white",
                  cursor: "pointer",
                  fontSize: 13,
                }}
              >
                This Week
              </button>

              <button
                onClick={() => {
                  const now = new Date();
                  const first = new Date(now.getFullYear(), now.getMonth(), 1);
                  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
                  setDraftMovementFrom(toISODate(first));
                  setDraftMovementTo(toISODate(last));
                }}
                style={{
                  padding: "6px 10px",
                  borderRadius: 6,
                  border: "1px solid #d1d5db",
                  background: "white",
                  cursor: "pointer",
                  fontSize: 13,
                }}
              >
                This Month
              </button>

              <button
                onClick={() => {
                  setMovementFrom(draftMovementFrom);
                  setMovementTo(draftMovementTo);
                }}
                style={{
                  padding: "6px 12px",
                  borderRadius: 6,
                  border: "none",
                  backgroundColor: "#3b82f6",
                  color: "white",
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                Apply
              </button>
            </div>
            
            {/* Export to PDF */}
            <div style={{ display: "flex", gap: 8, alignItems: "center", borderLeft: "1px solid #e5e7eb", paddingLeft: 12 }}>
              <select
                value={exportType}
                onChange={(e) => setExportType(e.target.value)}
                style={{
                  padding: "6px 10px",
                  borderRadius: 6,
                  border: "1px solid #d1d5db",
                  fontSize: 14,
                }}
              >
                <option value="all">All Movements</option>
                <option value="stock_in">Stock In (Purchases)</option>
                <option value="stock_out">Stock Out</option>
                <option value="sale">Sales Only</option>
              </select>
              <button
                onClick={handleExportPdf}
                disabled={exporting}
                style={{
                  padding: "6px 12px",
                  borderRadius: 6,
                  border: "none",
                  backgroundColor: exporting ? "#9ca3af" : "#10b981",
                  color: "white",
                  cursor: exporting ? "not-allowed" : "pointer",
                  fontSize: 14,
                  fontWeight: 500,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                {exporting ? "Exporting..." : "📄 Export PDF"}
              </button>
            </div>
          </div>
        </div>
        <MovementHistory movements={movements} />
      </div>
    </div>
  );
}
