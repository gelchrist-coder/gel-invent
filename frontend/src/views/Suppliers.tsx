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
    if (!query) return suppliers;
    return suppliers.filter((supplier) => [supplier.name, supplier.contact_person, supplier.phone, supplier.email]
      .some((value) => (value || "").toLowerCase().includes(query)));
  }, [search, suppliers]);

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
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
        {filtered.map((supplier) => (
          <div className="card" key={supplier.id} style={{ padding: 15, display: "grid", gap: 9, opacity: supplier.is_active ? 1 : 0.65 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><strong>{supplier.name}</strong><span style={{ fontSize: 12, color: supplier.is_active ? "#047857" : "#64748b" }}>{supplier.is_active ? "Active" : "Inactive"}</span></div>
            <div style={{ color: "#64748b", fontSize: 13 }}>{supplier.contact_person || "No contact person"}{supplier.phone ? ` · ${supplier.phone}` : ""}</div>
            {supplier.email ? <div style={{ color: "#475569", fontSize: 13 }}>{supplier.email}</div> : null}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, paddingTop: 8, borderTop: "1px solid #e2e8f0" }}>
              <div><span style={{ display: "block", fontSize: 11, color: "#64748b" }}>Purchased</span><strong>{Number(supplier.total_purchased || 0).toFixed(2)}</strong></div>
              <div><span style={{ display: "block", fontSize: 11, color: "#64748b" }}>Outstanding</span><strong style={{ color: Number(supplier.outstanding_balance || 0) > 0 ? "#b45309" : "#0f172a" }}>{Number(supplier.outstanding_balance || 0).toFixed(2)}</strong></div>
            </div>
            {canManage && supplier.is_active ? <div style={{ display: "flex", gap: 8 }}><button className="button secondary" onClick={() => openEdit(supplier)}>Edit</button><button className="button secondary" onClick={() => void deactivateSupplier(supplier.id).then(load)}>Deactivate</button></div> : null}
          </div>
        ))}
      </div>
      {!loading && filtered.length === 0 ? <div className="card" style={{ padding: 24, textAlign: "center", color: "#64748b" }}>No suppliers found.</div> : null}
      {loading ? <div className="card" style={{ padding: 24, textAlign: "center" }}>Loading suppliers...</div> : null}
    </div>
  );
}
