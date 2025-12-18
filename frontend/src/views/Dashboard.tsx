import { useEffect, useState } from "react";

import { fetchProducts, fetchSalesDashboard, fetchSystemSettings } from "../api";
import { Product } from "../types";

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

export default function Dashboard({ onNavigate }: Props) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [dashboardData, setDashboardData] = useState<SalesDashboardResponse | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [lowStockThreshold, setLowStockThreshold] = useState<number>(10);
  const [expiryWarningDays, setExpiryWarningDays] = useState<number>(180);

  // Check if current user is Admin
  const currentUser = localStorage.getItem("user");
  const userRole = currentUser ? JSON.parse(currentUser).role : null;
  const isAdmin = userRole === "Admin";
  const token = localStorage.getItem("token");

  useEffect(() => {
    // Only fetch products if authenticated
    if (!token) {
      setLoading(false);
      return;
    }

    const loadData = async () => {
      try {
        const data = await fetchProducts();
        setProducts(data);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [token]);

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const settings = await fetchSystemSettings();
        setLowStockThreshold(settings.low_stock_threshold);
        setExpiryWarningDays(settings.expiry_warning_days);
      } catch {
        // ignore
      }
    })();
  }, [token]);

  useEffect(() => {
    const loadDashboard = async () => {
      // Only fetch dashboard if authenticated and admin
      if (!token || !isAdmin) {
        setDashboardLoading(false);
        return;
      }
      try {
        const data = await fetchSalesDashboard();
        setDashboardData(data);
      } catch (error) {
        console.error("Error loading dashboard:", error);
      } finally {
        setDashboardLoading(false);
      }
    };
    loadDashboard();
  }, [token, isAdmin]);

  // Top products from dashboard data
  const topProducts = dashboardData?.top_products ?? [];

  // Recent sales from dashboard data
  const recentSales = dashboardData?.recent_sales ?? [];

  // Stock alerts - will be based on real stock movements when implemented
  const lowStockItems: LowStockItem[] = products
    .filter((p) => (p.current_stock ?? 0) < lowStockThreshold)
    .map((p) => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      currentStock: p.current_stock ?? 0,
      minStock: lowStockThreshold,
    }));

  // Calculate expired and expiring soon products
  const expiredProducts = products.filter(
    (p) => p.expiry_date && new Date(p.expiry_date) < new Date()
  );
  const expiringSoonProducts = products.filter(
    (p) =>
      p.expiry_date &&
      new Date(p.expiry_date) >= new Date() &&
      new Date(p.expiry_date) <= new Date(Date.now() + expiryWarningDays * 24 * 60 * 60 * 1000)
  );

  const quickActions = [
    { label: "Add Product", icon: "➕", color: "#1f7aff", action: "products" },
    { label: "Record Sale", icon: "💰", color: "#10b981", action: "sales" },
    { label: "Stock Movement", icon: "📦", color: "#8246ff", action: "inventory", adminOnly: true },
    { label: "View Reports", icon: "📊", color: "#f59e0b", action: "reports", adminOnly: true },
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

      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
        {/* Top Products */}
        <div className="card">
          <h2 className="section-title">Top Products</h2>
          {dashboardLoading ? (
            <p style={{ margin: 0, color: "#4a5368" }}>Loading...</p>
          ) : !isAdmin ? (
            <p style={{ margin: 0, color: "#4a5368" }}>Admin access required</p>
          ) : topProducts.length === 0 ? (
            <p style={{ margin: 0, color: "#4a5368" }}>No sales data yet</p>
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
                  ⚠️ Expiring Soon ({expiryWarningDays} days)
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
