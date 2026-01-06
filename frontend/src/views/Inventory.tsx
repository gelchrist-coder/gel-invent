import { useCallback, useEffect, useState } from "react";
import type { ComponentProps } from "react";
import { fetchInventoryAnalytics, fetchAllMovements, exportMovementsPdf } from "../api";
import InventoryOverview from "../components/InventoryOverview";
import StockAlerts from "../components/StockAlerts";
import MovementHistory from "../components/MovementHistory";
import { useExpiryTracking } from "../settings";

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [movementDays, setMovementDays] = useState(30);
  const [exporting, setExporting] = useState(false);
  const [exportType, setExportType] = useState<string>("all");

  const loadData = useCallback(async () => {
    // Only load data if user is Admin
    if (!isAdmin) return;
    
    setLoading(true);
    setError(null);
    try {
      const [analyticsData, movementsData] = await Promise.all([
        fetchInventoryAnalytics(),
        fetchAllMovements(movementDays),
      ]);
      setAnalytics(analyticsData as InventoryAnalytics);
      setMovements(movementsData as MovementHistoryRow[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load inventory data");
    } finally {
      setLoading(false);
    }
  }, [isAdmin, movementDays]);

  useEffect(() => {
    if (isAdmin) {
      loadData();
    } else {
      setLoading(false);
    }
  }, [isAdmin, loadData, movementDays]);

  const handleExportPdf = async () => {
    setExporting(true);
    try {
      const blob = await exportMovementsPdf(movementDays, exportType);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `stock_movements_${exportType}_${new Date().toISOString().slice(0, 10)}.pdf`;
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

  // Block access for non-Admin users
  if (!isAdmin) {
    return (
      <div style={{ padding: 32 }}>
        <div
          style={{
            padding: 32,
            background: "#fee",
            border: "1px solid #fcc",
            borderRadius: 8,
            textAlign: "center",
          }}
        >
          <h2 style={{ color: "#c33", marginBottom: 8 }}>Access Denied</h2>
          <p style={{ color: "#666" }}>Only business owners can access inventory tracking.</p>
        </div>
      </div>
    );
  }

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

  const locations = analytics.stock_by_location.map((loc) => loc.location);

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

      {/* Movement History */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Movement History</h3>
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <label style={{ fontSize: 14, color: "#6b7280" }}>Show last:</label>
              <select
                value={movementDays}
                onChange={(e) => setMovementDays(Number(e.target.value))}
                style={{
                  padding: "6px 10px",
                  borderRadius: 6,
                  border: "1px solid #d1d5db",
                  fontSize: 14,
                }}
              >
                <option value={7}>7 days</option>
                <option value={30}>30 days</option>
                <option value={90}>90 days</option>
                <option value={365}>1 year</option>
              </select>
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
        <MovementHistory movements={movements} locations={locations} />
      </div>
    </div>
  );
}
