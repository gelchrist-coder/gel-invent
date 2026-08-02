import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import {
  buildApiUrl,
  createIntegrationApiKey,
  createWarehouse,
  createWebhookEndpoint,
  deactivateWebhookEndpoint,
  createFulfillmentOrder,
  fetchBranches,
  fetchProducts,
  fetchWarehouseStock,
  fetchWarehouses,
  fetchFulfillmentOrders,
  fetchIntegrationApiKeys,
  fetchWebhookDeliveries,
  fetchWebhookEndpoints,
  receiveWarehouseStock,
  retryWebhookDelivery,
  revokeIntegrationApiKey,
  transferWarehouseStock,
  updateWarehouse,
  updateFulfillmentOrderStatus,
} from "../api";
import { Branch, FulfillmentOrder, FulfillmentStatus, IntegrationApiKey, Product, Warehouse, WarehouseStock, WebhookDelivery, WebhookEndpoint } from "../types";
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
  const canManageIntegrations = hasUserPermission("manage_settings", readStoredUser());
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<number | null>(null);
  const [stock, setStock] = useState<WarehouseStock[]>([]);
  const [orders, setOrders] = useState<FulfillmentOrder[]>([]);
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
  const [orderDraft, setOrderDraft] = useState({ customerName: "", phone: "", email: "", address: "", externalId: "" });
  const [lineDraft, setLineDraft] = useState({ itemId: "", quantity: "" });
  const [orderLines, setOrderLines] = useState<Array<{ itemId: number; quantity: number }>>([]);
  const [apiKeys, setApiKeys] = useState<IntegrationApiKey[]>([]);
  const [webhooks, setWebhooks] = useState<WebhookEndpoint[]>([]);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [revealedSecret, setRevealedSecret] = useState<{ label: string; value: string } | null>(null);
  const [keyName, setKeyName] = useState("Website");
  const [webhookDraft, setWebhookDraft] = useState({ name: "Website", url: "" });

  const selectedWarehouse = warehouses.find((warehouse) => warehouse.id === selectedWarehouseId) ?? null;
  const activeWarehouses = useMemo(() => warehouses.filter((warehouse) => warehouse.is_active), [warehouses]);

  const loadStock = useCallback(async (warehouseId: number) => {
    const [stockRows, orderRows] = await Promise.all([
      fetchWarehouseStock(warehouseId),
      fetchFulfillmentOrders(warehouseId),
    ]);
    setStock(stockRows);
    setOrders(orderRows);
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

  const loadIntegrations = useCallback(async () => {
    if (!canManageIntegrations) return;
    try {
      const [keyRows, webhookRows, deliveryRows] = await Promise.all([
        fetchIntegrationApiKeys(), fetchWebhookEndpoints(), fetchWebhookDeliveries(),
      ]);
      setApiKeys(keyRows); setWebhooks(webhookRows); setDeliveries(deliveryRows);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load website integrations");
    }
  }, [canManageIntegrations]);

  useEffect(() => { void loadIntegrations(); }, [loadIntegrations]);

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

  const handleCreateApiKey = async () => {
    if (!keyName.trim()) return;
    setBusy(true); setError(null);
    try {
      const created = await createIntegrationApiKey({ name: keyName.trim(), scopes: ["inventory:read", "orders:read", "orders:write"] });
      if (created.secret) setRevealedSecret({ label: "Website API key — copy it now; it will not be shown again", value: created.secret });
      await loadIntegrations();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not create API key"); }
    finally { setBusy(false); }
  };

  const handleCreateWebhook = async () => {
    if (!webhookDraft.name.trim() || !webhookDraft.url.trim()) return;
    setBusy(true); setError(null);
    try {
      const created = await createWebhookEndpoint({
        name: webhookDraft.name.trim(), url: webhookDraft.url.trim(),
        events: ["fulfillment.order.created", "fulfillment.order.picking", "fulfillment.order.packed", "fulfillment.order.dispatched", "fulfillment.order.delivered", "fulfillment.order.cancelled"],
      });
      if (created.signing_secret) setRevealedSecret({ label: "Webhook signing secret", value: created.signing_secret });
      setWebhookDraft({ ...webhookDraft, url: "" });
      await loadIntegrations();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not create webhook"); }
    finally { setBusy(false); }
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

              {canManage && selectedWarehouse.is_active ? (
                <form className="card" onSubmit={handleCreateOrder} style={{ padding: 16, display: "grid", gap: 12 }}>
                  <div><strong>Create fulfilment order</strong><div style={{ marginTop: 3, fontSize: 12, color: "#64748b" }}>Creating an order reserves stock immediately. Physical stock leaves the warehouse at dispatch.</div></div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10 }}>
                    <input style={inputStyle} value={orderDraft.customerName} onChange={(e) => setOrderDraft({ ...orderDraft, customerName: e.target.value })} placeholder="Customer name" required />
                    <input style={inputStyle} value={orderDraft.phone} onChange={(e) => setOrderDraft({ ...orderDraft, phone: e.target.value })} placeholder="Phone" />
                    <input style={inputStyle} type="email" value={orderDraft.email} onChange={(e) => setOrderDraft({ ...orderDraft, email: e.target.value })} placeholder="Email" />
                    <input style={inputStyle} value={orderDraft.externalId} onChange={(e) => setOrderDraft({ ...orderDraft, externalId: e.target.value })} placeholder="Website order ID (optional)" />
                    <input style={inputStyle} value={orderDraft.address} onChange={(e) => setOrderDraft({ ...orderDraft, address: e.target.value })} placeholder="Delivery address" />
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "minmax(180px, 1fr) 130px auto", gap: 8 }}>
                    <select style={inputStyle} value={lineDraft.itemId} onChange={(e) => setLineDraft({ ...lineDraft, itemId: e.target.value })}>
                      <option value="">Choose warehouse item</option>
                      {stock.filter((item) => Number(item.available_quantity) > 0).map((item) => <option key={item.item_id} value={item.item_id}>{item.name} · {Number(item.available_quantity)} available</option>)}
                    </select>
                    <input style={inputStyle} type="number" min="0.01" step="0.01" value={lineDraft.quantity} onChange={(e) => setLineDraft({ ...lineDraft, quantity: e.target.value })} placeholder="Quantity" />
                    <button type="button" className="button secondary" onClick={addOrderLine}>Add Item</button>
                  </div>
                  {orderLines.length ? <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{orderLines.map((line) => {
                    const item = stock.find((row) => row.item_id === line.itemId);
                    return <button type="button" key={line.itemId} onClick={() => setOrderLines((rows) => rows.filter((row) => row.itemId !== line.itemId))} style={{ border: "1px solid #bfdbfe", background: "#eff6ff", color: "#1d4ed8", borderRadius: 999, padding: "6px 10px", cursor: "pointer" }}>{item?.name || line.itemId} × {line.quantity} · remove</button>;
                  })}</div> : null}
                  <button className="button" disabled={busy || orderLines.length === 0}>Create &amp; Reserve Order</button>
                </form>
              ) : null}

              <div className="card" style={{ padding: 16, display: "grid", gap: 12 }}>
                <div><strong>Fulfilment pipeline</strong><div style={{ color: "#64748b", fontSize: 12, marginTop: 3 }}>{orders.filter((order) => !["delivered", "cancelled"].includes(order.status)).length} active orders</div></div>
                {orders.length === 0 ? <div style={{ padding: 18, textAlign: "center", color: "#64748b" }}>No fulfilment orders yet.</div> : orders.map((order) => {
                  const nextStatus: Partial<Record<FulfillmentStatus, Exclude<FulfillmentStatus, "reserved">>> = { reserved: "picking", picking: "packed", packed: "dispatched", dispatched: "delivered" };
                  const next = nextStatus[order.status];
                  return (
                    <div key={order.id} style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 14, display: "grid", gap: 9 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
                        <div><strong>Order #{order.id}{order.external_order_id ? ` · ${order.external_order_id}` : ""}</strong><div style={{ color: "#64748b", fontSize: 12 }}>{order.customer_name} · {new Date(order.created_at).toLocaleString()}</div></div>
                        <span style={{ textTransform: "capitalize", fontWeight: 700, fontSize: 12, padding: "5px 9px", borderRadius: 999, background: order.status === "cancelled" ? "#fef2f2" : order.status === "delivered" ? "#ecfdf5" : "#eff6ff", color: order.status === "cancelled" ? "#b91c1c" : order.status === "delivered" ? "#047857" : "#1d4ed8" }}>{order.status}</span>
                      </div>
                      <div style={{ fontSize: 13, color: "#334155" }}>{order.items.map((item) => `${item.product_name} × ${Number(item.quantity)}`).join(" · ")}</div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                        <strong style={{ marginRight: "auto" }}>{Number(order.total_amount).toFixed(2)}</strong>
                        {canManage && next ? <button className="button" disabled={busy} onClick={() => void advanceOrder(order, next)}>{next === "picking" ? "Start Picking" : next === "packed" ? "Mark Packed" : next === "dispatched" ? "Dispatch" : "Mark Delivered"}</button> : null}
                        {canManage && ["reserved", "picking", "packed"].includes(order.status) ? <button className="button secondary" disabled={busy} onClick={() => void advanceOrder(order, "cancelled")}>Cancel</button> : null}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="card" style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 620 }}>
                  <thead><tr style={{ background: "#f8fafc", textAlign: "left" }}><th style={{ padding: 12 }}>Product</th><th>SKU</th><th>On Hand</th><th>Reserved</th><th>Available</th><th>Value</th></tr></thead>
                  <tbody>
                    {stock.map((item) => (
                      <tr key={item.item_id} style={{ borderTop: "1px solid #e2e8f0" }}>
                        <td style={{ padding: 12, fontWeight: 600 }}>{item.name}</td><td>{item.sku}</td><td>{Number(item.quantity).toLocaleString()}</td><td>{Number(item.reserved_quantity).toLocaleString()}</td><td style={{ fontWeight: 700 }}>{Number(item.available_quantity).toLocaleString()} {item.unit}</td><td>{item.cost_price == null ? "—" : (Number(item.quantity) * Number(item.cost_price)).toFixed(2)}</td>
                      </tr>
                    ))}
                    {stock.length === 0 ? <tr><td colSpan={6} style={{ padding: 24, textAlign: "center", color: "#64748b" }}>No warehouse stock yet.</td></tr> : null}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </>
      )}
      {canManageIntegrations ? (
        <div className="card" style={{ padding: 18, display: "grid", gap: 18 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 20 }}>Website integration</h2>
            <p style={{ margin: "5px 0 0", color: "#64748b", fontSize: 13 }}>
              Connect an ecommerce website to warehouse availability and fulfilment orders. API base: <code>{buildApiUrl("/integrations/v1")}</code>
            </p>
          </div>

          {revealedSecret ? (
            <div style={{ padding: 13, border: "1px solid #fbbf24", background: "#fffbeb", borderRadius: 9 }}>
              <strong style={{ display: "block", color: "#92400e", marginBottom: 7 }}>{revealedSecret.label}</strong>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <code style={{ flex: 1, minWidth: 220, overflowWrap: "anywhere" }}>{revealedSecret.value}</code>
                <button type="button" className="button secondary" onClick={() => void navigator.clipboard.writeText(revealedSecret.value)}>Copy</button>
                <button type="button" className="button secondary" onClick={() => setRevealedSecret(null)}>Done</button>
              </div>
            </div>
          ) : null}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(290px, 1fr))", gap: 16 }}>
            <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 14, display: "grid", gap: 10 }}>
              <strong>Website API keys</strong>
              <div style={{ display: "flex", gap: 8 }}>
                <input style={inputStyle} value={keyName} onChange={(e) => setKeyName(e.target.value)} placeholder="Key name" />
                <button type="button" className="button" disabled={busy} onClick={() => void handleCreateApiKey()}>Create Key</button>
              </div>
              <p style={{ margin: 0, fontSize: 12, color: "#64748b" }}>New keys receive inventory read and order read/write scopes. Send the key in the <code>X-API-Key</code> header.</p>
              {apiKeys.map((key) => (
                <div key={key.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", paddingTop: 9, borderTop: "1px solid #e2e8f0" }}>
                  <div><strong style={{ fontSize: 13 }}>{key.name}</strong><div style={{ fontSize: 12, color: "#64748b" }}>{key.key_prefix}… · {key.is_active ? "Active" : "Revoked"}</div></div>
                  {key.is_active ? <button type="button" className="button secondary" onClick={() => void revokeIntegrationApiKey(key.id).then(loadIntegrations)}>Revoke</button> : null}
                </div>
              ))}
            </div>

            <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 14, display: "grid", gap: 10 }}>
              <strong>Signed webhooks</strong>
              <input style={inputStyle} value={webhookDraft.name} onChange={(e) => setWebhookDraft({ ...webhookDraft, name: e.target.value })} placeholder="Webhook name" />
              <input style={inputStyle} type="url" value={webhookDraft.url} onChange={(e) => setWebhookDraft({ ...webhookDraft, url: e.target.value })} placeholder="https://your-site.com/webhooks/gel-invent" />
              <button type="button" className="button" disabled={busy} onClick={() => void handleCreateWebhook()}>Add Webhook</button>
              <p style={{ margin: 0, fontSize: 12, color: "#64748b" }}>All fulfilment lifecycle events are sent with an <code>X-GelInvent-Signature</code> HMAC header.</p>
              {webhooks.map((webhook) => (
                <div key={webhook.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", paddingTop: 9, borderTop: "1px solid #e2e8f0" }}>
                  <div style={{ minWidth: 0 }}><strong style={{ fontSize: 13 }}>{webhook.name}</strong><div style={{ fontSize: 12, color: "#64748b", overflow: "hidden", textOverflow: "ellipsis" }}>{webhook.url} · {webhook.is_active ? "Active" : "Disabled"}</div></div>
                  {webhook.is_active ? <button type="button" className="button secondary" onClick={() => void deactivateWebhookEndpoint(webhook.id).then(loadIntegrations)}>Disable</button> : null}
                </div>
              ))}
            </div>
          </div>

          <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: 14 }}>
            <strong>Recent webhook deliveries</strong>
            <div style={{ display: "grid", gap: 7, marginTop: 10 }}>
              {deliveries.slice(0, 20).map((delivery) => (
                <div key={delivery.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: 9, background: "#f8fafc", borderRadius: 8, fontSize: 12 }}>
                  <span style={{ fontWeight: 700, color: delivery.status === "delivered" ? "#047857" : delivery.status === "failed" ? "#b91c1c" : "#92400e" }}>{delivery.status}</span>
                  <span style={{ flex: 1 }}>{delivery.event_type} · attempt {delivery.attempts}</span>
                  {delivery.response_status ? <span>HTTP {delivery.response_status}</span> : null}
                  {delivery.status === "failed" ? <button type="button" className="button secondary" onClick={() => void retryWebhookDelivery(delivery.id).then(loadIntegrations)}>Retry</button> : null}
                </div>
              ))}
              {deliveries.length === 0 ? <span style={{ color: "#64748b", fontSize: 13 }}>No webhook deliveries yet.</span> : null}
            </div>
          </div>
        </div>
      ) : null}
      {activeWarehouses.length === 0 && warehouses.length > 0 ? <p style={{ color: "#92400e" }}>All warehouses are inactive.</p> : null}
    </div>
  );
}
