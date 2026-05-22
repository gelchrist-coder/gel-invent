import { useEffect, useMemo, useState } from "react";

import { fetchProductsCached } from "../api";
import POSSaleForm from "../components/POSSaleForm";
import { cacheProducts, loadCachedProducts } from "../offline/storage";
import { NewSale, Product } from "../types";

type UiMessage = { type: "error" | "info"; text: string } | null;

export default function Invoice() {
  const cachedProducts = loadCachedProducts();
  const [products, setProducts] = useState<Product[]>(cachedProducts || []);
  const [loading, setLoading] = useState(!cachedProducts);
  const [error, setError] = useState<string | null>(null);
  const [offlineNotice, setOfflineNotice] = useState<string | null>(null);
  const [pendingInvoice, setPendingInvoice] = useState<NewSale[]>([]);
  const [showInvoice, setShowInvoice] = useState(false);
  const [invoiceToken, setInvoiceToken] = useState<string | null>(null);
  const [uiMessage, setUiMessage] = useState<UiMessage>(null);

  const currentUser = localStorage.getItem("user");
  const userData = currentUser ? JSON.parse(currentUser) : null;
  const businessName = userData?.business_name || "Your Business";
  const businessLogoUrl = userData?.business_logo_url || "";
  const salesPerson = userData?.name || "Sales Person";

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchProductsCached((fresh) => {
        setProducts(fresh);
        cacheProducts(fresh);
      });
      setProducts(data);
      cacheProducts(data);
      setOfflineNotice(null);
    } catch (err) {
      const cached = loadCachedProducts();
      const message = err instanceof Error ? err.message : "Failed to load products";
      if (cached?.length) {
        setProducts(cached);
        setOfflineNotice(
          navigator.onLine
            ? "Using cached products while we reconnect to the server."
            : "Offline mode: using cached products."
        );
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  useEffect(() => {
    const handler = () => {
      void loadData();
    };
    window.addEventListener("activeBranchChanged", handler as EventListener);
    return () => window.removeEventListener("activeBranchChanged", handler as EventListener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const productById = useMemo(() => {
    const map = new Map<number, Product>();
    for (const p of products) map.set(p.id, p);
    return map;
  }, [products]);

  const handleCreateInvoice = (salesArray: NewSale[]) => {
    if (!salesArray.length) {
      setUiMessage({ type: "error", text: "Please add items before creating an invoice." });
      return;
    }

    const token = (globalThis.crypto as Crypto | undefined)?.randomUUID?.() ?? `inv_${Date.now()}`;
    const withClientIds = salesArray.map((s, idx) => ({
      ...s,
      client_sale_id: s.client_sale_id ?? `${token}:${idx}`,
    }));

    setInvoiceToken(token);
    setPendingInvoice(withClientIds);
    setShowInvoice(true);
    setUiMessage(null);
  };

  const resetInvoice = () => {
    setShowInvoice(false);
    setPendingInvoice([]);
    setInvoiceToken(null);
  };

  const printInvoice = () => {
    if (!pendingInvoice.length) return;

    const total = pendingInvoice.reduce((sum, line) => sum + (Number(line.total_price) || 0), 0);
    const customerName = pendingInvoice[0]?.customer_name || "Walk-in Customer";
    const invoiceNumber = (invoiceToken ?? "INV").split(":")[0].slice(-8).toUpperCase();
    const issueDate = new Date().toLocaleString();

    const rowsHTML = pendingInvoice
      .map((line) => {
        const product = productById.get(line.product_id);
        const name = product?.name || `Product #${line.product_id}`;
        const isPack = line.sale_unit_type === "pack" && typeof line.pack_quantity === "number";
        const qtyDisplay = isPack ? line.pack_quantity : Number(line.quantity) || 0;
        const qtyLabel = isPack ? " pack" : "";
        const unitPrice = Number(line.unit_price) || 0;
        const lineTotal = Number(line.total_price) || 0;

        return `
          <tr>
            <td>${name}</td>
            <td style="text-align:right">${qtyDisplay}${qtyLabel}</td>
            <td style="text-align:right">GHS ${unitPrice.toFixed(2)}</td>
            <td style="text-align:right">GHS ${lineTotal.toFixed(2)}</td>
          </tr>
        `;
      })
      .join("");

    const logoHtml = businessLogoUrl
      ? `<div style="margin-bottom:10px"><img src="${businessLogoUrl}" alt="Logo" style="height:50px;max-width:160px;object-fit:contain" /></div>`
      : "";

    const html = `
      <html>
        <head>
          <title>Proforma Invoice</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 24px; color: #0f172a; }
            h1 { margin: 0 0 6px; font-size: 24px; }
            .meta { font-size: 12px; color: #475569; margin-bottom: 16px; }
            table { width: 100%; border-collapse: collapse; margin-top: 16px; }
            th, td { border-bottom: 1px solid #e2e8f0; padding: 8px 4px; font-size: 12px; }
            th { text-align: left; background: #f8fafc; }
            .total { text-align: right; font-weight: 700; font-size: 14px; }
            .footer { margin-top: 24px; font-size: 11px; color: #64748b; }
          </style>
        </head>
        <body>
          <h1>${businessName}</h1>
          ${logoHtml}
          <div class="meta">PROFORMA INVOICE</div>
          <div class="meta">Invoice No: ${invoiceNumber}</div>
          <div class="meta">Issued: ${issueDate}</div>
          <div class="meta">Prepared By: ${salesPerson}</div>
          <div class="meta">Customer: ${customerName}</div>

          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th style="text-align:right">Qty</th>
                <th style="text-align:right">Unit Price</th>
                <th style="text-align:right">Line Total</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHTML}
              <tr>
                <td colspan="3" class="total">Total</td>
                <td class="total">GHS ${total.toFixed(2)}</td>
              </tr>
            </tbody>
          </table>

          <div class="footer">This is a proforma invoice and does not affect stock levels.</div>
          <script>window.onload = function () { window.print(); }</script>
        </body>
      </html>
    `;

    const invoiceWindow = window.open("", "_blank", "width=900,height=700");
    if (!invoiceWindow) return;
    invoiceWindow.document.write(html);
    invoiceWindow.document.close();
  };

  const totalDue = pendingInvoice.reduce((sum, line) => sum + (Number(line.total_price) || 0), 0);
  const customerName = pendingInvoice[0]?.customer_name || "Walk-in Customer";
  const paymentMethod = pendingInvoice[0]?.payment_method || "unpaid";
  const invoiceNumber = (invoiceToken ?? "INV").split(":")[0].slice(-8).toUpperCase();

  return (
    <div className="app-shell">
      <h1 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>Proforma Invoice</h1>

      {uiMessage && (
        <div className="card" style={{ marginBottom: 16, border: "1px solid #cbd5f5", background: "#f8fafc" }}>
          <p style={{ margin: 0, color: uiMessage.type === "error" ? "#b91c1c" : "#1d4ed8" }}>{uiMessage.text}</p>
        </div>
      )}

      {offlineNotice && (
        <div className="card" style={{ marginBottom: 16, border: "1px solid #bae6fd", background: "#eff6ff" }}>
          <p style={{ margin: 0, color: "#1d4ed8" }}>{offlineNotice}</p>
        </div>
      )}

      {error && (
        <div className="card" style={{ marginBottom: 16, border: "1px solid #fecaca", background: "#fef2f2" }}>
          <p style={{ margin: 0, color: "#b91c1c" }}>Error: {error}</p>
          <button onClick={loadData} style={{ marginTop: 8 }}>
            Retry
          </button>
        </div>
      )}

      <div className="card" style={{ marginBottom: 24, padding: 16 }}>
        {products.length === 0 && loading ? (
          <p style={{ margin: 0, color: "#6b7280" }}>Loading products...</p>
        ) : (
          <POSSaleForm products={products} onSubmit={handleCreateInvoice} />
        )}
      </div>

      {showInvoice && pendingInvoice.length > 0 && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(15, 23, 42, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 20,
          }}
          onClick={resetInvoice}
        >
          <div
            style={{
              background: "#f8fafc",
              borderRadius: 18,
              maxWidth: 520,
              width: "100%",
              maxHeight: "90vh",
              overflow: "hidden",
              boxShadow: "0 24px 56px rgba(15, 23, 42, 0.32)",
              display: "flex",
              flexDirection: "column",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                background: "white",
                borderTop: "4px solid #10b981",
                borderBottom: "1px solid #e2e8f0",
                padding: "18px 20px 16px",
                position: "relative",
                textAlign: "center",
              }}
            >
              <div
                style={{
                  width: 54,
                  height: 54,
                  borderRadius: "50%",
                  border: "2px solid #bbf7d0",
                  color: "#16a34a",
                  margin: "0 auto 10px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 700,
                  fontSize: 22,
                  lineHeight: 1,
                }}
              >
                INV
              </div>
              <h2 style={{ fontSize: 26, fontWeight: 800, margin: 0, color: "#0f172a", lineHeight: 1.05 }}>
                {businessName.toUpperCase()}
              </h2>
              <div style={{ marginTop: 4, fontSize: 11, fontWeight: 700, letterSpacing: "1px", color: "#94a3b8" }}>
                PROFORMA INVOICE
              </div>
              <div style={{ marginTop: 8, fontSize: 11, color: "#64748b" }}>
                {new Date().toLocaleString()}
              </div>
              <div
                style={{
                  position: "absolute",
                  top: 12,
                  right: 12,
                  background: "#f1f5f9",
                  borderRadius: "50%",
                  width: 28,
                  height: 28,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 16,
                  color: "#475569",
                  cursor: "pointer",
                }}
                onClick={resetInvoice}
                >
                X
              </div>
            </div>

            <div style={{ flex: 1, overflow: "auto", padding: "14px 18px 18px" }}>
              <div
                style={{
                  borderTop: "1px dashed #cbd5e1",
                  borderBottom: "1px dashed #cbd5e1",
                  padding: "10px 0",
                  marginBottom: 12,
                  fontSize: 12,
                  color: "#334155",
                  display: "grid",
                  gap: 6,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <strong>INVOICE NO:</strong>
                  <span>#{invoiceNumber}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <strong>PREPARED BY:</strong>
                  <span>{salesPerson.toUpperCase()}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <strong>CUSTOMER:</strong>
                  <span>{customerName.toUpperCase()}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <strong>PAYMENT:</strong>
                  <span>{paymentMethod.toUpperCase()}</span>
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {pendingInvoice.map((line, index) => {
                  const product = productById.get(line.product_id);
                  const name = product?.name || `Product #${line.product_id}`;
                  const isPack = line.sale_unit_type === "pack" && typeof line.pack_quantity === "number";
                  const qtyDisplay = isPack ? line.pack_quantity : Number(line.quantity) || 0;
                  const qtyLabel = isPack ? " pack" : "";
                  const unitPrice = Number(line.unit_price) || 0;
                  const lineTotal = Number(line.total_price) || 0;

                  return (
                    <div key={`${line.product_id}-${index}`} style={{ display: "grid", gap: 4 }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{name}</div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#475569" }}>
                        <span>
                          {qtyDisplay}
                          {qtyLabel} × GHS {unitPrice.toFixed(2)}
                        </span>
                        <span>GHS {lineTotal.toFixed(2)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div style={{ borderTop: "1px solid #e2e8f0", marginTop: 14, paddingTop: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700 }}>
                  <span>Total</span>
                  <span>GHS {totalDue.toFixed(2)}</span>
                </div>
              </div>

              <div style={{ marginTop: 12, fontSize: 11, color: "#64748b" }}>
                This is a proforma invoice and does not affect stock levels.
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                <button
                  onClick={printInvoice}
                  style={{
                    flex: 1,
                    padding: "10px 12px",
                    background: "#10b981",
                    color: "white",
                    border: "none",
                    borderRadius: 8,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Print Invoice
                </button>
                <button
                  onClick={resetInvoice}
                  style={{
                    flex: 1,
                    padding: "10px 12px",
                    background: "#e2e8f0",
                    color: "#0f172a",
                    border: "none",
                    borderRadius: 8,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  New Invoice
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
