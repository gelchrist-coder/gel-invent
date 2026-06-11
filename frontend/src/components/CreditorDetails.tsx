import { API_BASE, buildAuthHeaders, resilientFetch } from "../api";
import { useCallback, useEffect, useState } from "react";

interface Transaction {
  id: number;
  creditor_id: number;
  sale_id: number | null;
  amount: number;
  transaction_type: "debt" | "payment";
  entry_type?: "purchase" | "debt" | "payment";
  notes: string | null;
  created_at: string;
  sale_amount?: number;
  sale_total?: number | null;
  sale_quantity?: number | null;
  running_balance?: number;
}

interface Creditor {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  total_debt: number;
  actual_debt?: number;
  total_purchases?: number;
  total_payments?: number;
  transaction_count?: number;
  loyalty_level?: "Bronze" | "Silver" | "Gold" | "VIP";
  created_at?: string;
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
  const [typeFilter, setTypeFilter] = useState<"all" | "purchase" | "payment">("all");
  const [searchTerm, setSearchTerm] = useState("");

  const fetchTransactions = useCallback(async () => {
    try {
      setLoading(true);
      const response = await resilientFetch(`${API_BASE}/creditors/${creditor.id}/transactions`, {
        headers: buildAuthHeaders(),
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

  const outstanding = Math.max(0, actualDebt);
  const creditBalance = Math.max(0, -actualDebt);
  const loyaltyLevel =
    (creditor.loyalty_level as "Bronze" | "Silver" | "Gold" | "VIP" | undefined) ||
    ((totalDebt >= 5000 || transactions.length >= 20) && outstanding <= 0
      ? "VIP"
      : totalDebt >= 2000 || transactions.length >= 12
        ? "Gold"
        : totalDebt >= 800 || transactions.length >= 6
          ? "Silver"
          : "Bronze");

  const filteredTransactions = transactions.filter((t) => {
    const typeMatch =
      typeFilter === "all" ||
      (typeFilter === "payment" && t.transaction_type === "payment") ||
      (typeFilter === "purchase" && t.transaction_type === "debt");
    if (!typeMatch) return false;

    const q = searchTerm.trim().toLowerCase();
    if (!q) return true;
    return (
      (t.notes || "").toLowerCase().includes(q) ||
      String(t.id).includes(q) ||
      (t.sale_id ? String(t.sale_id).includes(q) : false)
    );
  });

  const buildStatementHtml = () => {
    const rows = transactions
      .slice()
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      .map((t) => {
        const date = formatDate(t.created_at);
        const entry = t.transaction_type === "payment" ? "Payment" : "Purchase";
        const amount = formatCurrency(t.amount);
        const balance = t.running_balance != null ? formatCurrency(t.running_balance) : "-";
        const meta = t.sale_id ? `Sale #${t.sale_id}` : "Manual";
        return `
          <tr>
            <td>${date}</td>
            <td>${entry}</td>
            <td>${meta}</td>
            <td style="text-align:right">${amount}</td>
            <td style="text-align:right">${balance}</td>
            <td>${(t.notes || "-").replace(/</g, "&lt;")}</td>
          </tr>
        `;
      })
      .join("");

    return `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Customer Statement - ${creditor.name}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 20px; color: #1f2937; }
            h1 { margin: 0 0 4px; font-size: 20px; }
            .muted { color: #6b7280; font-size: 13px; }
            .summary { margin: 16px 0; padding: 12px; background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 8px; }
            table { width: 100%; border-collapse: collapse; margin-top: 16px; }
            th, td { border-bottom: 1px solid #e5e7eb; padding: 8px; text-align: left; font-size: 12px; }
            th { background: #f9fafb; text-transform: uppercase; color: #6b7280; font-size: 11px; }
            @media print { body { padding: 0; } }
          </style>
        </head>
        <body>
          <h1>Customer Statement</h1>
          <p class="muted">Customer: ${creditor.name}</p>
          <p class="muted">Generated: ${new Date().toLocaleString()}</p>
          <div class="summary">
            <strong>Total Purchases:</strong> ${formatCurrency(totalDebt)}<br />
            <strong>Total Payments:</strong> ${formatCurrency(totalPayments)}<br />
            <strong>${actualDebt >= 0 ? "Outstanding" : "Credit Balance"}:</strong> ${formatCurrency(actualDebt >= 0 ? outstanding : creditBalance)}<br />
            <strong>Loyalty Level:</strong> ${loyaltyLevel}
          </div>
          <table>
            <thead>
              <tr>
                <th>Date</th><th>Type</th><th>Reference</th><th style="text-align:right">Amount</th><th style="text-align:right">Balance</th><th>Notes</th>
              </tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>
        </body>
      </html>
    `;
  };

  const printStatement = () => {
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(buildStatementHtml());
    w.document.close();
    w.focus();
    w.print();
  };

  const downloadStatement = () => {
    const blob = new Blob([buildStatementHtml()], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${creditor.name.replace(/\s+/g, "_").toLowerCase()}_statement.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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
              {creditor.phone && <p style={{ margin: "4px 0", fontSize: 14, color: "#6b7280" }}>{creditor.phone}</p>}
              {creditor.email && <p style={{ margin: "4px 0", fontSize: 14, color: "#6b7280" }}>{creditor.email}</p>}
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
            X
          </button>
        </div>

        {/* Summary Cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16, marginBottom: 24 }}>
          <div style={{ backgroundColor: "#fee2e2", borderRadius: 8, padding: 16 }}>
            <p style={{ margin: 0, fontSize: 13, color: "#991b1b" }}>Total Purchases on Credit</p>
            <p style={{ margin: "8px 0 0", fontSize: 24, fontWeight: 700, color: "#dc2626" }}>
              {formatCurrency(totalDebt)}
            </p>
          </div>
          <div style={{ backgroundColor: "#d1fae5", borderRadius: 8, padding: 16 }}>
            <p style={{ margin: 0, fontSize: 13, color: "#065f46" }}>Total Paid by Customer</p>
            <p style={{ margin: "8px 0 0", fontSize: 24, fontWeight: 700, color: "#059669" }}>
              {formatCurrency(totalPayments)}
            </p>
          </div>
          <div style={{ backgroundColor: actualDebt >= 0 ? "#fef3c7" : "#e0e7ff", borderRadius: 8, padding: 16 }}>
            <p style={{ margin: 0, fontSize: 13, color: actualDebt >= 0 ? "#92400e" : "#3730a3" }}>
              {actualDebt >= 0 ? "Outstanding" : "Credit Balance"}
            </p>
            <p style={{ margin: "8px 0 0", fontSize: 24, fontWeight: 700, color: actualDebt >= 0 ? "#f59e0b" : "#6366f1" }}>
              {formatCurrency(actualDebt >= 0 ? outstanding : creditBalance)}
            </p>
          </div>
          <div style={{ backgroundColor: "#ecfeff", borderRadius: 8, padding: 16 }}>
            <p style={{ margin: 0, fontSize: 13, color: "#155e75" }}>Loyalty Level</p>
            <p style={{ margin: "8px 0 0", fontSize: 24, fontWeight: 700, color: "#0f766e" }}>
              {loyaltyLevel}
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
            Record Payment
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
            Record Sale
          </button>
          <button
            onClick={printStatement}
            style={{
              padding: "10px 20px",
              backgroundColor: "#111827",
              color: "white",
              border: "none",
              borderRadius: 6,
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Print Statement
          </button>
          <button
            onClick={downloadStatement}
            style={{
              padding: "10px 20px",
              backgroundColor: "#374151",
              color: "white",
              border: "none",
              borderRadius: 6,
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Download Statement
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
            Edit Info
          </button>
        </div>

        {/* Transactions History */}
        <div>
          <h3 style={{ margin: "0 0 16px", fontSize: 18, fontWeight: 700 }}>Customer Ledger</h3>
          <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search notes, sale ID, reference"
              style={{ padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: 6, minWidth: 220, fontSize: 13 }}
            />
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as "all" | "purchase" | "payment")}
              style={{ padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 13 }}
            >
              <option value="all">All Entries</option>
              <option value="purchase">Purchases</option>
              <option value="payment">Payments</option>
            </select>
          </div>
          
          {loading ? (
            <p style={{ textAlign: "center", color: "#6b7280", padding: 40 }}>Loading transactions...</p>
          ) : filteredTransactions.length === 0 ? (
            <div style={{ backgroundColor: "#f9fafb", borderRadius: 8, padding: 40, textAlign: "center" }}>
              <p style={{ margin: 0, color: "#6b7280" }}>No customer transactions yet.</p>
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
                    <th style={{ padding: "12px 16px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#6b7280", textTransform: "uppercase" }}>
                      Reference
                    </th>
                    <th style={{ padding: "12px 16px", textAlign: "right", fontSize: 12, fontWeight: 600, color: "#6b7280", textTransform: "uppercase" }}>
                      Amount
                    </th>
                    <th style={{ padding: "12px 16px", textAlign: "right", fontSize: 12, fontWeight: 600, color: "#6b7280", textTransform: "uppercase" }}>
                      Balance
                    </th>
                    <th style={{ padding: "12px 16px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#6b7280", textTransform: "uppercase" }}>
                      Notes
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTransactions.map((transaction) => (
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
                          {transaction.transaction_type === "debt" ? "Purchase" : "Payment"}
                        </span>
                      </td>
                      <td style={{ padding: "12px 16px", fontSize: 13, color: "#6b7280" }}>
                        {transaction.sale_id ? `Sale #${transaction.sale_id}` : "Manual"}
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
                      <td style={{ padding: "12px 16px", textAlign: "right", fontSize: 13, fontWeight: 600, color: "#334155" }}>
                        {transaction.running_balance != null ? formatCurrency(transaction.running_balance) : "-"}
                      </td>
                      <td style={{ padding: "12px 16px", fontSize: 13, color: "#6b7280" }}>
                        {transaction.notes || "—"}
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

interface SaleLineItem {
  id: string;
  productId: string;
  quantity: string;
}

function DebtModal({ creditorId, creditorName, onClose, onSuccess }: DebtModalProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [lineItems, setLineItems] = useState<SaleLineItem[]>([
    { id: `line-${Date.now()}`, productId: "", quantity: "" },
  ]);
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
      const response = await resilientFetch(`${API_BASE}/products/`, { headers: buildAuthHeaders() });
      if (response.ok) {
        const data = (await response.json()) as Array<Record<string, unknown>>;
        const mapped: Product[] = (Array.isArray(data) ? data : []).map((p) => {
          const id = Number(p.id);
          const name = String(p.name ?? "");
          const price = Number((p.selling_price ?? p.price ?? 0) as unknown);
          const quantity_in_stock = Number((p.current_stock ?? p.quantity_in_stock ?? 0) as unknown);
          return {
            id,
            name,
            price: Number.isFinite(price) ? price : 0,
            quantity_in_stock: Number.isFinite(quantity_in_stock) ? quantity_in_stock : 0,
          };
        });
        setProducts(mapped);
      }
    } catch (error) {
      console.error("Error fetching products:", error);
    } finally {
      setLoadingProducts(false);
    }
  };

  const parsedLines = lineItems.map((line) => {
    const product = products.find((p) => p.id === Number.parseInt(line.productId, 10));
    const quantityNum = Number.parseFloat(line.quantity || "0");
    const subtotal = product ? product.price * quantityNum : 0;
    return {
      ...line,
      product,
      quantityNum: Number.isFinite(quantityNum) ? quantityNum : 0,
      subtotal,
    };
  });

  const totalAmount = parsedLines.reduce((sum, line) => sum + line.subtotal, 0);
  const initialPaymentNum = parseFloat(initialPayment || "0");
  const creditAmount = totalAmount - initialPaymentNum;

  const addLineItem = () => {
    setLineItems((prev) => [
      ...prev,
      { id: `line-${Date.now()}-${prev.length}`, productId: "", quantity: "" },
    ]);
  };

  const updateLineItem = (id: string, patch: Partial<SaleLineItem>) => {
    setLineItems((prev) => prev.map((line) => (line.id === id ? { ...line, ...patch } : line)));
  };

  const removeLineItem = (id: string) => {
    setLineItems((prev) => {
      if (prev.length <= 1) {
        return prev;
      }
      return prev.filter((line) => line.id !== id);
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const validLines = parsedLines.filter((line) => line.product && line.quantityNum > 0);

    if (validLines.length === 0) {
      setError("Please add at least one product with a valid quantity");
      return;
    }

    if (parsedLines.some((line) => line.productId && line.quantityNum <= 0)) {
      setError("Please enter valid quantities for all selected products");
      return;
    }

    const quantitiesByProduct = new Map<number, number>();
    for (const line of validLines) {
      const productId = line.product!.id;
      const current = quantitiesByProduct.get(productId) ?? 0;
      quantitiesByProduct.set(productId, current + line.quantityNum);
    }

    for (const [productId, requestedQty] of quantitiesByProduct.entries()) {
      const product = products.find((p) => p.id === productId);
      if (product && requestedQty > product.quantity_in_stock) {
        setError(`Only ${product.quantity_in_stock} units available for ${product.name}`);
        return;
      }
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
      // Record all lines as credit sales so debt entries are generated consistently.
      const salesPayload = validLines.map((line) => ({
        product_id: line.product!.id,
        quantity: line.quantityNum,
        unit_price: line.product!.price,
        total_price: line.subtotal,
        customer_name: creditorName,
        payment_method: "credit",
        notes: notes.trim() || null,
      }));

      const response = await resilientFetch(`${API_BASE}/sales/bulk`, {
        method: "POST",
        headers: buildAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(salesPayload),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || "Failed to record sale");
      }

      // Apply upfront payment once against the creditor ledger for the full invoice.
      if (initialPaymentNum > 0) {
        const paymentResponse = await resilientFetch(`${API_BASE}/creditors/transactions`, {
          method: "POST",
          headers: buildAuthHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({
            creditor_id: creditorId,
            amount: initialPaymentNum,
            transaction_type: "payment",
            notes:
              notes.trim() ||
              `Initial payment for multi-product credit sale (${validLines.length} item${validLines.length === 1 ? "" : "s"})`,
          }),
        });

        if (!paymentResponse.ok) {
          throw new Error("Sales were recorded, but initial payment could not be saved. Please record payment manually.");
        }
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
          maxWidth: 620,
          maxHeight: "90vh",
          overflow: "auto",
          padding: 24,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ margin: "0 0 16px", fontSize: 18, fontWeight: 700 }}>
          Add Credit Sale
        </h3>
        <p style={{ margin: "0 0 20px", fontSize: 14, color: "#6b7280" }}>
          Record a new credit purchase for <strong>{creditorName}</strong>
        </p>

        <form onSubmit={handleSubmit}>
          {/* Product Lines */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", marginBottom: 8, fontSize: 14, fontWeight: 500 }}>
              Products <span style={{ color: "#ef4444" }}>*</span>
            </label>

            {loadingProducts ? (
              <p style={{ fontSize: 14, color: "#6b7280" }}>Loading products...</p>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {parsedLines.map((line, index) => (
                  <div
                    key={line.id}
                    style={{
                      border: "1px solid #e5e7eb",
                      borderRadius: 8,
                      padding: 10,
                      backgroundColor: "#fafafa",
                    }}
                  >
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 130px auto", gap: 8, alignItems: "end" }}>
                      <div>
                        <label style={{ display: "block", marginBottom: 4, fontSize: 12, color: "#4b5563" }}>Product</label>
                        <select
                          value={line.productId}
                          onChange={(e) => updateLineItem(line.id, { productId: e.target.value })}
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
                      </div>

                      <div>
                        <label style={{ display: "block", marginBottom: 4, fontSize: 12, color: "#4b5563" }}>Quantity</label>
                        <input
                          type="number"
                          step="0.01"
                          value={line.quantity}
                          onChange={(e) => updateLineItem(line.id, { quantity: e.target.value })}
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

                      <button
                        type="button"
                        onClick={() => removeLineItem(line.id)}
                        disabled={lineItems.length === 1}
                        style={{
                          padding: "10px 12px",
                          backgroundColor: lineItems.length === 1 ? "#e5e7eb" : "#fee2e2",
                          color: lineItems.length === 1 ? "#6b7280" : "#b91c1c",
                          border: "none",
                          borderRadius: 6,
                          fontSize: 13,
                          fontWeight: 600,
                          cursor: lineItems.length === 1 ? "not-allowed" : "pointer",
                        }}
                      >
                        Remove
                      </button>
                    </div>

                    <p style={{ margin: "8px 0 0", fontSize: 12, color: "#6b7280" }}>
                      Line {index + 1}: GHS {line.subtotal.toFixed(2)}
                    </p>
                  </div>
                ))}

                <button
                  type="button"
                  onClick={addLineItem}
                  style={{
                    padding: "10px 14px",
                    backgroundColor: "#eff6ff",
                    color: "#1d4ed8",
                    border: "1px solid #bfdbfe",
                    borderRadius: 6,
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: "pointer",
                    justifySelf: "start",
                  }}
                >
                  + Add Another Product
                </button>
              </div>
            )}
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
              {loading ? "Recording Sale..." : "Add Credit Sale"}
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
      const response = await resilientFetch(`${API_BASE}/creditors/transactions`, {
        method: "POST",
        headers: buildAuthHeaders({ "Content-Type": "application/json" }),
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
          {transactionType === "payment" ? "Record Payment" : "Add Credit Sale"}
        </h3>
        <p style={{ margin: "0 0 20px", fontSize: 14, color: "#6b7280" }}>
          {transactionType === "payment" ? "Record a payment from" : "Add a credit entry for"} <strong>{creditorName}</strong>
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
              {loading ? "Saving..." : transactionType === "payment" ? "Record Payment" : "Add Credit Sale"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
