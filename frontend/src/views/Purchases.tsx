import { useCallback, useEffect, useState } from "react";

import { fetchProductsCached } from "../api";
import PurchasingPanel from "../components/PurchasingPanel";
import { useExpiryTracking } from "../settings";
import type { Product } from "../types";

type PurchaseTab = "purchases" | "returns";

export default function Purchases() {
  const usesExpiryTracking = useExpiryTracking();
  const [activeTab, setActiveTab] = useState<PurchaseTab>("purchases");
  const [products, setProducts] = useState<Product[]>([]);
  const [pendingReturnPurchaseId, setPendingReturnPurchaseId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadProducts = useCallback(async () => {
    setError(null);
    try {
      const rows = await fetchProductsCached((fresh) => setProducts(fresh));
      setProducts(rows);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load products for purchasing");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProducts();
    const handleBranchChange = () => void loadProducts();
    window.addEventListener("activeBranchChanged", handleBranchChange);
    return () => window.removeEventListener("activeBranchChanged", handleBranchChange);
  }, [loadProducts]);

  return (
    <div className="app-shell">
      <div style={{ marginBottom: 20 }}>
        <h1 className="page-title" style={{ marginBottom: 6 }}>Purchases</h1>
        <p style={{ margin: 0, color: "#64748b" }}>Manage supplier purchases, payments, and stock returned to suppliers.</p>
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
      {loading ? <div className="card"><p style={{ margin: 0, color: "#64748b" }}>Loading purchases...</p></div> : (
        activeTab === "purchases" ? (
          <PurchasingPanel
            products={products}
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
            products={products}
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
