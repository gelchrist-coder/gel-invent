import { useState, useEffect } from "react";
import { Product } from "../types";
import { fetchReturns, SaleReturn } from "../api";

type ReturnsListProps = {
  products: Product[];
};

export default function ReturnsList({ products }: ReturnsListProps) {
  const [returns, setReturns] = useState<SaleReturn[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    loadReturns();
  }, []);

  const loadReturns = async () => {
    try {
      setLoading(true);
      const data = await fetchReturns();
      setReturns(data);
      setError(null);
    } catch (err) {
      setError("Failed to load returns");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const getProductName = (productId: number) => {
    const product = products.find((p) => p.id === productId);
    return product?.name || `Product #${productId}`;
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getReasonBadge = (reason: string) => {
    const lowerReason = reason.toLowerCase();
    let color = "#6b7280"; // default gray
    let bgColor = "#f3f4f6";

    if (lowerReason.includes("defective") || lowerReason.includes("damaged")) {
      color = "#dc2626";
      bgColor = "#fee2e2";
    } else if (lowerReason.includes("exchange")) {
      color = "#2563eb";
      bgColor = "#dbeafe";
    } else if (lowerReason.includes("wrong")) {
      color = "#f59e0b";
      bgColor = "#fef3c7";
    } else if (lowerReason.includes("changed mind")) {
      color = "#8b5cf6";
      bgColor = "#ede9fe";
    } else if (lowerReason.includes("expired")) {
      color = "#dc2626";
      bgColor = "#fee2e2";
    }

    return (
      <span
        style={{
          display: "inline-block",
          padding: "2px 8px",
          borderRadius: 12,
          fontSize: 11,
          fontWeight: 500,
          backgroundColor: bgColor,
          color: color,
          maxWidth: 150,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={reason}
      >
        {reason}
      </span>
    );
  };

  const getRefundMethodLabel = (method: string) => {
    switch (method) {
      case "cash":
        return "Cash";
      case "credit_to_account":
        return "Credit Reduced";
      case "store_credit":
        return "Store Credit";
      case "exchange":
        return "Exchange";
      default:
        return method;
    }
  };

  if (loading) {
    return <p style={{ margin: 0, color: "#6b7280", fontSize: 13 }}>Loading returns...</p>;
  }

  if (error) {
    return (
      <div>
        <p style={{ margin: "0 0 8px", color: "#dc2626", fontSize: 13 }}>{error}</p>
        <button
          onClick={loadReturns}
          style={{
            padding: "4px 12px",
            fontSize: 12,
            borderRadius: 4,
            border: "1px solid #e5e7eb",
            background: "white",
            cursor: "pointer",
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  if (returns.length === 0) {
    return <p style={{ margin: 0, color: "#6b7280", fontSize: 13 }}>No returns recorded yet.</p>;
  }

  const displayReturns = expanded ? returns : returns.slice(0, 5);

  // Calculate summary
  const totalRefunds = returns.reduce((sum, r) => sum + Number(r.refund_amount), 0);
  const totalItems = returns.reduce((sum, r) => sum + r.quantity_returned, 0);

  return (
    <div>
      {/* Summary */}
      <div
        style={{
          display: "flex",
          gap: 16,
          marginBottom: 12,
          padding: 12,
          backgroundColor: "#fef3c7",
          borderRadius: 8,
          fontSize: 13,
        }}
      >
        <div>
          <span style={{ color: "#92400e" }}>Total Returns:</span>{" "}
          <strong>{returns.length}</strong>
        </div>
        <div>
          <span style={{ color: "#92400e" }}>Items Returned:</span>{" "}
          <strong>{totalItems}</strong>
        </div>
        <div>
          <span style={{ color: "#92400e" }}>Total Refunds:</span>{" "}
          <strong>GHS {totalRefunds.toFixed(2)}</strong>
        </div>
      </div>

      {/* Returns Table */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
              <th style={{ padding: "8px 6px", textAlign: "left", fontWeight: 600, color: "#374151" }}>
                Date
              </th>
              <th style={{ padding: "8px 6px", textAlign: "left", fontWeight: 600, color: "#374151" }}>
                Product
              </th>
              <th style={{ padding: "8px 6px", textAlign: "center", fontWeight: 600, color: "#374151" }}>
                Qty
              </th>
              <th style={{ padding: "8px 6px", textAlign: "right", fontWeight: 600, color: "#374151" }}>
                Refund
              </th>
              <th style={{ padding: "8px 6px", textAlign: "left", fontWeight: 600, color: "#374151" }}>
                Method
              </th>
              <th style={{ padding: "8px 6px", textAlign: "left", fontWeight: 600, color: "#374151" }}>
                Reason
              </th>
              <th style={{ padding: "8px 6px", textAlign: "center", fontWeight: 600, color: "#374151" }}>
                Restocked
              </th>
            </tr>
          </thead>
          <tbody>
            {displayReturns.map((ret) => (
              <tr key={ret.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                <td style={{ padding: "10px 6px", color: "#6b7280", fontSize: 12 }}>
                  {formatDate(ret.created_at)}
                </td>
                <td style={{ padding: "10px 6px", fontWeight: 500 }}>
                  {getProductName(ret.product_id)}
                </td>
                <td style={{ padding: "10px 6px", textAlign: "center" }}>
                  {ret.quantity_returned}
                </td>
                <td style={{ padding: "10px 6px", textAlign: "right", fontWeight: 600, color: "#dc2626" }}>
                  GHS {Number(ret.refund_amount).toFixed(2)}
                </td>
                <td style={{ padding: "10px 6px", fontSize: 12 }}>
                  {getRefundMethodLabel(ret.refund_method)}
                </td>
                <td style={{ padding: "10px 6px" }}>{getReasonBadge(ret.reason || "No reason")}</td>
                <td style={{ padding: "10px 6px", textAlign: "center" }}>
                  {ret.restock ? (
                    <span style={{ color: "#10b981", fontWeight: 600 }}>Yes</span>
                  ) : (
                    <span style={{ color: "#ef4444" }}>No</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Show More */}
      {returns.length > 5 && (
        <div style={{ textAlign: "center", marginTop: 12 }}>
          <button
            onClick={() => setExpanded(!expanded)}
            style={{
              padding: "8px 16px",
              borderRadius: 4,
              border: "1px solid #e5e7eb",
              background: "white",
              color: "#374151",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            {expanded ? "Show Less" : `View ${returns.length - 5} more returns →`}
          </button>
        </div>
      )}
    </div>
  );
}
