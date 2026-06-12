import { Fragment, useState } from "react";
import { Sale, Product } from "../types";
import { SaleTransaction } from "../sales-transactions";
import ReturnForm from "./ReturnForm";

type SalesListProps = {
  sales: SaleTransaction[];
  products: Product[];
  onDelete: (saleId: number) => void;
  onRefresh?: () => void;
  allowDelete?: boolean;
  onPrintReceipt?: (transaction: SaleTransaction) => void;
  onConvertWalkIn?: (transaction: SaleTransaction) => void;
  onRepeatSale?: (transaction: SaleTransaction) => void;
};

const WALK_IN_NAMES = new Set(["walk in", "walk in customer", "walkin", "guest", "anonymous"]);

function isWalkInSaleName(customerName: string | null | undefined): boolean {
  const rawName = String(customerName || "").trim();
  if (!rawName) return true;
  const normalized = rawName.toLowerCase().replace(/[-_]/g, " ").replace(/\s+/g, " ").trim();
  return WALK_IN_NAMES.has(normalized);
}

export default function SalesList({ sales, products, onDelete, onRefresh, allowDelete = false, onPrintReceipt, onConvertWalkIn, onRepeatSale }: SalesListProps) {
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [returnSale, setReturnSale] = useState<Sale | null>(null);
  const [expandedTransactionKey, setExpandedTransactionKey] = useState<string | null>(null);

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
    if (!allowDelete) return;
    setDeleteId(saleId);
  };

  const handleReturn = (sale: Sale) => {
    setReturnSale(sale);
  };

  const handleReturnSuccess = () => {
    setReturnSale(null);
    if (onRefresh) {
      onRefresh();
    }
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
              <th style={{ padding: 12, textAlign: "left", borderBottom: "2px solid #e5e7eb", position: "sticky", top: 0, zIndex: 1, backgroundColor: "#f9fafb" }}>
                Date
              </th>
              <th style={{ padding: 12, textAlign: "left", borderBottom: "2px solid #e5e7eb", position: "sticky", top: 0, zIndex: 1, backgroundColor: "#f9fafb" }}>
                Customer
              </th>
              <th style={{ padding: 12, textAlign: "right", borderBottom: "2px solid #e5e7eb", position: "sticky", top: 0, zIndex: 1, backgroundColor: "#f9fafb" }}>
                Items Bought
              </th>
              <th style={{ padding: 12, textAlign: "left", borderBottom: "2px solid #e5e7eb", position: "sticky", top: 0, zIndex: 1, backgroundColor: "#f9fafb" }}>
                Payment
              </th>
              <th style={{ padding: 12, textAlign: "right", borderBottom: "2px solid #e5e7eb", position: "sticky", top: 0, zIndex: 1, backgroundColor: "#f9fafb" }}>
                Total
              </th>
              <th style={{ padding: 12, textAlign: "left", borderBottom: "2px solid #e5e7eb", position: "sticky", top: 0, zIndex: 1, backgroundColor: "#f9fafb" }}>
                Recorded By
              </th>
              <th style={{ padding: 12, textAlign: "center", borderBottom: "2px solid #e5e7eb", position: "sticky", top: 0, zIndex: 1, backgroundColor: "#f9fafb" }}>
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {sales.map((transaction) => {
              const isExpanded = expandedTransactionKey === transaction.key;
              const paymentMethod = String(transaction.payment_method || "cash");
              const totalPaid = Number(transaction.amount_paid || 0);
              const balance = Math.max(0, Number(transaction.total_price || 0) - totalPaid);

              return (
                <Fragment key={transaction.key}>
                  <tr style={{ borderBottom: isExpanded ? "none" : "1px solid #e5e7eb", verticalAlign: "top" }}>
                    <td style={{ padding: 12 }}>
                      <div style={{ fontWeight: 600, color: "#111827" }}>{formatDate(transaction.created_at)}</div>
                      <div style={{ marginTop: 4, fontSize: 12, color: "#64748b" }}>Receipt #{transaction.receiptNumber}</div>
                    </td>
                    <td style={{ padding: 12 }}>
                      <div style={{ fontWeight: 600, color: isWalkInSaleName(transaction.customer_name) ? "#92400e" : "#111827" }}>
                        {transaction.customer_name || "Walk-in"}
                      </div>
                      <div style={{ marginTop: 4, fontSize: 12, color: "#64748b" }}>
                        {transaction.item_count} item{transaction.item_count === 1 ? "" : "s"}
                      </div>
                    </td>
                    <td style={{ padding: 12, minWidth: 280 }}>
                      <div style={{ display: "grid", gap: 6 }}>
                        {transaction.items.map((item) => (
                          <div key={item.sale.id} style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                            <span style={{ color: "#111827", fontWeight: 500 }}>{item.productName}</span>
                            <span style={{ color: "#64748b", fontSize: 12, whiteSpace: "nowrap" }}>{item.quantityLabel}</span>
                          </div>
                        ))}
                      </div>
                    </td>
                    <td style={{ padding: 12 }}>
                      <span
                        style={{
                          padding: "4px 8px",
                          borderRadius: 4,
                          backgroundColor:
                            paymentMethod === "cash"
                              ? "#d1fae5"
                              : paymentMethod === "credit"
                                ? "#fee2e2"
                                : "#dbeafe",
                          fontSize: "0.875rem",
                        }}
                      >
                        {paymentMethod.charAt(0).toUpperCase() + paymentMethod.slice(1)}
                      </span>
                      {totalPaid > 0 && paymentMethod !== "cash" ? (
                        <div style={{ marginTop: 6, fontSize: 12, color: "#64748b" }}>
                          Paid GHS {totalPaid.toFixed(2)}
                          {balance > 0 ? ` · Balance GHS ${balance.toFixed(2)}` : ""}
                        </div>
                      ) : null}
                    </td>
                    <td style={{ padding: 12, textAlign: "right", fontWeight: 700, color: "#111827", whiteSpace: "nowrap" }}>
                      GHS {Number(transaction.total_price || 0).toFixed(2)}
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
                        {transaction.created_by_name || "Unknown"}
                      </span>
                    </td>
                    <td style={{ padding: 12, textAlign: "center" }}>
                      <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
                        <button
                          type="button"
                          onClick={() => setExpandedTransactionKey(isExpanded ? null : transaction.key)}
                          style={{
                            padding: "5px 10px",
                            borderRadius: 4,
                            border: "1px solid #cbd5e1",
                            backgroundColor: "white",
                            color: "#334155",
                            cursor: "pointer",
                            fontSize: "0.8125rem",
                            fontWeight: 600,
                          }}
                        >
                          {isExpanded ? "Hide Items" : "View Items"}
                        </button>
                        {onPrintReceipt && (
                          <button
                            type="button"
                            onClick={() => onPrintReceipt(transaction)}
                            style={{
                              padding: "5px 10px",
                              borderRadius: 4,
                              border: "1px solid #bfdbfe",
                              backgroundColor: "#eff6ff",
                              color: "#1d4ed8",
                              cursor: "pointer",
                              fontSize: "0.8125rem",
                              fontWeight: 600,
                            }}
                          >
                            Receipt
                          </button>
                        )}
                        {onRepeatSale && (
                          <button
                            type="button"
                            onClick={() => onRepeatSale(transaction)}
                            style={{
                              padding: "5px 10px",
                              borderRadius: 4,
                              border: "1px solid #bbf7d0",
                              backgroundColor: "#f0fdf4",
                              color: "#166534",
                              cursor: "pointer",
                              fontSize: "0.8125rem",
                              fontWeight: 600,
                            }}
                          >
                            Repeat Sale
                          </button>
                        )}
                        {onConvertWalkIn && isWalkInSaleName(transaction.customer_name) && (
                          <button
                            type="button"
                            onClick={() => onConvertWalkIn(transaction)}
                            style={{
                              padding: "5px 10px",
                              borderRadius: 4,
                              border: "1px solid #fcd34d",
                              backgroundColor: "#fffbeb",
                              color: "#92400e",
                              cursor: "pointer",
                              fontSize: "0.8125rem",
                              fontWeight: 600,
                            }}
                          >
                            Assign Customer
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr style={{ borderBottom: "1px solid #e5e7eb", background: "#f8fafc" }}>
                      <td colSpan={7} style={{ padding: 0 }}>
                        <div style={{ padding: 14 }}>
                          <div style={{ marginBottom: 10, fontSize: 12, fontWeight: 700, color: "#475569" }}>
                            Line items in this checkout
                          </div>
                          <div style={{ display: "grid", gap: 10 }}>
                            {transaction.items.map((item) => (
                              <div
                                key={item.sale.id}
                                style={{
                                  border: "1px solid #dbe5f2",
                                  borderRadius: 10,
                                  background: "white",
                                  padding: 12,
                                  display: "grid",
                                  gap: 10,
                                }}
                              >
                                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                                  <div>
                                    <div style={{ fontSize: 13, color: "#64748b", fontWeight: 700, marginBottom: 4 }}>Item</div>
                                    <div style={{ fontWeight: 700, color: "#111827" }}>{item.productName}</div>
                                  </div>
                                  <div
                                    style={{
                                      padding: "4px 8px",
                                      borderRadius: 999,
                                      background: "#eef2ff",
                                      color: "#4338ca",
                                      fontSize: 12,
                                      fontWeight: 700,
                                      whiteSpace: "nowrap",
                                    }}
                                  >
                                    {item.quantityLabel}
                                  </div>
                                </div>

                                <div
                                  style={{
                                    display: "grid",
                                    gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                                    gap: 8,
                                  }}
                                >
                                  <div style={{ borderRadius: 8, background: "#f8fafc", padding: "8px 10px" }}>
                                    <div style={{ fontSize: 11, color: "#64748b", fontWeight: 700, marginBottom: 3 }}>Unit Price</div>
                                    <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a" }}>GHS {item.unitPrice.toFixed(2)}</div>
                                  </div>
                                  <div style={{ borderRadius: 8, background: "#f8fafc", padding: "8px 10px" }}>
                                    <div style={{ fontSize: 11, color: "#64748b", fontWeight: 700, marginBottom: 3 }}>Line Total</div>
                                    <div style={{ fontSize: 14, fontWeight: 700, color: "#047857" }}>GHS {item.totalPrice.toFixed(2)}</div>
                                  </div>
                                </div>

                                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                  <button
                                    type="button"
                                    onClick={() => handleReturn(item.sale)}
                                    style={{
                                      padding: "5px 12px",
                                      borderRadius: 4,
                                      border: "none",
                                      backgroundColor: "#2563eb",
                                      color: "white",
                                      cursor: "pointer",
                                      fontSize: "0.8125rem",
                                      fontWeight: 600,
                                    }}
                                  >
                                    Return
                                  </button>
                                  {allowDelete && (
                                    <button
                                      type="button"
                                      onClick={() => handleDelete(item.sale.id)}
                                      style={{
                                        padding: "5px 10px",
                                        borderRadius: 4,
                                        border: "1px solid #fecaca",
                                        backgroundColor: "#fef2f2",
                                        color: "#b91c1c",
                                        cursor: "pointer",
                                        fontSize: "0.8125rem",
                                        fontWeight: 600,
                                      }}
                                    >
                                      Delete
                                    </button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Return Form Modal */}
      {returnSale && (
        <ReturnForm
          sale={returnSale}
          product={products.find((p) => p.id === returnSale.product_id)}
          onClose={() => setReturnSale(null)}
          onSuccess={handleReturnSuccess}
        />
      )}

      {/* Delete Confirmation Modal */}
      {allowDelete && deleteId && (
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
