// SVG Icons
const PackageIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16.5 9.4 7.55 4.24" />
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    <polyline points="3.29 7 12 12 20.71 7" />
    <line x1="12" y1="22" x2="12" y2="12" />
  </svg>
);

const DollarIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="1" x2="12" y2="23" />
    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
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
  usesExpiryTracking?: boolean;
};

export default function InventoryOverview({ analytics, usesExpiryTracking = true }: Props) {
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
              color: "#2563eb",
            }}
          >
            <PackageIcon />
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
              color: "#059669",
            }}
          >
            <DollarIcon />
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
              color: "#dc2626",
            }}
          >
            <AlertTriangleIcon />
          </div>
          <div>
            <p style={{ margin: 0, fontSize: 14, color: "#6b7280" }}>Low Stock</p>
            <p style={{ margin: "4px 0 0", fontSize: 24, fontWeight: 700 }}>
              {analytics.low_stock_alerts.length}
            </p>
          </div>
        </div>
      </div>

      {/* Expiring Products - only show if expiry tracking is enabled */}
      {usesExpiryTracking && (
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
              color: "#d97706",
            }}
          >
            <ClockIcon />
          </div>
          <div>
            <p style={{ margin: 0, fontSize: 14, color: "#6b7280" }}>Expiring Soon</p>
            <p style={{ margin: "4px 0 0", fontSize: 24, fontWeight: 700 }}>
              {analytics.expiring_products.filter((p) => p.days_to_expiry <= 30).length}
            </p>
          </div>
        </div>
      </div>
      )}

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
