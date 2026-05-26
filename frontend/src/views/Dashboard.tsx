import { useCallback, useEffect, useMemo, useState } from "react";

import { fetchProductsCached, fetchSalesCached, fetchSalesDashboard, fetchSystemSettingsCached, getCachedProducts } from "../api";
import { Product } from "../types";
import { useExpiryTracking } from "../settings";

type Props = {
  onNavigate: (view: string) => void;
};

type DashboardTopProduct = {
  name: string;
  quantity_sold: number | string;
  revenue: number | string;
};

type DashboardRecentSale = {
  id: number | string;
  product?: { name?: string | null } | null;
  product_id?: number | string;
  customer_name?: string | null;
  quantity?: number | string;
  total_price?: number | string;
  payment_method?: string | null;
  created_at: string;
};

type SalesDashboardResponse = {
  top_products?: DashboardTopProduct[];
  recent_sales?: DashboardRecentSale[];
  [key: string]: unknown;
};

type LowStockItem = {
  id: number | string;
  name: string;
  sku: string;
  currentStock: number;
  minStock: number;
};

type TrendSale = {
  created_at: string;
  total_price?: number | string;
};

type TrendPoint = {
  key: string;
  label: string;
  revenue: number;
};

type TrendCoordinate = TrendPoint & {
  x: number;
  y: number;
};

type GlobalRangeKey = "today" | "7d" | "30d" | "all" | "custom";

type KpiItem = {
  label: string;
  value: string;
  accent: string;
  helper: string;
};

const rangeOptions: Array<{ key: GlobalRangeKey; label: string }> = [
  { key: "today", label: "Today" },
  { key: "7d", label: "Last 7 Days" },
  { key: "30d", label: "Last 30 Days" },
  { key: "all", label: "All Time" },
  { key: "custom", label: "Custom" },
];

function toISODateOnly(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getRangeStartDate(range: GlobalRangeKey, customStartDate: string): string | undefined {
  if (range === "all") {
    return undefined;
  }

  if (range === "custom") {
    return customStartDate || undefined;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (range === "today") {
    return toISODateOnly(today);
  }

  if (range === "7d") {
    const start = new Date(today);
    start.setDate(today.getDate() - 6);
    return toISODateOnly(start);
  }

  const start = new Date(today);
  start.setDate(today.getDate() - 29);
  return toISODateOnly(start);
}

function toCurrency(value: number): string {
  return `GHS ${value.toFixed(2)}`;
}

function toCompactCurrency(value: number): string {
  return `GHS ${new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value)}`;
}

export default function Dashboard({ onNavigate }: Props) {
  // Initialize from cache for instant display
  const cachedProducts = getCachedProducts();
  const [products, setProducts] = useState<Product[]>(cachedProducts || []);
  const [loading, setLoading] = useState(!cachedProducts); // Only show loading if no cache
  const [dashboardData, setDashboardData] = useState<SalesDashboardResponse | null>(null);
  const [salesForTrend, setSalesForTrend] = useState<TrendSale[]>([]);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [lowStockThreshold, setLowStockThreshold] = useState<number>(10);
  const [expiryWarningDays, setExpiryWarningDays] = useState<number>(180);
  const usesExpiryTracking = useExpiryTracking();
  const [selectedRange, setSelectedRange] = useState<GlobalRangeKey>("30d");
  const [customRangeStartDate, setCustomRangeStartDate] = useState<string>("");
  const [hoveredTrendPointKey, setHoveredTrendPointKey] = useState<string | null>(null);
  const rangeStartDate = useMemo(
    () => getRangeStartDate(selectedRange, customRangeStartDate),
    [customRangeStartDate, selectedRange],
  );

  const rangeLabel = useMemo(() => {
    if (selectedRange === "today") return "Today";
    if (selectedRange === "7d") return "Last 7 Days";
    if (selectedRange === "30d") return "Last 30 Days";
    if (selectedRange === "custom") return customRangeStartDate ? `Since ${customRangeStartDate}` : "Custom Range";
    return "All Time";
  }, [customRangeStartDate, selectedRange]);

  // Check if current user is Admin
  const currentUser = localStorage.getItem("user");
  const userRole = currentUser ? JSON.parse(currentUser).role : null;
  const isAdmin = userRole === "Admin";
  const token = localStorage.getItem("token");

  const loadDashboardData = useCallback(async () => {
    if (!token) {
      setLoading(false);
      setDashboardLoading(false);
      return;
    }

    setDashboardLoading(true);

    try {
      const [productsData, settingsData, dashboardResponse, salesData] = await Promise.all([
        fetchProductsCached((fresh) => setProducts(fresh)),
        fetchSystemSettingsCached((fresh) => {
          setLowStockThreshold(fresh.low_stock_threshold);
          setExpiryWarningDays(fresh.expiry_warning_days);
        }).catch(() => null),
        isAdmin ? fetchSalesDashboard(rangeStartDate) : Promise.resolve(null),
        isAdmin ? fetchSalesCached((fresh) => setSalesForTrend(fresh as TrendSale[])).catch(() => []) : Promise.resolve([]),
      ]);

      setProducts(productsData);

      if (settingsData) {
        setLowStockThreshold(settingsData.low_stock_threshold);
        setExpiryWarningDays(settingsData.expiry_warning_days);
      }

      if (isAdmin) {
        if (dashboardResponse) {
          setDashboardData(dashboardResponse);
        }
        setSalesForTrend(salesData as TrendSale[]);
      } else {
        setDashboardData(null);
        setSalesForTrend([]);
      }
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn("Dashboard load degraded due to temporary error:", error);
      }
    } finally {
      setLoading(false);
      setDashboardLoading(false);
    }
  }, [isAdmin, rangeStartDate, token]);

  useEffect(() => {
    void loadDashboardData();
  }, [loadDashboardData]);

  useEffect(() => {
    const handler = () => {
      void loadDashboardData();
    };
    window.addEventListener("activeBranchChanged", handler as EventListener);
    return () => window.removeEventListener("activeBranchChanged", handler as EventListener);
  }, [loadDashboardData]);

  const dashboardTopProducts = dashboardData?.top_products;
  const dashboardRecentSales = dashboardData?.recent_sales;

  // Top products from dashboard data
  const topProducts = useMemo(() => dashboardTopProducts ?? [], [dashboardTopProducts]);

  // Recent sales from dashboard data
  const recentSales = useMemo(() => dashboardRecentSales ?? [], [dashboardRecentSales]);

  const rangeStartTimestamp = useMemo(() => {
    if (!rangeStartDate) {
      return null;
    }
    const parsed = new Date(`${rangeStartDate}T00:00:00`).getTime();
    return Number.isNaN(parsed) ? null : parsed;
  }, [rangeStartDate]);

  const salesInSelectedRange = useMemo<TrendSale[]>(() => {
    const source = salesForTrend.length > 0
      ? salesForTrend
      : recentSales.map((sale) => ({ created_at: sale.created_at, total_price: sale.total_price }));

    if (rangeStartTimestamp == null) {
      return source;
    }

    return source.filter((sale) => {
      const saleTime = new Date(sale.created_at).getTime();
      return Number.isFinite(saleTime) && saleTime >= rangeStartTimestamp;
    });
  }, [rangeStartTimestamp, recentSales, salesForTrend]);

  const trendWindowDays = useMemo(() => {
    if (selectedRange === "today") return 1;
    if (selectedRange === "7d") return 7;
    if (selectedRange === "30d") return 30;

    if (selectedRange === "custom" && rangeStartTimestamp != null) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const diffDays = Math.floor((today.getTime() - rangeStartTimestamp) / (1000 * 60 * 60 * 24)) + 1;
      return Math.min(Math.max(diffDays, 1), 30);
    }

    return 14;
  }, [rangeStartTimestamp, selectedRange]);

  const trendComparisonSource = useMemo<TrendSale[]>(() => (
    salesForTrend.length > 0
      ? salesForTrend
      : recentSales.map((sale) => ({ created_at: sale.created_at, total_price: sale.total_price }))
  ), [recentSales, salesForTrend]);

  const chartWindowBounds = useMemo(() => {
    const end = new Date();
    end.setHours(24, 0, 0, 0);

    const start = new Date(end);
    start.setDate(end.getDate() - trendWindowDays);

    const previousStart = new Date(start);
    previousStart.setDate(start.getDate() - trendWindowDays);

    return {
      startMs: start.getTime(),
      endMs: end.getTime(),
      previousStartMs: previousStart.getTime(),
    };
  }, [trendWindowDays]);

  const chartComparison = useMemo(() => {
    let currentRevenue = 0;
    let previousRevenue = 0;

    for (const sale of trendComparisonSource) {
      const saleTime = new Date(sale.created_at).getTime();
      if (!Number.isFinite(saleTime)) continue;

      const amount = Number(sale.total_price ?? 0);
      const safeAmount = Number.isFinite(amount) ? amount : 0;

      if (saleTime >= chartWindowBounds.startMs && saleTime < chartWindowBounds.endMs) {
        currentRevenue += safeAmount;
      } else if (saleTime >= chartWindowBounds.previousStartMs && saleTime < chartWindowBounds.startMs) {
        previousRevenue += safeAmount;
      }
    }

    const delta = currentRevenue - previousRevenue;
    const percentChange = previousRevenue > 0 ? (delta / previousRevenue) * 100 : null;

    return {
      currentRevenue,
      previousRevenue,
      delta,
      percentChange,
    };
  }, [chartWindowBounds, trendComparisonSource]);

  const salesTrend = useMemo<TrendPoint[]>(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const points: TrendPoint[] = [];
    const dayMap = new Map<string, number>();

    for (let i = trendWindowDays - 1; i >= 0; i -= 1) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const label = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
      points.push({ key, label, revenue: 0 });
      dayMap.set(key, 0);
    }

    for (const sale of salesInSelectedRange) {
      const saleDate = new Date(sale.created_at);
      if (Number.isNaN(saleDate.getTime())) continue;
      const key = saleDate.toISOString().slice(0, 10);
      if (!dayMap.has(key)) continue;
      const amount = Number(sale.total_price ?? 0);
      dayMap.set(key, (dayMap.get(key) ?? 0) + (Number.isFinite(amount) ? amount : 0));
    }

    return points.map((p) => ({ ...p, revenue: dayMap.get(p.key) ?? 0 }));
  }, [salesInSelectedRange, trendWindowDays]);

  const topProductsBars = useMemo(
    () => topProducts.slice(0, 6).map((p) => ({
      name: p.name,
      revenue: Number.isFinite(Number(p.revenue)) ? Number(p.revenue) : 0,
      qty: Number.isFinite(Number(p.quantity_sold)) ? Number(p.quantity_sold) : 0,
    })),
    [topProducts]
  );

  const trendMax = Math.max(...salesTrend.map((d) => d.revenue), 1);
  const trendCoordinates = useMemo<TrendCoordinate[]>(
    () => salesTrend.map((point, index) => {
      const x = salesTrend.length > 1 ? (index / (salesTrend.length - 1)) * 100 : 0;
      const y = 100 - (point.revenue / trendMax) * 100;
      return {
        ...point,
        x,
        y,
      };
    }),
    [salesTrend, trendMax],
  );
  const trendPoints = trendCoordinates.map((point) => `${point.x},${point.y}`).join(" ");
  const trendYAxisTicks = useMemo(
    () => [trendMax, trendMax / 2, 0],
    [trendMax],
  );
  const hoveredTrendPoint = useMemo(
    () => hoveredTrendPointKey
      ? trendCoordinates.find((point) => point.key === hoveredTrendPointKey) ?? null
      : null,
    [hoveredTrendPointKey, trendCoordinates],
  );
  const chartComparisonLabel = useMemo(() => {
    if (chartComparison.previousRevenue <= 0) {
      if (chartComparison.currentRevenue <= 0) {
        return `No change vs previous ${trendWindowDays}d`;
      }
      return `New activity vs previous ${trendWindowDays}d`;
    }

    const sign = chartComparison.delta >= 0 ? "+" : "";
    return `${sign}${(chartComparison.percentChange ?? 0).toFixed(1)}% vs previous ${trendWindowDays}d`;
  }, [chartComparison.currentRevenue, chartComparison.delta, chartComparison.percentChange, chartComparison.previousRevenue, trendWindowDays]);
  const chartComparisonColor = chartComparison.delta > 0
    ? "#15803d"
    : chartComparison.delta < 0
      ? "#b91c1c"
      : "#475569";

  useEffect(() => {
    if (!hoveredTrendPointKey) {
      return;
    }

    if (!salesTrend.some((point) => point.key === hoveredTrendPointKey)) {
      setHoveredTrendPointKey(null);
    }
  }, [hoveredTrendPointKey, salesTrend]);

  const topRevenueMax = Math.max(...topProductsBars.map((p) => p.revenue), 1);

  // Stock alerts - will be based on real stock movements when implemented
  const lowStockItems: LowStockItem[] = products
    .filter((p) => Math.max(0, Number(p.current_stock ?? 0)) < lowStockThreshold)
    .map((p) => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      currentStock: Math.max(0, Number(p.current_stock ?? 0)),
      minStock: lowStockThreshold,
    }));

  // Calculate expired and expiring soon products (only if expiry tracking is enabled)
  const expiredProducts = usesExpiryTracking ? products.filter(
    (p) => p.expiry_date && new Date(p.expiry_date) < new Date()
  ) : [];
  const expiringSoonProducts = usesExpiryTracking ? products.filter(
    (p) =>
      p.expiry_date &&
      new Date(p.expiry_date) >= new Date() &&
      new Date(p.expiry_date) <= new Date(Date.now() + expiryWarningDays * 24 * 60 * 60 * 1000)
  ) : [];

  const totalRangeRevenue = useMemo(
    () => salesInSelectedRange.reduce((sum, sale) => {
      const amount = Number(sale.total_price ?? 0);
      return sum + (Number.isFinite(amount) ? amount : 0);
    }, 0),
    [salesInSelectedRange],
  );

  const averageOrderValue = salesInSelectedRange.length > 0
    ? totalRangeRevenue / salesInSelectedRange.length
    : 0;

  const kpiItems = useMemo<KpiItem[]>(() => {
    if (isAdmin) {
      return [
        {
          label: `Revenue (${rangeLabel})`,
          value: toCurrency(totalRangeRevenue),
          accent: "#047857",
          helper: `${salesInSelectedRange.length} order${salesInSelectedRange.length === 1 ? "" : "s"}`,
        },
        {
          label: "Average Order",
          value: toCurrency(averageOrderValue),
          accent: "#1d4ed8",
          helper: "Per transaction",
        },
        {
          label: "Top Product",
          value: topProducts[0]?.name ?? "No sales yet",
          accent: "#7c3aed",
          helper: topProducts[0] ? `${Number(topProducts[0].quantity_sold || 0)} units sold` : "Awaiting sales",
        },
        {
          label: "Stock Alerts",
          value: String(lowStockItems.length + expiredProducts.length + expiringSoonProducts.length),
          accent: "#b45309",
          helper: `${lowStockItems.length} low stock, ${expiredProducts.length} expired`,
        },
      ];
    }

    return [
      {
        label: "Products",
        value: String(products.length),
        accent: "#1d4ed8",
        helper: "Active catalog",
      },
      {
        label: "Low Stock",
        value: String(lowStockItems.length),
        accent: "#b45309",
        helper: `Threshold ${lowStockThreshold}`,
      },
      {
        label: "Expired",
        value: String(expiredProducts.length),
        accent: "#b91c1c",
        helper: usesExpiryTracking ? "Needs removal" : "Expiry tracking off",
      },
      {
        label: "Expiring Soon",
        value: String(expiringSoonProducts.length),
        accent: "#92400e",
        helper: `Within ${expiryWarningDays} days`,
      },
    ];
  }, [
    averageOrderValue,
    expiringSoonProducts.length,
    expiryWarningDays,
    expiredProducts.length,
    isAdmin,
    lowStockItems.length,
    lowStockThreshold,
    products.length,
    rangeLabel,
    salesInSelectedRange.length,
    topProducts,
    totalRangeRevenue,
    usesExpiryTracking,
  ]);

  const quickActions = [
    { label: "Add Product", icon: "+", color: "#1f7aff", action: "products" },
    { label: "Record Sale", icon: "$", color: "#10b981", action: "sales" },
    { label: "Stock Movement", icon: "#", color: "#8246ff", action: "inventory" },
    { label: "View Reports", icon: "~", color: "#f59e0b", action: "reports", adminOnly: true },
  ].filter(action => !action.adminOnly || isAdmin);

  return (
    <div className="app-shell">
      <div className="page-header" style={{ marginBottom: 14 }}>
        <h1 className="page-title" style={{ marginBottom: 0 }}>Dashboard</h1>
      </div>

      <div className="card" style={{ marginBottom: 24, padding: 14 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#334155", marginRight: 4 }}>Range</span>
          {rangeOptions.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setSelectedRange(option.key)}
              style={{
                padding: "7px 11px",
                borderRadius: 999,
                border: selectedRange === option.key ? "1px solid #1d4ed8" : "1px solid #dbe5f2",
                background: selectedRange === option.key ? "#eff6ff" : "#ffffff",
                color: selectedRange === option.key ? "#1d4ed8" : "#334155",
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              {option.label}
            </button>
          ))}
          {selectedRange === "custom" ? (
            <input
              type="date"
              value={customRangeStartDate}
              onChange={(event) => setCustomRangeStartDate(event.target.value)}
              className="input"
              style={{ width: "auto", minWidth: 190, marginLeft: 6 }}
            />
          ) : null}
          <span style={{ marginLeft: "auto", fontSize: 12, color: "#64748b" }}>Viewing {rangeLabel}</span>
        </div>
      </div>

      <div
        className="grid"
        style={{
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12,
          marginBottom: 24,
        }}
      >
        {kpiItems.map((item) => (
          <div key={item.label} className="card" style={{ padding: "14px 16px" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#64748b", marginBottom: 6 }}>{item.label}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: item.accent, lineHeight: 1.2, marginBottom: 6 }}>{item.value}</div>
            <div style={{ fontSize: 12, color: "#64748b" }}>{item.helper}</div>
          </div>
        ))}
      </div>

      {/* Quick Actions */}
      <div className="card" style={{ marginBottom: 24 }}>
        <h2 className="section-title">Quick Actions</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
          {quickActions.map((action) => (
            <button
              key={action.label}
              className="button"
              style={{
                background: action.color,
                display: "flex",
                alignItems: "center",
                gap: 10,
                justifyContent: "center",
                padding: "16px",
                fontSize: 15,
              }}
              onClick={() => onNavigate(action.action)}
            >
              <span style={{ fontSize: 20 }}>{action.icon}</span>
              <span>{action.label}</span>
            </button>
          ))}
        </div>
      </div>

      {isAdmin && (
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16, marginBottom: 24 }}>
          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 10, flexWrap: "wrap" }}>
              <h2 className="section-title" style={{ margin: 0 }}>Sales Over Time ({rangeLabel})</h2>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: chartComparisonColor }}>{chartComparisonLabel}</div>
                <div style={{ fontSize: 11, color: "#64748b" }}>
                  {toCurrency(chartComparison.currentRevenue)} now · {toCurrency(chartComparison.previousRevenue)} previous
                </div>
              </div>
            </div>
            {dashboardLoading ? (
              <p style={{ margin: 0, color: "#4a5368" }}>Loading chart...</p>
            ) : (
              <>
                <div style={{ width: "100%", background: "#f8fbff", border: "1px solid #e6e9f2", borderRadius: 10, padding: 12 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "56px minmax(0, 1fr)", gap: 10, alignItems: "stretch" }}>
                    <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", fontSize: 11, color: "#64748b", padding: "4px 0" }}>
                      {trendYAxisTicks.map((tick, index) => (
                        <span key={`${tick}-${index}`}>{toCompactCurrency(tick)}</span>
                      ))}
                    </div>
                    <div
                      style={{ position: "relative", height: 220 }}
                      onMouseLeave={() => setHoveredTrendPointKey(null)}
                    >
                      <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: "100%", height: "100%" }} aria-label="Sales trend chart">
                        <defs>
                          <linearGradient id="salesTrendArea" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#60a5fa" stopOpacity="0.3" />
                            <stop offset="100%" stopColor="#60a5fa" stopOpacity="0" />
                          </linearGradient>
                        </defs>
                        <line x1="0" y1="0" x2="100" y2="0" stroke="#e2e8f0" strokeWidth="0.8" />
                        <line x1="0" y1="50" x2="100" y2="50" stroke="#e2e8f0" strokeWidth="0.8" />
                        <line x1="0" y1="100" x2="100" y2="100" stroke="#cbd5e1" strokeWidth="0.8" />
                        <line x1="0" y1="0" x2="0" y2="100" stroke="#cbd5e1" strokeWidth="0.8" />
                        {trendCoordinates.length > 1 ? (
                          <polygon
                            points={`0,100 ${trendPoints} 100,100`}
                            fill="url(#salesTrendArea)"
                          />
                        ) : null}
                        {hoveredTrendPoint ? (
                          <line x1={hoveredTrendPoint.x} y1="0" x2={hoveredTrendPoint.x} y2="100" stroke="#93c5fd" strokeDasharray="2 2" strokeWidth="0.7" />
                        ) : null}
                        <polyline
                          fill="none"
                          stroke="#2563eb"
                          strokeWidth="2"
                          points={trendPoints}
                        />
                        {trendCoordinates.map((point) => (
                          <circle
                            key={point.key}
                            cx={point.x}
                            cy={point.y}
                            r={hoveredTrendPoint?.key === point.key ? "2.4" : "1.8"}
                            fill={hoveredTrendPoint?.key === point.key ? "#1e3a8a" : "#1d4ed8"}
                            style={{ cursor: "pointer" }}
                            tabIndex={0}
                            onMouseEnter={() => setHoveredTrendPointKey(point.key)}
                            onFocus={() => setHoveredTrendPointKey(point.key)}
                            onBlur={() => setHoveredTrendPointKey(null)}
                          />
                        ))}
                      </svg>
                      {hoveredTrendPoint ? (
                        <div
                          style={{
                            position: "absolute",
                            left: `${Math.min(Math.max(hoveredTrendPoint.x, 10), 90)}%`,
                            top: `${Math.max(hoveredTrendPoint.y - 4, 4)}%`,
                            transform: "translate(-50%, -100%)",
                            background: "#0f172a",
                            color: "#f8fafc",
                            borderRadius: 8,
                            padding: "8px 10px",
                            boxShadow: "0 12px 28px rgba(15, 23, 42, 0.25)",
                            pointerEvents: "none",
                            minWidth: 130,
                          }}
                        >
                          <div style={{ fontSize: 11, color: "#bfdbfe", marginBottom: 2 }}>{hoveredTrendPoint.label}</div>
                          <div style={{ fontSize: 13, fontWeight: 800 }}>{toCurrency(hoveredTrendPoint.revenue)}</div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 12, color: "#64748b" }}>
                  <span>{trendCoordinates[0]?.label}</span>
                  <span>{trendCoordinates[Math.floor((trendCoordinates.length - 1) / 2)]?.label}</span>
                  <span>{trendCoordinates[trendCoordinates.length - 1]?.label}</span>
                </div>
              </>
            )}
          </div>

          <div className="card">
            <h2 className="section-title" style={{ marginBottom: 10 }}>Top Products (Revenue, {rangeLabel})</h2>
            {dashboardLoading ? (
              <p style={{ margin: 0, color: "#4a5368" }}>Loading chart...</p>
            ) : topProductsBars.length === 0 ? (
              <p style={{ margin: 0, color: "#4a5368" }}>No data for the selected range</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {topProductsBars.map((item) => (
                  <div key={item.name}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                      <span style={{ fontWeight: 600 }}>{item.name}</span>
                      <span style={{ color: "#0f766e", fontWeight: 700 }}>GHS {item.revenue.toFixed(2)}</span>
                    </div>
                    <div style={{ height: 10, width: "100%", background: "#e2e8f0", borderRadius: 999, overflow: "hidden" }}>
                      <div
                        style={{
                          height: "100%",
                          width: `${Math.max((item.revenue / topRevenueMax) * 100, 4)}%`,
                          borderRadius: 999,
                          background: "linear-gradient(90deg, #16a34a, #22c55e)",
                        }}
                      />
                    </div>
                    <div style={{ marginTop: 2, fontSize: 11, color: "#64748b" }}>{item.qty} units sold</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 24 }}>
        <h2 className="section-title">
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            Stock Alerts
            {lowStockItems.length > 0 && (
              <span
                className="badge"
                style={{ background: "#fee2e2", color: "#dc2626", fontSize: 12 }}
              >
                {lowStockItems.length}
              </span>
            )}
          </span>
        </h2>
        {loading ? (
          <p style={{ margin: 0, color: "#4a5368" }}>Loading...</p>
        ) : lowStockItems.length === 0 ? (
          <p style={{ margin: 0, color: "#4a5368" }}>All stock levels are good!</p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
            {lowStockItems.map((item) => (
              <div
                key={item.id}
                style={{
                  padding: 12,
                  background: "#fef2f2",
                  border: "1px solid #fecaca",
                  borderRadius: 10,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{item.name}</div>
                  <span className="badge" style={{ background: "#dc2626", color: "#fff" }}>
                    Low Stock
                  </span>
                </div>
                <div style={{ fontSize: 13, color: "#991b1b" }}>
                  Current: {item.currentStock} | Min: {item.minStock}
                </div>
                <div style={{ fontSize: 12, color: "#5f6475", marginTop: 4 }}>SKU: {item.sku}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Expiry Tracking */}
      {(expiredProducts.length > 0 || expiringSoonProducts.length > 0) && (
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16, marginBottom: 24 }}>
          {/* Expired Products */}
          {expiredProducts.length > 0 && (
            <div className="card">
              <h2 className="section-title">
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  🚨 Expired Products
                  <span
                    className="badge"
                    style={{ background: "#fee2e2", color: "#dc2626", fontSize: 12 }}
                  >
                    {expiredProducts.length}
                  </span>
                </span>
              </h2>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {expiredProducts.slice(0, 5).map((item) => (
                  <div
                    key={item.id}
                    style={{
                      padding: 12,
                      background: "#fef2f2",
                      border: "2px solid #ef4444",
                      borderRadius: 10,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{item.name}</div>
                      <span className="badge" style={{ background: "#dc2626", color: "#fff" }}>
                        EXPIRED
                      </span>
                    </div>
                    <div style={{ fontSize: 13, color: "#991b1b", marginBottom: 4 }}>
                      Expired: {new Date(item.expiry_date!).toLocaleDateString()}
                    </div>
                    <div style={{ fontSize: 12, color: "#5f6475" }}>SKU: {item.sku}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Expiring Soon */}
          {expiringSoonProducts.length > 0 && (
            <div className="card">
              <h2 className="section-title">
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  Expiring Soon ({expiryWarningDays} days)
                  <span
                    className="badge"
                    style={{ background: "#fef3c7", color: "#92400e", fontSize: 12 }}
                  >
                    {expiringSoonProducts.length}
                  </span>
                </span>
              </h2>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {expiringSoonProducts.slice(0, 5).map((item) => (
                  <div
                    key={item.id}
                    style={{
                      padding: 12,
                      background: "#fffbeb",
                      border: "2px solid #f59e0b",
                      borderRadius: 10,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{item.name}</div>
                      <span className="badge" style={{ background: "#f59e0b", color: "#fff" }}>
                        {Math.ceil(
                          (new Date(item.expiry_date!).getTime() - new Date().getTime()) /
                            (1000 * 60 * 60 * 24)
                        )}{" "}
                        days
                      </span>
                    </div>
                    <div style={{ fontSize: 13, color: "#92400e", marginBottom: 4 }}>
                      Expires: {new Date(item.expiry_date!).toLocaleDateString()}
                    </div>
                    <div style={{ fontSize: 12, color: "#5f6475" }}>SKU: {item.sku}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Recent Sales */}
      {isAdmin && (
        <div className="card">
          <h2 className="section-title">Recent Sales</h2>
          {dashboardLoading ? (
            <p style={{ margin: 0, color: "#4a5368" }}>Loading...</p>
          ) : (
            <>
              <table className="table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Customer</th>
                    <th>Quantity</th>
                    <th>Total</th>
                    <th>Payment</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {recentSales.map((sale) => (
                    <tr key={sale.id}>
                      <td style={{ fontWeight: 600 }}>{sale.product?.name || `Product #${sale.product_id}`}</td>
                      <td>{sale.customer_name || "Walk-in"}</td>
                      <td>{sale.quantity}</td>
                      <td style={{ fontWeight: 700, color: "#10b981" }}>GHS {Number(sale.total_price).toFixed(2)}</td>
                      <td>
                        <span className="badge" style={{ 
                          background: sale.payment_method === 'cash' ? '#dcfce7' : 
                                     sale.payment_method === 'credit' ? '#fee2e2' : '#fef3c7',
                          color: sale.payment_method === 'cash' ? '#166534' : 
                                sale.payment_method === 'credit' ? '#991b1b' : '#92400e'
                        }}>
                          {sale.payment_method}
                        </span>
                      </td>
                      <td style={{ color: "#5f6475" }}>{new Date(sale.created_at).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {recentSales.length === 0 && (
                <p style={{ margin: "16px 0 0", color: "#4a5368", textAlign: "center" }}>No sales yet</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
