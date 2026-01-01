type LowStockAlert = {
  id: number;
  name: string;
  sku: string;
  current_stock: number;
  threshold: number;
  category: string | null;
};

type ExpiringProduct = {
  product_id: number;
  product_name: string;
  sku: string;
  batch_number: string | null;
  quantity: number;
  expiry_date: string;
  days_to_expiry: number;
  status: "expired" | "expiring_soon" | "expiring_30" | "expiring_90";
  location: string;
};

type Props = {
  lowStock: LowStockAlert[];
  expiring: ExpiringProduct[];
};

export default function StockAlerts({ lowStock, expiring }: Props) {
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  };

  const getExpiryStatusColor = (status: string) => {
    switch (status) {
      case "expired":
        return "#ef4444";
      case "expiring_soon":
        return "#f97316";
      case "expiring_30":
        return "#eab308";
      default:
        return "#3b82f6";
    }
  };

  const getExpiryStatusLabel = (daysToExpiry: number) => {
    if (daysToExpiry < 0) return "EXPIRED";
    if (daysToExpiry === 0) return "Expires Today";
    if (daysToExpiry === 1) return "Expires Tomorrow";
    if (daysToExpiry <= 7) return `${daysToExpiry} days`;
    if (daysToExpiry <= 30) return `${daysToExpiry} days`;
    return `${daysToExpiry} days`;
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(450px, 1fr))", gap: 24 }}>
      {/* Low Stock Alerts */}
      <div>
        <h3 style={{ margin: "0 0 16px 0", fontSize: 18, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
          <span></span>
          Low Stock Alerts ({lowStock.length})
        </h3>
        <div
          style={{
            backgroundColor: "white",
            borderRadius: 8,
            border: "1px solid #e5e7eb",
            maxHeight: 400,
            overflowY: "auto",
          }}
        >
          {lowStock.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", color: "#6b7280" }}>
              No low stock alerts
            </div>
          ) : (
            lowStock.map((item) => (
              <div
                key={item.id}
                style={{
                  padding: 16,
                  borderBottom: "1px solid #e5e7eb",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div style={{ flex: 1 }}>
                  <p style={{ margin: 0, fontWeight: 600, fontSize: 14 }}>{item.name}</p>
                  <p style={{ margin: "4px 0 0", fontSize: 13, color: "#6b7280" }}>
                    SKU: {item.sku}
                    {item.category && ` • ${item.category}`}
                  </p>
                </div>
                <div style={{ textAlign: "right" }}>
                  <p
                    style={{
                      margin: 0,
                      fontSize: 18,
                      fontWeight: 700,
                      color: item.current_stock === 0 ? "#ef4444" : "#f97316",
                    }}
                  >
                    {item.current_stock}
                  </p>
                  <p style={{ margin: "4px 0 0", fontSize: 12, color: "#6b7280" }}>
                    Min: {item.threshold}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Expiring Products */}
      <div>
        <h3 style={{ margin: "0 0 16px 0", fontSize: 18, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
          <span></span>
          Expiring Products ({expiring.length})
        </h3>
        <div
          style={{
            backgroundColor: "white",
            borderRadius: 8,
            border: "1px solid #e5e7eb",
            maxHeight: 400,
            overflowY: "auto",
          }}
        >
          {expiring.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", color: "#6b7280" }}>
              No expiring products
            </div>
          ) : (
            expiring.map((item, idx) => (
              <div
                key={`${item.product_id}-${item.batch_number}-${idx}`}
                style={{
                  padding: 16,
                  borderBottom: "1px solid #e5e7eb",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div style={{ flex: 1 }}>
                  <p style={{ margin: 0, fontWeight: 600, fontSize: 14 }}>{item.product_name}</p>
                  <p style={{ margin: "4px 0 0", fontSize: 13, color: "#6b7280" }}>
                    Batch: {item.batch_number || "N/A"} • Qty: {item.quantity} • {item.location}
                  </p>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div
                    style={{
                      padding: "4px 8px",
                      borderRadius: 4,
                      backgroundColor: `${getExpiryStatusColor(item.status)}20`,
                      color: getExpiryStatusColor(item.status),
                      fontSize: 13,
                      fontWeight: 600,
                      marginBottom: 4,
                    }}
                  >
                    {getExpiryStatusLabel(item.days_to_expiry)}
                  </div>
                  <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>
                    {formatDate(item.expiry_date)}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
