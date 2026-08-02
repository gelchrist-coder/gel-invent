import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import {
  createWarehouse,
  fetchBranches,
  fetchProducts,
  fetchWarehouseStock,
  fetchWarehouses,
  receiveWarehouseStock,
  transferWarehouseStock,
  updateWarehouse,
} from "../api";
import { Branch, Product, Warehouse, WarehouseStock } from "../types";
import { hasUserPermission, readStoredUser } from "../user-storage";

const inputStyle = {
  width: "100%",
  minHeight: 40,
  padding: "9px 11px",
  border: "1px solid #cbd5e1",
  borderRadius: 8,
  background: "#fff",
} as const;

export default function Warehouses() {
  const canManage = hasUserPermission("manage_warehouses", readStoredUser());
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<number | null>(null);
  const [stock, setStock] = useState<WarehouseStock[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [warehouseName, setWarehouseName] = useState("");
  const [warehouseAddress, setWarehouseAddress] = useState("");
  const [receipt, setReceipt] = useState({ productId: "", quantity: "", reference: "" });
  const [transfer, setTransfer] = useState({
    direction: "branch_to_warehouse" as "branch_to_warehouse" | "warehouse_to_branch",
    productId: "",
    itemId: "",
    branchId: "",
    quantity: "",
    notes: "",
  });

  const selectedWarehouse = warehouses.find((warehouse) => warehouse.id === selectedWarehouseId) ?? null;
  const activeWarehouses = useMemo(() => warehouses.filter((warehouse) => warehouse.is_active), [warehouses]);

  const loadStock = useCallback(async (warehouseId: number) => {
    setStock(await fetchWarehouseStock(warehouseId));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [warehouseRows, productRows, branchRows] = await Promise.all([
        fetchWarehouses(),
        fetchProducts(),
        fetchBranches(),
      ]);
      setWarehouses(warehouseRows);
      setProducts(productRows);
      setBranches(branchRows);
      const activeBranchId = localStorage.getItem("activeBranchId") || String(branchRows[0]?.id ?? "");
      setTransfer((current) => current.branchId ? current : { ...current, branchId: activeBranchId });
      const nextId = selectedWarehouseId && warehouseRows.some((row) => row.id === selectedWarehouseId)
        ? selectedWarehouseId
        : warehouseRows.find((row) => row.is_active)?.id ?? warehouseRows[0]?.id ?? null;
      setSelectedWarehouseId(nextId);
      if (nextId) await loadStock(nextId);
      else setStock([]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load warehouses");
    } finally {
      setLoading(false);
    }
  }, [loadStock, selectedWarehouseId]);

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const selectWarehouse = async (warehouseId: number) => {
    setSelectedWarehouseId(warehouseId);
    setError(null);
    try {
      await loadStock(warehouseId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load warehouse stock");
    }
  };

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    if (!warehouseName.trim()) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      const created = await createWarehouse({ name: warehouseName.trim(), address: warehouseAddress.trim() || null });
      setWarehouseName(""); setWarehouseAddress(""); setShowCreate(false);
      await load();
      await selectWarehouse(created.id);
      setMessage("Warehouse created.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create warehouse");
    } finally { setBusy(false); }
  };

  const handleReceipt = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedWarehouseId || !receipt.productId || Number(receipt.quantity) <= 0) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      await receiveWarehouseStock(selectedWarehouseId, {
        product_id: Number(receipt.productId),
        quantity: Number(receipt.quantity),
        reference: receipt.reference.trim() || null,
      });
      setReceipt({ productId: "", quantity: "", reference: "" });
      await load();
      setMessage("Stock received into the warehouse.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not receive stock");
    } finally { setBusy(false); }
  };

  const handleTransfer = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedWarehouseId || Number(transfer.quantity) <= 0) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      const result = await transferWarehouseStock(selectedWarehouseId, {
        direction: transfer.direction,
        quantity: Number(transfer.quantity),
        branch_id: transfer.branchId ? Number(transfer.branchId) : undefined,
        product_id: transfer.direction === "branch_to_warehouse" ? Number(transfer.productId) : undefined,
        item_id: transfer.direction === "warehouse_to_branch" ? Number(transfer.itemId) : undefined,
        notes: transfer.notes.trim() || null,
      });
      setTransfer({ ...transfer, productId: "", itemId: "", quantity: "", notes: "" });
      await load();
      window.dispatchEvent(new CustomEvent("inventoryChanged"));
      setMessage(`Transfer completed. Reference: ${result.reference}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not transfer stock");
    } finally { setBusy(false); }
  };

  if (loading) return <div className="card" style={{ margin: 16, padding: 20 }}>Loading warehouses...</div>;

  return (
    <div style={{ padding: 16, display: "grid", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 26 }}>Warehouses</h1>
          <p style={{ margin: "5px 0 0", color: "#64748b" }}>Receive stock centrally and move it to or from your branches.</p>
        </div>
        {canManage ? <button className="button" onClick={() => setShowCreate((value) => !value)}>Add Warehouse</button> : null}
      </div>

      {error ? <div style={{ padding: 12, borderRadius: 8, background: "#fef2f2", color: "#b91c1c" }}>{error}</div> : null}
      {message ? <div style={{ padding: 12, borderRadius: 8, background: "#ecfdf5", color: "#047857" }}>{message}</div> : null}

      {showCreate ? (
        <form className="card" onSubmit={handleCreate} style={{ padding: 16, display: "grid", gap: 10, maxWidth: 620 }}>
          <strong>Create warehouse</strong>
          <input style={inputStyle} value={warehouseName} onChange={(e) => setWarehouseName(e.target.value)} placeholder="Warehouse name" required />
          <input style={inputStyle} value={warehouseAddress} onChange={(e) => setWarehouseAddress(e.target.value)} placeholder="Address (optional)" />
          <button className="button" disabled={busy}>Save Warehouse</button>
        </form>
      ) : null}

      {warehouses.length === 0 ? (
        <div className="card" style={{ padding: 28, textAlign: "center", color: "#64748b" }}>No warehouses yet. Add one to begin receiving stock.</div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 4 }}>
            {warehouses.map((warehouse) => (
              <button
                key={warehouse.id}
                onClick={() => void selectWarehouse(warehouse.id)}
                style={{ minWidth: 190, textAlign: "left", padding: 14, borderRadius: 10, cursor: "pointer", border: selectedWarehouseId === warehouse.id ? "2px solid #2563eb" : "1px solid #cbd5e1", background: "#fff", opacity: warehouse.is_active ? 1 : 0.6 }}
              >
                <strong style={{ display: "block" }}>{warehouse.name}</strong>
                <span style={{ display: "block", marginTop: 5, fontSize: 12, color: "#64748b" }}>{warehouse.total_skus} SKUs · {Number(warehouse.total_units).toLocaleString()} units</span>
              </button>
            ))}
          </div>

          {selectedWarehouse ? (
            <>
              <div className="card" style={{ padding: 16, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                <div><strong>{selectedWarehouse.name}</strong><div style={{ color: "#64748b", fontSize: 13 }}>{selectedWarehouse.address || "No address saved"}</div></div>
                {canManage ? <button className="button secondary" onClick={() => void updateWarehouse(selectedWarehouse.id, { is_active: !selectedWarehouse.is_active }).then(load)}>{selectedWarehouse.is_active ? "Deactivate" : "Reactivate"}</button> : null}
              </div>

              {canManage && selectedWarehouse.is_active ? (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
                  <form className="card" onSubmit={handleReceipt} style={{ padding: 16, display: "grid", gap: 10 }}>
                    <strong>Receive directly into warehouse</strong>
                    <select style={inputStyle} value={receipt.productId} onChange={(e) => setReceipt({ ...receipt, productId: e.target.value })} required>
                      <option value="">Choose product</option>
                      {products.map((product) => <option key={product.id} value={product.id}>{product.name} ({product.sku})</option>)}
                    </select>
                    <input style={inputStyle} type="number" min="0.01" step="0.01" value={receipt.quantity} onChange={(e) => setReceipt({ ...receipt, quantity: e.target.value })} placeholder="Quantity" required />
                    <input style={inputStyle} value={receipt.reference} onChange={(e) => setReceipt({ ...receipt, reference: e.target.value })} placeholder="Supplier reference (optional)" />
                    <button className="button" disabled={busy}>Receive Stock</button>
                  </form>

                  <form className="card" onSubmit={handleTransfer} style={{ padding: 16, display: "grid", gap: 10 }}>
                    <strong>Transfer stock</strong>
                    <select style={inputStyle} value={transfer.direction} onChange={(e) => setTransfer({ ...transfer, direction: e.target.value as typeof transfer.direction })}>
                      <option value="branch_to_warehouse">Branch → Warehouse</option>
                      <option value="warehouse_to_branch">Warehouse → Branch</option>
                    </select>
                    <select style={inputStyle} value={transfer.branchId} onChange={(e) => setTransfer({ ...transfer, branchId: e.target.value })} required disabled={transfer.direction === "branch_to_warehouse"}>
                      <option value="">Choose branch</option>
                      {branches
                        .filter((branch) => transfer.direction === "warehouse_to_branch" || String(branch.id) === (localStorage.getItem("activeBranchId") || String(branches[0]?.id ?? "")))
                        .map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                    </select>
                    {transfer.direction === "branch_to_warehouse" ? (
                      <select style={inputStyle} value={transfer.productId} onChange={(e) => setTransfer({ ...transfer, productId: e.target.value })} required>
                        <option value="">Choose branch product</option>
                        {products.map((product) => <option key={product.id} value={product.id}>{product.name} ({product.sku}) · {Number(product.current_stock || 0)} available</option>)}
                      </select>
                    ) : (
                      <select style={inputStyle} value={transfer.itemId} onChange={(e) => setTransfer({ ...transfer, itemId: e.target.value })} required>
                        <option value="">Choose warehouse stock</option>
                        {stock.filter((item) => Number(item.quantity) > 0).map((item) => <option key={item.item_id} value={item.item_id}>{item.name} ({item.sku}) · {Number(item.quantity)} available</option>)}
                      </select>
                    )}
                    <input style={inputStyle} type="number" min="0.01" step="0.01" value={transfer.quantity} onChange={(e) => setTransfer({ ...transfer, quantity: e.target.value })} placeholder="Quantity" required />
                    <input style={inputStyle} value={transfer.notes} onChange={(e) => setTransfer({ ...transfer, notes: e.target.value })} placeholder="Transfer note (optional)" />
                    <button className="button" disabled={busy}>Transfer Stock</button>
                  </form>
                </div>
              ) : null}

              <div className="card" style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 620 }}>
                  <thead><tr style={{ background: "#f8fafc", textAlign: "left" }}><th style={{ padding: 12 }}>Product</th><th>SKU</th><th>Category</th><th>Quantity</th><th>Value</th></tr></thead>
                  <tbody>
                    {stock.map((item) => (
                      <tr key={item.item_id} style={{ borderTop: "1px solid #e2e8f0" }}>
                        <td style={{ padding: 12, fontWeight: 600 }}>{item.name}</td><td>{item.sku}</td><td>{item.category || "—"}</td><td>{Number(item.quantity).toLocaleString()} {item.unit}</td><td>{item.cost_price == null ? "—" : (Number(item.quantity) * Number(item.cost_price)).toFixed(2)}</td>
                      </tr>
                    ))}
                    {stock.length === 0 ? <tr><td colSpan={5} style={{ padding: 24, textAlign: "center", color: "#64748b" }}>No warehouse stock yet.</td></tr> : null}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </>
      )}
      {activeWarehouses.length === 0 && warehouses.length > 0 ? <p style={{ color: "#92400e" }}>All warehouses are inactive.</p> : null}
    </div>
  );
}
