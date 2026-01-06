import { useState } from "react";

type MovementHistory = {
  id: number;
  product_id: number;
  product_name: string;
  product_sku: string;
  change: number;
  reason: string;
  batch_number: string | null;
  expiry_date: string | null;
  location: string;
  created_at: string;
};

type Props = {
  movements: MovementHistory[];
};

export default function MovementHistory({ movements }: Props) {
  const [filterType, setFilterType] = useState<string>("all");

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

  const getMovementType = (change: number, reason: string) => {
    if (reason === "Sale") return "sale";
    if (change > 0) return "in";
    return "out";
  };

  const filteredMovements = movements.filter((m) => {
    const type = getMovementType(m.change, m.reason);
    const matchesType = filterType === "all" || type === filterType;
    return matchesType;
  });

  return (
    <div>
      {/* Filters */}
      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div>
          <label style={{ display: "block", marginBottom: 4, fontSize: 14, fontWeight: 500 }}>
            Type
          </label>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            style={{
              padding: "8px 12px",
              borderRadius: 6,
              border: "1px solid #d1d5db",
              fontSize: 14,
              minWidth: 150,
            }}
          >
            <option value="all">All Types</option>
            <option value="in">Stock In</option>
            <option value="out">Stock Out</option>
            <option value="sale">Sales</option>
          </select>
        </div>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "flex-end" }}>
          <div
            style={{
              padding: "8px 12px",
              backgroundColor: "#f3f4f6",
              borderRadius: 6,
              fontSize: 14,
            }}
          >
            Showing {filteredMovements.length} of {movements.length} movements
          </div>
        </div>
      </div>

      {/* Table */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ backgroundColor: "#f9fafb" }}>
              <th style={{ padding: 12, textAlign: "left", borderBottom: "2px solid #e5e7eb" }}>
                Date/Time
              </th>
              <th style={{ padding: 12, textAlign: "left", borderBottom: "2px solid #e5e7eb" }}>
                Product
              </th>
              <th style={{ padding: 12, textAlign: "left", borderBottom: "2px solid #e5e7eb" }}>
                SKU
              </th>
              <th style={{ padding: 12, textAlign: "right", borderBottom: "2px solid #e5e7eb" }}>
                Change
              </th>
              <th style={{ padding: 12, textAlign: "left", borderBottom: "2px solid #e5e7eb" }}>
                Reason
              </th>
              <th style={{ padding: 12, textAlign: "left", borderBottom: "2px solid #e5e7eb" }}>
                Batch
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredMovements.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: 24, textAlign: "center", color: "#6b7280" }}>
                  No movements found
                </td>
              </tr>
            ) : (
              filteredMovements.map((movement) => (
                <tr key={movement.id} style={{ borderBottom: "1px solid #e5e7eb" }}>
                  <td style={{ padding: 12, fontSize: 14 }}>{formatDate(movement.created_at)}</td>
                  <td style={{ padding: 12, fontSize: 14, fontWeight: 500 }}>
                    {movement.product_name}
                  </td>
                  <td style={{ padding: 12, fontSize: 14, color: "#6b7280" }}>
                    {movement.product_sku}
                  </td>
                  <td
                    style={{
                      padding: 12,
                      textAlign: "right",
                      fontSize: 14,
                      fontWeight: 600,
                      color: movement.change > 0 ? "#10b981" : "#ef4444",
                    }}
                  >
                    {movement.change > 0 ? "+" : ""}
                    {movement.change.toFixed(2)}
                  </td>
                  <td style={{ padding: 12, fontSize: 14 }}>
                    <span
                      style={{
                        padding: "4px 8px",
                        borderRadius: 4,
                        backgroundColor:
                          movement.reason === "Sale"
                            ? "#dbeafe"
                            : movement.change > 0
                              ? "#d1fae5"
                              : "#fee2e2",
                        fontSize: 13,
                      }}
                    >
                      {movement.reason}
                    </span>
                  </td>
                  <td style={{ padding: 12, fontSize: 14, color: "#6b7280" }}>
                    {movement.batch_number || "-"}
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
