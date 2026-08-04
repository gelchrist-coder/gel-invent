import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { createSupplier, deactivateSupplier, fetchSupplierDetail, fetchSuppliers, updateSupplier } from "../api";
import { NewSupplier, Supplier, SupplierDetail } from "../types";
import { hasUserPermission, readStoredUser } from "../user-storage";

const emptyForm: NewSupplier = { name: "", contact_person: "", phone: "", email: "", address: "", notes: "" };

export default function Suppliers() {
  const canManage = hasUserPermission("manage_procurement", readStoredUser());
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [form, setForm] = useState<NewSupplier>(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<SupplierDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setSuppliers(await fetchSuppliers()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load suppliers"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    void load();
    const reload = () => {
      setDetail(null);
      void load();
    };
    window.addEventListener("activeBranchChanged", reload);
    window.addEventListener("locationScopeChanged", reload);
    return () => {
      window.removeEventListener("activeBranchChanged", reload);
      window.removeEventListener("locationScopeChanged", reload);
    };
  }, [load]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return suppliers
      .filter((supplier) => !query || [supplier.name, supplier.contact_person, supplier.phone, supplier.email]
        .some((value) => (value || "").toLowerCase().includes(query)))
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [search, suppliers]);

  const formatCurrency = (amount: number | null | undefined) => new Intl.NumberFormat("en-GH", {
    style: "currency",
    currency: "GHS",
  }).format(Number(amount || 0));

  const openCreate = () => { setEditingId(null); setForm(emptyForm); setShowForm(true); };
  const openEdit = (supplier: Supplier) => {
    setEditingId(supplier.id);
    setForm({ name: supplier.name, contact_person: supplier.contact_person || "", phone: supplier.phone || "", email: supplier.email || "", address: supplier.address || "", notes: supplier.notes || "" });
    setShowForm(true);
  };

  const openDetail = async (supplier: Supplier) => {
    setDetailLoading(true);
    setDetailError(null);
    setDetail({ supplier, purchases: [], payments: [], returns: [] });
    try {
      setDetail(await fetchSupplierDetail(supplier.id));
    } catch (cause) {
      setDetailError(cause instanceof Error ? cause.message : "Could not load supplier history");
    } finally {
      setDetailLoading(false);
    }
  };

  const formatDate = (value: string | null | undefined) => value
    ? new Intl.DateTimeFormat("en-GH", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value))
    : "—";

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.name.trim()) return;
    setBusy(true); setError(null);
    try {
      const payload = { ...form, name: form.name.trim(), contact_person: form.contact_person?.trim() || null, phone: form.phone?.trim() || null, email: form.email?.trim() || null, address: form.address?.trim() || null, notes: form.notes?.trim() || null };
      if (editingId) await updateSupplier(editingId, payload);
      else await createSupplier(payload);
      setShowForm(false); setEditingId(null); setForm(emptyForm); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save supplier"); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ padding: 16, display: "grid", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div><h1 style={{ margin: 0, fontSize: 26 }}>Suppliers</h1><p style={{ margin: "5px 0 0", color: "#64748b" }}>Manage supplier contacts, balances, and purchasing relationships.</p></div>
        {canManage ? <button className="button" onClick={openCreate}>Add Supplier</button> : null}
      </div>
      {error ? <div style={{ padding: 12, background: "#fef2f2", color: "#b91c1c", borderRadius: 8 }}>{error}</div> : null}
      {showForm ? (
        <form className="card" onSubmit={submit} style={{ padding: 16, display: "grid", gap: 10 }}>
          <strong>{editingId ? "Edit supplier" : "New supplier"}</strong>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Supplier name" required />
            <input className="input" value={form.contact_person || ""} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} placeholder="Contact person" />
            <input className="input" value={form.phone || ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="Phone" />
            <input className="input" type="email" value={form.email || ""} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="Email" />
            <input className="input" value={form.address || ""} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Address" />
            <input className="input" value={form.notes || ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Notes" />
          </div>
          <div style={{ display: "flex", gap: 8 }}><button className="button" disabled={busy}>{busy ? "Saving..." : "Save Supplier"}</button><button type="button" className="button secondary" onClick={() => setShowForm(false)}>Cancel</button></div>
        </form>
      ) : null}
      <div className="card" style={{ padding: 14 }}><input className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search suppliers by name, contact, phone, or email" style={{ width: "100%" }} /></div>
      <div
        style={{
          backgroundColor: "white",
          border: "1px solid #e5e7eb",
          borderRadius: 8,
          overflowX: "auto",
          overflowY: "hidden",
          WebkitOverflowScrolling: "touch",
        }}
      >
        <table style={{ width: "100%", minWidth: 820, borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ backgroundColor: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
              {[
                ["Supplier", "left"],
                ["Contact", "left"],
                ["Purchased", "right"],
                ["Outstanding", "right"],
                ["Status", "center"],
                ["Actions", "center"],
              ].map(([label, align]) => (
                <th
                  key={label}
                  style={{
                    padding: "12px 16px",
                    textAlign: align as "left" | "right" | "center",
                    fontSize: 12,
                    fontWeight: 600,
                    color: "#6b7280",
                    textTransform: "uppercase",
                  }}
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ padding: 32, textAlign: "center", color: "#64748b" }}>Loading suppliers...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={6} style={{ padding: 32, textAlign: "center", color: "#64748b" }}>No suppliers found.</td></tr>
            ) : filtered.map((supplier) => (
              <tr
                key={supplier.id}
                style={{ borderBottom: "1px solid #e5e7eb", opacity: supplier.is_active ? 1 : 0.65 }}
                onMouseEnter={(event) => { event.currentTarget.style.backgroundColor = "#f9fafb"; }}
                onMouseLeave={(event) => { event.currentTarget.style.backgroundColor = "white"; }}
              >
                <td style={{ padding: "12px 16px" }}>
                  <p style={{ margin: 0, fontWeight: 600, fontSize: 14, color: "#111827" }}>{supplier.name}</p>
                  {supplier.notes ? (
                    <p style={{ margin: "4px 0 0", fontSize: 12, color: "#6b7280" }}>
                      {supplier.notes.substring(0, 50)}{supplier.notes.length > 50 ? "..." : ""}
                    </p>
                  ) : null}
                </td>
                <td style={{ padding: "12px 16px" }}>
                  <p style={{ margin: 0, fontSize: 13, color: "#111827" }}>{supplier.contact_person || "No contact person"}</p>
                  {supplier.phone ? <p style={{ margin: "4px 0 0", fontSize: 13, color: "#475569" }}>{supplier.phone}</p> : null}
                  {supplier.email ? <p style={{ margin: "4px 0 0", fontSize: 12, color: "#6b7280" }}>{supplier.email}</p> : null}
                </td>
                <td style={{ padding: "12px 16px", textAlign: "right", fontWeight: 600, whiteSpace: "nowrap" }}>
                  {formatCurrency(supplier.total_purchased)}
                </td>
                <td
                  style={{
                    padding: "12px 16px",
                    textAlign: "right",
                    fontWeight: 700,
                    color: Number(supplier.outstanding_balance || 0) > 0 ? "#b45309" : "#059669",
                    whiteSpace: "nowrap",
                  }}
                >
                  {formatCurrency(supplier.outstanding_balance)}
                </td>
                <td style={{ padding: "12px 16px", textAlign: "center" }}>
                  <span
                    style={{
                      display: "inline-block",
                      padding: "4px 10px",
                      borderRadius: 999,
                      backgroundColor: supplier.is_active ? "#d1fae5" : "#f3f4f6",
                      color: supplier.is_active ? "#047857" : "#64748b",
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    {supplier.is_active ? "Active" : "Inactive"}
                  </span>
                </td>
                <td style={{ padding: "12px 16px", textAlign: "center" }}>
                  <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                    <button className="button secondary" onClick={() => void openDetail(supplier)}>View history</button>
                    {canManage && supplier.is_active ? <>
                      <button className="button secondary" onClick={() => openEdit(supplier)}>Edit</button>
                      <button className="button secondary" onClick={() => void deactivateSupplier(supplier.id).then(load)}>Deactivate</button>
                    </> : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {detail ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${detail.supplier.name} supplier history`}
          onMouseDown={(event) => { if (event.target === event.currentTarget) setDetail(null); }}
          style={{ position: "fixed", inset: 0, zIndex: 1200, background: "rgba(15, 23, 42, .58)", padding: "clamp(10px, 3vw, 32px)", display: "grid", placeItems: "center" }}
        >
          <section style={{ width: "min(1120px, 100%)", maxHeight: "92vh", overflow: "auto", background: "#fff", borderRadius: 16, boxShadow: "0 24px 70px rgba(15, 23, 42, .28)" }}>
            <header style={{ position: "sticky", top: 0, zIndex: 2, background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "16px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 20 }}>{detail.supplier.name}</h2>
                <p style={{ margin: "4px 0 0", color: "#64748b", fontSize: 13 }}>Company-wide purchases, payments, returns, and delivery destinations.</p>
              </div>
              <button type="button" className="button secondary" onClick={() => setDetail(null)}>Close</button>
            </header>
            <div style={{ padding: 18, display: "grid", gap: 18 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 }}>
                {[
                  ["Total purchased", formatCurrency(detail.supplier.total_purchased)],
                  ["Total paid", formatCurrency(detail.supplier.total_paid)],
                  ["Outstanding", formatCurrency(detail.supplier.outstanding_balance)],
                  ["Open purchases", String(detail.supplier.unpaid_purchases_count || 0)],
                ].map(([label, value]) => (
                  <div key={label} style={{ padding: 14, border: "1px solid #e2e8f0", borderRadius: 12, background: "#f8fafc" }}>
                    <div style={{ color: "#64748b", fontSize: 12, fontWeight: 700 }}>{label}</div>
                    <div style={{ marginTop: 6, color: "#0f172a", fontSize: 19, fontWeight: 800 }}>{value}</div>
                  </div>
                ))}
              </div>
              {detailError ? <div style={{ padding: 12, borderRadius: 10, background: "#fef2f2", color: "#b91c1c" }}>{detailError}</div> : null}
              {detailLoading ? <div style={{ display: "grid", gap: 10 }}>{[1, 2, 3].map((row) => <div key={row} className="skeleton" style={{ height: 54, borderRadius: 10 }} />)}</div> : (
                <>
                  <SupplierLedgerTable
                    title="Purchases and deliveries"
                    empty="No purchases recorded for this location scope."
                    rows={detail.purchases.map((purchase) => ({
                      id: purchase.id,
                      date: formatDate(purchase.purchase_date || purchase.created_at),
                      reference: purchase.order_number || purchase.invoice_number || `Purchase #${purchase.id}`,
                      description: purchase.product_name,
                      destination: purchase.destination_name || (purchase.warehouse_id ? "Warehouse" : "Branch"),
                      user: purchase.created_by_name || "—",
                      amount: formatCurrency(purchase.total_cost),
                    }))}
                  />
                  <SupplierLedgerTable
                    title="Payments"
                    empty="No supplier payments recorded for this location scope."
                    rows={detail.payments.map((payment) => ({
                      id: payment.id,
                      date: formatDate(payment.payment_date || payment.created_at),
                      reference: payment.order_number || payment.purchase_invoice_number || `Payment #${payment.id}`,
                      description: payment.payment_method,
                      destination: payment.destination_name || (payment.warehouse_id ? "Warehouse" : "Branch"),
                      user: payment.created_by_name || "—",
                      amount: formatCurrency(payment.amount),
                    }))}
                  />
                  <SupplierLedgerTable
                    title="Returns to supplier"
                    empty="No purchase returns recorded for this location scope."
                    rows={detail.returns.map((item) => ({
                      id: item.id,
                      date: formatDate(item.return_date || item.created_at),
                      reference: item.order_number || item.purchase_invoice_number || `Return #${item.id}`,
                      description: `${item.product_name || "Product"} · ${item.quantity_returned} returned${item.reason ? ` · ${item.reason}` : ""}`,
                      destination: item.destination_name || (item.warehouse_id ? "Warehouse" : "Branch"),
                      user: item.created_by_name || "—",
                      amount: formatCurrency(item.total_cost_returned),
                    }))}
                  />
                </>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

type LedgerRow = { id: number; date: string; reference: string; description: string; destination: string; user: string; amount: string };

function SupplierLedgerTable({ title, empty, rows }: { title: string; empty: string; rows: LedgerRow[] }) {
  return (
    <section style={{ display: "grid", gap: 8 }}>
      <h3 style={{ margin: 0, fontSize: 16 }}>{title}</h3>
      <div style={{ overflowX: "auto", border: "1px solid #e2e8f0", borderRadius: 10 }}>
        <table style={{ width: "100%", minWidth: 760, borderCollapse: "collapse" }}>
          <thead><tr style={{ background: "#f8fafc" }}>{["Date", "Reference", "Item / method", "Destination", "Recorded by", "Amount"].map((label) => <th key={label} style={{ padding: "10px 12px", textAlign: label === "Amount" ? "right" : "left", fontSize: 11, color: "#64748b", textTransform: "uppercase" }}>{label}</th>)}</tr></thead>
          <tbody>
            {rows.length === 0 ? <tr><td colSpan={6} style={{ padding: 20, textAlign: "center", color: "#64748b" }}>{empty}</td></tr> : rows.map((row) => (
              <tr key={row.id} style={{ borderTop: "1px solid #e2e8f0" }}>
                <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>{row.date}</td>
                <td style={{ padding: "10px 12px", fontWeight: 700 }}>{row.reference}</td>
                <td style={{ padding: "10px 12px" }}>{row.description}</td>
                <td style={{ padding: "10px 12px" }}>{row.destination}</td>
                <td style={{ padding: "10px 12px" }}>{row.user}</td>
                <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 700, whiteSpace: "nowrap" }}>{row.amount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
