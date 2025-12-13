import { API_BASE } from "../api";
import { useCallback, useEffect, useState } from "react";

interface Transaction {
  id: number;
  creditor_id: number;
  sale_id: number | null;
  amount: number;
  transaction_type: "debt" | "payment";
  notes: string | null;
  created_at: string;
  sale_amount?: number;
}

interface Creditor {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  total_debt: number;
  notes: string | null;
}

interface CreditorDetailsProps {
  creditor: Creditor;
  onClose: () => void;
  onEdit: () => void;
  onRefresh: () => void;
}

export default function CreditorDetails({ creditor, onClose, onEdit, onRefresh }: CreditorDetailsProps) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showDebtModal, setShowDebtModal] = useState(false);

  const fetchTransactions = useCallback(async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem("token");
      const response = await fetch(`${API_BASE}/creditors/${creditor.id}/transactions`, {
        headers: {
          "Authorization": `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error("Failed to fetch transactions");
      }

      const data = await response.json();
      setTransactions(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("Error fetching transactions:", error);
      setTransactions([]);
    } finally {
      setLoading(false);
    }
  }, [creditor.id]);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-GH", {
      style: "currency",
      currency: "GHS",
    }).format(amount);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString("en-GH", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // Calculate actual debt from transactions
  const totalDebt = transactions
    .filter((t) => t.transaction_type === "debt")
    .reduce((sum, t) => sum + t.amount, 0);
  const totalPayments = transactions
    .filter((t) => t.transaction_type === "payment")
    .reduce((sum, t) => sum + t.amount, 0);
  const actualDebt = totalDebt - totalPayments;

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0, 0, 0, 0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: "white",
          borderRadius: 8,
          width: "100%",
          maxWidth: 900,
          maxHeight: "90vh",
          overflow: "auto",
          padding: 24,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: 24 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>{creditor.name}</h2>
            <div style={{ marginTop: 8 }}>
              {creditor.phone && <p style={{ margin: "4px 0", fontSize: 14, color: "#6b7280" }}>📱 {creditor.phone}</p>}
              {creditor.email && <p style={{ margin: "4px 0", fontSize: 14, color: "#6b7280" }}>✉️ {creditor.email}</p>}
            </div>
            {creditor.notes && (
              <p style={{ margin: "12px 0 0", fontSize: 14, color: "#6b7280", fontStyle: "italic" }}>
                {creditor.notes}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              padding: "8px 12px",
              backgroundColor: "#f3f4f6",
              border: "none",
              borderRadius: 6,
              fontSize: 18,
              cursor: "pointer",
            }}
          >
            ✕
          </button>
        </div>

        {/* Summary Cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 24 }}>
          <div style={{ backgroundColor: "#fee2e2", borderRadius: 8, padding: 16 }}>
            <p style={{ margin: 0, fontSize: 13, color: "#991b1b" }}>Total Debt</p>
            <p style={{ margin: "8px 0 0", fontSize: 24, fontWeight: 700, color: "#dc2626" }}>
              {formatCurrency(totalDebt)}
            </p>
          </div>
          <div style={{ backgroundColor: "#d1fae5", borderRadius: 8, padding: 16 }}>
            <p style={{ margin: 0, fontSize: 13, color: "#065f46" }}>Total Paid</p>
            <p style={{ margin: "8px 0 0", fontSize: 24, fontWeight: 700, color: "#059669" }}>
              {formatCurrency(totalPayments)}
            </p>
          </div>
          <div style={{ backgroundColor: actualDebt > 0 ? "#fef3c7" : "#e0e7ff", borderRadius: 8, padding: 16 }}>
            <p style={{ margin: 0, fontSize: 13, color: actualDebt > 0 ? "#92400e" : "#3730a3" }}>Outstanding</p>
            <p style={{ margin: "8px 0 0", fontSize: 24, fontWeight: 700, color: actualDebt > 0 ? "#f59e0b" : "#6366f1" }}>
              {formatCurrency(actualDebt)}
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div style={{ display: "flex", gap: 12, marginBottom: 24 }}>
          <button
            onClick={() => setShowPaymentModal(true)}
            style={{
              padding: "10px 20px",
              backgroundColor: "#10b981",
              color: "white",
              border: "none",
              borderRadius: 6,
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            💵 Record Payment
          </button>
          <button
            onClick={() => setShowDebtModal(true)}
            style={{
              padding: "10px 20px",
              backgroundColor: "#ef4444",
              color: "white",
              border: "none",
              borderRadius: 6,
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            📝 Add Debt
          </button>
          <button
            onClick={onEdit}
            style={{
              padding: "10px 20px",
              backgroundColor: "#3b82f6",
              color: "white",
              border: "none",
              borderRadius: 6,
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            ✏️ Edit Info
          </button>
        </div>

        {/* Transactions History */}
        <div>
          <h3 style={{ margin: "0 0 16px", fontSize: 18, fontWeight: 700 }}>Transaction History</h3>
          
          {loading ? (
            <p style={{ textAlign: "center", color: "#6b7280", padding: 40 }}>Loading transactions...</p>
          ) : transactions.length === 0 ? (
            <div style={{ backgroundColor: "#f9fafb", borderRadius: 8, padding: 40, textAlign: "center" }}>
              <p style={{ margin: 0, color: "#6b7280" }}>No transactions yet.</p>
            </div>
          ) : (
            <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ backgroundColor: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
                    <th style={{ padding: "12px 16px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#6b7280", textTransform: "uppercase" }}>
                      Date
                    </th>
                    <th style={{ padding: "12px 16px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#6b7280", textTransform: "uppercase" }}>
                      Type
                    </th>
                    <th style={{ padding: "12px 16px", textAlign: "right", fontSize: 12, fontWeight: 600, color: "#6b7280", textTransform: "uppercase" }}>
                      Amount
                    </th>
                    <th style={{ padding: "12px 16px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#6b7280", textTransform: "uppercase" }}>
                      Notes
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((transaction) => (
                    <tr key={transaction.id} style={{ borderBottom: "1px solid #e5e7eb" }}>
                      <td style={{ padding: "12px 16px", fontSize: 13 }}>
                        {formatDate(transaction.created_at)}
                      </td>
                      <td style={{ padding: "12px 16px" }}>
                        <span
                          style={{
                            display: "inline-block",
                            padding: "4px 12px",
                            backgroundColor: transaction.transaction_type === "debt" ? "#fee2e2" : "#d1fae5",
                            color: transaction.transaction_type === "debt" ? "#dc2626" : "#059669",
                            borderRadius: 12,
                            fontSize: 12,
                            fontWeight: 600,
                          }}
                        >
                          {transaction.transaction_type === "debt" ? "Debt" : "Payment"}
                        </span>
                      </td>
                      <td
                        style={{
                          padding: "12px 16px",
                          textAlign: "right",
                          fontSize: 14,
                          fontWeight: 600,
                          color: transaction.transaction_type === "debt" ? "#ef4444" : "#10b981",
                        }}
                      >
                        {transaction.transaction_type === "debt" ? "+" : "-"}
                        {formatCurrency(transaction.amount)}
                      </td>
                      <td style={{ padding: "12px 16px", fontSize: 13, color: "#6b7280" }}>
                        {transaction.notes || "—"}
                        {transaction.sale_id && (
                          <span style={{ fontSize: 12, color: "#9ca3af", marginLeft: 8 }}>
                            (Sale #{transaction.sale_id})
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Payment Modal */}
        {showPaymentModal && (
          <TransactionModal
            creditorId={creditor.id}
            creditorName={creditor.name}
            transactionType="payment"
            onClose={() => setShowPaymentModal(false)}
            onSuccess={() => {
              fetchTransactions();
              onRefresh();
              setShowPaymentModal(false);
            }}
          />
        )}

        {/* Debt Modal */}
        {showDebtModal && (
          <DebtModal
            creditorId={creditor.id}
            creditorName={creditor.name}
            onClose={() => setShowDebtModal(false)}
            onSuccess={() => {
              fetchTransactions();
              onRefresh();
              setShowDebtModal(false);
            }}
          />
        )}
      </div>
    </div>
  );
}

// Debt Modal Component (with product selection)
interface DebtModalProps {
  creditorId: number;
  creditorName: string;
  onClose: () => void;
  onSuccess: () => void;
}

interface Product {
  id: number;
  name: string;
  price: number;
  quantity_in_stock: number;
}

function DebtModal({ creditorId: _creditorId, creditorName, onClose, onSuccess }: DebtModalProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [initialPayment, setInitialPayment] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchProducts();
  }, []);

  const fetchProducts = async () => {
    try {
      const token = localStorage.getItem("token");
      const response = await fetch(`${API_BASE}/products/`, {
        headers: {
          "Authorization": `Bearer ${token}`,
        },
      });
      if (response.ok) {
        const data = await response.json();
        setProducts(data);
      }
    } catch (error) {
      console.error("Error fetching products:", error);
    } finally {
      setLoadingProducts(false);
    }
  };

  const selectedProduct = products.find(p => p.id === parseInt(selectedProductId));
  const totalAmount = selectedProduct ? selectedProduct.price * parseFloat(quantity || "0") : 0;
  const initialPaymentNum = parseFloat(initialPayment || "0");
  const creditAmount = totalAmount - initialPaymentNum;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedProductId) {
      setError("Please select a product");
      return;
    }

    const quantityNum = parseFloat(quantity);
    if (!quantityNum || quantityNum <= 0) {
      setError("Please enter a valid quantity");
      return;
    }

    if (selectedProduct && quantityNum > selectedProduct.quantity_in_stock) {
      setError(`Only ${selectedProduct.quantity_in_stock} units available in stock`);
      return;
    }

    if (initialPaymentNum < 0) {
      setError("Initial payment cannot be negative");
      return;
    }

    if (initialPaymentNum > totalAmount) {
      setError("Initial payment cannot exceed total amount");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const token = localStorage.getItem("token");
      
      // Create the sale with credit payment method
      const response = await fetch(`${API_BASE}/sales`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({
          product_id: parseInt(selectedProductId),
          quantity: quantityNum,
          customer_name: creditorName,
          payment_method: "credit",
          amount_paid: initialPaymentNum > 0 ? initialPaymentNum : undefined,
          notes: notes.trim() || null,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || "Failed to record sale");
      }

      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0, 0, 0, 0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1001,
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: "white",
          borderRadius: 8,
          width: "100%",
          maxWidth: 500,
          maxHeight: "90vh",
          overflow: "auto",
          padding: 24,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ margin: "0 0 16px", fontSize: 18, fontWeight: 700 }}>
          Add Debt
        </h3>
        <p style={{ margin: "0 0 20px", fontSize: 14, color: "#6b7280" }}>
          Record a credit sale for <strong>{creditorName}</strong>
        </p>

        <form onSubmit={handleSubmit}>
          {/* Product Selection */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", marginBottom: 6, fontSize: 14, fontWeight: 500 }}>
              Product <span style={{ color: "#ef4444" }}>*</span>
            </label>
            {loadingProducts ? (
              <p style={{ fontSize: 14, color: "#6b7280" }}>Loading products...</p>
            ) : (
              <select
                value={selectedProductId}
                onChange={(e) => setSelectedProductId(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  border: "1px solid #d1d5db",
                  borderRadius: 6,
                  fontSize: 14,
                }}
              >
                <option value="">Select a product</option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name} - GHS {product.price.toFixed(2)} ({product.quantity_in_stock} in stock)
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Quantity */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", marginBottom: 6, fontSize: 14, fontWeight: 500 }}>
              Quantity <span style={{ color: "#ef4444" }}>*</span>
            </label>
            <input
              type="number"
              step="0.01"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              style={{
                width: "100%",
                padding: "10px 12px",
                border: "1px solid #d1d5db",
                borderRadius: 6,
                fontSize: 14,
              }}
              placeholder="0"
            />
          </div>

          {/* Total Amount Display */}
          {totalAmount > 0 && (
            <div style={{ marginBottom: 16, padding: "12px", backgroundColor: "#f9fafb", borderRadius: 6 }}>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
                Total Amount: GHS {totalAmount.toFixed(2)}
              </p>
            </div>
          )}

          {/* Initial Payment */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", marginBottom: 6, fontSize: 14, fontWeight: 500 }}>
              Initial Payment (GHS)
            </label>
            <input
              type="number"
              step="0.01"
              value={initialPayment}
              onChange={(e) => setInitialPayment(e.target.value)}
              style={{
                width: "100%",
                padding: "10px 12px",
                border: "1px solid #d1d5db",
                borderRadius: 6,
                fontSize: 14,
              }}
              placeholder="0.00"
            />
          </div>

          {/* Credit Amount Display */}
          {totalAmount > 0 && (
            <div style={{ marginBottom: 16, padding: "12px", backgroundColor: creditAmount > 0 ? "#fef3c7" : "#d1fae5", borderRadius: 6 }}>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: creditAmount > 0 ? "#92400e" : "#065f46" }}>
                Credit Amount: GHS {creditAmount.toFixed(2)}
              </p>
            </div>
          )}

          {/* Notes */}
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: "block", marginBottom: 6, fontSize: 14, fontWeight: 500 }}>
              Notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              style={{
                width: "100%",
                padding: "10px 12px",
                border: "1px solid #d1d5db",
                borderRadius: 6,
                fontSize: 14,
                fontFamily: "inherit",
                resize: "vertical",
              }}
              placeholder="Optional notes about this sale"
            />
          </div>

          {error && (
            <div
              style={{
                padding: "12px 16px",
                backgroundColor: "#fee2e2",
                color: "#dc2626",
                borderRadius: 6,
                marginBottom: 16,
                fontSize: 14,
              }}
            >
              {error}
            </div>
          )}

          <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: "10px 20px",
                backgroundColor: "#f3f4f6",
                color: "#374151",
                border: "none",
                borderRadius: 6,
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || loadingProducts}
              style={{
                padding: "10px 20px",
                backgroundColor: loading || loadingProducts ? "#9ca3af" : "#ef4444",
                color: "white",
                border: "none",
                borderRadius: 6,
                fontSize: 14,
                fontWeight: 600,
                cursor: loading || loadingProducts ? "not-allowed" : "pointer",
              }}
            >
              {loading ? "Recording Sale..." : "Add Debt"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Transaction Modal Component
interface TransactionModalProps {
  creditorId: number;
  creditorName: string;
  transactionType: "debt" | "payment";
  onClose: () => void;
  onSuccess: () => void;
}

function TransactionModal({ creditorId, creditorName, transactionType, onClose, onSuccess }: TransactionModalProps) {
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const amountNum = parseFloat(amount);
    if (!amountNum || amountNum <= 0) {
      setError("Please enter a valid amount");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const token = localStorage.getItem("token");
      const response = await fetch(`${API_BASE}/creditors/transactions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({
          creditor_id: creditorId,
          amount: amountNum,
          transaction_type: transactionType,
          notes: notes.trim() || null,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to record transaction");
      }

      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0, 0, 0, 0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1001,
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: "white",
          borderRadius: 8,
          width: "100%",
          maxWidth: 400,
          padding: 24,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ margin: "0 0 16px", fontSize: 18, fontWeight: 700 }}>
          {transactionType === "payment" ? "Record Payment" : "Add Debt"}
        </h3>
        <p style={{ margin: "0 0 20px", fontSize: 14, color: "#6b7280" }}>
          {transactionType === "payment" ? "Record a payment from" : "Add debt for"} <strong>{creditorName}</strong>
        </p>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", marginBottom: 6, fontSize: 14, fontWeight: 500 }}>
              Amount (GHS) <span style={{ color: "#ef4444" }}>*</span>
            </label>
            <input
              type="number"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              style={{
                width: "100%",
                padding: "10px 12px",
                border: "1px solid #d1d5db",
                borderRadius: 6,
                fontSize: 14,
              }}
              placeholder="0.00"
              autoFocus
            />
          </div>

          <div style={{ marginBottom: 20 }}>
            <label style={{ display: "block", marginBottom: 6, fontSize: 14, fontWeight: 500 }}>
              Notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              style={{
                width: "100%",
                padding: "10px 12px",
                border: "1px solid #d1d5db",
                borderRadius: 6,
                fontSize: 14,
                fontFamily: "inherit",
                resize: "vertical",
              }}
              placeholder="Optional notes about this transaction"
            />
          </div>

          {error && (
            <div
              style={{
                padding: "12px 16px",
                backgroundColor: "#fee2e2",
                color: "#dc2626",
                borderRadius: 6,
                marginBottom: 16,
                fontSize: 14,
              }}
            >
              {error}
            </div>
          )}

          <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: "10px 20px",
                backgroundColor: "#f3f4f6",
                color: "#374151",
                border: "none",
                borderRadius: 6,
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              style={{
                padding: "10px 20px",
                backgroundColor: loading ? "#9ca3af" : transactionType === "payment" ? "#10b981" : "#ef4444",
                color: "white",
                border: "none",
                borderRadius: 6,
                fontSize: 14,
                fontWeight: 600,
                cursor: loading ? "not-allowed" : "pointer",
              }}
            >
              {loading ? "Saving..." : transactionType === "payment" ? "Record Payment" : "Add Debt"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
