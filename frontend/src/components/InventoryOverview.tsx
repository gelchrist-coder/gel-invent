type InventoryAnalytics = {
  stock_by_location: {
    location: string;
    products: number;
    total_units: number;
    value: number;
  }[];
  low_stock_alerts: {
    id: number;
    name: string;
    sku: string;
    current_stock: number;
    threshold: number;
    category: string | null;
  }[];
  expiring_products: {
    product_id: number;
    product_name: string;
    sku: string;
    batch_number: string | null;
    quantity: number;
    expiry_date: string;
    days_to_expiry: number;
    status: "expired" | "expiring_soon" | "expiring_30" | "expiring_90";
    location: string;
  }[];
  movement_summary: {
    stock_in: number;
    stock_out: number;
    adjustments: number;
    sales: number;
  };
  total_stock_value: number;
  total_products: number;
};

type Props = {
  analytics: InventoryAnalytics;
};

export default function InventoryOverview({ analytics }: Props) {
  const formatCurrency = (value: number) => {
    return `GHS ${value.toFixed(2)}`;
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 16 }}>
      {/* Total Products */}
      <div
        style={{
          backgroundColor: "white",
          borderRadius: 8,
          border: "1px solid #e5e7eb",
          padding: 20,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 8,
              backgroundColor: "#dbeafe",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 24,
            }}
          >
          </div>
          <div>
            <p style={{ margin: 0, fontSize: 14, color: "#6b7280" }}>Total Products</p>
            <p style={{ margin: "4px 0 0", fontSize: 24, fontWeight: 700 }}>
              {analytics.total_products}
            </p>
          </div>
        </div>
      </div>

      {/* Total Stock Value */}
      <div
        style={{
          backgroundColor: "white",
          borderRadius: 8,
          border: "1px solid #e5e7eb",
          padding: 20,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 8,
              backgroundColor: "#d1fae5",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 24,
            }}
          >
          </div>
          <div>
            <p style={{ margin: 0, fontSize: 14, color: "#6b7280" }}>Stock Value</p>
            <p style={{ margin: "4px 0 0", fontSize: 24, fontWeight: 700 }}>
              {formatCurrency(analytics.total_stock_value)}
            </p>
          </div>
        </div>
      </div>

      {/* Low Stock Alerts */}
      <div
        style={{
          backgroundColor: "white",
          borderRadius: 8,
          border: "1px solid #e5e7eb",
          padding: 20,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 8,
              backgroundColor: "#fee2e2",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 24,
            }}
          >
          </div>
          <div>
            <p style={{ margin: 0, fontSize: 14, color: "#6b7280" }}>Low Stock</p>
            <p style={{ margin: "4px 0 0", fontSize: 24, fontWeight: 700 }}>
              {analytics.low_stock_alerts.length}
            </p>
          </div>
        </div>
      </div>

      {/* Expiring Products */}
      <div
        style={{
          backgroundColor: "white",
          borderRadius: 8,
          border: "1px solid #e5e7eb",
          padding: 20,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 8,
              backgroundColor: "#fef3c7",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 24,
            }}
          >
          </div>
          <div>
            <p style={{ margin: 0, fontSize: 14, color: "#6b7280" }}>Expiring Soon</p>
            <p style={{ margin: "4px 0 0", fontSize: 24, fontWeight: 700 }}>
              {analytics.expiring_products.filter((p) => p.days_to_expiry <= 30).length}
            </p>
          </div>
        </div>
      </div>

      {/* Movement Summary - Last 30 Days */}
      <div
        style={{
          backgroundColor: "white",
          borderRadius: 8,
          border: "1px solid #e5e7eb",
          padding: 20,
          gridColumn: "1 / -1",
        }}
      >
        <h3 style={{ margin: "0 0 16px 0", fontSize: 16, fontWeight: 600 }}>
          Stock Movement (Last 30 Days)
        </h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
          <div>
            <p style={{ margin: 0, fontSize: 14, color: "#6b7280" }}>Stock In</p>
            <p style={{ margin: "4px 0 0", fontSize: 20, fontWeight: 600, color: "#10b981" }}>
              +{analytics.movement_summary.stock_in.toFixed(2)}
            </p>
          </div>
          <div>
            <p style={{ margin: 0, fontSize: 14, color: "#6b7280" }}>Stock Out</p>
            <p style={{ margin: "4px 0 0", fontSize: 20, fontWeight: 600, color: "#ef4444" }}>
              -{analytics.movement_summary.stock_out.toFixed(2)}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
