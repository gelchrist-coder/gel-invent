import { useState } from "react";
import { Sale, Product } from "../types";

type SalesListProps = {
  sales: Sale[];
  products: Product[];
  onDelete: (saleId: number) => void;
};

export default function SalesList({ sales, products, onDelete }: SalesListProps) {
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const getProductName = (productId: number) => {
    const product = products.find((p) => p.id === productId);
    return product ? product.name : `Product #${productId}`;
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const handleDelete = (saleId: number) => {
    setDeleteId(saleId);
  };

  const confirmDelete = () => {
    if (deleteId) {
      onDelete(deleteId);
      setDeleteId(null);
    }
  };

  if (sales.length === 0) {
    return (
      <div
        style={{
          padding: 24,
          backgroundColor: "#f9fafb",
          borderRadius: 8,
          textAlign: "center",
          color: "#6b7280",
        }}
      >
        No sales recorded yet
      </div>
    );
  }

  return (
    <div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ backgroundColor: "#f9fafb" }}>
              <th style={{ padding: 12, textAlign: "left", borderBottom: "2px solid #e5e7eb" }}>
                Date
              </th>
              <th style={{ padding: 12, textAlign: "left", borderBottom: "2px solid #e5e7eb" }}>
                Product
              </th>
              <th style={{ padding: 12, textAlign: "right", borderBottom: "2px solid #e5e7eb" }}>
                Qty
              </th>
              <th style={{ padding: 12, textAlign: "right", borderBottom: "2px solid #e5e7eb" }}>
                Price
              </th>
              <th style={{ padding: 12, textAlign: "right", borderBottom: "2px solid #e5e7eb" }}>
                Total
              </th>
              <th style={{ padding: 12, textAlign: "left", borderBottom: "2px solid #e5e7eb" }}>
                Customer
              </th>
              <th style={{ padding: 12, textAlign: "left", borderBottom: "2px solid #e5e7eb" }}>
                Payment
              </th>
              <th style={{ padding: 12, textAlign: "left", borderBottom: "2px solid #e5e7eb" }}>
                Recorded By
              </th>
              <th style={{ padding: 12, textAlign: "center", borderBottom: "2px solid #e5e7eb" }}>
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {sales.map((sale) => (
              <tr key={sale.id} style={{ borderBottom: "1px solid #e5e7eb" }}>
                <td style={{ padding: 12 }}>{formatDate(sale.created_at)}</td>
                <td style={{ padding: 12 }}>{getProductName(sale.product_id)}</td>
                <td style={{ padding: 12, textAlign: "right" }}>{sale.quantity}</td>
                <td style={{ padding: 12, textAlign: "right" }}>
                  GHS {Number(sale.unit_price).toFixed(2)}
                </td>
                <td style={{ padding: 12, textAlign: "right", fontWeight: 600 }}>
                  GHS {Number(sale.total_price).toFixed(2)}
                </td>
                <td style={{ padding: 12 }}>{sale.customer_name || "-"}</td>
                <td style={{ padding: 12 }}>
                  <span
                    style={{
                      padding: "4px 8px",
                      borderRadius: 4,
                      backgroundColor:
                        sale.payment_method === "cash"
                          ? "#d1fae5"
                          : sale.payment_method === "credit"
                            ? "#fee2e2"
                            : "#dbeafe",
                      fontSize: "0.875rem",
                    }}
                  >
                    {sale.payment_method.charAt(0).toUpperCase() + sale.payment_method.slice(1)}
                  </span>
                </td>
                <td style={{ padding: 12 }}>
                  <span
                    style={{
                      padding: "4px 8px",
                      borderRadius: 4,
                      backgroundColor: "#eff6ff",
                      color: "#1e40af",
                      fontSize: "0.875rem",
                      fontWeight: 500,
                    }}
                  >
                    {sale.created_by_name || "Unknown"}
                  </span>
                </td>
                <td style={{ padding: 12, textAlign: "center" }}>
                  <button
                    onClick={() => handleDelete(sale.id)}
                    style={{
                      padding: "4px 12px",
                      borderRadius: 4,
                      border: "none",
                      backgroundColor: "#ef4444",
                      color: "white",
                      cursor: "pointer",
                      fontSize: "0.875rem",
                    }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Delete Confirmation Modal */}
      {deleteId && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={() => setDeleteId(null)}
        >
          <div
            style={{
              backgroundColor: "white",
              padding: 24,
              borderRadius: 8,
              maxWidth: 400,
              width: "90%",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: "0 0 16px 0" }}>Delete Sale</h3>
            <p style={{ margin: "0 0 16px 0" }}>
              Are you sure you want to delete this sale? This will restore the stock.
            </p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                onClick={() => setDeleteId(null)}
                style={{
                  padding: "8px 16px",
                  borderRadius: 4,
                  border: "1px solid #ddd",
                  backgroundColor: "white",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                style={{
                  padding: "8px 16px",
                  borderRadius: 4,
                  border: "none",
                  backgroundColor: "#ef4444",
                  color: "white",
                  cursor: "pointer",
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
