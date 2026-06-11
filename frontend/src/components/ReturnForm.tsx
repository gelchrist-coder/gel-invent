import { useState, useEffect } from "react";
import { Sale, Product } from "../types";
import { createSaleReturn, SaleReturn, fetchReturnsForSale } from "../api";

type ReturnFormProps = {
  sale: Sale;
  product: Product | undefined;
  onClose: () => void;
  onSuccess: () => void;
};

export default function ReturnForm({ sale, product, onClose, onSuccess }: ReturnFormProps) {
  const [quantityReturned, setQuantityReturned] = useState(1);
  const [refundAmount, setRefundAmount] = useState(sale.unit_price);
  const [refundMethod, setRefundMethod] = useState<"cash" | "credit_to_account" | "store_credit" | "no_refund">(
    sale.payment_method === "credit" ? "credit_to_account" : "cash"
  );
  const [reasonCategory, setReasonCategory] = useState("");
  const [reasonDetails, setReasonDetails] = useState("");
  const [restock, setRestock] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [existingReturns, setExistingReturns] = useState<SaleReturn[]>([]);
  const [loadingReturns, setLoadingReturns] = useState(true);

  // Reason categories - separate restockable and non-restockable
  const RESTOCKABLE_REASONS = [
    { value: "wrong_item", label: "Wrong Item Delivered" },
    { value: "wrong_size", label: "Wrong Size/Specification" },
    { value: "changed_mind", label: "Customer Changed Mind" },
    { value: "exchange", label: "Exchange for Other Product" },
    { value: "other", label: "Other" },
  ];
  
  const NON_RESTOCKABLE_REASONS = [
    { value: "damaged", label: "Damaged (Record as Loss)" },
    { value: "expired", label: "Expired (Record as Loss)" },
    { value: "defective", label: "Defective (Record as Loss)" },
  ];
  
  const REASON_CATEGORIES = [...RESTOCKABLE_REASONS, ...NON_RESTOCKABLE_REASONS];
  
  // Check if current reason is a loss reason (non-restockable)
  const isLossReason = NON_RESTOCKABLE_REASONS.some(r => r.value === reasonCategory);

  // Calculate max quantity that can be returned
  const totalReturned = existingReturns.reduce((sum, r) => sum + r.quantity_returned, 0);
  const maxQuantity = sale.quantity - totalReturned;

  useEffect(() => {
    // Fetch existing returns for this sale
    fetchReturnsForSale(sale.id)
      .then((returns) => {
        setExistingReturns(returns);
        setLoadingReturns(false);
      })
      .catch((err) => {
        console.error("Failed to fetch existing returns:", err);
        setLoadingReturns(false);
      });
  }, [sale.id]);

  // Update refund amount when quantity changes
  useEffect(() => {
    setRefundAmount(sale.unit_price * quantityReturned);
  }, [quantityReturned, sale.unit_price]);

  // Update max quantity when returns load
  useEffect(() => {
    if (quantityReturned > maxQuantity && maxQuantity > 0) {
      setQuantityReturned(maxQuantity);
    }
  }, [maxQuantity, quantityReturned]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (quantityReturned <= 0) {
      setError("Quantity must be at least 1");
      return;
    }
    
    if (quantityReturned > maxQuantity) {
      setError(`Cannot return more than ${maxQuantity} items`);
      return;
    }

    if (refundAmount < 0) {
      setError("Refund amount cannot be negative");
      return;
    }

    if (!reasonCategory) {
      setError("Please select a reason for the return");
      return;
    }

    if (reasonCategory === "other" && !reasonDetails.trim()) {
      setError("Please provide details for 'Other' reason");
      return;
    }

    // Build the full reason string
    const selectedReason = REASON_CATEGORIES.find(r => r.value === reasonCategory);
    const fullReason = reasonCategory === "other" 
      ? reasonDetails.trim()
      : reasonDetails.trim() 
        ? `${selectedReason?.label}: ${reasonDetails.trim()}`
        : selectedReason?.label || "";

    // For loss reasons, never restock
    const shouldRestock = isLossReason ? false : restock;

    setLoading(true);
    setError("");

    try {
      await createSaleReturn({
        sale_id: sale.id,
        quantity_returned: quantityReturned,
        refund_amount: refundMethod === "no_refund" ? 0 : refundAmount,
        refund_method: refundMethod === "no_refund" ? "exchange" : refundMethod,
        reason: fullReason,
        restock: shouldRestock,
      });
      onSuccess();
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to process return");
      setLoading(false);
    }
  };

  if (loadingReturns) {
    return (
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
      >
        <div
          style={{
            backgroundColor: "white",
            padding: 24,
            borderRadius: 8,
            maxWidth: 500,
            width: "90%",
          }}
        >
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  if (maxQuantity <= 0) {
    return (
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
        onClick={onClose}
      >
        <div
          style={{
            backgroundColor: "white",
            padding: 24,
            borderRadius: 8,
            maxWidth: 500,
            width: "90%",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <h3 style={{ margin: "0 0 16px 0", color: "#dc2626" }}>All Items Already Returned</h3>
          <p style={{ margin: "0 0 16px 0", color: "#6b7280" }}>
            All {sale.quantity} items from this sale have already been returned.
          </p>
          <button
            onClick={onClose}
            style={{
              width: "100%",
              padding: "10px 16px",
              borderRadius: 4,
              border: "1px solid #ddd",
              backgroundColor: "white",
              cursor: "pointer",
            }}
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
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
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: "white",
          padding: 24,
          borderRadius: 8,
          maxWidth: 500,
          width: "90%",
          maxHeight: "90vh",
          overflowY: "auto",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ margin: "0 0 8px 0" }}>Process Return</h3>
        
        {/* Sale Info */}
        <div
          style={{
            padding: 12,
            backgroundColor: "#f9fafb",
            borderRadius: 6,
            marginBottom: 16,
          }}
        >
          <p style={{ margin: "0 0 4px 0", fontWeight: 600 }}>
            {product?.name || `Product #${sale.product_id}`}
          </p>
          <p style={{ margin: 0, fontSize: "0.875rem", color: "#6b7280" }}>
            Original sale: {sale.quantity} × GHS {Number(sale.unit_price).toFixed(2)} = GHS {Number(sale.total_price).toFixed(2)}
          </p>
          {totalReturned > 0 && (
            <p style={{ margin: "4px 0 0 0", fontSize: "0.875rem", color: "#dc2626" }}>
              Already returned: {totalReturned} items
            </p>
          )}
        </div>

        {error && (
          <div
            style={{
              padding: 12,
              backgroundColor: "#fee2e2",
              color: "#dc2626",
              borderRadius: 6,
              marginBottom: 16,
              fontSize: "0.875rem",
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", marginBottom: 6, fontWeight: 500 }}>
              Quantity to Return (max: {maxQuantity})
            </label>
            <input
              type="number"
              min={1}
              max={maxQuantity}
              value={quantityReturned}
              onChange={(e) => setQuantityReturned(Math.min(Number(e.target.value), maxQuantity))}
              style={{
                width: "100%",
                padding: 10,
                borderRadius: 4,
                border: "1px solid #ddd",
                boxSizing: "border-box",
              }}
            />
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", marginBottom: 6, fontWeight: 500 }}>
              Refund Amount (GHS)
            </label>
            <input
              type="number"
              step="0.01"
              min={0}
              value={refundAmount}
              onChange={(e) => setRefundAmount(Number(e.target.value))}
              style={{
                width: "100%",
                padding: 10,
                borderRadius: 4,
                border: "1px solid #ddd",
                boxSizing: "border-box",
              }}
            />
            <p style={{ margin: "4px 0 0 0", fontSize: "0.75rem", color: "#6b7280" }}>
              Suggested: GHS {(sale.unit_price * quantityReturned).toFixed(2)} (based on unit price)
            </p>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", marginBottom: 6, fontWeight: 500 }}>
              Reason for Return
            </label>
            <select
              value={reasonCategory}
              onChange={(e) => {
                const newReason = e.target.value;
                setReasonCategory(newReason);
                // Auto-set no refund for exchanges
                if (newReason === "exchange") {
                  setRefundMethod("no_refund");
                } else if (refundMethod === "no_refund" && newReason !== "exchange") {
                  setRefundMethod(sale.payment_method === "credit" ? "credit_to_account" : "cash");
                }
                // Auto-uncheck restock for loss reasons
                const isLoss = NON_RESTOCKABLE_REASONS.some(r => r.value === newReason);
                if (isLoss) {
                  setRestock(false);
                }
              }}
              style={{
                width: "100%",
                padding: 10,
                borderRadius: 4,
                border: "1px solid #ddd",
                boxSizing: "border-box",
              }}
            >
              <option value="">-- Select a reason --</option>
              <optgroup label="Restockable Returns">
                {RESTOCKABLE_REASONS.map((cat) => (
                  <option key={cat.value} value={cat.value}>
                    {cat.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Loss/Damage (Not Restockable)">
                {NON_RESTOCKABLE_REASONS.map((cat) => (
                  <option key={cat.value} value={cat.value}>
                    {cat.label}
                  </option>
                ))}
              </optgroup>
            </select>
            {isLossReason && (
              <p style={{ margin: "6px 0 0 0", fontSize: "0.75rem", color: "#dc2626", fontWeight: 500 }}>
                This will be recorded as a loss and will NOT be restocked
              </p>
            )}
          </div>

          {reasonCategory && (
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", marginBottom: 6, fontWeight: 500 }}>
                {reasonCategory === "other" ? "Please specify" : "Additional Details (optional)"}
              </label>
              <textarea
                value={reasonDetails}
                onChange={(e) => setReasonDetails(e.target.value)}
                placeholder={reasonCategory === "other" ? "Please describe the reason..." : "Any additional details..."}
                rows={2}
                style={{
                  width: "100%",
                  padding: 10,
                  borderRadius: 4,
                  border: "1px solid #ddd",
                  boxSizing: "border-box",
                  resize: "vertical",
                }}
              />
            </div>
          )}

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", marginBottom: 6, fontWeight: 500 }}>
              Refund Method
            </label>
            <select
              value={refundMethod}
              onChange={(e) => setRefundMethod(e.target.value as any)}
              style={{
                width: "100%",
                padding: 10,
                borderRadius: 4,
                border: "1px solid #ddd",
                boxSizing: "border-box",
              }}
            >
              <option value="cash">Cash Refund</option>
              <option value="credit_to_account">Credit to Account (reduce debt)</option>
              <option value="store_credit">Store Credit</option>
              <option value="no_refund">No Refund (Exchange Only)</option>
            </select>
            {sale.payment_method === "credit" && refundMethod === "credit_to_account" && (
              <p style={{ margin: "4px 0 0 0", fontSize: "0.75rem", color: "#059669" }}>
                This will reduce the customer's outstanding debt
              </p>
            )}
            {refundMethod === "no_refund" && (
              <p style={{ margin: "4px 0 0 0", fontSize: "0.75rem", color: "#f59e0b" }}>
                Customer will exchange for another product of equal or greater value
              </p>
            )}
          </div>

          {!isLossReason && (
            <div style={{ marginBottom: 20 }}>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={restock}
                  onChange={(e) => setRestock(e.target.checked)}
                  style={{ width: 18, height: 18 }}
                />
                <span>
                  <span style={{ fontWeight: 500 }}>Return items to inventory</span>
                  <span style={{ display: "block", fontSize: "0.75rem", color: "#6b7280" }}>
                    Uncheck if items cannot be resold
                  </span>
                </span>
              </label>
            </div>
          )}

          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              style={{
                flex: 1,
                padding: "10px 16px",
                borderRadius: 4,
                border: "1px solid #ddd",
                backgroundColor: "white",
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              style={{
                flex: 1,
                padding: "10px 16px",
                borderRadius: 4,
                border: "none",
                backgroundColor: "#f59e0b",
                color: "white",
                cursor: loading ? "not-allowed" : "pointer",
                opacity: loading ? 0.7 : 1,
              }}
            >
              {loading ? "Processing..." : "Process Return"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
