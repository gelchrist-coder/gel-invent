import { API_BASE, buildAuthHeaders } from "../api";
import { useState, useEffect } from "react";

interface Creditor {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  total_debt: number;
  actual_debt: number;
  transaction_count: number;
  notes: string | null;
  created_at: string;
}

interface CreditorListProps {
  onSelectCreditor: (creditor: Creditor) => void;
  onAddCreditor: () => void;
  refreshTrigger: number;
}

export default function CreditorList({ onSelectCreditor, onAddCreditor, refreshTrigger }: CreditorListProps) {
  const [creditors, setCreditors] = useState<Creditor[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    fetchCreditors();
  }, [refreshTrigger]);

  const fetchCreditors = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${API_BASE}/creditors/`, {
        headers: buildAuthHeaders({ "Content-Type": "application/json" }),
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      setCreditors(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("Error fetching creditors:", error);
      setCreditors([]);
    } finally {
      setLoading(false);
    }
  };

  const filteredCreditors = creditors.filter(
    (creditor) =>
      creditor.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      creditor.phone?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      creditor.email?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-GH", {
      style: "currency",
      currency: "GHS",
    }).format(amount);
  };

  const outstandingFor = (amount: number) => Math.max(0, amount);

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: "center" }}>
        <p style={{ color: "#6b7280" }}>Loading creditors...</p>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div style={{ flex: 1, maxWidth: 400 }}>
          <input
            type="text"
            placeholder="Search creditors..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{
              width: "100%",
              padding: "10px 14px",
              border: "1px solid #d1d5db",
              borderRadius: 6,
              fontSize: 14,
            }}
          />
        </div>
        <button
          onClick={onAddCreditor}
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
          + Add Creditor
        </button>
      </div>

      {/* Summary Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, marginBottom: 20 }}>
        <div style={{ backgroundColor: "white", border: "1px solid #e5e7eb", borderRadius: 8, padding: 16 }}>
          <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>Total Creditors</p>
          <p style={{ margin: "8px 0 0", fontSize: 24, fontWeight: 700 }}>{creditors.length}</p>
        </div>
        <div style={{ backgroundColor: "white", border: "1px solid #e5e7eb", borderRadius: 8, padding: 16 }}>
          <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>Active Debts</p>
          <p style={{ margin: "8px 0 0", fontSize: 24, fontWeight: 700, color: "#ef4444" }}>
            {creditors.filter(c => c.actual_debt > 0).length}
          </p>
        </div>
        <div style={{ backgroundColor: "white", border: "1px solid #e5e7eb", borderRadius: 8, padding: 16 }}>
          <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>Total Outstanding</p>
          <p style={{ margin: "8px 0 0", fontSize: 24, fontWeight: 700, color: "#ef4444" }}>
            {formatCurrency(creditors.reduce((sum, c) => sum + outstandingFor(c.actual_debt), 0))}
          </p>
        </div>
      </div>

      {/* Creditors Table */}
      <div style={{ backgroundColor: "white", border: "1px solid #e5e7eb", borderRadius: 8, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ backgroundColor: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
              <th style={{ padding: "12px 16px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#6b7280", textTransform: "uppercase" }}>
                Name
              </th>
              <th style={{ padding: "12px 16px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#6b7280", textTransform: "uppercase" }}>
                Contact
              </th>
              <th style={{ padding: "12px 16px", textAlign: "right", fontSize: 12, fontWeight: 600, color: "#6b7280", textTransform: "uppercase" }}>
                Outstanding Debt
              </th>
              <th style={{ padding: "12px 16px", textAlign: "center", fontSize: 12, fontWeight: 600, color: "#6b7280", textTransform: "uppercase" }}>
                Transactions
              </th>
              <th style={{ padding: "12px 16px", textAlign: "center", fontSize: 12, fontWeight: 600, color: "#6b7280", textTransform: "uppercase" }}>
                Status
              </th>
              <th style={{ padding: "12px 16px", textAlign: "center", fontSize: 12, fontWeight: 600, color: "#6b7280", textTransform: "uppercase" }}>
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredCreditors.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: 40, textAlign: "center", color: "#6b7280" }}>
                  {searchTerm ? "No creditors found matching your search." : "No creditors yet. Click 'Add Creditor' to get started."}
                </td>
              </tr>
            ) : (
              filteredCreditors.map((creditor) => (
                <tr
                  key={creditor.id}
                  style={{
                    borderBottom: "1px solid #e5e7eb",
                    cursor: "pointer",
                    transition: "background-color 0.15s",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#f9fafb")}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "white")}
                  onClick={() => onSelectCreditor(creditor)}
                >
                  <td style={{ padding: "12px 16px" }}>
                    <div>
                      <p style={{ margin: 0, fontWeight: 600, fontSize: 14 }}>{creditor.name}</p>
                      {creditor.notes && (
                        <p style={{ margin: "4px 0 0", fontSize: 12, color: "#6b7280" }}>
                          {creditor.notes.substring(0, 50)}{creditor.notes.length > 50 ? "..." : ""}
                        </p>
                      )}
                    </div>
                  </td>
                  <td style={{ padding: "12px 16px" }}>
                    <div>
                      {creditor.phone && <p style={{ margin: 0, fontSize: 13 }}>{creditor.phone}</p>}
                      {creditor.email && <p style={{ margin: "4px 0 0", fontSize: 13, color: "#6b7280" }}>{creditor.email}</p>}
                      {!creditor.phone && !creditor.email && <p style={{ margin: 0, fontSize: 13, color: "#9ca3af" }}>—</p>}
                    </div>
                  </td>
                  <td style={{ padding: "12px 16px", textAlign: "right" }}>
                    <p
                      style={{
                        margin: 0,
                        fontSize: 15,
                        fontWeight: 600,
                        color: creditor.actual_debt > 0 ? "#ef4444" : "#10b981",
                      }}
                    >
                      {formatCurrency(outstandingFor(creditor.actual_debt))}
                    </p>
                  </td>
                  <td style={{ padding: "12px 16px", textAlign: "center" }}>
                    <span
                      style={{
                        display: "inline-block",
                        padding: "4px 12px",
                        backgroundColor: "#f3f4f6",
                        borderRadius: 12,
                        fontSize: 13,
                        fontWeight: 600,
                      }}
                    >
                      {creditor.transaction_count}
                    </span>
                  </td>
                  <td style={{ padding: "12px 16px", textAlign: "center" }}>
                    <span
                      style={{
                        display: "inline-block",
                        padding: "4px 12px",
                        backgroundColor: creditor.actual_debt > 0 ? "#fee2e2" : "#d1fae5",
                        color: creditor.actual_debt > 0 ? "#dc2626" : "#059669",
                        borderRadius: 12,
                        fontSize: 12,
                        fontWeight: 600,
                      }}
                    >
                      {creditor.actual_debt > 0 ? "Owes" : "Clear"}
                    </span>
                  </td>
                  <td style={{ padding: "12px 16px", textAlign: "center" }}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectCreditor(creditor);
                      }}
                      style={{
                        padding: "6px 14px",
                        backgroundColor: "#3b82f6",
                        color: "white",
                        border: "none",
                        borderRadius: 4,
                        fontSize: 13,
                        fontWeight: 500,
                        cursor: "pointer",
                      }}
                    >
                      View Details
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
