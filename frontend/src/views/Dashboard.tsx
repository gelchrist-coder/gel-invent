import { useCallback, useEffect, useMemo, useState } from "react";

import { fetchMorningSummary, fetchProductsCached, fetchSalesCached, fetchSalesDashboard, fetchSystemSettingsCached, getCachedProducts } from "../api";
import { Product } from "../types";
import { useExpiryTracking } from "../settings";
import { hasUserPermission, readStoredUser } from "../user-storage";
import { Skeleton, SkeletonCard, SkeletonKpiRow } from "../components/Skeleton";

function DashboardSkeleton() {
  return (
    <div className="app-shell" aria-busy="true">
      <Skeleton width={180} height={28} style={{ marginBottom: 14 }} />
      <div className="card" style={{ marginBottom: 24, padding: 14 }}>
        <Skeleton width="60%" height={20} />
      </div>
      <SkeletonKpiRow />
      <div className="card" style={{ marginBottom: 24, display: "grid", gap: 12 }}>
        <Skeleton width="30%" height={18} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} height={52} />
          ))}
        </div>
      </div>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16, marginBottom: 24 }}>
        <SkeletonCard lines={6} style={{ minHeight: 240 }} />
        <SkeletonCard lines={6} style={{ minHeight: 240 }} />
      </div>
      <SkeletonCard lines={6} style={{ minHeight: 200 }} />
    </div>
  );
}

type Props = {
  onNavigate: (view: string) => void;
};

type DashboardTopProduct = {
  name: string;
  quantity_sold: number | string;
  revenue: number | string;
};

type SalesDashboardResponse = {
  top_products?: DashboardTopProduct[];
  recent_sales?: DashboardRecentSale[];
  [key: string]: unknown;
};

type MorningSummaryItem = {
  id?: number | string;
  product_id?: number | string;
  name: string;
  sku?: string;
  current_stock?: number;
  quantity_sold?: number;
  revenue?: number;
};

type MorningSummaryBranch = {
  branch_id: number;
  branch_name: string;
  transactions: number;
  revenue: number;
  rank: number;
  share_percent: number;
};

type MorningSummaryResponse = {
  generated_at: string;
  yesterday_sales: {
    transactions: number;
    revenue: number;
  };
  low_stock: {
    count: number;
    threshold: number;
    items: MorningSummaryItem[];
  };
  expiring_products: {
    count: number;
    window_days: number;
    items: Array<MorningSummaryItem & { expiry_date?: string; days_until_expiry?: number }>;
  };
  debt_due: {
    supplier_due_amount: number;
    supplier_due_count: number;
    customer_debt_amount: number;
    customer_debt_count: number;
  };
  best_sellers: MorningSummaryItem[];
  slow_movers: MorningSummaryItem[];
  branch_comparison: MorningSummaryBranch[];
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

type DashboardRecentSaleItem = {
  name?: string | null;
  quantity?: number | string;
};

type DashboardRecentSale = {
  id: number | string;
  receipt_number?: string | null;
  customer_name?: string | null;
  items?: DashboardRecentSaleItem[];
  item_count?: number | string;
  product_id?: number | string;
  product_name?: string | null;
  quantity?: number | string;
  total_price?: number | string;
  payment_method?: string | null;
  created_at: string;
};

type PaymentFilterOption = {
  key: string;
  label: string;
  count: number;
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

function normalizePaymentMethod(paymentMethod: string | null | undefined): string {
  const normalized = String(paymentMethod ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");

  if (!normalized) return "unknown";
  if (normalized.includes("cash")) return "cash";
  if (normalized.includes("credit")) return "credit";
  if (normalized.includes("mobile")) return "mobile_money";
  if (normalized.includes("card")) return "card";
  return "other";
}

function getPaymentMeta(paymentMethod: string): { label: string; background: string; color: string } {
  if (paymentMethod === "cash") {
    return { label: "Cash", background: "#dcfce7", color: "#166534" };
  }
  if (paymentMethod === "credit") {
    return { label: "Credit", background: "#fee2e2", color: "#991b1b" };
  }
  if (paymentMethod === "mobile_money") {
    return { label: "Mobile Money", background: "#dbeafe", color: "#1e3a8a" };
  }
  if (paymentMethod === "card") {
    return { label: "Card", background: "#ede9fe", color: "#5b21b6" };
  }
  return { label: "Other", background: "#fef3c7", color: "#92400e" };
}

function formatRecentSaleQuantity(value: number | string | undefined): string {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return "0";
  if (Number.isInteger(numeric)) return String(numeric);
  return numeric.toFixed(2);
}

function getRecentSaleItems(sale: DashboardRecentSale): DashboardRecentSaleItem[] {
  const items = Array.isArray(sale.items) ? sale.items : [];
  if (items.length > 0) {
    return items;
  }

  // Backward compatibility for older sales-dashboard payload shape.
  const fallbackName =
    (typeof sale.product_name === "string" && sale.product_name.trim())
      ? sale.product_name.trim()
      : sale.product_id != null
        ? `Product #${sale.product_id}`
        : "Item";
  const qty = Number(sale.quantity ?? 0);

  if (Number.isFinite(qty) && qty > 0) {
    return [{ name: fallbackName, quantity: qty }];
  }

  return [];
}

function getRecentSaleItemCount(sale: DashboardRecentSale): number {
  const explicitCount = Number(sale.item_count);
  if (Number.isFinite(explicitCount) && explicitCount > 0) {
    return explicitCount;
  }
  return getRecentSaleItems(sale).length;
}

export default function Dashboard({ onNavigate }: Props) {
  // Initialize from cache for instant display
  const cachedProducts = getCachedProducts();
  const [products, setProducts] = useState<Product[]>(cachedProducts || []);
  const [loading, setLoading] = useState(!cachedProducts); // Only show loading if no cache
  const [dashboardData, setDashboardData] = useState<SalesDashboardResponse | null>(null);
  const [morningSummary, setMorningSummary] = useState<MorningSummaryResponse | null>(null);
  const [salesForTrend, setSalesForTrend] = useState<TrendSale[]>([]);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [lowStockThreshold, setLowStockThreshold] = useState<number>(10);
  const [expiryWarningDays, setExpiryWarningDays] = useState<number>(45);
  const usesExpiryTracking = useExpiryTracking();
  const [selectedRange, setSelectedRange] = useState<GlobalRangeKey>("30d");
  const [customRangeStartDate, setCustomRangeStartDate] = useState<string>("");
  const [hoveredTrendPointKey, setHoveredTrendPointKey] = useState<string | null>(null);
  const [recentSalesSearch, setRecentSalesSearch] = useState<string>("");
  const [recentSalesPaymentFilter, setRecentSalesPaymentFilter] = useState<string>("all");
  const [recentSalesLimit, setRecentSalesLimit] = useState<number>(8);
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

  const currentUser = readStoredUser();
  const canViewReports = hasUserPermission("view_reports", currentUser);
  const canViewMorningSummary = hasUserPermission("manage_branches", currentUser);
  const token = localStorage.getItem("token");

  const loadDashboardData = useCallback(async () => {
    if (!token) {
      setLoading(false);
      setDashboardLoading(false);
      return;
    }

    setDashboardLoading(true);
    const safetyTimeout = window.setTimeout(() => {
      setLoading(false);
      setDashboardLoading(false);
    }, 20000);

    try {
      const [productsResult, settingsResult, dashboardResult, salesResult, morningSummaryResult] = await Promise.allSettled([
        fetchProductsCached((fresh) => setProducts(fresh)),
        fetchSystemSettingsCached((fresh) => {
          setLowStockThreshold(fresh.low_stock_threshold);
          setExpiryWarningDays(fresh.expiry_warning_days);
        }),
        canViewReports ? fetchSalesDashboard(rangeStartDate) : Promise.resolve(null),
        canViewReports ? fetchSalesCached((fresh) => setSalesForTrend(fresh as TrendSale[])) : Promise.resolve([]),
        canViewMorningSummary ? fetchMorningSummary() : Promise.resolve(null),
      ]);

      if (productsResult.status === "fulfilled") {
        setProducts(productsResult.value as Product[]);
      }

      if (settingsResult.status === "fulfilled" && settingsResult.value) {
        const settingsData = settingsResult.value as { low_stock_threshold: number; expiry_warning_days: number };
        setLowStockThreshold(settingsData.low_stock_threshold);
        setExpiryWarningDays(settingsData.expiry_warning_days);
      }

      if (canViewReports) {
        if (dashboardResult.status === "fulfilled" && dashboardResult.value) {
          setDashboardData(dashboardResult.value as SalesDashboardResponse);
        }
        if (salesResult.status === "fulfilled") {
          setSalesForTrend(salesResult.value as TrendSale[]);
        }
      } else {
        setDashboardData(null);
        setSalesForTrend([]);
      }

      if (canViewMorningSummary && morningSummaryResult.status === "fulfilled" && morningSummaryResult.value) {
        setMorningSummary(morningSummaryResult.value as MorningSummaryResponse);
      } else if (!canViewMorningSummary) {
        setMorningSummary(null);
      }
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn("Dashboard load degraded due to temporary error:", error);
      }
    } finally {
      window.clearTimeout(safetyTimeout);
      setLoading(false);
      setDashboardLoading(false);
    }
  }, [canViewMorningSummary, canViewReports, rangeStartDate, token]);

  const leadingBranch = useMemo(
    () => (morningSummary?.branch_comparison?.[0] ?? null),
    [morningSummary?.branch_comparison],
  );

  const morningActions = useMemo(
    () => [
      {
        key: "restock",
        label: "Restock Low Stock",
        helper: `${morningSummary?.low_stock.count ?? 0} items`,
        action: "inventory",
        color: "#c2410c",
      },
      {
        key: "expiry",
        label: "Handle Expiring",
        helper: `${morningSummary?.expiring_products.count ?? 0} products`,
        action: "inventory",
        color: "#a16207",
      },
      {
        key: "debt",
        label: "Review Debt Due",
        helper: `${toCurrency(Number(morningSummary?.debt_due.customer_debt_amount || 0) + Number(morningSummary?.debt_due.supplier_due_amount || 0))}`,
        action: "creditors",
        color: "#b91c1c",
      },
      {
        key: "branches",
        label: "Open Branch Reports",
        helper: leadingBranch ? `Leader: ${leadingBranch.branch_name}` : "Compare branches",
        action: "reports",
        color: "#1d4ed8",
      },
    ],
    [leadingBranch, morningSummary],
  );

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

  const lowStockActionItems = useMemo(
    () => lowStockItems
      .map((item) => ({
        ...item,
        shortfall: Math.max(item.minStock - item.currentStock, 0),
        isOutOfStock: item.currentStock === 0,
      }))
      .sort((a, b) => {
        if (a.isOutOfStock !== b.isOutOfStock) {
          return Number(b.isOutOfStock) - Number(a.isOutOfStock);
        }
        if (a.shortfall !== b.shortfall) {
          return b.shortfall - a.shortfall;
        }
        return a.currentStock - b.currentStock;
      }),
    [lowStockItems],
  );

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
    if (canViewReports) {
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
    canViewReports,
    expiringSoonProducts.length,
    expiryWarningDays,
    expiredProducts.length,
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
    ...(canViewReports ? [{ label: "View Reports", icon: "~", color: "#f59e0b", action: "reports" }] : []),
  ];

  const paymentCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const sale of recentSales) {
      const normalized = normalizePaymentMethod(sale.payment_method);
      counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
    }
    return counts;
  }, [recentSales]);

  const paymentFilterOptions = useMemo<PaymentFilterOption[]>(() => {
    const orderedKeys = ["cash", "credit", "mobile_money", "card", "other"];
    const dynamicOptions = orderedKeys
      .filter((key) => (paymentCounts.get(key) ?? 0) > 0)
      .map((key) => ({
        key,
        label: getPaymentMeta(key).label,
        count: paymentCounts.get(key) ?? 0,
      }));

    return [{ key: "all", label: "All", count: recentSales.length }, ...dynamicOptions];
  }, [paymentCounts, recentSales.length]);

  useEffect(() => {
    if (paymentFilterOptions.some((option) => option.key === recentSalesPaymentFilter)) {
      return;
    }
    setRecentSalesPaymentFilter("all");
  }, [paymentFilterOptions, recentSalesPaymentFilter]);

  const filteredRecentSales = useMemo(() => {
    const query = recentSalesSearch.trim().toLowerCase();

    return recentSales.filter((sale) => {
      const paymentKey = normalizePaymentMethod(sale.payment_method);
      const matchesPayment = recentSalesPaymentFilter === "all" || paymentKey === recentSalesPaymentFilter;
      if (!matchesPayment) return false;

      if (!query) return true;

      const itemsText = getRecentSaleItems(sale)
        .map((item) => `${item.name ?? "Unknown"} ${formatRecentSaleQuantity(item.quantity)}`)
        .join(" ")
        .toLowerCase();
      const customerName = (sale.customer_name ?? "Walk-in").toLowerCase();
      const paymentName = getPaymentMeta(paymentKey).label.toLowerCase();
      const receiptNumber = String(sale.receipt_number ?? "").toLowerCase();
      return itemsText.includes(query) || customerName.includes(query) || paymentName.includes(query) || receiptNumber.includes(query);
    });
  }, [recentSales, recentSalesPaymentFilter, recentSalesSearch]);

  const visibleRecentSales = useMemo(
    () => filteredRecentSales.slice(0, recentSalesLimit),
    [filteredRecentSales, recentSalesLimit],
  );

  const recentSalesSummary = useMemo(() => {
    const today = new Date().toDateString();
    let transactionsToday = 0;
    let revenueToday = 0;
    let overallRevenue = 0;

    for (const sale of recentSales) {
      const amount = Number(sale.total_price ?? 0);
      const safeAmount = Number.isFinite(amount) ? amount : 0;
      overallRevenue += safeAmount;

      const saleDate = new Date(sale.created_at);
      if (!Number.isNaN(saleDate.getTime()) && saleDate.toDateString() === today) {
        transactionsToday += 1;
        revenueToday += safeAmount;
      }
    }

    return {
      transactionsToday,
      revenueToday,
      averageTicket: recentSales.length > 0 ? overallRevenue / recentSales.length : 0,
    };
  }, [recentSales]);

  // First load with no cached data: show the whole dashboard as one skeleton so
  // everything appears together instead of fields popping in one by one.
  if (loading) {
    return <DashboardSkeleton />;
  }

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

      {canViewMorningSummary && morningSummary && (
        <div className="card" style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", flexWrap: "wrap", marginBottom: 14 }}>
            <h2 className="section-title" style={{ margin: 0 }}>Morning Command Center</h2>
            <div style={{ fontSize: 12, color: "#64748b" }}>
              Snapshot for yesterday · {new Date(morningSummary.generated_at).toLocaleString()}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10, marginBottom: 14 }}>
            <div style={{ padding: 12, borderRadius: 10, border: "1px solid #dbeafe", background: "#eff6ff" }}>
              <div style={{ fontSize: 12, color: "#1d4ed8", fontWeight: 700 }}>Yesterday Sales</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#1e3a8a" }}>{toCurrency(Number(morningSummary.yesterday_sales.revenue || 0))}</div>
              <div style={{ fontSize: 12, color: "#1d4ed8" }}>{morningSummary.yesterday_sales.transactions} transactions</div>
            </div>
            <div style={{ padding: 12, borderRadius: 10, border: "1px solid #fed7aa", background: "#fff7ed" }}>
              <div style={{ fontSize: 12, color: "#c2410c", fontWeight: 700 }}>Low Stock</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#9a3412" }}>{morningSummary.low_stock.count}</div>
              <div style={{ fontSize: 12, color: "#c2410c" }}>Threshold {morningSummary.low_stock.threshold}</div>
            </div>
            <div style={{ padding: 12, borderRadius: 10, border: "1px solid #fde68a", background: "#fefce8" }}>
              <div style={{ fontSize: 12, color: "#a16207", fontWeight: 700 }}>Expiring Products</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#854d0e" }}>{morningSummary.expiring_products.count}</div>
              <div style={{ fontSize: 12, color: "#a16207" }}>Within {morningSummary.expiring_products.window_days} days</div>
            </div>
            <div style={{ padding: 12, borderRadius: 10, border: "1px solid #fecaca", background: "#fef2f2" }}>
              <div style={{ fontSize: 12, color: "#b91c1c", fontWeight: 700 }}>Debt Due</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#991b1b" }}>
                {toCurrency(Number(morningSummary.debt_due.supplier_due_amount || 0) + Number(morningSummary.debt_due.customer_debt_amount || 0))}
              </div>
              <div style={{ fontSize: 12, color: "#b91c1c" }}>
                {morningSummary.debt_due.supplier_due_count} supplier due · {morningSummary.debt_due.customer_debt_count} customer debts
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10, marginBottom: 14 }}>
            {morningActions.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => onNavigate(item.action)}
                style={{
                  borderRadius: 10,
                  border: "1px solid #dbe5f2",
                  background: "#ffffff",
                  padding: "10px 12px",
                  textAlign: "left",
                  cursor: "pointer",
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 800, color: item.color, marginBottom: 4 }}>{item.label}</div>
                <div style={{ fontSize: 12, color: "#64748b" }}>{item.helper}</div>
              </button>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
            <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, color: "#0f172a" }}>Best Sellers (Yesterday)</div>
              {morningSummary.best_sellers.length === 0 ? (
                <div style={{ fontSize: 12, color: "#64748b" }}>No sales yesterday.</div>
              ) : morningSummary.best_sellers.slice(0, 5).map((item) => (
                <div key={`${item.product_id ?? item.name}-best`} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "5px 0", borderBottom: "1px solid #f1f5f9" }}>
                  <span>{item.name}</span>
                  <span style={{ fontWeight: 700 }}>{Number(item.quantity_sold ?? 0).toFixed(0)} units</span>
                </div>
              ))}
            </div>

            <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, color: "#0f172a" }}>Slow Movers (No sales in 30d)</div>
              {morningSummary.slow_movers.length === 0 ? (
                <div style={{ fontSize: 12, color: "#64748b" }}>No slow movers detected.</div>
              ) : morningSummary.slow_movers.slice(0, 5).map((item) => (
                <div key={`${item.product_id ?? item.name}-slow`} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "5px 0", borderBottom: "1px solid #f1f5f9" }}>
                  <span>{item.name}</span>
                  <span style={{ color: "#b45309", fontWeight: 700 }}>Stock {Number(item.current_stock ?? 0).toFixed(0)}</span>
                </div>
              ))}
            </div>

            <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, color: "#0f172a" }}>Branch Comparison (Yesterday)</div>
              {morningSummary.branch_comparison.length === 0 ? (
                <div style={{ fontSize: 12, color: "#64748b" }}>No active branches to compare.</div>
              ) : (
                <>
                  {leadingBranch ? (
                    <div style={{ fontSize: 12, marginBottom: 8, color: "#1d4ed8" }}>
                      Leading branch: <strong>{leadingBranch.branch_name}</strong> ({toCurrency(Number(leadingBranch.revenue || 0))})
                    </div>
                  ) : null}
                  {morningSummary.branch_comparison.slice(0, 5).map((branch) => (
                    <div key={branch.branch_id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "5px 0", borderBottom: "1px solid #f1f5f9" }}>
                      <span>#{branch.rank} {branch.branch_name}</span>
                      <span style={{ fontWeight: 700 }}>{toCurrency(Number(branch.revenue || 0))}</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>
      )}

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

      {canViewReports && (
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
              <Skeleton height={244} />
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
              <div style={{ display: "grid", gap: 12 }}>
                {Array.from({ length: 5 }).map((_, index) => (
                  <Skeleton key={index} height={26} />
                ))}
              </div>
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

      {(loading || lowStockActionItems.length > 0) && (
        <div className="card" style={{ marginBottom: 24 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 10,
              marginBottom: 12,
            }}
          >
            <h2 className="section-title" style={{ margin: 0 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                Low Stock Action Queue
                <span className="badge" style={{ background: "#fee2e2", color: "#dc2626", fontSize: 12 }}>
                  {lowStockActionItems.length}
                </span>
              </span>
            </h2>
            <button
              type="button"
              className="button"
              onClick={() => onNavigate("inventory")}
              style={{ background: "#1f7aff", fontSize: 12, padding: "8px 12px" }}
            >
              Open Inventory
            </button>
          </div>
          {loading ? (
            <p style={{ margin: 0, color: "#4a5368" }}>Loading...</p>
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
                {lowStockActionItems.slice(0, 8).map((item) => (
                  <div
                    key={item.id}
                    style={{
                      padding: 12,
                      background: item.isOutOfStock ? "#fef2f2" : "#fff7ed",
                      border: item.isOutOfStock ? "1px solid #fecaca" : "1px solid #fed7aa",
                      borderRadius: 10,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, gap: 8 }}>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{item.name}</div>
                      <span
                        className="badge"
                        style={{
                          background: item.isOutOfStock ? "#dc2626" : "#f97316",
                          color: "#fff",
                        }}
                      >
                        {item.isOutOfStock ? "Out" : "Low"}
                      </span>
                    </div>
                    <div style={{ fontSize: 13, color: "#9a3412", marginBottom: 4 }}>
                      Current {item.currentStock} | Min {item.minStock} | Shortfall {item.shortfall}
                    </div>
                    <div style={{ fontSize: 12, color: "#5f6475" }}>SKU: {item.sku}</div>
                  </div>
                ))}
              </div>
              {lowStockActionItems.length > 8 && (
                <p style={{ margin: "12px 0 0", fontSize: 12, color: "#64748b" }}>
                  Showing 8 of {lowStockActionItems.length} low stock alerts.
                </p>
              )}
            </>
          )}
        </div>
      )}

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
      {canViewReports && (
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 10 }}>
            <h2 className="section-title" style={{ margin: 0 }}>Recent Sales</h2>
            <button
              type="button"
              className="button"
              style={{ background: "#0f766e", fontSize: 12, padding: "8px 12px" }}
              onClick={() => onNavigate("sales")}
            >
              View All Sales
            </button>
          </div>
          {dashboardLoading ? (
            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 }}>
                {Array.from({ length: 3 }).map((_, index) => (
                  <Skeleton key={index} height={56} />
                ))}
              </div>
              <Skeleton height={160} />
            </div>
          ) : (
            <>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
                  gap: 10,
                  marginBottom: 12,
                }}
              >
                <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px", background: "#f8fafc" }}>
                  <div style={{ fontSize: 11, color: "#64748b", fontWeight: 700 }}>Transactions Today</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: "#0f172a" }}>{recentSalesSummary.transactionsToday}</div>
                </div>
                <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px", background: "#f8fafc" }}>
                  <div style={{ fontSize: 11, color: "#64748b", fontWeight: 700 }}>Revenue Today</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: "#047857" }}>{toCurrency(recentSalesSummary.revenueToday)}</div>
                </div>
                <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px", background: "#f8fafc" }}>
                  <div style={{ fontSize: 11, color: "#64748b", fontWeight: 700 }}>Average Ticket</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: "#1d4ed8" }}>{toCurrency(recentSalesSummary.averageTicket)}</div>
                </div>
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 12 }}>
                <input
                  type="text"
                  value={recentSalesSearch}
                  onChange={(event) => setRecentSalesSearch(event.target.value)}
                  placeholder="Search customer or item"
                  className="input"
                  style={{ minWidth: 210, flex: "1 1 220px" }}
                />
                <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                  {paymentFilterOptions.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => setRecentSalesPaymentFilter(option.key)}
                      style={{
                        borderRadius: 999,
                        border: recentSalesPaymentFilter === option.key ? "1px solid #1d4ed8" : "1px solid #dbe5f2",
                        background: recentSalesPaymentFilter === option.key ? "#eff6ff" : "#ffffff",
                        color: recentSalesPaymentFilter === option.key ? "#1d4ed8" : "#334155",
                        fontSize: 12,
                        fontWeight: 700,
                        padding: "7px 10px",
                        cursor: "pointer",
                      }}
                    >
                      {option.label} ({option.count})
                    </button>
                  ))}
                </div>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#64748b", fontWeight: 700 }}>
                  Rows
                  <select
                    value={recentSalesLimit}
                    onChange={(event) => setRecentSalesLimit(Number(event.target.value))}
                    className="input"
                    style={{ width: 82, minWidth: 82, height: 34, padding: "0 10px" }}
                  >
                    {[5, 8, 12].map((limit) => (
                      <option key={limit} value={limit}>
                        {limit}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {filteredRecentSales.length === 0 ? (
                <p style={{ margin: "8px 0 0", color: "#4a5368", textAlign: "center" }}>No sales match the current filters.</p>
              ) : (
                <>
                  <div style={{ overflowX: "auto" }}>
                    <table className="table" style={{ minWidth: 760 }}>
                      <thead>
                        <tr>
                          <th>Receipt</th>
                          <th>Customer</th>
                          <th>Items</th>
                          <th style={{ textAlign: "right" }}>Total</th>
                          <th>Payment</th>
                          <th>Date & Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleRecentSales.map((sale) => {
                          const paymentKey = normalizePaymentMethod(sale.payment_method);
                          const paymentMeta = getPaymentMeta(paymentKey);
                          const saleItems = getRecentSaleItems(sale);
                          const itemCount = getRecentSaleItemCount(sale);
                          return (
                            <tr key={sale.id}>
                              <td style={{ fontWeight: 700, color: "#0f172a" }}>#{sale.receipt_number || sale.id}</td>
                              <td>
                                <div style={{ fontWeight: 600, color: "#0f172a" }}>{sale.customer_name || "Walk-in"}</div>
                                <div style={{ marginTop: 4, fontSize: 12, color: "#64748b" }}>
                                  {itemCount} item{itemCount === 1 ? "" : "s"}
                                </div>
                              </td>
                              <td>
                                <div style={{ display: "grid", gap: 4 }}>
                                  {saleItems.map((item, index) => (
                                    <div key={`${sale.id}-${index}`} style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                                      <span style={{ color: "#0f172a", fontWeight: 500 }}>{item.name || "Unknown"}</span>
                                      <span style={{ color: "#64748b", fontSize: 12 }}>Qty {formatRecentSaleQuantity(item.quantity)}</span>
                                    </div>
                                  ))}
                                </div>
                              </td>
                              <td style={{ textAlign: "right", fontWeight: 800, color: "#047857" }}>GHS {Number(sale.total_price).toFixed(2)}</td>
                              <td>
                                <span className="badge" style={{ background: paymentMeta.background, color: paymentMeta.color }}>
                                  {paymentMeta.label}
                                </span>
                              </td>
                              <td style={{ color: "#5f6475", fontSize: 12 }}>{new Date(sale.created_at).toLocaleString()}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <p style={{ margin: "10px 0 0", fontSize: 12, color: "#64748b" }}>
                    Showing {visibleRecentSales.length} of {filteredRecentSales.length} filtered transactions.
                  </p>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
