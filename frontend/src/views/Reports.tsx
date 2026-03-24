import { useCallback, useEffect, useState } from "react";
import { API_BASE, buildAuthHeaders, fetchRevenueAnalytics } from "../api";
import { useExpiryTracking } from "../settings";

// SVG Icons for KPI Cards
const CalendarIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </svg>
);

const CalendarWeekIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
    <path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01" />
  </svg>
);

const CalendarMonthIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
    <path d="M9 16l2 2 4-4" />
  </svg>
);

const PackageIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16.5 9.4 7.55 4.24" />
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    <polyline points="3.29 7 12 12 20.71 7" />
    <line x1="12" y1="22" x2="12" y2="12" />
  </svg>
);

const AlertCircleIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="8" x2="12" y2="12" />
    <line x1="12" y1="16" x2="12.01" y2="16" />
  </svg>
);

const AlertTriangleIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

const ClockIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

const UsersIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

const DollarIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="1" x2="12" y2="23" />
    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
  </svg>
);

interface SalesDashboard {
  today: { count: number; total: number };
  week: { count: number; total: number };
  month: { count: number; total: number };
  payment_methods: Array<{ method: string; count: number; total: number }>;
  top_products: Array<{ name: string; quantity_sold: number; revenue: number }>;
  recent_sales: Array<{
    id: number;
    product_id: number;
    quantity: number;
    total_price: number;
    customer_name: string | null;
    payment_method: string;
    created_at: string;
  }>;
}

interface InventoryStatus {
  summary: {
    total_products: number;
    low_stock_count: number;
    out_of_stock_count: number;
    expiring_soon_count: number;
    total_cost_value: number;
    total_selling_value: number;
    potential_profit: number;
  };
  low_stock: Array<{ id: number; sku: string; name: string; current_stock: number; unit: string }>;
  out_of_stock: Array<{ id: number; sku: string; name: string; unit: string }>;
  expiring_soon: Array<{
    id: number;
    sku: string;
    name: string;
    current_stock: number;
    expiry_date: string;
    days_until_expiry: number;
  }>;
  by_category: Array<{ category: string; product_count: number; total_stock: number }>;
}

interface CreditorsSummary {
  summary: {
    total_creditors: number;
    creditors_with_debt: number;
    total_outstanding_debt: number;
    average_debt: number;
  };
  top_debtors: Array<{
    id: number;
    name: string;
    phone: string | null;
    email: string | null;
    total_debt: number;
    created_at: string;
  }>;
  recent_transactions: Array<{
    id: number;
    creditor_id: number;
    creditor_name: string;
    amount: number;
    type: string;
    notes: string | null;
    created_at: string;
  }>;
  all_creditors: Array<{
    id: number;
    name: string;
    phone: string | null;
    total_debt: number;
  }>;
}

interface RevenueAnalytics {
  period: {
    start: string;
    end: string;
    label: string;
  };
  metrics: {
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
  payment_methods: Array<{ method: string; revenue: number }>;
  top_products: Array<{ product_name: string; quantity_sold: number; revenue: number; profit: number }>;
  daily_trend: Array<{ date: string; revenue: number }>;
}

type BarChartItem = {
  label: string;
  value: number;
  subLabel?: string;
  color?: string;
};

function HorizontalBarChart({
  title,
  items,
  formatValue,
}: {
  title: string;
  items: BarChartItem[];
  formatValue: (value: number) => string;
}) {
  if (items.length === 0) {
    return (
      <div style={{ backgroundColor: "white", border: "1px solid #e5e7eb", borderRadius: 8, padding: 16 }}>
        <h3 style={{ margin: "0 0 12px", fontSize: 16, fontWeight: 600 }}>{title}</h3>
        <p style={{ margin: 0, color: "#6b7280" }}>No chart data available</p>
      </div>
    );
  }

  const maxValue = Math.max(...items.map((item) => item.value), 0);

  return (
    <div style={{ backgroundColor: "white", border: "1px solid #e5e7eb", borderRadius: 8, padding: 16 }}>
      <h3 style={{ margin: "0 0 12px", fontSize: 16, fontWeight: 600 }}>{title}</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {items.map((item) => {
          const ratio = maxValue > 0 ? (item.value / maxValue) * 100 : 0;
          return (
            <div key={item.label}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, gap: 12 }}>
                <div style={{ minWidth: 0 }}>
                  <p
                    style={{
                      margin: 0,
                      fontSize: 14,
                      fontWeight: 600,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {item.label}
                  </p>
                  {item.subLabel && <p style={{ margin: "2px 0 0", fontSize: 12, color: "#6b7280" }}>{item.subLabel}</p>}
                </div>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#111827", flexShrink: 0 }}>
                  {formatValue(item.value)}
                </p>
              </div>
              <div
                style={{
                  width: "100%",
                  height: 10,
                  borderRadius: 999,
                  backgroundColor: "#eef2ff",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${Math.max(ratio, item.value > 0 ? 3 : 0)}%`,
                    height: "100%",
                    borderRadius: 999,
                    background: item.color || "linear-gradient(90deg, #2563eb, #60a5fa)",
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DailyTrendBarChart({
  points,
  formatCurrency,
  formatDate,
}: {
  points: Array<{ date: string; revenue: number }>;
  formatCurrency: (value: number) => string;
  formatDate: (value: string) => string;
}) {
  if (points.length === 0) {
    return <p style={{ textAlign: "center", color: "#6b7280", padding: 20 }}>No revenue trend data</p>;
  }

  const maxRevenue = Math.max(...points.map((p) => p.revenue), 0);

  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, backgroundColor: "white", padding: 16 }}>
      <div style={{ overflowX: "auto", overflowY: "hidden", paddingBottom: 10 }}>
        <div style={{ minWidth: Math.max(points.length * 18, 560), height: 240, display: "flex", alignItems: "flex-end", gap: 6 }}>
          {points.map((point, index) => {
            const ratio = maxRevenue > 0 ? point.revenue / maxRevenue : 0;
            const barHeight = Math.max(4, Math.round(ratio * 190));
            const showTick = index === 0 || index === points.length - 1 || points.length <= 14 || index % 7 === 0;
            return (
              <div key={point.date} style={{ width: 12, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                <div
                  title={`${formatDate(point.date)}: ${formatCurrency(point.revenue)}`}
                  style={{
                    width: "100%",
                    height: barHeight,
                    borderRadius: 4,
                    background: "linear-gradient(180deg, #34d399 0%, #059669 100%)",
                  }}
                />
                <span style={{ fontSize: 10, color: "#6b7280", whiteSpace: "nowrap", transform: "rotate(-35deg)", transformOrigin: "top left", height: showTick ? 28 : 0, opacity: showTick ? 1 : 0 }}>
                  {showTick ? formatDate(point.date) : ""}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function Reports() {
  // Check if current user is Admin
  const currentUser = localStorage.getItem("user");
  const userRole = currentUser ? JSON.parse(currentUser).role : null;
  const isAdmin = userRole === "Admin";
  const usesExpiryTracking = useExpiryTracking();

  const [activeTab, setActiveTab] = useState<"sales" | "inventory" | "creditors">("sales");
  const [salesData, setSalesData] = useState<SalesDashboard | null>(null);
  const [inventoryData, setInventoryData] = useState<InventoryStatus | null>(null);
  const [creditorsData, setCreditorsData] = useState<CreditorsSummary | null>(null);
  const [revenueData, setRevenueData] = useState<RevenueAnalytics | null>(null);
  const [revenuePeriod, setRevenuePeriod] = useState<"today" | "7d" | "30d" | "90d" | "all">("30d");
  const [loading, setLoading] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const headers = buildAuthHeaders({ "Content-Type": "application/json" });

      if (activeTab === "sales") {
        if (!salesData) {
          const res = await fetch(`${API_BASE}/reports/sales-dashboard`, { headers });
          if (res.ok) {
            setSalesData(await res.json());
          }
        }
        if (!revenueData) {
          const data = await fetchRevenueAnalytics(revenuePeriod);
          setRevenueData(data as RevenueAnalytics);
        }
      } else if (activeTab === "inventory" && !inventoryData) {
        const res = await fetch(`${API_BASE}/reports/inventory-status`, { headers });
        if (res.ok) {
          setInventoryData(await res.json());
        }
      } else if (activeTab === "creditors" && !creditorsData) {
        const res = await fetch(`${API_BASE}/reports/creditors-summary`, { headers });
        if (res.ok) {
          setCreditorsData(await res.json());
        }
      }
    } catch (error) {
      console.error("Failed to load report data:", error);
    } finally {
      setLoading(false);
    }
  }, [activeTab, creditorsData, inventoryData, revenueData, revenuePeriod, salesData]);

  useEffect(() => {
    // Only load data if user is Admin
    if (isAdmin) {
      loadData();
    }
  }, [isAdmin, loadData]);

  // Clear cached data when branch changes so fresh data is loaded
  useEffect(() => {
    const handleBranchChange = () => {
      setSalesData(null);
      setInventoryData(null);
      setCreditorsData(null);
      setRevenueData(null);
    };

    window.addEventListener("activeBranchChanged", handleBranchChange);
    return () => window.removeEventListener("activeBranchChanged", handleBranchChange);
  }, []);

  const formatCurrency = (amount: number) => `GHS ${amount.toFixed(2)}`;
  const formatDate = (dateStr: string) => new Date(dateStr).toLocaleDateString();

  // Block access for non-Admin users
  if (userRole !== "Admin") {
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
          <p style={{ color: "#666" }}>Only business owners can access reports.</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 20 }}>
      <h1 className="page-title" style={{ marginBottom: 24 }}>Reports</h1>
      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 24, borderBottom: "2px solid #e5e7eb" }}>
        {(["sales", "inventory", "creditors"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: "12px 24px",
              border: "none",
              background: "none",
              cursor: "pointer",
              fontWeight: 600,
              fontSize: 15,
              color: activeTab === tab ? "#2563eb" : "#6b7280",
              borderBottom: activeTab === tab ? "2px solid #2563eb" : "none",
              marginBottom: -2,
              textTransform: "capitalize",
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {loading && (
        <div style={{ textAlign: "center", padding: 40, color: "#6b7280" }}>Loading...</div>
      )}

      {activeTab === "sales" && (
        <div style={{ marginBottom: 16, display: "flex", justifyContent: "flex-end" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#4b5563" }}>
            Revenue Period
            <select
              value={revenuePeriod}
              onChange={(e) => {
                const next = e.target.value as "today" | "7d" | "30d" | "90d" | "all";
                setRevenuePeriod(next);
                setRevenueData(null);
              }}
              style={{
                padding: "8px 10px",
                border: "1px solid #d1d5db",
                borderRadius: 8,
                background: "#fff",
              }}
            >
              <option value="today">Today</option>
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="90d">Last 90 days</option>
              <option value="all">All time</option>
            </select>
          </label>
        </div>
      )}

      {/* Sales Dashboard */}
      {activeTab === "sales" && salesData && salesData.today && (
        <div>
          {/* Summary Cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 24 }}>
            <div style={{ padding: 20, backgroundColor: "#eff6ff", borderRadius: 8, border: "1px solid #bfdbfe" }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                <div style={{ width: 40, height: 40, borderRadius: 8, backgroundColor: "#dbeafe", display: "flex", alignItems: "center", justifyContent: "center", color: "#2563eb", flexShrink: 0 }}>
                  <CalendarIcon />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: 14, color: "#1e40af", marginBottom: 4 }}>Today</h3>
                  <p style={{ margin: 0, fontSize: 28, fontWeight: 700, color: "#1e3a8a" }}>
                    {formatCurrency(salesData.today?.total || 0)}
                  </p>
                  <p style={{ margin: "4px 0 0", fontSize: 13, color: "#3b82f6" }}>{salesData.today?.count || 0} sales</p>
                </div>
              </div>
            </div>

            <div style={{ padding: 20, backgroundColor: "#f0fdf4", borderRadius: 8, border: "1px solid #bbf7d0" }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                <div style={{ width: 40, height: 40, borderRadius: 8, backgroundColor: "#dcfce7", display: "flex", alignItems: "center", justifyContent: "center", color: "#16a34a", flexShrink: 0 }}>
                  <CalendarWeekIcon />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: 14, color: "#15803d", marginBottom: 4 }}>This Week</h3>
                  <p style={{ margin: 0, fontSize: 28, fontWeight: 700, color: "#166534" }}>
                    {formatCurrency(salesData.week?.total || 0)}
                  </p>
                  <p style={{ margin: "4px 0 0", fontSize: 13, color: "#22c55e" }}>{salesData.week?.count || 0} sales</p>
                </div>
              </div>
            </div>

            <div style={{ padding: 20, backgroundColor: "#fef3c7", borderRadius: 8, border: "1px solid #fde047" }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                <div style={{ width: 40, height: 40, borderRadius: 8, backgroundColor: "#fef08a", display: "flex", alignItems: "center", justifyContent: "center", color: "#ca8a04", flexShrink: 0 }}>
                  <CalendarMonthIcon />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: 14, color: "#a16207", marginBottom: 4 }}>This Month</h3>
                  <p style={{ margin: 0, fontSize: 28, fontWeight: 700, color: "#854d0e" }}>
                    {formatCurrency(salesData.month?.total || 0)}
                  </p>
                  <p style={{ margin: "4px 0 0", fontSize: 13, color: "#ca8a04" }}>{salesData.month?.count || 0} sales</p>
                </div>
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginBottom: 24 }}>
            <HorizontalBarChart
              title="Payment Method Distribution"
              items={salesData.payment_methods.map((pm, index) => ({
                label: pm.method,
                value: pm.total,
                subLabel: `${pm.count} sales`,
                color: index % 2 === 0 ? "linear-gradient(90deg, #16a34a, #4ade80)" : "linear-gradient(90deg, #0284c7, #38bdf8)",
              }))}
              formatValue={formatCurrency}
            />

            <HorizontalBarChart
              title="Top Product Revenue"
              items={salesData.top_products.slice(0, 6).map((prod, index) => ({
                label: prod.name,
                value: prod.revenue,
                subLabel: `${prod.quantity_sold} units sold`,
                color: index % 2 === 0 ? "linear-gradient(90deg, #9333ea, #c084fc)" : "linear-gradient(90deg, #f59e0b, #fcd34d)",
              }))}
              formatValue={formatCurrency}
            />
          </div>

          {/* Payment Methods */}
          <div style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>Sales by Payment Method</h2>
            <div style={{ backgroundColor: "white", border: "1px solid #e5e7eb", borderRadius: 8, padding: 16 }}>
              {salesData.payment_methods.length > 0 ? (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
                      <th style={{ textAlign: "left", padding: "8px 0", fontSize: 13, color: "#6b7280" }}>Method</th>
                      <th style={{ textAlign: "right", padding: "8px 0", fontSize: 13, color: "#6b7280" }}>Count</th>
                      <th style={{ textAlign: "right", padding: "8px 0", fontSize: 13, color: "#6b7280" }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {salesData.payment_methods.map((pm) => (
                      <tr key={pm.method} style={{ borderBottom: "1px solid #f3f4f6" }}>
                        <td style={{ padding: "12px 0", textTransform: "capitalize" }}>{pm.method}</td>
                        <td style={{ textAlign: "right", padding: "12px 0" }}>{pm.count}</td>
                        <td style={{ textAlign: "right", padding: "12px 0", fontWeight: 600 }}>
                          {formatCurrency(pm.total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p style={{ textAlign: "center", color: "#6b7280", padding: 20 }}>No sales data</p>
              )}
            </div>
          </div>

          {/* Top Products */}
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>Top Selling Products</h2>
            <div style={{ backgroundColor: "white", border: "1px solid #e5e7eb", borderRadius: 8, padding: 16 }}>
              {salesData.top_products.length > 0 ? (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
                      <th style={{ textAlign: "left", padding: "8px 0", fontSize: 13, color: "#6b7280" }}>Product</th>
                      <th style={{ textAlign: "right", padding: "8px 0", fontSize: 13, color: "#6b7280" }}>Qty Sold</th>
                      <th style={{ textAlign: "right", padding: "8px 0", fontSize: 13, color: "#6b7280" }}>Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {salesData.top_products.map((prod, idx) => (
                      <tr key={idx} style={{ borderBottom: "1px solid #f3f4f6" }}>
                        <td style={{ padding: "12px 0" }}>{prod.name}</td>
                        <td style={{ textAlign: "right", padding: "12px 0" }}>{prod.quantity_sold}</td>
                        <td style={{ textAlign: "right", padding: "12px 0", fontWeight: 600 }}>
                          {formatCurrency(prod.revenue)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p style={{ textAlign: "center", color: "#6b7280", padding: 20 }}>No products sold this month</p>
              )}
            </div>
          </div>

          {/* Revenue Summary (merged into Sales) */}
          {revenueData && (
            <div style={{ marginTop: 24 }}>
              <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>Revenue & Profitability</h2>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 24 }}>
                <div style={{ padding: 20, backgroundColor: "#eff6ff", borderRadius: 8, border: "1px solid #bfdbfe" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                    <div style={{ width: 40, height: 40, borderRadius: 8, backgroundColor: "#dbeafe", display: "flex", alignItems: "center", justifyContent: "center", color: "#2563eb", flexShrink: 0 }}>
                      <DollarIcon />
                    </div>
                    <div>
                      <h3 style={{ margin: 0, fontSize: 13, color: "#1e40af", marginBottom: 4 }}>Total Revenue</h3>
                      <p style={{ margin: 0, fontSize: 28, fontWeight: 700, color: "#1e3a8a" }}>
                        {formatCurrency(revenueData.metrics.total_revenue)}
                      </p>
                    </div>
                  </div>
                </div>

                <div style={{ padding: 20, backgroundColor: "#f0fdf4", borderRadius: 8, border: "1px solid #bbf7d0" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                    <div style={{ width: 40, height: 40, borderRadius: 8, backgroundColor: "#dcfce7", display: "flex", alignItems: "center", justifyContent: "center", color: "#16a34a", flexShrink: 0 }}>
                      <DollarIcon />
                    </div>
                    <div>
                      <h3 style={{ margin: 0, fontSize: 13, color: "#15803d", marginBottom: 4 }}>Actual Profit</h3>
                      <p style={{ margin: 0, fontSize: 28, fontWeight: 700, color: "#166534" }}>
                        {formatCurrency(revenueData.metrics.actual_profit)}
                      </p>
                    </div>
                  </div>
                </div>

                <div style={{ padding: 20, backgroundColor: "#fff7ed", borderRadius: 8, border: "1px solid #fed7aa" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                    <div style={{ width: 40, height: 40, borderRadius: 8, backgroundColor: "#ffedd5", display: "flex", alignItems: "center", justifyContent: "center", color: "#ea580c", flexShrink: 0 }}>
                      <CalendarWeekIcon />
                    </div>
                    <div>
                      <h3 style={{ margin: 0, fontSize: 13, color: "#9a3412", marginBottom: 4 }}>Sales Count</h3>
                      <p style={{ margin: 0, fontSize: 28, fontWeight: 700, color: "#c2410c" }}>
                        {revenueData.metrics.sales_count}
                      </p>
                    </div>
                  </div>
                </div>

                <div style={{ padding: 20, backgroundColor: "#fef2f2", borderRadius: 8, border: "1px solid #fecaca" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                    <div style={{ width: 40, height: 40, borderRadius: 8, backgroundColor: "#fee2e2", display: "flex", alignItems: "center", justifyContent: "center", color: "#dc2626", flexShrink: 0 }}>
                      <AlertCircleIcon />
                    </div>
                    <div>
                      <h3 style={{ margin: 0, fontSize: 13, color: "#991b1b", marginBottom: 4 }}>Losses</h3>
                      <p style={{ margin: 0, fontSize: 28, fontWeight: 700, color: "#b91c1c" }}>
                        {formatCurrency(revenueData.metrics.total_losses)}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div style={{ marginBottom: 24 }}>
                <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>Daily Revenue Trend</h2>
                <p style={{ margin: "0 0 12px", fontSize: 12, color: "#6b7280" }}>
                  Showing trend from {formatDate(revenueData.period.start)} to {formatDate(revenueData.period.end)}.
                </p>
                <DailyTrendBarChart
                  points={revenueData.daily_trend}
                  formatCurrency={formatCurrency}
                  formatDate={formatDate}
                />
              </div>

              <div style={{ padding: 16, backgroundColor: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 8 }}>
                <p style={{ margin: 0, fontSize: 14, color: "#374151" }}>
                  Profit margin: <strong>{revenueData.metrics.actual_profit_margin.toFixed(2)}%</strong>
                  {"  •  "}
                  Average transaction: <strong>{formatCurrency(revenueData.metrics.avg_transaction)}</strong>
                  {"  •  "}
                  Revenue growth: <strong>{revenueData.metrics.revenue_growth.toFixed(2)}%</strong>
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Inventory Status */}
      {activeTab === "inventory" && inventoryData && (
        <div>
          {/* Summary Cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 24 }}>
            <div style={{ padding: 20, backgroundColor: "#f3f4f6", borderRadius: 8, border: "1px solid #d1d5db" }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                <div style={{ width: 40, height: 40, borderRadius: 8, backgroundColor: "#e5e7eb", display: "flex", alignItems: "center", justifyContent: "center", color: "#4b5563", flexShrink: 0 }}>
                  <PackageIcon />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: 13, color: "#6b7280", marginBottom: 4 }}>Total Products</h3>
                  <p style={{ margin: 0, fontSize: 32, fontWeight: 700, color: "#1f2937" }}>
                    {inventoryData.summary.total_products}
                  </p>
                </div>
              </div>
            </div>

            <div style={{ padding: 20, backgroundColor: "#fef2f2", borderRadius: 8, border: "1px solid #fecaca" }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                <div style={{ width: 40, height: 40, borderRadius: 8, backgroundColor: "#fee2e2", display: "flex", alignItems: "center", justifyContent: "center", color: "#dc2626", flexShrink: 0 }}>
                  <AlertCircleIcon />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: 13, color: "#991b1b", marginBottom: 4 }}>Out of Stock</h3>
                  <p style={{ margin: 0, fontSize: 32, fontWeight: 700, color: "#dc2626" }}>
                    {inventoryData.summary.out_of_stock_count}
                  </p>
                </div>
              </div>
            </div>

            <div style={{ padding: 20, backgroundColor: "#fef3c7", borderRadius: 8, border: "1px solid #fde047" }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                <div style={{ width: 40, height: 40, borderRadius: 8, backgroundColor: "#fef08a", display: "flex", alignItems: "center", justifyContent: "center", color: "#d97706", flexShrink: 0 }}>
                  <AlertTriangleIcon />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: 13, color: "#92400e", marginBottom: 4 }}>Low Stock</h3>
                  <p style={{ margin: 0, fontSize: 32, fontWeight: 700, color: "#d97706" }}>
                    {inventoryData.summary.low_stock_count}
                  </p>
                </div>
              </div>
            </div>

            {usesExpiryTracking && (
            <div style={{ padding: 20, backgroundColor: "#fff7ed", borderRadius: 8, border: "1px solid #fed7aa" }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                <div style={{ width: 40, height: 40, borderRadius: 8, backgroundColor: "#ffedd5", display: "flex", alignItems: "center", justifyContent: "center", color: "#ea580c", flexShrink: 0 }}>
                  <ClockIcon />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: 13, color: "#9a3412", marginBottom: 4 }}>Expiring Soon</h3>
                  <p style={{ margin: 0, fontSize: 32, fontWeight: 700, color: "#ea580c" }}>
                    {inventoryData.summary.expiring_soon_count}
                  </p>
                </div>
              </div>
            </div>
            )}
          </div>

          {/* Stock Value */}
          <div style={{ marginBottom: 24, padding: 20, backgroundColor: "#f0fdf4", borderRadius: 8, border: "1px solid #bbf7d0" }}>
            <h3 style={{ margin: "0 0 12px", fontSize: 16, color: "#15803d" }}>Stock Valuation</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
              <div>
                <p style={{ margin: 0, fontSize: 12, color: "#166534" }}>Cost Value</p>
                <p style={{ margin: "4px 0 0", fontSize: 20, fontWeight: 600, color: "#15803d" }}>
                  {formatCurrency(inventoryData.summary.total_cost_value)}
                </p>
              </div>
              <div>
                <p style={{ margin: 0, fontSize: 12, color: "#166534" }}>Selling Value</p>
                <p style={{ margin: "4px 0 0", fontSize: 20, fontWeight: 600, color: "#15803d" }}>
                  {formatCurrency(inventoryData.summary.total_selling_value)}
                </p>
              </div>
              <div>
                <p style={{ margin: 0, fontSize: 12, color: "#166534" }}>Potential Profit</p>
                <p style={{ margin: "4px 0 0", fontSize: 20, fontWeight: 600, color: "#15803d" }}>
                  {formatCurrency(inventoryData.summary.potential_profit)}
                </p>
              </div>
            </div>
          </div>

          <div style={{ marginBottom: 24 }}>
            <HorizontalBarChart
              title="Stock by Category"
              items={inventoryData.by_category
                .sort((a, b) => b.total_stock - a.total_stock)
                .slice(0, 8)
                .map((cat, index) => ({
                  label: cat.category,
                  value: cat.total_stock,
                  subLabel: `${cat.product_count} products`,
                  color: index % 2 === 0 ? "linear-gradient(90deg, #0d9488, #2dd4bf)" : "linear-gradient(90deg, #3b82f6, #93c5fd)",
                }))}
              formatValue={(value) => value.toFixed(0)}
            />
          </div>

          {/* Alerts */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16 }}>
            {/* Low Stock */}
            <div>
              <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Low Stock Items</h2>
              <div style={{ backgroundColor: "white", border: "1px solid #e5e7eb", borderRadius: 8, padding: 16, maxHeight: 300, overflowY: "auto" }}>
                {inventoryData.low_stock.length > 0 ? (
                  inventoryData.low_stock.map((item) => (
                    <div key={item.id} style={{ padding: "8px 0", borderBottom: "1px solid #f3f4f6" }}>
                      <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{item.name}</p>
                      <p style={{ margin: "4px 0 0", fontSize: 12, color: "#d97706" }}>
                        Stock: {item.current_stock} {item.unit}
                      </p>
                    </div>
                  ))
                ) : (
                  <p style={{ textAlign: "center", color: "#6b7280", padding: 20 }}>No low stock items</p>
                )}
              </div>
            </div>

            {/* Expiring Soon - only show if business uses expiry tracking */}
            {usesExpiryTracking && (
            <div>
              <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Expiring Soon</h2>
              <div style={{ backgroundColor: "white", border: "1px solid #e5e7eb", borderRadius: 8, padding: 16, maxHeight: 300, overflowY: "auto" }}>
                {inventoryData.expiring_soon.length > 0 ? (
                  inventoryData.expiring_soon.map((item) => (
                    <div key={item.id} style={{ padding: "8px 0", borderBottom: "1px solid #f3f4f6" }}>
                      <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{item.name}</p>
                      <p style={{ margin: "4px 0 0", fontSize: 12, color: "#ea580c" }}>
                        Expires: {formatDate(item.expiry_date)} ({item.days_until_expiry} days)
                      </p>
                    </div>
                  ))
                ) : (
                  <p style={{ textAlign: "center", color: "#6b7280", padding: 20 }}>No items expiring soon</p>
                )}
              </div>
            </div>
            )}
          </div>
        </div>
      )}

      {/* Creditors Summary */}
      {activeTab === "creditors" && creditorsData && (
        <div>
          {/* Summary Cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 24 }}>
            <div style={{ padding: 20, backgroundColor: "#f3f4f6", borderRadius: 8, border: "1px solid #d1d5db" }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                <div style={{ width: 40, height: 40, borderRadius: 8, backgroundColor: "#e5e7eb", display: "flex", alignItems: "center", justifyContent: "center", color: "#4b5563", flexShrink: 0 }}>
                  <UsersIcon />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: 13, color: "#6b7280", marginBottom: 4 }}>Total Creditors</h3>
                  <p style={{ margin: 0, fontSize: 32, fontWeight: 700, color: "#1f2937" }}>
                    {creditorsData.summary.total_creditors}
                  </p>
                </div>
              </div>
            </div>

            <div style={{ padding: 20, backgroundColor: "#fef2f2", borderRadius: 8, border: "1px solid #fecaca" }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                <div style={{ width: 40, height: 40, borderRadius: 8, backgroundColor: "#fee2e2", display: "flex", alignItems: "center", justifyContent: "center", color: "#dc2626", flexShrink: 0 }}>
                  <AlertCircleIcon />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: 13, color: "#991b1b", marginBottom: 4 }}>With Debt</h3>
                  <p style={{ margin: 0, fontSize: 32, fontWeight: 700, color: "#dc2626" }}>
                    {creditorsData.summary.creditors_with_debt}
                  </p>
                </div>
              </div>
            </div>

            <div style={{ padding: 20, backgroundColor: "#fff7ed", borderRadius: 8, border: "1px solid #fed7aa" }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                <div style={{ width: 40, height: 40, borderRadius: 8, backgroundColor: "#ffedd5", display: "flex", alignItems: "center", justifyContent: "center", color: "#ea580c", flexShrink: 0 }}>
                  <DollarIcon />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: 13, color: "#9a3412", marginBottom: 4 }}>Total Debt</h3>
                  <p style={{ margin: 0, fontSize: 28, fontWeight: 700, color: "#ea580c" }}>
                    {formatCurrency(creditorsData.summary.total_outstanding_debt)}
                  </p>
                </div>
              </div>
            </div>

            <div style={{ padding: 20, backgroundColor: "#fef3c7", borderRadius: 8, border: "1px solid #fde047" }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                <div style={{ width: 40, height: 40, borderRadius: 8, backgroundColor: "#fef08a", display: "flex", alignItems: "center", justifyContent: "center", color: "#d97706", flexShrink: 0 }}>
                  <DollarIcon />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: 13, color: "#92400e", marginBottom: 4 }}>Avg Debt</h3>
                  <p style={{ margin: 0, fontSize: 28, fontWeight: 700, color: "#d97706" }}>
                    {formatCurrency(creditorsData.summary.average_debt)}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div style={{ marginBottom: 24 }}>
            <HorizontalBarChart
              title="Debt Distribution by Creditor"
              items={creditorsData.top_debtors.slice(0, 8).map((debtor, index) => ({
                label: debtor.name,
                value: debtor.total_debt,
                subLabel: debtor.phone || "No phone",
                color: index % 2 === 0 ? "linear-gradient(90deg, #dc2626, #f87171)" : "linear-gradient(90deg, #ea580c, #fb923c)",
              }))}
              formatValue={formatCurrency}
            />
          </div>

          {/* Top Debtors */}
          <div style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>Top Debtors</h2>
            <div style={{ backgroundColor: "white", border: "1px solid #e5e7eb", borderRadius: 8, padding: 16 }}>
              {creditorsData.top_debtors.length > 0 ? (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
                      <th style={{ textAlign: "left", padding: "8px 0", fontSize: 13, color: "#6b7280" }}>Name</th>
                      <th style={{ textAlign: "left", padding: "8px 0", fontSize: 13, color: "#6b7280" }}>Phone</th>
                      <th style={{ textAlign: "right", padding: "8px 0", fontSize: 13, color: "#6b7280" }}>Debt</th>
                    </tr>
                  </thead>
                  <tbody>
                    {creditorsData.top_debtors.map((debtor) => (
                      <tr key={debtor.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                        <td style={{ padding: "12px 0", fontWeight: 600 }}>{debtor.name}</td>
                        <td style={{ padding: "12px 0", color: "#6b7280" }}>{debtor.phone || "N/A"}</td>
                        <td style={{ textAlign: "right", padding: "12px 0", fontWeight: 600, color: "#dc2626" }}>
                          {formatCurrency(debtor.total_debt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p style={{ textAlign: "center", color: "#6b7280", padding: 20 }}>No creditors with debt</p>
              )}
            </div>
          </div>

          {/* Recent Transactions */}
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>Recent Transactions</h2>
            <div style={{ backgroundColor: "white", border: "1px solid #e5e7eb", borderRadius: 8, padding: 16 }}>
              {creditorsData.recent_transactions.length > 0 ? (
                <div style={{ maxHeight: 400, overflowY: "auto" }}>
                  {creditorsData.recent_transactions.map((txn) => (
                    <div key={txn.id} style={{ padding: "12px 0", borderBottom: "1px solid #f3f4f6" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                        <span style={{ fontWeight: 600 }}>{txn.creditor_name}</span>
                        <span
                          style={{
                            fontWeight: 600,
                            color: txn.type === "debt" ? "#dc2626" : "#16a34a",
                          }}
                        >
                          {txn.type === "debt" ? "+" : "-"} {formatCurrency(txn.amount)}
                        </span>
                      </div>
                      <p style={{ margin: "4px 0", fontSize: 12, color: "#6b7280" }}>
                        {txn.notes || "No notes"}
                      </p>
                      <p style={{ margin: "4px 0 0", fontSize: 11, color: "#9ca3af" }}>
                        {formatDate(txn.created_at)}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ textAlign: "center", color: "#6b7280", padding: 20 }}>No transactions</p>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
