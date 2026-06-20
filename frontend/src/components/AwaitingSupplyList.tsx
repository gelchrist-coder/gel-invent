import { useCallback, useEffect, useMemo, useState } from "react";
import { Product, Sale } from "../types";
import { fetchAwaitingSupply, supplySale } from "../api";

type AwaitingSupplyListProps = {
  products: Product[];
  // Called after goods are handed over so the parent can refresh stock/sales.
  onSupplied?: () => void;
};

function toCurrency(value: number): string {
  return `GHS ${value.toFixed(2)}`;
}

function remainingFor(sale: Sale): number {
  const supplied = Number(sale.supplied_quantity ?? 0);
  return Math.max(0, Number(sale.quantity || 0) - supplied);
}

export default function AwaitingSupplyList({ products, onSupplied }: AwaitingSupplyListProps) {
  const [rows, setRows] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [qtyDraft, setQtyDraft] = useState<Record<number, string>>({});

  const productById = useMemo(() => {
    const map = new Map<number, Product>();
    for (const product of products) map.set(product.id, product);
    return map;
  }, [products]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAwaitingSupply();
      setRows(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load reserved goods.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSupply = async (sale: Sale, quantity?: number) => {
    setBusyId(sale.id);
    setError(null);
    try {
      await supplySale(sale.id, quantity);
      setQtyDraft((prev) => {
        const next = { ...prev };
        delete next[sale.id];
        return next;
      });
      await load();
      onSupplied?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record collection.");
    } finally {
      setBusyId(null);
    }
  };

  const totalReserved = rows.reduce((sum, sale) => sum + remainingFor(sale), 0);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 12, flexWrap: "wrap" }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Awaiting Supply</h3>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "#6b7280" }}>
            Paid goods still in the store. Mark them supplied when the customer collects.
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {rows.length > 0 && (
            <span style={{ fontSize: 12, color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 999, padding: "4px 10px", fontWeight: 700 }}>
              {totalReserved} reserved across {rows.length} sale{rows.length === 1 ? "" : "s"}
            </span>
          )}
          <button
            type="button"
            onClick={() => void load()}
            style={{
              fontSize: 12,
              fontWeight: 700,
              padding: "6px 12px",
              borderRadius: 6,
              border: "1px solid #d1d5db",
              background: "white",
              color: "#374151",
              cursor: "pointer",
            }}
          >
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <p style={{ margin: "0 0 10px", fontSize: 12, color: "#b91c1c", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6, padding: "8px 10px" }}>
          {error}
        </p>
      )}

      {loading && rows.length === 0 ? (
        <p style={{ margin: 0, color: "#6b7280", fontSize: 13 }}>Loading reserved goods...</p>
      ) : rows.length === 0 ? (
        <p style={{ margin: 0, color: "#6b7280", fontSize: 13 }}>
          Nothing awaiting supply. Reserved goods will appear here when a sale is marked "leave in store".
        </p>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {rows.map((sale) => {
            const product = productById.get(sale.product_id);
            const remaining = remainingFor(sale);
            const supplied = Number(sale.supplied_quantity ?? 0);
            const partiallySupplied = supplied > 0 && remaining > 0;
            const unit = product?.unit || "pcs";
            const draftRaw = qtyDraft[sale.id];
            const draftValue = draftRaw === undefined ? String(remaining) : draftRaw;
            const draftNumber = Number(draftValue);
            const draftValid = Number.isFinite(draftNumber) && draftNumber > 0 && draftNumber <= remaining;
            const busy = busyId === sale.id;

            return (
              <div
                key={sale.id}
                style={{
                  border: "1px solid #e5e7eb",
                  borderRadius: 8,
                  padding: "12px 14px",
                  background: "#fffdf7",
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 12,
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div style={{ minWidth: 200, flex: "1 1 220px" }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#111827" }}>
                    {product?.name || `Product #${sale.product_id}`}
                  </div>
                  <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
                    {sale.customer_name?.trim() || "Walk-in customer"}
                    {sale.customer_phone ? ` · ${sale.customer_phone}` : ""}
                  </div>
                  <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
                    {new Date(sale.created_at).toLocaleDateString()} · {toCurrency(Number(sale.total_price || 0))}
                  </div>
                </div>

                <div style={{ textAlign: "center", minWidth: 110 }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: "#92400e" }}>
                    {remaining} {unit}
                  </div>
                  <div style={{ fontSize: 11, color: "#92400e" }}>
                    {partiallySupplied ? `reserved (of ${Number(sale.quantity)} ${unit})` : "reserved"}
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={remaining}
                    value={draftValue}
                    disabled={busy}
                    onChange={(event) =>
                      setQtyDraft((prev) => ({ ...prev, [sale.id]: event.target.value }))
                    }
                    style={{
                      width: 80,
                      padding: "8px 10px",
                      border: "1px solid #d1d5db",
                      borderRadius: 6,
                      fontSize: 13,
                    }}
                  />
                  <button
                    type="button"
                    disabled={busy || !draftValid}
                    onClick={() => void handleSupply(sale, draftNumber)}
                    style={{
                      padding: "8px 12px",
                      borderRadius: 6,
                      border: "1px solid #d1d5db",
                      background: "white",
                      color: "#111827",
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: busy || !draftValid ? "not-allowed" : "pointer",
                      opacity: busy || !draftValid ? 0.6 : 1,
                    }}
                  >
                    Supply
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleSupply(sale)}
                    style={{
                      padding: "8px 12px",
                      borderRadius: 6,
                      border: "none",
                      background: "#16a34a",
                      color: "white",
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: busy ? "not-allowed" : "pointer",
                      opacity: busy ? 0.6 : 1,
                    }}
                  >
                    {busy ? "Saving..." : "Supply all"}
                  </button>
                </div>

                {(sale.supplies?.length ?? 0) > 0 && (
                  <div
                    style={{
                      flexBasis: "100%",
                      borderTop: "1px dashed #fde68a",
                      paddingTop: 8,
                      marginTop: 2,
                    }}
                  >
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#92400e", marginBottom: 4 }}>
                      Collection history
                    </div>
                    {sale.supplies!.map((entry) => (
                      <div
                        key={entry.id}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 8,
                          fontSize: 11,
                          color: "#6b7280",
                          padding: "2px 0",
                        }}
                      >
                        <span>
                          {new Date(entry.created_at).toLocaleString()} · {entry.collected_by_name || "Staff"}
                        </span>
                        <span style={{ fontWeight: 700, color: "#111827", whiteSpace: "nowrap" }}>
                          {Number(entry.quantity)} {unit}
                          {entry.notes ? ` · ${entry.notes}` : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
