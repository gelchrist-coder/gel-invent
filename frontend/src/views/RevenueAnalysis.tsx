import { useCallback, useEffect, useState } from "react";
import { fetchRevenueAnalytics } from "../api";
import RevenueMetrics from "../components/RevenueMetrics";
import RevenueTrend from "../components/RevenueTrend";
import TopProducts from "../components/TopProducts";
import PaymentMethodBreakdown from "../components/PaymentMethodBreakdown";
import { hasUserPermission, readStoredUser } from "../user-storage";

type RevenueAnalysisProps = {
  embedded?: boolean;
};

type RevenueMetricsData = {
  total_revenue: number;
  cash_revenue: number;
  credit_revenue: number;
  total_profit: number;
  total_losses: number;
  actual_profit: number;
  total_cost: number;
  profit_margin: number;
  actual_profit_margin: number;
  sales_count: number;
  avg_transaction: number;
  revenue_growth: number;
};

type DailyTrendRow = {
  date: string;
  revenue: number;
};

type PaymentMethodRow = {
  method: string;
  revenue: number;
};

type TopProductRow = {
  product_id: number;
  product_name: string;
  sku: string;
  quantity_sold: number;
  revenue: number;
  cost: number;
  profit: number;
  profit_margin: number;
};

type RevenueAnalyticsResponse = {
  metrics: RevenueMetricsData;
  daily_trend: DailyTrendRow[];
  payment_methods: PaymentMethodRow[];
  top_products: TopProductRow[];
};

export default function RevenueAnalysis({ embedded = false }: RevenueAnalysisProps) {
  const currentUser = readStoredUser();
  const canViewRevenue = hasUserPermission("view_revenue", currentUser);

  const [data, setData] = useState<RevenueAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState("30d");
  const title = "Revenue";

  const loadData = useCallback(async () => {
    if (!canViewRevenue) return;
    
    setLoading(true);
    setError(null);
    try {
      const analytics = await fetchRevenueAnalytics(period);
      setData(analytics as RevenueAnalyticsResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load revenue data");
    } finally {
      setLoading(false);
    }
  }, [canViewRevenue, period]);

  useEffect(() => {
    if (canViewRevenue) {
      loadData();
    } else {
      setLoading(false);
    }
  }, [canViewRevenue, loadData, period]);

  // Reload data when branch changes
  useEffect(() => {
    const handleBranchChange = () => {
      if (canViewRevenue) {
        loadData();
      }
    };

    window.addEventListener("activeBranchChanged", handleBranchChange);
    return () => window.removeEventListener("activeBranchChanged", handleBranchChange);
  }, [canViewRevenue, loadData]);

  if (!canViewRevenue) {
    return (
      <div style={{ padding: embedded ? 0 : 32 }}>
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
          <p style={{ color: "#666" }}>Your account does not have access to revenue.</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className={embedded ? undefined : "app-shell"}>
        {!embedded ? <h1 className="page-title" style={{ marginBottom: 24 }}>{title}</h1> : null}
        <div className="card">
          <p style={{ margin: 0, color: "#6b7280" }}>Loading revenue data...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={embedded ? undefined : "app-shell"}>
        {!embedded ? <h1 className="page-title" style={{ marginBottom: 24 }}>{title}</h1> : null}
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

  if (!data) {
    return null;
  }

  return (
    <div className={embedded ? undefined : "app-shell"}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h1 className="page-title" style={{ margin: 0, fontSize: embedded ? 24 : undefined }}>{title}</h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <label style={{ fontSize: 14, color: "#6b7280", fontWeight: 500 }}>Period:</label>
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            style={{
              padding: "8px 12px",
              borderRadius: 6,
              border: "1px solid #d1d5db",
              fontSize: 14,
              fontWeight: 500,
            }}
          >
            <option value="today">Today</option>
            <option value="7d">Last 7 Days</option>
            <option value="30d">Last 30 Days</option>
            <option value="90d">Last 90 Days</option>
            <option value="all">All Time</option>
          </select>
          <button
            onClick={loadData}
            style={{
              padding: "8px 16px",
              borderRadius: 6,
              border: "1px solid #d1d5db",
              backgroundColor: "white",
              cursor: "pointer",
              fontSize: 14,
              fontWeight: 500,
            }}
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Key Metrics */}
      <div style={{ marginBottom: 24 }}>
        <RevenueMetrics metrics={data.metrics} />
      </div>

      {/* Revenue Trend */}
      <div className="card" style={{ marginBottom: 24 }}>
        <h3 style={{ margin: "0 0 16px 0", fontSize: 18, fontWeight: 600 }}>Revenue Trend</h3>
        <RevenueTrend data={data.daily_trend} />
      </div>

      {/* Payment Methods */}
      <div className="card" style={{ marginBottom: 24 }}>
        <h3 style={{ margin: "0 0 16px 0", fontSize: 18, fontWeight: 600 }}>Payment Methods</h3>
        <PaymentMethodBreakdown data={data.payment_methods} />
      </div>

      {/* Top Products */}
      <div className="card">
        <h3 style={{ margin: "0 0 16px 0", fontSize: 18, fontWeight: 600 }}>Top Products by Revenue</h3>
        <TopProducts products={data.top_products} />
      </div>
    </div>
  );
}
