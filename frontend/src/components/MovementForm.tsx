import React, { useState } from "react";

import { NewMovement } from "../types";

type Props = {
  productName?: string;
  onCreate: (payload: NewMovement) => Promise<void>;
  disabled?: boolean;
};

export default function MovementForm({ productName, onCreate, disabled }: Props) {
  const [form, setForm] = useState<NewMovement>({ 
    change: 0, 
    reason: "adjustment",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (disabled) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate({ 
        change: Number(form.change),
        reason: form.reason,
      });
      setForm({ 
        change: 0, 
        reason: "adjustment",
      });
    } catch (err) {
      setError((err as Error).message || "Failed to record movement");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h2 className="section-title">Stock movement {productName ? `for ${productName}` : ""}</h2>
      <form onSubmit={submit} className="grid" style={{ gap: 12 }}>
        <div className="form-row">
          <label>
            Change
            <input
              className="input"
              type="number"
              step="0.01"
              value={form.change}
              onChange={(e) => setForm({ ...form, change: Number(e.target.value) })}
              required
              placeholder="Positive to add, negative to remove"
              disabled={disabled}
            />
          </label>
          <label>
            Reason
            <input
              className="input"
              value={form.reason ?? ""}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              placeholder="e.g. initial stock"
              disabled={disabled}
            />
          </label>
        </div>
        {error ? <p style={{ color: "#d14343", margin: 0 }}>{error}</p> : null}
        <button className="button" type="submit" disabled={busy || disabled}>
          {busy ? "Saving..." : "Record movement"}
        </button>
        {disabled ? <p style={{ margin: 0, color: "#5f6475" }}>Select a product to record movement.</p> : null}
      </form>
    </div>
  );
}
