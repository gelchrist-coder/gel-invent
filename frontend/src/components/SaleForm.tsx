import { API_BASE } from "../api";
import { useState, useEffect } from "react";
import { NewSale, Product } from "../types";

type SaleFormProps = {
  products: Product[];
  onSubmit: (sale: NewSale) => void;
  onCancel?: () => void;
};

interface Creditor {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  total_debt: number;
  actual_debt: number;
}

const PAYMENT_METHODS = ["cash", "card", "mobile money", "bank transfer", "credit", "partial"];

export default function SaleForm({ products, onSubmit, onCancel }: SaleFormProps) {
  const [form, setForm] = useState({
    product_id: 0,
    quantity: "",
    unit_price: "",
    total_price: "",
    customer_name: "",
    payment_method: "cash",
    notes: "",
  });
  const [showCreditorModal, setShowCreditorModal] = useState(false);
  const [selectedCreditor, setSelectedCreditor] = useState<Creditor | null>(null);
  const [amountPaid, setAmountPaid] = useState("");
  const [partialPaymentMethod, setPartialPaymentMethod] = useState("cash");
  const [saleUnitType, setSaleUnitType] = useState<"piece" | "pack">("piece");
  const [packQuantity, setPackQuantity] = useState("");

  // Auto-fill unit price from selected product based on sale unit type
  useEffect(() => {
    const product = products.find((p) => p.id === form.product_id);
    if (product) {
      // Use pack selling price when selling by pack, otherwise use piece price
      if (saleUnitType === "pack" && product.pack_selling_price) {
        setForm((prev) => ({ ...prev, unit_price: product.pack_selling_price!.toString() }));
      } else if (product.selling_price) {
        setForm((prev) => ({ ...prev, unit_price: product.selling_price!.toString() }));
      }
    }
  }, [form.product_id, products, saleUnitType]);

  // Auto-calculate quantity when selling by pack
  useEffect(() => {
    const product = products.find((p) => p.id === form.product_id);
    if (saleUnitType === "pack" && product?.pack_size && packQuantity) {
      const totalQty = Number(packQuantity) * product.pack_size;
      setForm((prev) => ({ ...prev, quantity: totalQty.toString() }));
    }
  }, [saleUnitType, packQuantity, form.product_id, products]);

  // Auto-calculate total price
  useEffect(() => {
    const price = Number(form.unit_price);
    if (price >= 0) {
      let total = 0;
      if (saleUnitType === "pack") {
        // For pack sales: number of packs × pack price
        const packs = Number(packQuantity);
        if (packs > 0) {
          total = packs * price;
        }
      } else {
        // For piece sales: quantity × piece price
        const qty = Number(form.quantity);
        if (qty > 0) {
          total = qty * price;
        }
      }
      setForm((prev) => ({ ...prev, total_price: total.toFixed(2) }));
    }
  }, [form.quantity, form.unit_price, saleUnitType, packQuantity]);

  const handleUnitTypeChange = (type: "piece" | "pack") => {
    setSaleUnitType(type);
    if (type === "piece") {
      setPackQuantity("");
      setForm({ ...form, quantity: "" });
    }
  };

  const handlePaymentMethodChange = (method: string) => {
    setForm({ ...form, payment_method: method });
    
    // Show creditor modal when credit or partial is selected
    if (method === "credit" || method === "partial") {
      setShowCreditorModal(true);
    } else {
      setSelectedCreditor(null);
      setAmountPaid("");
    }
  };

  const handleCreditorSelect = (creditor: Creditor) => {
    setSelectedCreditor(creditor);
    setForm({ ...form, customer_name: creditor.name });
    setShowCreditorModal(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!form.product_id || !form.quantity || !form.unit_price) {
      alert("Please fill in all required fields");
      return;
    }

    // If payment method is credit or partial, require creditor selection
    if ((form.payment_method === "credit" || form.payment_method === "partial") && !selectedCreditor) {
      alert("Please select a creditor for credit sales");
      setShowCreditorModal(true);
      return;
    }

    // Validate partial payment
    if (form.payment_method === "partial") {
      const paid = Number(amountPaid);
      const total = Number(form.total_price);
      
      if (!amountPaid || paid <= 0) {
        alert("Please enter the amount paid");
        return;
      }
      
      if (paid >= total) {
        alert("Amount paid should be less than total price. Use regular payment method if paying in full.");
        return;
      }
    }

    const product = products.find(p => p.id === form.product_id);
    if (!product) return;

    const quantity = saleUnitType === "pack" && packQuantity 
      ? Number(packQuantity) * (product.pack_size || 1)
      : Number(form.quantity);

    const sale: NewSale = {
      product_id: form.product_id,
      quantity,
      unit_price: Number(form.unit_price),
      total_price: Number(form.total_price),
      customer_name: form.customer_name || null,
      payment_method: form.payment_method,
      notes: form.notes || null,
      amount_paid: form.payment_method === "partial" ? Number(amountPaid) : undefined,
      partial_payment_method: form.payment_method === "partial" ? partialPaymentMethod : undefined,
    };

    onSubmit(sale);

    // Reset form
    setForm({
      product_id: 0,
      quantity: "",
      unit_price: "",
      total_price: "",
      customer_name: "",
      payment_method: "cash",
      notes: "",
    });
    setSelectedCreditor(null);
    setAmountPaid("");
    setPartialPaymentMethod("cash");
    setSaleUnitType("piece");
    setPackQuantity("");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h3 style={{ margin: 0 }}>New Sale</h3>

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        Product *
        <select
          value={form.product_id}
          onChange={(e) => setForm({ ...form, product_id: Number(e.target.value) })}
          style={{ padding: 8, borderRadius: 4, border: "1px solid #ddd" }}
        >
          <option value={0}>Select a product...</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.sku}) - {p.selling_price ? `GHS ${p.selling_price}` : "No price"}
            </option>
          ))}
        </select>
      </label>

      {/* Unit Type Selector */}
      {products.find((p) => p.id === form.product_id)?.pack_size && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 12 }}>
          <label style={{ fontSize: 14, fontWeight: 600 }}>Sale Unit Type</label>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={() => handleUnitTypeChange("piece")}
              style={{
                flex: 1,
                padding: 8,
                borderRadius: 4,
                border: saleUnitType === "piece" ? "2px solid #1f7aff" : "1px solid #ddd",
                background: saleUnitType === "piece" ? "#eff6ff" : "white",
                cursor: "pointer",
                fontWeight: saleUnitType === "piece" ? 600 : 400,
              }}
            >
              By Piece
            </button>
            <button
              type="button"
              onClick={() => handleUnitTypeChange("pack")}
              style={{
                flex: 1,
                padding: 8,
                borderRadius: 4,
                border: saleUnitType === "pack" ? "2px solid #1f7aff" : "1px solid #ddd",
                background: saleUnitType === "pack" ? "#eff6ff" : "white",
                cursor: "pointer",
                fontWeight: saleUnitType === "pack" ? 600 : 400,
              }}
            >
              By Pack ({products.find((p) => p.id === form.product_id)?.pack_size} pcs)
            </button>
          </div>
        </div>
      )}

      {/* Quantity Input */}
      {saleUnitType === "pack" ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            Number of Packs *
            <input
              type="number"
              step="1"
              min="1"
              value={packQuantity}
              onChange={(e) => setPackQuantity(e.target.value)}
              required
              placeholder="e.g., 2"
              style={{ padding: 8, borderRadius: 4, border: "1px solid #ddd" }}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            Total Pieces
            <input
              type="number"
              value={form.quantity}
              readOnly
              style={{
                padding: 8,
                borderRadius: 4,
                border: "1px solid #ddd",
                backgroundColor: "#f5f5f5",
              }}
            />
          </label>
        </div>
      ) : (
        <label style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 12 }}>
          Quantity (pieces) *
          <input
            type="number"
            step="0.01"
            min="0.01"
            value={form.quantity}
            onChange={(e) => setForm({ ...form, quantity: e.target.value })}
            style={{ padding: 8, borderRadius: 4, border: "1px solid #ddd" }}
          />
        </label>
      )}

      <label style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 12 }}>
        Unit Price * {saleUnitType === "pack" ? "(per pack)" : "(per piece)"}
        <input
          type="number"
          step="0.01"
          min="0"
          value={form.unit_price}
          onChange={(e) => setForm({ ...form, unit_price: e.target.value })}
          style={{ padding: 8, borderRadius: 4, border: "1px solid #ddd" }}
        />
        {saleUnitType === "pack" && products.find((p) => p.id === form.product_id)?.pack_size && (
          <small style={{ color: "#6b7280", fontSize: 12 }}>
            Per pack of {products.find((p) => p.id === form.product_id)?.pack_size} pieces
          </small>
        )}
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        Customer Name
        <input
          type="text"
          maxLength={255}
          value={form.customer_name}
          onChange={(e) => setForm({ ...form, customer_name: e.target.value })}
          style={{ padding: 8, borderRadius: 4, border: "1px solid #ddd" }}
        />
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 12 }}>
        Payment Method
        <select
          value={form.payment_method}
          onChange={(e) => handlePaymentMethodChange(e.target.value)}
          style={{ padding: 8, borderRadius: 4, border: "1px solid #ddd" }}
        >
          {PAYMENT_METHODS.map((method) => (
            <option key={method} value={method}>
              {method.charAt(0).toUpperCase() + method.slice(1)}
            </option>
          ))}
        </select>
      </label>

      {/* Show creditor info if credit or partial payment selected */}
      {(form.payment_method === "credit" || form.payment_method === "partial") && (
        <div
          style={{
            padding: 12,
            backgroundColor: "#fef3c7",
            border: "1px solid #fbbf24",
            borderRadius: 6,
          }}
        >
          {selectedCreditor ? (
            <div>
              <p style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 600, color: "#92400e" }}>
                {form.payment_method === "partial" ? "Partial Payment - Credit to:" : "Credit Sale to:"}
              </p>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{selectedCreditor.name}</p>
                  {selectedCreditor.phone && (
                    <p style={{ margin: "4px 0 0", fontSize: 12, color: "#6b7280" }}>
                      📱 {selectedCreditor.phone}
                    </p>
                  )}
                  <p style={{ margin: "4px 0 0", fontSize: 12, color: "#dc2626" }}>
                    Current Debt: GHS {selectedCreditor.actual_debt.toFixed(2)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowCreditorModal(true)}
                  style={{
                    padding: "6px 12px",
                    fontSize: 12,
                    backgroundColor: "#f59e0b",
                    color: "white",
                    border: "none",
                    borderRadius: 4,
                    cursor: "pointer",
                  }}
                >
                  Change
                </button>
              </div>
              
              {/* Partial Payment Details */}
              {form.payment_method === "partial" && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #fbbf24" }}>
                  <p style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 600, color: "#92400e" }}>
                    Payment Details:
                  </p>
                  
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                    <div>
                      <label style={{ fontSize: 12, color: "#6b7280", display: "block", marginBottom: 4 }}>
                        Payment Method
                      </label>
                      <select
                        value={partialPaymentMethod}
                        onChange={(e) => setPartialPaymentMethod(e.target.value)}
                        style={{
                          width: "100%",
                          padding: "6px 8px",
                          border: "1px solid #d1d5db",
                          borderRadius: 4,
                          fontSize: 13,
                        }}
                      >
                        <option value="cash">Cash</option>
                        <option value="card">Card</option>
                        <option value="mobile money">Mobile Money</option>
                        <option value="bank transfer">Bank Transfer</option>
                      </select>
                    </div>
                    
                    <div>
                      <label style={{ fontSize: 12, color: "#6b7280", display: "block", marginBottom: 4 }}>
                        Amount Paid (GHS)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        max={form.total_price}
                        value={amountPaid}
                        onChange={(e) => setAmountPaid(e.target.value)}
                        placeholder="0.00"
                        style={{
                          width: "100%",
                          padding: "6px 8px",
                          border: "1px solid #d1d5db",
                          borderRadius: 4,
                          fontSize: 13,
                        }}
                      />
                    </div>
                  </div>
                  
                  {amountPaid && Number(amountPaid) > 0 && Number(form.total_price) > 0 && (
                    <div style={{ fontSize: 12, color: "#6b7280", padding: 8, backgroundColor: "#fffbeb", borderRadius: 4 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                        <span>Total:</span>
                        <span style={{ fontWeight: 600 }}>GHS {Number(form.total_price).toFixed(2)}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                        <span>Paid ({partialPaymentMethod}):</span>
                        <span style={{ fontWeight: 600, color: "#10b981" }}>GHS {Number(amountPaid).toFixed(2)}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 4, borderTop: "1px solid #fbbf24" }}>
                        <span style={{ fontWeight: 600 }}>Credit Balance:</span>
                        <span style={{ fontWeight: 700, color: "#ef4444" }}>
                          GHS {(Number(form.total_price) - Number(amountPaid)).toFixed(2)}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div style={{ textAlign: "center" }}>
              <p style={{ margin: "0 0 8px", fontSize: 13, color: "#92400e" }}>
                ⚠️ Please select a creditor for this {form.payment_method === "partial" ? "partial payment" : "credit sale"}
              </p>
              <button
                type="button"
                onClick={() => setShowCreditorModal(true)}
                style={{
                  padding: "6px 16px",
                  fontSize: 13,
                  backgroundColor: "#f59e0b",
                  color: "white",
                  border: "none",
                  borderRadius: 4,
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                Select Creditor
              </button>
            </div>
          )}
        </div>
      )}

      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        Notes
        <textarea
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          rows={3}
          style={{ padding: 8, borderRadius: 4, border: "1px solid #ddd", resize: "vertical" }}
          placeholder="Add any notes about this sale..."
        />
      </label>

      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="submit"
          style={{
            flex: 1,
            padding: 12,
            borderRadius: 4,
            border: "none",
            background: "#22c55e",
            color: "white",
            fontSize: 16,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Record Sale
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: 12,
              borderRadius: 4,
              border: "1px solid #ddd",
              background: "white",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
        )}
      </div>
      </form>

      {/* Creditor Selection Modal */}
      {showCreditorModal && (
        <CreditorSelectionModal
          onSelect={handleCreditorSelect}
          onClose={() => setShowCreditorModal(false)}
        />
      )}
    </div>
  );
}

// Creditor Selection Modal Component
interface CreditorSelectionModalProps {
  onSelect: (creditor: Creditor) => void;
  onClose: () => void;
}

function CreditorSelectionModal({ onSelect, onClose }: CreditorSelectionModalProps) {
  const [creditors, setCreditors] = useState<Creditor[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [showNewCreditorForm, setShowNewCreditorForm] = useState(false);

  useEffect(() => {
    fetchCreditors();
  }, []);

  const fetchCreditors = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${API_BASE}/creditors/`);
      const data = await response.json();
      setCreditors(data);
    } catch (error) {
      console.error("Error fetching creditors:", error);
    } finally {
      setLoading(false);
    }
  };

  const filteredCreditors = creditors.filter((c) =>
    c.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleCreateCreditor = async (name: string, phone: string) => {
    try {
      const response = await fetch(`${API_BASE}/creditors/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone: phone || null }),
      });

      if (response.ok) {
        await fetchCreditors();
        setShowNewCreditorForm(false);
      }
    } catch (error) {
      console.error("Error creating creditor:", error);
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
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: "white",
          borderRadius: 8,
          width: "100%",
          maxWidth: 600,
          maxHeight: "80vh",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: 20,
            borderBottom: "1px solid #e5e7eb",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Select Creditor</h3>
          <button
            onClick={onClose}
            style={{
              padding: "4px 8px",
              backgroundColor: "transparent",
              border: "none",
              fontSize: 20,
              cursor: "pointer",
              color: "#6b7280",
            }}
          >
            ✕
          </button>
        </div>

        {/* Search and Add New */}
        <div style={{ padding: 20, borderBottom: "1px solid #e5e7eb" }}>
          <input
            type="text"
            placeholder="Search creditors..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{
              width: "100%",
              padding: "10px 12px",
              border: "1px solid #d1d5db",
              borderRadius: 6,
              fontSize: 14,
              marginBottom: 12,
            }}
          />
          <button
            onClick={() => setShowNewCreditorForm(!showNewCreditorForm)}
            style={{
              padding: "8px 16px",
              backgroundColor: "#10b981",
              color: "white",
              border: "none",
              borderRadius: 6,
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
              width: "100%",
            }}
          >
            + Add New Creditor
          </button>

          {/* Quick Add Form */}
          {showNewCreditorForm && (
            <QuickAddCreditorForm
              onSubmit={handleCreateCreditor}
              onCancel={() => setShowNewCreditorForm(false)}
            />
          )}
        </div>

        {/* Creditors List */}
        <div style={{ flex: 1, overflow: "auto", padding: 20 }}>
          {loading ? (
            <p style={{ textAlign: "center", color: "#6b7280" }}>Loading creditors...</p>
          ) : filteredCreditors.length === 0 ? (
            <p style={{ textAlign: "center", color: "#6b7280" }}>
              {searchTerm ? "No creditors found matching your search." : "No creditors yet. Add one above."}
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {filteredCreditors.map((creditor) => (
                <div
                  key={creditor.id}
                  onClick={() => onSelect(creditor)}
                  style={{
                    padding: 16,
                    border: "1px solid #e5e7eb",
                    borderRadius: 6,
                    cursor: "pointer",
                    transition: "all 0.15s",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = "#f9fafb";
                    e.currentTarget.style.borderColor = "#3b82f6";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = "white";
                    e.currentTarget.style.borderColor = "#e5e7eb";
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
                    <div>
                      <p style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{creditor.name}</p>
                      {creditor.phone && (
                        <p style={{ margin: "4px 0 0", fontSize: 13, color: "#6b7280" }}>
                          📱 {creditor.phone}
                        </p>
                      )}
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>Current Debt</p>
                      <p
                        style={{
                          margin: "4px 0 0",
                          fontSize: 15,
                          fontWeight: 700,
                          color: creditor.actual_debt > 0 ? "#ef4444" : "#10b981",
                        }}
                      >
                        GHS {creditor.actual_debt.toFixed(2)}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Quick Add Creditor Form
interface QuickAddCreditorFormProps {
  onSubmit: (name: string, phone: string) => void;
  onCancel: () => void;
}

function QuickAddCreditorForm({ onSubmit, onCancel }: QuickAddCreditorFormProps) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      onSubmit(name.trim(), phone.trim());
      setName("");
      setPhone("");
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        marginTop: 12,
        padding: 16,
        backgroundColor: "#f9fafb",
        borderRadius: 6,
        border: "1px solid #e5e7eb",
      }}
    >
      <input
        type="text"
        placeholder="Creditor name *"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        style={{
          width: "100%",
          padding: "8px 12px",
          border: "1px solid #d1d5db",
          borderRadius: 4,
          fontSize: 14,
          marginBottom: 8,
        }}
      />
      <input
        type="tel"
        placeholder="Phone (optional)"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        style={{
          width: "100%",
          padding: "8px 12px",
          border: "1px solid #d1d5db",
          borderRadius: 4,
          fontSize: 14,
          marginBottom: 12,
        }}
      />
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="submit"
          style={{
            flex: 1,
            padding: "8px 16px",
            backgroundColor: "#10b981",
            color: "white",
            border: "none",
            borderRadius: 4,
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Add
        </button>
        <button
          type="button"
          onClick={onCancel}
          style={{
            flex: 1,
            padding: "8px 16px",
            backgroundColor: "#f3f4f6",
            color: "#374151",
            border: "none",
            borderRadius: 4,
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
