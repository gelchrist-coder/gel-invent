import { useCallback, useEffect, useState } from "react";

import { fetchProductsCached, fetchWarehouses, fetchWarehouseStock } from "../api";
import PurchasingPanel from "../components/PurchasingPanel";
import { useExpiryTracking } from "../settings";
import type { Product, Warehouse, WarehouseStock } from "../types";
import { readStoredUser } from "../user-storage";

type PurchaseTab = "purchases" | "returns";

export default function Purchases() {
  const currentUser = readStoredUser();
  const isWarehouseUser = currentUser?.role === "Warehouse";
  const usesExpiryTracking = useExpiryTracking();
  const [activeTab, setActiveTab] = useState<PurchaseTab>("purchases");
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [destination, setDestination] = useState<string>(() => (
    isWarehouseUser && currentUser?.warehouse_id ? `warehouse:${currentUser.warehouse_id}` : "branch"
  ));
  const [pendingReturnPurchaseId, setPendingReturnPurchaseId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const selectedWarehouseId = destination.startsWith("warehouse:") ? Number(destination.split(":")[1]) : null;
  const selectedWarehouse = warehouses.find((warehouse) => warehouse.id === selectedWarehouseId) ?? null;

  const warehouseStockToProducts = (rows: WarehouseStock[]): Product[] => rows.map((item) => ({
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
  }));

  const loadProducts = useCallback(async () => {
    setError(null);
    try {
      if (selectedWarehouseId) {
        const rows = await fetchWarehouseStock(selectedWarehouseId);
        setProducts(warehouseStockToProducts(rows));
      } else {
        const rows = await fetchProductsCached((fresh) => setProducts(fresh));
        setProducts(rows);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load products for purchasing");
    } finally {
      setLoading(false);
    }
  }, [selectedWarehouseId]);

  useEffect(() => {
    fetchWarehouses()
      .then((rows) => {
        const activeRows = rows.filter((warehouse) => warehouse.is_active);
        setWarehouses(activeRows);
        if (isWarehouseUser && currentUser?.warehouse_id) {
          setDestination(`warehouse:${currentUser.warehouse_id}`);
        }
      })
      .catch(() => setWarehouses([]));
  }, [currentUser?.warehouse_id, isWarehouseUser]);

  useEffect(() => {
    void loadProducts();
    const handleBranchChange = () => {
      if (!selectedWarehouseId) void loadProducts();
    };
    window.addEventListener("activeBranchChanged", handleBranchChange);
    return () => window.removeEventListener("activeBranchChanged", handleBranchChange);
  }, [loadProducts, selectedWarehouseId]);

  return (
    <div className="app-shell">
      <div style={{ marginBottom: 20 }}>
        <h1 className="page-title" style={{ marginBottom: 6 }}>Purchases</h1>
        <p style={{ margin: 0, color: "#64748b" }}>Manage supplier purchases, payments, and stock returned to suppliers.</p>
      </div>

      <div className="card purchase-destination-card" style={{ marginBottom: 18, padding: 16, display: "grid", gap: 12 }}>
        <div>
          <div style={{ fontWeight: 800, color: "#0f172a" }}>Where should this supplier delivery go?</div>
          <div style={{ marginTop: 4, color: "#64748b", fontSize: 13 }}>
            Purchases update stock at the selected destination immediately and keep supplier payments and returns tied to that location.
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {!isWarehouseUser ? (
            <button type="button" onClick={() => setDestination("branch")} className={destination === "branch" ? "button" : "button secondary"}>
              Active Branch
            </button>
          ) : null}
          {warehouses.map((warehouse) => (
            <button
              key={warehouse.id}
              type="button"
              onClick={() => setDestination(`warehouse:${warehouse.id}`)}
              className={selectedWarehouseId === warehouse.id ? "button" : "button secondary"}
            >
              {warehouse.name} Warehouse
            </button>
          ))}
        </div>
        <div style={{ fontSize: 12, color: selectedWarehouseId ? "#047857" : "#1d4ed8", fontWeight: 700 }}>
          Receiving into {selectedWarehouse ? `${selectedWarehouse.name} Warehouse` : selectedWarehouseId ? "an unavailable warehouse" : "the active branch"}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 20, padding: 5, width: "fit-content", maxWidth: "100%", border: "1px solid #e2e8f0", borderRadius: 12, background: "#f8fafc" }}>
        {([
          { id: "purchases" as const, label: "Purchase Orders" },
          { id: "returns" as const, label: "Return Outwards" },
        ]).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: "9px 14px",
              border: activeTab === tab.id ? "1px solid #bfdbfe" : "1px solid transparent",
              borderRadius: 8,
              background: activeTab === tab.id ? "#ffffff" : "transparent",
              color: activeTab === tab.id ? "#1d4ed8" : "#475569",
              boxShadow: activeTab === tab.id ? "0 1px 3px rgba(15, 23, 42, 0.08)" : "none",
              cursor: "pointer",
              fontWeight: 700,
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error ? <div style={{ padding: 12, marginBottom: 16, borderRadius: 9, background: "#fef2f2", color: "#b91c1c" }}>{error}</div> : null}
      {loading ? <div className="card"><p style={{ margin: 0, color: "#64748b" }}>Loading purchases...</p></div> : selectedWarehouseId && !selectedWarehouse ? (
        <div className="card" style={{ color: "#92400e" }}>This warehouse is inactive or unavailable. Ask the business owner to reactivate it before recording purchases.</div>
      ) : (
        activeTab === "purchases" ? (
          <PurchasingPanel
            key={`purchasing:${destination}`}
            products={products}
            warehouseId={selectedWarehouseId}
            destinationLabel={selectedWarehouse ? `${selectedWarehouse.name} Warehouse` : "Active branch"}
            usesExpiryTracking={usesExpiryTracking}
            onPurchaseRecorded={loadProducts}
            mode="purchasing"
            onOpenReturnsView={(purchaseId) => {
              setPendingReturnPurchaseId(purchaseId);
              setActiveTab("returns");
            }}
          />
        ) : (
          <PurchasingPanel
            key={`returns:${destination}`}
            products={products}
            warehouseId={selectedWarehouseId}
            destinationLabel={selectedWarehouse ? `${selectedWarehouse.name} Warehouse` : "Active branch"}
            usesExpiryTracking={usesExpiryTracking}
            onPurchaseRecorded={loadProducts}
            mode="returns"
            initialReturnPurchaseId={pendingReturnPurchaseId}
            onInitialReturnPurchaseIdHandled={() => setPendingReturnPurchaseId(null)}
          />
        )
      )}
    </div>
  );
}
