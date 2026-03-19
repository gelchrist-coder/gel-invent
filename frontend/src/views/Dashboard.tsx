import { useEffect, useMemo, useState } from "react";

import { fetchProductsCached, fetchSalesCached, fetchSalesDashboard, fetchSystemSettings, getCachedProducts } from "../api";
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
  
  // Top Products date filter
  const [topProductsDate, setTopProductsDate] = useState<string>("");
  const [topProductsLoading, setTopProductsLoading] = useState(false);

  // Check if current user is Admin
  const currentUser = localStorage.getItem("user");
  const userRole = currentUser ? JSON.parse(currentUser).role : null;
  const isAdmin = userRole === "Admin";
  const token = localStorage.getItem("token");

  const reloadDashboardData = async () => {
    if (!token) {
      setLoading(false);
      setDashboardLoading(false);
      return;
    }

    try {
      const [productData, salesData] = await Promise.all([
        fetchProductsCached((fresh) => setProducts(fresh)),
        isAdmin ? fetchSalesCached((fresh) => setSalesForTrend(fresh as TrendSale[])) : Promise.resolve([]),
      ]);
      setProducts(productData);
      if (isAdmin) {
        setSalesForTrend(salesData as TrendSale[]);
      }
    } finally {
      setLoading(false);
    }

    // Only fetch dashboard if admin
    if (!isAdmin) {
      setDashboardLoading(false);
      return;
    }
    setDashboardLoading(true);
    try {
      const data = await fetchSalesDashboard(topProductsDate || undefined);
      setDashboardData(data);
    } catch (error) {
      console.error("Error loading dashboard:", error);
    } finally {
      setDashboardLoading(false);
    }
  };

  useEffect(() => {
    if (!token) {
      setLoading(false);
      setDashboardLoading(false);
      return;
    }

    const loadData = async () => {
      try {
        const [productsData, settingsData, dashboardResponse, salesData] = await Promise.all([
          fetchProductsCached((fresh) => setProducts(fresh)),
          fetchSystemSettings().catch(() => null),
          isAdmin ? fetchSalesDashboard() : Promise.resolve(null),
          isAdmin ? fetchSalesCached((fresh) => setSalesForTrend(fresh as TrendSale[])).catch(() => []) : Promise.resolve([]),
        ]);

        setProducts(productsData);

        if (settingsData) {
          setLowStockThreshold(settingsData.low_stock_threshold);
          setExpiryWarningDays(settingsData.expiry_warning_days);
        }

        if (isAdmin && dashboardResponse) {
          setDashboardData(dashboardResponse);
        }

        if (isAdmin) {
          setSalesForTrend(salesData as TrendSale[]);
        }
      } finally {
        setLoading(false);
        setDashboardLoading(false);
      }
    };
    loadData();
  }, [token, isAdmin]);

  useEffect(() => {
    const handler = () => {
      void reloadDashboardData();
    };
    window.addEventListener("activeBranchChanged", handler as EventListener);
    return () => window.removeEventListener("activeBranchChanged", handler as EventListener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, isAdmin, topProductsDate]);

  // Reload top products with date filter
  const handleFilterTopProducts = async () => {
    if (!token || !isAdmin) return;
    setTopProductsLoading(true);
    try {
      const data = await fetchSalesDashboard(topProductsDate || undefined);
      setDashboardData(data);
    } catch (error) {
      console.error("Error filtering top products:", error);
    } finally {
      setTopProductsLoading(false);
    }
  };

  // Clear date filter
  const handleClearFilter = async () => {
    setTopProductsDate("");
    setTopProductsLoading(true);
    try {
      const data = await fetchSalesDashboard();
      setDashboardData(data);
    } catch (error) {
      console.error("Error loading dashboard:", error);
    } finally {
      setTopProductsLoading(false);
    }
  };

  // Top products from dashboard data
  const topProducts = dashboardData?.top_products ?? [];

  // Recent sales from dashboard data
  const recentSales = dashboardData?.recent_sales ?? [];

  const salesTrend = useMemo<TrendPoint[]>(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const points: TrendPoint[] = [];
    const dayMap = new Map<string, number>();

    for (let i = 13; i >= 0; i -= 1) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const label = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
      points.push({ key, label, revenue: 0 });
      dayMap.set(key, 0);
    }

    const source = salesForTrend.length > 0
      ? salesForTrend
      : recentSales.map((s) => ({ created_at: s.created_at, total_price: s.total_price }));

    for (const sale of source) {
      const saleDate = new Date(sale.created_at);
      if (Number.isNaN(saleDate.getTime())) continue;
      const key = saleDate.toISOString().slice(0, 10);
      if (!dayMap.has(key)) continue;
      const amount = Number(sale.total_price ?? 0);
      dayMap.set(key, (dayMap.get(key) ?? 0) + (Number.isFinite(amount) ? amount : 0));
    }

    return points.map((p) => ({ ...p, revenue: dayMap.get(p.key) ?? 0 }));
  }, [salesForTrend, recentSales]);

  const topProductsBars = useMemo(
    () => topProducts.slice(0, 6).map((p) => ({
      name: p.name,
      revenue: Number(p.revenue),
      qty: Number(p.quantity_sold),
    })),
    [topProducts]
  );

  const trendMax = Math.max(...salesTrend.map((d) => d.revenue), 1);
  const trendPoints = salesTrend
    .map((d, i) => {
      const x = salesTrend.length > 1 ? (i / (salesTrend.length - 1)) * 100 : 0;
      const y = 100 - (d.revenue / trendMax) * 100;
      return `${x},${y}`;
    })
    .join(" ");

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

  const quickActions = [
    { label: "Add Product", icon: "+", color: "#1f7aff", action: "products" },
    { label: "Record Sale", icon: "$", color: "#10b981", action: "sales" },
    { label: "Stock Movement", icon: "#", color: "#8246ff", action: "inventory" },
    { label: "View Reports", icon: "~", color: "#f59e0b", action: "reports", adminOnly: true },
  ].filter(action => !action.adminOnly || isAdmin);

  return (
    <div className="app-shell">
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 24 }}>Dashboard</h1>

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
        <div className="grid" style={{ gridTemplateColumns: "1.2fr 1fr", gap: 16, marginBottom: 24 }}>
          <div className="card">
            <h2 className="section-title" style={{ marginBottom: 10 }}>Sales Over Time (Last 14 Days)</h2>
            {dashboardLoading ? (
              <p style={{ margin: 0, color: "#4a5368" }}>Loading chart...</p>
            ) : (
              <>
                <div style={{ width: "100%", height: 220, background: "#f8fbff", border: "1px solid #e6e9f2", borderRadius: 10, padding: 12 }}>
                  <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: "100%", height: "100%" }}>
                    <line x1="0" y1="100" x2="100" y2="100" stroke="#cbd5e1" strokeWidth="0.8" />
                    <line x1="0" y1="0" x2="0" y2="100" stroke="#cbd5e1" strokeWidth="0.8" />
                    <polyline
                      fill="none"
                      stroke="#2563eb"
                      strokeWidth="2"
                      points={trendPoints}
                    />
                    {salesTrend.map((d, i) => {
                      const x = salesTrend.length > 1 ? (i / (salesTrend.length - 1)) * 100 : 0;
                      const y = 100 - (d.revenue / trendMax) * 100;
                      return <circle key={d.key} cx={x} cy={y} r="1.5" fill="#1d4ed8" />;
                    })}
                  </svg>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 12, color: "#64748b" }}>
                  <span>{salesTrend[0]?.label}</span>
                  <span>{salesTrend[salesTrend.length - 1]?.label}</span>
                </div>
              </>
            )}
          </div>

          <div className="card">
            <h2 className="section-title" style={{ marginBottom: 10 }}>Top Products (Revenue)</h2>
            {dashboardLoading || topProductsLoading ? (
              <p style={{ margin: 0, color: "#4a5368" }}>Loading chart...</p>
            ) : topProductsBars.length === 0 ? (
              <p style={{ margin: 0, color: "#4a5368" }}>No data yet</p>
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

      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
        {/* Top Products */}
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h2 className="section-title" style={{ margin: 0 }}>Top Products</h2>
          </div>
          
          {/* Date Filter */}
          {isAdmin && (
            <div style={{ 
              display: "flex", 
              gap: 8, 
              marginBottom: 16, 
              alignItems: "center",
              padding: 12,
              background: "#f9fbff",
              borderRadius: 8,
              border: "1px solid #e6e9f2"
            }}>
              <span style={{ color: "#4a5368", fontSize: 13, fontWeight: 500 }}>Date:</span>
              <input
                type="date"
                value={topProductsDate}
                onChange={(e) => setTopProductsDate(e.target.value)}
                style={{
                  padding: "8px 12px",
                  borderRadius: 6,
                  border: "1px solid #d1d5db",
                  fontSize: 13,
                  flex: 1,
                }}
              />
              <button
                onClick={handleFilterTopProducts}
                disabled={topProductsLoading}
                style={{
                  padding: "8px 16px",
                  borderRadius: 6,
                  border: "none",
                  background: "#1f7aff",
                  color: "white",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: topProductsLoading ? "wait" : "pointer",
                  opacity: topProductsLoading ? 0.7 : 1,
                }}
              >
                {topProductsLoading ? "..." : "Filter"}
              </button>
              {topProductsDate && (
                <button
                  onClick={handleClearFilter}
                  disabled={topProductsLoading}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 6,
                    border: "1px solid #d1d5db",
                    background: "white",
                    color: "#6b7280",
                    fontSize: 13,
                    cursor: topProductsLoading ? "wait" : "pointer",
                  }}
                >
                  Clear
                </button>
              )}
            </div>
          )}
          
          {dashboardLoading || topProductsLoading ? (
            <p style={{ margin: 0, color: "#4a5368" }}>Loading...</p>
          ) : !isAdmin ? (
            <p style={{ margin: 0, color: "#4a5368" }}>Admin access required</p>
          ) : topProducts.length === 0 ? (
            <p style={{ margin: 0, color: "#4a5368" }}>No sales data for selected period</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {topProducts.map((item, idx) => (
                <div
                  key={idx}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: 12,
                    background: "#f9fbff",
                    borderRadius: 10,
                    border: "1px solid #e6e9f2",
                  }}
                >
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: "50%",
                      background: idx === 0 ? "#ffd700" : idx === 1 ? "#c0c0c0" : idx === 2 ? "#cd7f32" : "#e6e9f2",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: 700,
                      fontSize: 14,
                    }}
                  >
                    {idx + 1}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{item.name}</div>
                    <div style={{ fontSize: 12, color: "#5f6475" }}>Qty sold: {item.quantity_sold}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontWeight: 700, color: "#10b981" }}>GHS {Number(item.revenue).toFixed(2)}</div>
                    <div style={{ fontSize: 12, color: "#5f6475" }}>Revenue</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Stock Alerts */}
        <div className="card">
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
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
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
      </div>

      {/* Expiry Tracking */}
      {(expiredProducts.length > 0 || expiringSoonProducts.length > 0) && (
        <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
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
