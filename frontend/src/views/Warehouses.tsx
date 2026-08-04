import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import {
  createWarehouseItem,
  createFulfillmentOrder,
  fetchWarehouseDestinationBranches,
  fetchProducts,
  fetchWarehouseStock,
  fetchWarehouseMovements,
  fetchWarehouses,
  fetchFulfillmentOrders,
  receiveWarehouseStock,
  transferWarehouseStock,
  updateFulfillmentOrderStatus,
} from "../api";
import ProductForm from "../components/ProductForm";
import PurchasingPanel from "../components/PurchasingPanel";
import { Skeleton } from "../components/Skeleton";
import { useExpiryTracking } from "../settings";
import { Branch, FulfillmentOrder, FulfillmentStatus, NewProduct, Product, Warehouse, WarehouseMovement, WarehouseStock } from "../types";
import { hasUserPermission, readStoredUser } from "../user-storage";

const inputStyle = {
  width: "100%",
  minHeight: 40,
  padding: "9px 11px",
  border: "1px solid #cbd5e1",
  borderRadius: 8,
  background: "#fff",
} as const;

type WarehousesProps = {
  activeWarehouseId?: number | null;
  onChangeWarehouse?: (warehouseId: number) => void;
};

function WarehousePageSkeleton() {
  return (
    <div className="app-shell warehouse-page warehouse-page-skeleton" aria-busy="true" aria-label="Loading warehouse operations">
      <div className="page-header warehouse-skeleton-heading">
        <Skeleton width={230} height={30} />
        <Skeleton width="min(520px, 82vw)" height={14} />
      </div>

      <div className="card warehouse-hero warehouse-hero-skeleton" aria-hidden="true">
        <div><Skeleton width={150} height={10} /><Skeleton width={245} height={27} /><Skeleton width={130} height={13} /></div>
        <Skeleton width={58} height={28} radius={999} />
      </div>

      <div className="warehouse-kpis" aria-hidden="true">
        {Array.from({ length: 4 }).map((_, index) => (
          <div className="card" key={index}>
            <Skeleton width="52%" height={10} />
            <Skeleton width={index === 2 ? "72%" : "38%"} height={21} />
            <Skeleton width="66%" height={10} />
          </div>
        ))}
      </div>

      <div className="warehouse-tabs warehouse-tabs-skeleton" aria-hidden="true">
        {Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} width={index === 4 ? 78 : 66} height={32} />)}
      </div>

      <div className="card warehouse-actions-card warehouse-actions-skeleton" aria-hidden="true">
        <Skeleton width={105} height={18} />
        <div className="warehouse-action-buttons">
          <Skeleton width={170} height={36} />
          <Skeleton width={155} height={36} />
          <Skeleton width={185} height={36} />
        </div>
      </div>

      <div className="card warehouse-table-wrap warehouse-table-skeleton" aria-hidden="true">
        <div className="warehouse-skeleton-table-head">{Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} width={index === 0 ? "58%" : "72%"} height={10} />)}</div>
        {Array.from({ length: 4 }).map((_, rowIndex) => (
          <div className="warehouse-skeleton-table-row" key={rowIndex}>
            {Array.from({ length: 6 }).map((_, cellIndex) => <Skeleton key={cellIndex} width={cellIndex === 0 ? "72%" : "56%"} height={12} />)}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Warehouses({ activeWarehouseId, onChangeWarehouse }: WarehousesProps) {
  const currentUser = readStoredUser();
  const usesExpiryTracking = useExpiryTracking();
  const canManage = hasUserPermission("manage_warehouses", currentUser);
  const canPurchase = hasUserPermission("manage_procurement", currentUser);
  const canViewBranchStock = hasUserPermission("view_inventory", currentUser) && hasUserPermission("view_catalog", currentUser);
  const isWarehouseUser = currentUser?.role === "Warehouse";
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<number | null>(() => {
    if (activeWarehouseId != null) return activeWarehouseId;
    if (typeof currentUser?.warehouse_id === "number") return currentUser.warehouse_id;
    const stored = Number(localStorage.getItem("activeWarehouseId"));
    return Number.isFinite(stored) && stored > 0 ? stored : null;
  });
  const [stock, setStock] = useState<WarehouseStock[]>([]);
  const [orders, setOrders] = useState<FulfillmentOrder[]>([]);
  const [movements, setMovements] = useState<WarehouseMovement[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [activeTab, setActiveTab] = useState<"overview" | "stock" | "purchases" | "transfers" | "orders" | "movements">("overview");
  const [receipt, setReceipt] = useState({ itemId: "", quantity: "", reference: "", batchNumber: "", expiryDate: "", unitCost: "", notes: "" });
  const [transfer, setTransfer] = useState({
    direction: (isWarehouseUser ? "warehouse_to_branch" : "branch_to_warehouse") as "branch_to_warehouse" | "warehouse_to_branch",
    productId: "",
    itemId: "",
    branchId: "",
    quantity: "",
    notes: "",
  });
  const [orderDraft, setOrderDraft] = useState({ customerName: "", phone: "", email: "", address: "", externalId: "" });
  const [lineDraft, setLineDraft] = useState({ itemId: "", quantity: "" });
  const [orderLines, setOrderLines] = useState<Array<{ itemId: number; quantity: number }>>([]);

  const selectedWarehouse = warehouses.find((warehouse) => warehouse.id === selectedWarehouseId) ?? null;
  const selectedReceiptItem = stock.find((item) => String(item.item_id) === receipt.itemId) ?? null;
  const activeWarehouses = useMemo(() => warehouses.filter((warehouse) => warehouse.is_active), [warehouses]);
  const warehouseProducts = useMemo<Product[]>(() => stock.map((item) => ({
    id: item.item_id,
    sku: item.sku,
    barcode: item.barcode,
    name: item.name,
    description: item.description,
    unit: item.unit,
    measurement_type: item.measurement_type,
    allows_fractional_sales: item.allows_fractional_sales,
    quantity_step: item.quantity_step,
    pack_size: item.pack_size,
    category: item.category,
    supplier: item.supplier,
    expiry_date: item.expiry_date,
    cost_price: item.cost_price,
    pack_cost_price: item.pack_cost_price,
    selling_price: item.selling_price,
    pack_selling_price: item.pack_selling_price,
    wholesale_price: item.wholesale_price,
    wholesale_min_quantity: item.wholesale_min_quantity,
    image: item.image,
    created_at: "",
    updated_at: "",
    current_stock: item.quantity,
    reserved_stock: item.reserved_quantity,
    variants: [],
    unit_conversions: [],
  })), [stock]);
  const totalStockValue = useMemo(
    () => stock.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.cost_price || 0), 0),
    [stock],
  );
  const lowStockCount = useMemo(
    () => stock.filter((item) => Number(item.available_quantity || 0) <= 5).length,
    [stock],
  );
  const activeOrderCount = useMemo(
    () => orders.filter((order) => !["delivered", "cancelled"].includes(order.status)).length,
    [orders],
  );

  const loadStock = useCallback(async (warehouseId: number) => {
    const [stockRows, orderRows, movementRows] = await Promise.all([
      fetchWarehouseStock(warehouseId),
      fetchFulfillmentOrders(warehouseId),
      fetchWarehouseMovements(warehouseId),
    ]);
    setStock(stockRows);
    setOrders(orderRows);
    setMovements(movementRows);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [warehouseRows, productRows, branchRows] = await Promise.all([
        fetchWarehouses(),
        canViewBranchStock ? fetchProducts() : Promise.resolve([]),
        fetchWarehouseDestinationBranches(),
      ]);
      setWarehouses(warehouseRows);
      setProducts(productRows);
      setBranches(branchRows);
      const activeBranchId = canViewBranchStock
        ? localStorage.getItem("activeBranchId") || String(branchRows[0]?.id ?? "")
        : String(branchRows[0]?.id ?? "");
      setTransfer((current) => current.branchId ? current : { ...current, branchId: activeBranchId });
      const preferredWarehouseId = activeWarehouseId ?? selectedWarehouseId;
      const nextId = preferredWarehouseId && warehouseRows.some((row) => row.id === preferredWarehouseId)
        ? preferredWarehouseId
        : warehouseRows.find((row) => row.is_active)?.id ?? warehouseRows[0]?.id ?? null;
      setSelectedWarehouseId(nextId);
      if (nextId != null && nextId !== activeWarehouseId) {
        localStorage.setItem("activeWarehouseId", String(nextId));
        onChangeWarehouse?.(nextId);
      }
      if (nextId) await loadStock(nextId);
      else setStock([]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load warehouses");
    } finally {
      setLoading(false);
    }
  }, [activeWarehouseId, canViewBranchStock, loadStock, onChangeWarehouse, selectedWarehouseId]);

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const selectWarehouse = async (warehouseId: number) => {
    setLoading(true);
    setSelectedWarehouseId(warehouseId);
    localStorage.setItem("activeWarehouseId", String(warehouseId));
    if (warehouseId !== activeWarehouseId) onChangeWarehouse?.(warehouseId);
    setActiveTab("overview");
    setStock([]);
    setOrders([]);
    setMovements([]);
    setReceipt({ itemId: "", quantity: "", reference: "", batchNumber: "", expiryDate: "", unitCost: "", notes: "" });
    setTransfer((current) => ({ ...current, productId: "", itemId: "", quantity: "", notes: "" }));
    setOrderDraft({ customerName: "", phone: "", email: "", address: "", externalId: "" });
    setLineDraft({ itemId: "", quantity: "" });
    setOrderLines([]);
    setError(null);
    try {
      await loadStock(warehouseId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load warehouse stock");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (loading || activeWarehouseId == null || activeWarehouseId === selectedWarehouseId) return;
    void selectWarehouse(activeWarehouseId);
    // selectWarehouse intentionally runs only when the global warehouse changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWarehouseId]);

  const handleAddWarehouseProduct = async (payload: NewProduct) => {
    if (!selectedWarehouseId) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      await createWarehouseItem(selectedWarehouseId, payload);
      await load();
      setMessage("Product added to the warehouse.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not add warehouse product");
    } finally { setBusy(false); }
  };

  const handleReceipt = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedWarehouseId || !receipt.itemId || Number(receipt.quantity) <= 0) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      await receiveWarehouseStock(selectedWarehouseId, {
        item_id: Number(receipt.itemId),
        quantity: Number(receipt.quantity),
        reference: receipt.reference.trim() || null,
        batch_number: receipt.batchNumber.trim() || null,
        expiry_date: receipt.expiryDate || null,
        unit_cost_price: receipt.unitCost.trim() ? Number(receipt.unitCost) : null,
        notes: receipt.notes.trim() || null,
      });
      setReceipt({ itemId: "", quantity: "", reference: "", batchNumber: "", expiryDate: "", unitCost: "", notes: "" });
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

  const addOrderLine = () => {
    const itemId = Number(lineDraft.itemId);
    const quantity = Number(lineDraft.quantity);
    if (!itemId || quantity <= 0) return;
    setOrderLines((current) => {
      const existing = current.find((line) => line.itemId === itemId);
      return existing
        ? current.map((line) => line.itemId === itemId ? { ...line, quantity: line.quantity + quantity } : line)
        : [...current, { itemId, quantity }];
    });
    setLineDraft({ itemId: "", quantity: "" });
  };

  const handleCreateOrder = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedWarehouseId || !orderDraft.customerName.trim() || orderLines.length === 0) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      await createFulfillmentOrder(selectedWarehouseId, {
        external_order_id: orderDraft.externalId.trim() || null,
        source: "manual",
        customer_name: orderDraft.customerName.trim(),
        customer_phone: orderDraft.phone.trim() || null,
        customer_email: orderDraft.email.trim() || null,
        delivery_address: orderDraft.address.trim() || null,
        items: orderLines.map((line) => ({
          item_id: line.itemId,
          quantity: line.quantity,
          unit_price: stock.find((item) => item.item_id === line.itemId)?.selling_price ?? 0,
        })),
      });
      setOrderDraft({ customerName: "", phone: "", email: "", address: "", externalId: "" });
      setOrderLines([]);
      await load();
      setMessage("Fulfilment order created and stock reserved.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create fulfilment order");
    } finally { setBusy(false); }
  };

  const advanceOrder = async (order: FulfillmentOrder, status: Exclude<FulfillmentStatus, "reserved">) => {
    if (!selectedWarehouseId) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      await updateFulfillmentOrderStatus(selectedWarehouseId, order.id, status);
      await load();
      setMessage(`Order #${order.id} moved to ${status}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update fulfilment order");
    } finally { setBusy(false); }
  };

  if (loading) return <WarehousePageSkeleton />;

  const tabs = [
    { id: "overview" as const, label: "Overview" },
    { id: "stock" as const, label: "Stock" },
    ...(canPurchase && selectedWarehouse?.is_active ? [{ id: "purchases" as const, label: "Purchases" }] : []),
    { id: "transfers" as const, label: "Transfers" },
    { id: "orders" as const, label: "Fulfilment" },
    { id: "movements" as const, label: "History" },
  ];

  const stockTable = (
    <div className="card warehouse-table-wrap">
      <table className="warehouse-table table-cards">
        <thead><tr><th>Product</th><th>SKU</th><th>On hand</th><th>Reserved</th><th>Available</th><th>Stock value</th></tr></thead>
        <tbody>
          {stock.map((item) => (
            <tr key={item.item_id}>
              <td data-label="Product"><strong>{item.name}</strong><small>{item.category || "Uncategorised"}{item.supplier ? ` · ${item.supplier}` : ""}</small></td>
              <td data-label="SKU">{item.sku}</td>
              <td data-label="On hand">{Number(item.quantity).toLocaleString()}</td>
              <td data-label="Reserved">{Number(item.reserved_quantity).toLocaleString()}</td>
              <td data-label="Available"><strong>{Number(item.available_quantity).toLocaleString()} {item.unit}</strong></td>
              <td data-label="Stock value">{item.cost_price == null ? "—" : `GHS ${(Number(item.quantity) * Number(item.cost_price)).toFixed(2)}`}</td>
            </tr>
          ))}
          {stock.length === 0 ? <tr><td colSpan={6} className="warehouse-empty td-full">No warehouse stock yet. Add a product or create a supplier purchase.</td></tr> : null}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="app-shell warehouse-page">
      <div className="page-header">
        <div><h1 className="page-title">Warehouse Operations</h1><p className="text-muted" style={{ margin: "5px 0 0" }}>Purchase centrally, control stock, transfer to branches, and keep a complete movement trail.</p></div>
      </div>
      {error ? <div className="warehouse-alert warehouse-alert--error">{error}</div> : null}
      {message ? <div className="warehouse-alert warehouse-alert--success">{message}</div> : null}

      {warehouses.length === 0 ? <div className="card warehouse-empty">No warehouses are configured. The business owner can create one in Settings.</div> : (
        <>
          {selectedWarehouse ? <>
            <div className="card warehouse-hero">
              <div><span className="warehouse-eyebrow">CENTRAL STOCK LOCATION</span><h2>{selectedWarehouse.name}</h2><p>{selectedWarehouse.address || "No address saved"}</p></div>
              <span className={selectedWarehouse.is_active ? "warehouse-status active" : "warehouse-status"}>{selectedWarehouse.is_active ? "Active" : "Inactive"}</span>
            </div>

            <div className="warehouse-kpis">
              <div className="card"><span>Products</span><strong>{stock.length}</strong><small>Warehouse SKUs</small></div>
              <div className="card"><span>Available units</span><strong>{stock.reduce((sum, item) => sum + Number(item.available_quantity || 0), 0).toLocaleString()}</strong><small>After reservations</small></div>
              <div className="card"><span>Stock value</span><strong>GHS {totalStockValue.toFixed(2)}</strong><small>At recorded cost</small></div>
              <div className="card"><span>Attention</span><strong>{lowStockCount + activeOrderCount}</strong><small>{lowStockCount} low stock · {activeOrderCount} active orders</small></div>
            </div>

            <div className="warehouse-tabs" role="tablist">
              {tabs.map((tab) => <button key={tab.id} type="button" className={activeTab === tab.id ? "active" : ""} onClick={() => setActiveTab(tab.id)}>{tab.label}</button>)}
            </div>

            {activeTab === "overview" ? <div className="warehouse-overview-grid">
              <div className="card warehouse-actions-card"><h3>Quick actions</h3><div className="warehouse-action-buttons">{canPurchase && selectedWarehouse.is_active ? <button className="button" onClick={() => setActiveTab("purchases")}>Record supplier purchase</button> : null}<button className="button secondary" onClick={() => setActiveTab("transfers")}>Transfer to a branch</button><button className="button secondary" onClick={() => setActiveTab("stock")}>Review warehouse stock</button></div></div>
              {stockTable}
            </div> : null}

            {activeTab === "stock" ? <div style={{ display: "grid", gap: 16 }}>
              {canManage && selectedWarehouse.is_active ? <div className="warehouse-form-grid">
                <div className="card warehouse-action-panel"><h3>Add warehouse product</h3><p>Create the complete product record before supplier deliveries or transfers arrive.</p><button type="button" className="button" disabled={busy} onClick={() => setShowAddProduct(true)}>Add Product</button></div>
                <form className="card warehouse-action-panel" onSubmit={handleReceipt}><h3>Manual stock receipt</h3><p>Use this for opening balances or non-purchase adjustments. Supplier deliveries belong in Purchases.</p><select style={inputStyle} value={receipt.itemId} onChange={(e) => setReceipt({ ...receipt, itemId: e.target.value, expiryDate: "" })} required><option value="">Choose warehouse product</option>{stock.map((item) => <option key={item.item_id} value={item.item_id}>{item.name} ({item.sku})</option>)}</select><div className="warehouse-form-grid"><input style={inputStyle} type="number" min="0.01" step="0.01" value={receipt.quantity} onChange={(e) => setReceipt({ ...receipt, quantity: e.target.value })} placeholder="Quantity" required />{usesExpiryTracking ? <><input style={inputStyle} value={receipt.batchNumber} onChange={(e) => setReceipt({ ...receipt, batchNumber: e.target.value })} placeholder="Batch / lot (optional)" /><label>{selectedReceiptItem?.expiry_date ? "Expiry date (required)" : "Expiry date"}<input style={inputStyle} type="date" value={receipt.expiryDate} onChange={(e) => setReceipt({ ...receipt, expiryDate: e.target.value })} required={Boolean(selectedReceiptItem?.expiry_date)} /></label></> : null}<input style={inputStyle} type="number" min="0" step="0.01" value={receipt.unitCost} onChange={(e) => setReceipt({ ...receipt, unitCost: e.target.value })} placeholder="Unit cost (optional)" /><input style={inputStyle} value={receipt.reference} onChange={(e) => setReceipt({ ...receipt, reference: e.target.value })} placeholder="Reference (optional)" /><input style={inputStyle} value={receipt.notes} onChange={(e) => setReceipt({ ...receipt, notes: e.target.value })} placeholder="Adjustment note (optional)" /></div><button className="button" disabled={busy}>Receive Stock</button></form>
              </div> : null}
              {stockTable}
            </div> : null}

            {activeTab === "purchases" && canPurchase && selectedWarehouse.is_active ? <PurchasingPanel key={`warehouse-purchases-${selectedWarehouse.id}`} products={warehouseProducts} warehouseId={selectedWarehouse.id} destinationLabel={`${selectedWarehouse.name} Warehouse`} usesExpiryTracking={usesExpiryTracking} onPurchaseRecorded={() => loadStock(selectedWarehouse.id)} mode="purchasing" /> : null}

            {activeTab === "transfers" ? <form className="card warehouse-action-panel warehouse-transfer-form" onSubmit={handleTransfer}><div><span className="warehouse-eyebrow">CONTROLLED MOVEMENT</span><h3>Transfer stock</h3><p>Every transfer creates matching warehouse and branch audit entries.</p></div><div className="warehouse-form-grid"><label>Direction<select style={inputStyle} value={transfer.direction} onChange={(e) => setTransfer({ ...transfer, direction: e.target.value as typeof transfer.direction })}>{canViewBranchStock ? <option value="branch_to_warehouse">Branch → Warehouse</option> : null}<option value="warehouse_to_branch">Warehouse → Branch</option></select></label><label>Branch<select style={inputStyle} value={transfer.branchId} onChange={(e) => setTransfer({ ...transfer, branchId: e.target.value })} required><option value="">Choose branch</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>{transfer.direction === "branch_to_warehouse" ? <label>Branch product<select style={inputStyle} value={transfer.productId} onChange={(e) => setTransfer({ ...transfer, productId: e.target.value })} required><option value="">Choose product</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name} · {Number(product.current_stock || 0)} available</option>)}</select></label> : <label>Warehouse product<select style={inputStyle} value={transfer.itemId} onChange={(e) => setTransfer({ ...transfer, itemId: e.target.value })} required><option value="">Choose stock</option>{stock.filter((item) => Number(item.available_quantity) > 0).map((item) => <option key={item.item_id} value={item.item_id}>{item.name} · {Number(item.available_quantity)} available</option>)}</select></label>}<label>Quantity<input style={inputStyle} type="number" min="0.01" step="0.01" value={transfer.quantity} onChange={(e) => setTransfer({ ...transfer, quantity: e.target.value })} required /></label><label>Note<input style={inputStyle} value={transfer.notes} onChange={(e) => setTransfer({ ...transfer, notes: e.target.value })} placeholder="Optional" /></label></div><button className="button" disabled={busy}>Complete Transfer</button></form> : null}

            {activeTab === "orders" ? <div style={{ display: "grid", gap: 16 }}>
              {canManage && selectedWarehouse.is_active ? <form className="card warehouse-action-panel" onSubmit={handleCreateOrder}><div><h3>Create fulfilment order</h3><p>Stock is reserved immediately and leaves on dispatch.</p></div><div className="warehouse-form-grid"><input style={inputStyle} value={orderDraft.customerName} onChange={(e) => setOrderDraft({ ...orderDraft, customerName: e.target.value })} placeholder="Customer name" required /><input style={inputStyle} value={orderDraft.phone} onChange={(e) => setOrderDraft({ ...orderDraft, phone: e.target.value })} placeholder="Phone" /><input style={inputStyle} type="email" value={orderDraft.email} onChange={(e) => setOrderDraft({ ...orderDraft, email: e.target.value })} placeholder="Email" /><input style={inputStyle} value={orderDraft.externalId} onChange={(e) => setOrderDraft({ ...orderDraft, externalId: e.target.value })} placeholder="Order reference" /><input style={inputStyle} value={orderDraft.address} onChange={(e) => setOrderDraft({ ...orderDraft, address: e.target.value })} placeholder="Delivery address" /></div><div className="warehouse-order-line"><select style={inputStyle} value={lineDraft.itemId} onChange={(e) => setLineDraft({ ...lineDraft, itemId: e.target.value })}><option value="">Choose warehouse item</option>{stock.filter((item) => Number(item.available_quantity) > 0).map((item) => <option key={item.item_id} value={item.item_id}>{item.name} · {Number(item.available_quantity)} available</option>)}</select><input style={inputStyle} type="number" min="0.01" step="0.01" value={lineDraft.quantity} onChange={(e) => setLineDraft({ ...lineDraft, quantity: e.target.value })} placeholder="Quantity" /><button type="button" className="button secondary" onClick={addOrderLine}>Add</button></div>{orderLines.length ? <div className="warehouse-line-chips">{orderLines.map((line) => { const item = stock.find((row) => row.item_id === line.itemId); return <button type="button" key={line.itemId} onClick={() => setOrderLines((rows) => rows.filter((row) => row.itemId !== line.itemId))}>{item?.name || line.itemId} × {line.quantity} · remove</button>; })}</div> : null}<button className="button" disabled={busy || orderLines.length === 0}>Create &amp; Reserve Order</button></form> : null}
              <div className="card warehouse-action-panel"><h3>Fulfilment pipeline</h3>{orders.length === 0 ? <div className="warehouse-empty">No fulfilment orders yet.</div> : orders.map((order) => { const nextStatus: Partial<Record<FulfillmentStatus, Exclude<FulfillmentStatus, "reserved">>> = { reserved: "picking", picking: "packed", packed: "dispatched", dispatched: "delivered" }; const next = nextStatus[order.status]; return <div key={order.id} className="warehouse-order-card"><div><strong>Order #{order.id}{order.external_order_id ? ` · ${order.external_order_id}` : ""}</strong><small>{order.customer_name} · {new Date(order.created_at).toLocaleString()}</small></div><span className={`warehouse-order-status ${order.status}`}>{order.status}</span><p>{order.items.map((item) => `${item.product_name} × ${Number(item.quantity)}`).join(" · ")}</p><div className="warehouse-order-actions"><strong>GHS {Number(order.total_amount).toFixed(2)}</strong>{canManage && next ? <button className="button" disabled={busy} onClick={() => void advanceOrder(order, next)}>{next === "picking" ? "Start Picking" : next === "packed" ? "Mark Packed" : next === "dispatched" ? "Dispatch" : "Mark Delivered"}</button> : null}{canManage && ["reserved", "picking", "packed"].includes(order.status) ? <button className="button secondary" disabled={busy} onClick={() => void advanceOrder(order, "cancelled")}>Cancel</button> : null}</div></div>; })}</div>
            </div> : null}

            {activeTab === "movements" ? <div className="card warehouse-table-wrap"><table className="warehouse-table table-cards"><thead><tr><th>Date</th><th>Product</th><th>Movement</th><th>Reason</th><th>Reference</th><th>By</th></tr></thead><tbody>{movements.map((movement) => <tr key={movement.id}><td data-label="Date">{new Date(movement.created_at).toLocaleString()}</td><td data-label="Product"><strong>{movement.item_name}</strong><small>{movement.sku}</small></td><td data-label="Movement"><strong style={{ color: Number(movement.change) >= 0 ? "#047857" : "#b91c1c" }}>{Number(movement.change) >= 0 ? "+" : ""}{Number(movement.change).toLocaleString()}</strong></td><td data-label="Reason">{movement.reason}</td><td data-label="Reference">{movement.reference || "—"}{movement.branch_name ? <small>{movement.branch_name}</small> : null}</td><td data-label="By">{movement.actor_name || "System"}</td></tr>)}{movements.length === 0 ? <tr><td colSpan={6} className="warehouse-empty td-full">No warehouse movements yet.</td></tr> : null}</tbody></table></div> : null}
          </> : null}
        </>
      )}
      {activeWarehouses.length === 0 && warehouses.length > 0 ? <p style={{ color: "#92400e" }}>All warehouses are inactive.</p> : null}
      {showAddProduct ? <div className="warehouse-modal" onClick={() => setShowAddProduct(false)}><div className="warehouse-modal__panel" onClick={(event) => event.stopPropagation()}><ProductForm onCreate={handleAddWarehouseProduct} onCancel={() => setShowAddProduct(false)} userRole={currentUser?.role || "Warehouse"} layoutMode="modal" hideBranchField /></div></div> : null}
    </div>
  );
}
