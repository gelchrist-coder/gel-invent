import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { createSupplier, deactivateSupplier, fetchSuppliers, updateSupplier } from "../api";
import { NewSupplier, Supplier } from "../types";
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

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setSuppliers(await fetchSuppliers()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load suppliers"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

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
                  {canManage && supplier.is_active ? (
                    <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                      <button className="button secondary" onClick={() => openEdit(supplier)}>Edit</button>
                      <button className="button secondary" onClick={() => void deactivateSupplier(supplier.id).then(load)}>Deactivate</button>
                    </div>
                  ) : <span style={{ color: "#9ca3af" }}>—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
