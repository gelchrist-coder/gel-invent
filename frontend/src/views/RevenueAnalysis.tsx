import { useCallback, useEffect, useState } from "react";
import { fetchRevenueAnalytics } from "../api";
import RevenueMetrics from "../components/RevenueMetrics";
import RevenueTrend from "../components/RevenueTrend";
import TopProducts from "../components/TopProducts";
import PaymentMethodBreakdown from "../components/PaymentMethodBreakdown";

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

export default function RevenueAnalysis() {
  // Check if current user is Admin
  const currentUser = localStorage.getItem("user");
  const userRole = currentUser ? JSON.parse(currentUser).role : null;
  const isAdmin = userRole === "Admin";

  const [data, setData] = useState<RevenueAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState("30d");

  const loadData = useCallback(async () => {
    // Only load data if user is Admin
    if (!isAdmin) return;
    
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
  }, [isAdmin, period]);

  useEffect(() => {
    if (isAdmin) {
      loadData();
    } else {
      setLoading(false);
    }
  }, [isAdmin, loadData, period]);

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
          <p style={{ color: "#666" }}>Only business owners can access revenue analysis.</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="app-shell">
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 24 }}>Revenue Analysis</h1>
        <div className="card">
          <p style={{ margin: 0, color: "#6b7280" }}>Loading revenue data...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="app-shell">
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 24 }}>Revenue Analysis</h1>
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
    <div className="app-shell">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>Revenue Analysis</h1>
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
            🔄 Refresh
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
