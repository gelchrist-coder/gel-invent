import { useCallback, useEffect, useState } from "react";
import { API_BASE } from "../api";

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

export default function Reports() {
  // Check if current user is Admin
  const currentUser = localStorage.getItem("user");
  const userRole = currentUser ? JSON.parse(currentUser).role : null;
  const isAdmin = userRole === "Admin";

  const [activeTab, setActiveTab] = useState<"sales" | "inventory" | "creditors">("sales");
  const [salesData, setSalesData] = useState<SalesDashboard | null>(null);
  const [inventoryData, setInventoryData] = useState<InventoryStatus | null>(null);
  const [creditorsData, setCreditorsData] = useState<CreditorsSummary | null>(null);
  const [loading, setLoading] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem("token");
      const headers = {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      };

      if (activeTab === "sales" && !salesData) {
        const res = await fetch(`${API_BASE}/reports/sales-dashboard`, { headers });
        if (res.ok) {
          setSalesData(await res.json());
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
  }, [activeTab, creditorsData, inventoryData, salesData]);

  useEffect(() => {
    // Only load data if user is Admin
    if (isAdmin) {
      loadData();
    }
  }, [isAdmin, loadData]);

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
      <h1 style={{ marginBottom: 24, fontSize: 28, fontWeight: 700 }}>Reports</h1>
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

      {/* Sales Dashboard */}
      {activeTab === "sales" && salesData && salesData.today && (
        <div>
          {/* Summary Cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 24 }}>
            <div style={{ padding: 20, backgroundColor: "#eff6ff", borderRadius: 8, border: "1px solid #bfdbfe" }}>
              <h3 style={{ margin: 0, fontSize: 14, color: "#1e40af", marginBottom: 8 }}>Today</h3>
              <p style={{ margin: 0, fontSize: 28, fontWeight: 700, color: "#1e3a8a" }}>
                {formatCurrency(salesData.today?.total || 0)}
              </p>
              <p style={{ margin: "4px 0 0", fontSize: 13, color: "#3b82f6" }}>{salesData.today?.count || 0} sales</p>
            </div>

            <div style={{ padding: 20, backgroundColor: "#f0fdf4", borderRadius: 8, border: "1px solid #bbf7d0" }}>
              <h3 style={{ margin: 0, fontSize: 14, color: "#15803d", marginBottom: 8 }}>This Week</h3>
              <p style={{ margin: 0, fontSize: 28, fontWeight: 700, color: "#166534" }}>
                {formatCurrency(salesData.week?.total || 0)}
              </p>
              <p style={{ margin: "4px 0 0", fontSize: 13, color: "#22c55e" }}>{salesData.week?.count || 0} sales</p>
            </div>

            <div style={{ padding: 20, backgroundColor: "#fef3c7", borderRadius: 8, border: "1px solid #fde047" }}>
              <h3 style={{ margin: 0, fontSize: 14, color: "#a16207", marginBottom: 8 }}>This Month</h3>
              <p style={{ margin: 0, fontSize: 28, fontWeight: 700, color: "#854d0e" }}>
                {formatCurrency(salesData.month?.total || 0)}
              </p>
              <p style={{ margin: "4px 0 0", fontSize: 13, color: "#ca8a04" }}>{salesData.month?.count || 0} sales</p>
            </div>
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
        </div>
      )}

      {/* Inventory Status */}
      {activeTab === "inventory" && inventoryData && (
        <div>
          {/* Summary Cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 24 }}>
            <div style={{ padding: 20, backgroundColor: "#f3f4f6", borderRadius: 8, border: "1px solid #d1d5db" }}>
              <h3 style={{ margin: 0, fontSize: 13, color: "#6b7280", marginBottom: 8 }}>Total Products</h3>
              <p style={{ margin: 0, fontSize: 32, fontWeight: 700, color: "#1f2937" }}>
                {inventoryData.summary.total_products}
              </p>
            </div>

            <div style={{ padding: 20, backgroundColor: "#fef2f2", borderRadius: 8, border: "1px solid #fecaca" }}>
              <h3 style={{ margin: 0, fontSize: 13, color: "#991b1b", marginBottom: 8 }}>Out of Stock</h3>
              <p style={{ margin: 0, fontSize: 32, fontWeight: 700, color: "#dc2626" }}>
                {inventoryData.summary.out_of_stock_count}
              </p>
            </div>

            <div style={{ padding: 20, backgroundColor: "#fef3c7", borderRadius: 8, border: "1px solid #fde047" }}>
              <h3 style={{ margin: 0, fontSize: 13, color: "#92400e", marginBottom: 8 }}>Low Stock</h3>
              <p style={{ margin: 0, fontSize: 32, fontWeight: 700, color: "#d97706" }}>
                {inventoryData.summary.low_stock_count}
              </p>
            </div>

            <div style={{ padding: 20, backgroundColor: "#fff7ed", borderRadius: 8, border: "1px solid #fed7aa" }}>
              <h3 style={{ margin: 0, fontSize: 13, color: "#9a3412", marginBottom: 8 }}>Expiring Soon</h3>
              <p style={{ margin: 0, fontSize: 32, fontWeight: 700, color: "#ea580c" }}>
                {inventoryData.summary.expiring_soon_count}
              </p>
            </div>
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

            {/* Expiring Soon */}
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
          </div>
        </div>
      )}

      {/* Creditors Summary */}
      {activeTab === "creditors" && creditorsData && (
        <div>
          {/* Summary Cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 24 }}>
            <div style={{ padding: 20, backgroundColor: "#f3f4f6", borderRadius: 8, border: "1px solid #d1d5db" }}>
              <h3 style={{ margin: 0, fontSize: 13, color: "#6b7280", marginBottom: 8 }}>Total Creditors</h3>
              <p style={{ margin: 0, fontSize: 32, fontWeight: 700, color: "#1f2937" }}>
                {creditorsData.summary.total_creditors}
              </p>
            </div>

            <div style={{ padding: 20, backgroundColor: "#fef2f2", borderRadius: 8, border: "1px solid #fecaca" }}>
              <h3 style={{ margin: 0, fontSize: 13, color: "#991b1b", marginBottom: 8 }}>With Debt</h3>
              <p style={{ margin: 0, fontSize: 32, fontWeight: 700, color: "#dc2626" }}>
                {creditorsData.summary.creditors_with_debt}
              </p>
            </div>

            <div style={{ padding: 20, backgroundColor: "#fff7ed", borderRadius: 8, border: "1px solid #fed7aa" }}>
              <h3 style={{ margin: 0, fontSize: 13, color: "#9a3412", marginBottom: 8 }}>Total Debt</h3>
              <p style={{ margin: 0, fontSize: 28, fontWeight: 700, color: "#ea580c" }}>
                {formatCurrency(creditorsData.summary.total_outstanding_debt)}
              </p>
            </div>

            <div style={{ padding: 20, backgroundColor: "#fef3c7", borderRadius: 8, border: "1px solid #fde047" }}>
              <h3 style={{ margin: 0, fontSize: 13, color: "#92400e", marginBottom: 8 }}>Avg Debt</h3>
              <p style={{ margin: 0, fontSize: 28, fontWeight: 700, color: "#d97706" }}>
                {formatCurrency(creditorsData.summary.average_debt)}
              </p>
            </div>
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
