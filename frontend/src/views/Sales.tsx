import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Sale, Product, NewSale } from "../types";
import { fetchSalesCached, createSalesBulk, deleteSale, fetchProductsCached, getCachedProducts, getCachedSales, sendSalesReceiptEmail } from "../api";
import POSSaleForm from "../components/POSSaleForm";
import SalesList from "../components/SalesList";
import ReturnsList from "../components/ReturnsList";
import {
  applyLocalSaleToCachedProducts,
  cacheProducts,
  enqueueSales,
  getSalesOutboxCount,
  loadCachedProducts,
} from "../offline/storage";
import { syncSalesOutboxOnce } from "../offline/sync";

export default function Sales() {
  // Initialize from cache for instant display
  const cachedProducts = getCachedProducts();
  const cachedSales = getCachedSales();
  const [sales, setSales] = useState<Sale[]>(cachedSales || []);
  const [products, setProducts] = useState<Product[]>(cachedProducts || []);
  const [loading, setLoading] = useState(!cachedProducts); // Only show loading if no cache
  const [error, setError] = useState<string | null>(null);
  const [pendingSales, setPendingSales] = useState<NewSale[]>([]);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [saleConfirmed, setSaleConfirmed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmedSales, setConfirmedSales] = useState<Sale[]>([]);
  const [receiptEmail, setReceiptEmail] = useState("");
  const [emailSending, setEmailSending] = useState(false);
  const [emailStatus, setEmailStatus] = useState<string | null>(null);
  const [offlineNotice, setOfflineNotice] = useState<string | null>(null);
  const [outboxCount, setOutboxCount] = useState<number>(() => getSalesOutboxCount());
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [salesPeriod, setSalesPeriod] = useState<"all" | "day" | "week" | "month">("all");
  const hasLoadedOnce = useRef(false);

  // Get user and business info for receipt
  const currentUser = localStorage.getItem("user");
  const userData = currentUser ? JSON.parse(currentUser) : null;
  const businessName = userData?.business_name || "Your Business";
  const businessLogoUrl = userData?.business_logo_url || "";
  const salesPerson = userData?.name || "Sales Person";

  const loadData = useCallback(async () => {
    if (!hasLoadedOnce.current) {
      setLoading(true);
    }
    setError(null);
    try {
      const [productsData, salesData] = await Promise.all([
        fetchProductsCached((fresh) => {
          setProducts(fresh);
          cacheProducts(fresh);
        }),
        fetchSalesCached((fresh) => setSales(fresh)).catch(() => []),
      ]);

      setProducts(productsData);
      cacheProducts(productsData);
      if (Array.isArray(salesData)) {
        setSales(salesData);
      }
    } catch (err) {
      // If products can't be fetched, fall back to cached products so POS can still work.
      const cached = loadCachedProducts();
      const message = err instanceof Error ? err.message : "Failed to load data";
      const isOffline = !navigator.onLine;
      if (cached?.length) {
        setProducts(cached);
        setOfflineNotice(
          isOffline
            ? "Offline mode: using cached products. Sales will sync when internet returns."
            : "Using cached products while we reconnect to the server."
        );
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
      hasLoadedOnce.current = true;
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    const handler = () => {
      void loadData();
    };
    window.addEventListener("activeBranchChanged", handler as EventListener);
    return () => window.removeEventListener("activeBranchChanged", handler as EventListener);
  }, [loadData]);

  useEffect(() => {
    const handler = () => setOutboxCount(getSalesOutboxCount());
    window.addEventListener("offlineOutboxChanged", handler);
    window.addEventListener("online", handler);
    window.addEventListener("offline", handler);
    return () => {
      window.removeEventListener("offlineOutboxChanged", handler);
      window.removeEventListener("online", handler);
      window.removeEventListener("offline", handler);
    };
  }, []);

  const syncOutboxOnce = useCallback(async () => {
    const result = await syncSalesOutboxOnce();
    if (result.syncedCount === 0 && result.remainingCount === 0) {
      return;
    }

    // Refresh products/sales after syncing.
    try {
      await loadData();
      setOfflineNotice(result.hadFailure ? "Some queued sales are still waiting to sync." : null);
    } catch {
      // ignore
    }
  }, [loadData]);

  useEffect(() => {
    const onOnline = () => {
      void syncOutboxOnce();
    };
    window.addEventListener("online", onOnline);
    // Also try syncing shortly after mount.
    void syncOutboxOnce();
    return () => window.removeEventListener("online", onOnline);
  }, [syncOutboxOnce]);

  const handleCreateSale = async (salesArray: NewSale[]) => {
    // Show confirmation modal instead of submitting immediately
    const receiptId = (globalThis.crypto as Crypto | undefined)?.randomUUID?.() ?? `sale_${Date.now()}`;
    const withClientIds = salesArray.map((s, idx) => ({
      ...s,
      client_sale_id: s.client_sale_id ?? `${receiptId}:${idx}`,
    }));
    setPendingSales(withClientIds);
    setConfirmedSales([]);
    setEmailStatus(null);
    setReceiptEmail("");
    setShowConfirmation(true);
    setSaleConfirmed(false); // Reset confirmed state for new sale
  };

  const confirmSale = async () => {
    if (pendingSales.length === 0) return;
    setConfirming(true);
    try {
      // Instant UI: mark as confirmed and sync in the background.
      setSaleConfirmed(true);
      setConfirmedSales([]);

      // Optimistically update local stock and queue the sale.
      enqueueSales(pendingSales);
      const updated = applyLocalSaleToCachedProducts(pendingSales);
      if (updated) setProducts(updated);

      if (!navigator.onLine) {
        setOfflineNotice("Offline mode: sale saved locally. It will sync when internet returns.");
        return;
      }

      // Sync in background; don't block the UI.
      void (async () => {
        try {
          const createdSales = await createSalesBulk(pendingSales);
          setConfirmedSales(createdSales);
          await loadData();
          setOfflineNotice(null);
          window.dispatchEvent(new CustomEvent("productsUpdated"));
        } catch {
          setOfflineNotice("Sale queued for sync. We'll retry automatically.");
        }
      })();
    } catch (err) {
      // Network issue: queue sale locally and sync later.
      enqueueSales(pendingSales);
      setConfirmedSales([]);
      const updated = applyLocalSaleToCachedProducts(pendingSales);
      if (updated) setProducts(updated);
      setOfflineNotice("Sale queued for sync. We'll retry automatically.");
      setSaleConfirmed(true);
    } finally {
      setConfirming(false);
    }
  };

  const doneRef = useRef(false);
  
  const handleDone = () => {
    if (doneRef.current) return; // Prevent double-execution
    doneRef.current = true;
    setShowConfirmation(false);
    setPendingSales([]);
    setConfirmedSales([]);
    setEmailStatus(null);
    setReceiptEmail("");
    setSaleConfirmed(false);
    // Reset flag after state updates
    setTimeout(() => { doneRef.current = false; }, 100);
  };

  const sendReceiptToEmail = async () => {
    const email = receiptEmail.trim();
    if (!email) {
      setEmailStatus("Enter a customer email address.");
      return;
    }
    if (!confirmedSales.length) {
      setEmailStatus("This receipt is not yet synced online. Connect internet and try again.");
      return;
    }

    setEmailSending(true);
    setEmailStatus(null);
    try {
      const response = await sendSalesReceiptEmail({
        sale_ids: confirmedSales.map((s) => s.id),
        to_email: email,
        customer_name: pendingSales[0]?.customer_name || undefined,
      });
      setEmailStatus(response.message || "Receipt email sent.");
    } catch (err) {
      setEmailStatus(err instanceof Error ? err.message : "Failed to send receipt email.");
    } finally {
      setEmailSending(false);
    }
  };

  const productById = useMemo(() => {
    const map = new Map<number, Product>();
    for (const p of products) map.set(p.id, p);
    return map;
  }, [products]);

  const printReceipt = () => {
    if (pendingSales.length === 0) return;

    // Calculate totals
    const total = pendingSales.reduce((sum, sale) => sum + (Number(sale.total_price) || 0), 0);
    const customerName = pendingSales[0]?.customer_name;
    const paymentMethod = pendingSales[0]?.payment_method ?? "cash";
    const totalPaid = pendingSales.reduce((sum, sale) => sum + (Number(sale.amount_paid) || 0), 0);
    const receivedMethod = pendingSales.find((s) => s.partial_payment_method)?.partial_payment_method;
    const remainingBalance = paymentMethod === "credit" ? Math.max(0, total - totalPaid) : 0;

    // Build items HTML
    const itemsHTML = pendingSales
      .map((sale) => {
        const product = productById.get(sale.product_id);
        if (!product) return "";

        const isPack = sale.sale_unit_type === "pack" && typeof sale.pack_quantity === "number";
        const qtyDisplay = isPack ? sale.pack_quantity : Number(sale.quantity) || 0;
        const qtyLabel = isPack ? " pack" : "";

        const unitPrice = Number(sale.unit_price) || 0;
        const lineTotal = Number(sale.total_price) || 0;

        return `
          <div class="item-row"><div><strong>${product.name}</strong></div></div>
          <div class="item-row"><div>${qtyDisplay}${qtyLabel} × GHS ${unitPrice.toFixed(2)}</div><div>GHS ${lineTotal.toFixed(2)}</div></div>
        `;
      })
      .join("");

    const logoHtml = businessLogoUrl
      ? `<div style="margin-bottom:8px;"><img src="${businessLogoUrl}" alt="Logo" style="height:40px;max-width:140px;object-fit:contain;" /></div>`
      : "";

    const watermarkHtml = businessLogoUrl ? "" : "<div class=\"watermark\">Gel Invent</div>";

    const receiptHTML = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Receipt</title>
        <style>
          body { font-family: 'Courier New', monospace; max-width: 300px; margin: 0 auto; padding: 20px; }
          .header { text-align: center; margin-bottom: 20px; border-bottom: 2px dashed #000; padding-bottom: 10px; }
          .business-name { font-size: 18px; font-weight: bold; margin-bottom: 5px; }
          .receipt-info { font-size: 12px; margin-bottom: 15px; }
          .items { border-top: 1px dashed #000; border-bottom: 1px dashed #000; padding: 10px 0; margin: 15px 0; }
          .item-row { display: flex; justify-content: space-between; margin: 5px 0; }
          .total-section { margin-top: 15px; }
          .total-row { display: flex; justify-content: space-between; margin: 5px 0; font-weight: bold; }
          .footer { text-align: center; margin-top: 20px; font-size: 11px; border-top: 2px dashed #000; padding-top: 10px; }
          .watermark { position: fixed; top: 45%; left: 50%; transform: translate(-50%, -50%) rotate(-18deg); font-size: 36px; font-weight: 700; color: #000; opacity: 0.08; letter-spacing: 2px; pointer-events: none; }
          @media print { body { margin: 0; padding: 10px; } }
        </style>
      </head>
      <body>
        ${watermarkHtml}
        <div class="header">
          ${logoHtml}
          <div class="business-name">${businessName}</div>
          <div>Sales Receipt</div>
        </div>
        <div class="receipt-info">
          <div>Date: ${new Date().toLocaleString()}</div>
          <div>Served by: ${salesPerson}</div>
          ${customerName ? `<div>Customer: ${customerName}</div>` : ''}
        </div>
        <div class="items">${itemsHTML}</div>
        <div class="total-section">
          <div class="total-row"><div>TOTAL:</div><div>GHS ${total.toFixed(2)}</div></div>
          <div class="item-row"><div>Payment:</div><div>${paymentMethod.toUpperCase()}</div></div>
          ${paymentMethod === 'credit' ? `
            <div class="item-row" style="margin-top: 10px; padding-top: 10px; border-top: 1px dashed #000;">
              <div>Paid:</div><div>GHS ${totalPaid.toFixed(2)}</div>
            </div>
            ${receivedMethod ? `<div class="item-row"><div>Received via:</div><div>${String(receivedMethod).toUpperCase()}</div></div>` : ''}
            <div class="item-row" style="font-weight: bold;">
              <div>Balance:</div><div>GHS ${remainingBalance.toFixed(2)}</div>
            </div>
          ` : ''}
        </div>
        <div class="footer">
          <div>Thank you for your business!</div>
          <div>Please come again</div>
        </div>
      </body>
      </html>
    `;

    // Use iframe for printing - doesn't freeze the main app
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = 'none';
    document.body.appendChild(iframe);

    const iframeDoc = iframe.contentWindow?.document;
    if (!iframeDoc) {
      document.body.removeChild(iframe);
      alert("Failed to create print frame");
      return;
    }

    iframeDoc.open();
    iframeDoc.write(receiptHTML);
    iframeDoc.close();

    // Wait for content to render, then print
    setTimeout(() => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } catch (e) {
        console.error("Print error:", e);
      }
      // Clean up iframe after a delay (gives time for print dialog)
      setTimeout(() => {
        try {
          document.body.removeChild(iframe);
        } catch {
          // ignore
        }
      }, 1000);
    }, 100);

    // Close the modal immediately - don't wait for print to complete
    handleDone();
  };

  const handleDeleteSale = async (saleId: number) => {
    try {
      await deleteSale(saleId);
      await loadData(); // Refresh sales and products (to update stock)
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete sale");
    }
  };

  const salesPeriodLabel: Record<"all" | "day" | "week" | "month", string> = {
    all: "All time",
    day: "Today",
    week: "This week",
    month: "This month",
  };

  const periodStart = useMemo(() => {
    if (salesPeriod === "all") return null;
    const now = new Date();
    if (salesPeriod === "day") {
      return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    }
    if (salesPeriod === "week") {
      const day = now.getDay();
      const diff = (day + 6) % 7; // Monday start
      const start = new Date(now);
      start.setDate(now.getDate() - diff);
      start.setHours(0, 0, 0, 0);
      return start;
    }
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }, [salesPeriod]);

  const filteredSales = useMemo(() => {
    if (!periodStart) return sales;
    const startTime = periodStart.getTime();
    return sales.filter((sale) => new Date(sale.created_at).getTime() >= startTime);
  }, [sales, periodStart]);

  const filteredSalesTotal = useMemo(
    () => filteredSales.reduce((sum, sale) => sum + Number(sale.total_price || 0), 0),
    [filteredSales]
  );

  // PDF Export function
  const exportSalesPDF = (list: Sale[]) => {
    if (list.length === 0) return;

    const getProductName = (productId: number) => {
      const product = productById.get(productId);
      return product ? product.name : `Product #${productId}`;
    };

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

    const totalRevenue = list.reduce((sum, s) => sum + Number(s.total_price), 0);

    const pdfWindow = window.open("", "_blank");
    if (!pdfWindow) {
      alert("Please allow popups to export PDF");
      return;
    }

    const rowsHTML = list.map(sale => `
      <tr>
        <td>${formatDate(sale.created_at)}</td>
        <td>${getProductName(sale.product_id)}</td>
        <td style="text-align:right">${sale.quantity}</td>
        <td style="text-align:right">GHS ${Number(sale.unit_price).toFixed(2)}</td>
        <td style="text-align:right;font-weight:600">GHS ${Number(sale.total_price).toFixed(2)}</td>
        <td>${sale.customer_name || "-"}</td>
        <td>${sale.payment_method}</td>
      </tr>
    `).join("");

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Sales Report - ${businessName}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; font-size: 12px; }
          h1 { font-size: 18px; margin-bottom: 4px; }
          .subtitle { color: #666; margin-bottom: 20px; }
          table { width: 100%; border-collapse: collapse; margin-top: 16px; }
          th, td { padding: 8px; text-align: left; border-bottom: 1px solid #ddd; }
          th { background: #f5f5f5; font-weight: 600; }
          .total-row { background: #f0fdf4; font-weight: 700; }
          .summary { margin-top: 20px; padding: 12px; background: #f9fafb; border-radius: 8px; }
          @media print { body { padding: 0; } }
        </style>
      </head>
      <body>
        <h1>${businessName} - Sales Report</h1>
        <div class="subtitle">Generated on ${new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })}</div>
        
        <div class="summary">
          <strong>Total Sales:</strong> ${list.length} transactions | 
          <strong>Total Revenue:</strong> GHS ${totalRevenue.toFixed(2)}
        </div>
        
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Product</th>
              <th style="text-align:right">Qty</th>
              <th style="text-align:right">Price</th>
              <th style="text-align:right">Total</th>
              <th>Customer</th>
              <th>Payment</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHTML}
            <tr class="total-row">
              <td colspan="4" style="text-align:right"><strong>Grand Total:</strong></td>
              <td style="text-align:right"><strong>GHS ${totalRevenue.toFixed(2)}</strong></td>
              <td colspan="2"></td>
            </tr>
          </tbody>
        </table>
        
        <script>
          window.onload = function() { window.print(); }
        </script>
      </body>
      </html>
    `;

    pdfWindow.document.write(html);
    pdfWindow.document.close();
  };

  return (
    <div className="app-shell">
      <h1 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>Point of Sale</h1>

      {outboxCount > 0 && (
        <div className="card" style={{ marginBottom: 16, border: "1px solid #fde68a", background: "#fffbeb" }}>
          <p style={{ margin: 0, color: "#92400e" }}>
            Pending sync: {outboxCount} sale{outboxCount === 1 ? "" : "s"}. Connect to internet to auto-sync.
          </p>
          <button onClick={() => void syncOutboxOnce()} style={{ marginTop: 8 }}>
            Sync now
          </button>
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

      {/* POS Form */}
      <div className="card" style={{ marginBottom: 24, padding: 16 }}>
        {products.length === 0 && loading ? (
          <p style={{ margin: 0, color: "#6b7280" }}>Loading products...</p>
        ) : (
          <POSSaleForm products={products} onSubmit={handleCreateSale} />
        )}
      </div>

      {/* Sales List */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Recent Sales</h3>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
            <div style={{ fontSize: 12, color: "#6b7280" }}>
              Total ({salesPeriodLabel[salesPeriod]}): <strong style={{ color: "#111827" }}>GHS {filteredSalesTotal.toFixed(2)}</strong>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {(["day", "week", "month", "all"] as const).map((period) => (
                <button
                  key={period}
                  onClick={() => setSalesPeriod(period)}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 999,
                    border: "1px solid #e5e7eb",
                    background: salesPeriod === period ? "#111827" : "white",
                    color: salesPeriod === period ? "white" : "#374151",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  {period === "day" ? "Day" : period === "week" ? "Week" : period === "month" ? "Month" : "All"}
                </button>
              ))}
            </div>
            <button
              onClick={() => exportSalesPDF(filteredSales)}
              disabled={filteredSales.length === 0}
              style={{
                padding: "6px 12px",
                borderRadius: 4,
                border: "1px solid #e5e7eb",
                background: "white",
                color: "#374151",
                fontSize: 12,
                fontWeight: 500,
                cursor: filteredSales.length === 0 ? "not-allowed" : "pointer",
                opacity: filteredSales.length === 0 ? 0.5 : 1,
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              📄 Export PDF
            </button>
            {filteredSales.length > 5 && (
              <button
                onClick={() => setShowHistoryModal(true)}
                style={{
                  padding: "6px 12px",
                  borderRadius: 4,
                  border: "none",
                  background: "#111827",
                  color: "white",
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                View All ({filteredSales.length})
              </button>
            )}
          </div>
        </div>
        {filteredSales.length === 0 && loading ? (
          <p style={{ margin: 0, color: "#6b7280", fontSize: 13 }}>Loading sales...</p>
        ) : (
          <>
            {loading ? <p style={{ margin: "0 0 8px 0", color: "#6b7280", fontSize: 12 }}>Refreshing...</p> : null}
            <SalesList sales={filteredSales.slice(0, 5)} products={products} onDelete={handleDeleteSale} onRefresh={loadData} />
            {filteredSales.length > 5 && (
              <div style={{ textAlign: "center", marginTop: 12 }}>
                <button
                  onClick={() => setShowHistoryModal(true)}
                  style={{
                    padding: "8px 16px",
                    borderRadius: 4,
                    border: "1px solid #e5e7eb",
                    background: "white",
                    color: "#374151",
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  View {filteredSales.length - 5} more sales →
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Returns History */}
      <div className="card" style={{ marginTop: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Returns History</h3>
        </div>
        <ReturnsList products={products} />
      </div>

      {/* Confirmation Modal */}
      {showConfirmation && pendingSales.length > 0 && (
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
          onClick={() => {
            if (confirming) return;
            setShowConfirmation(false);
            setPendingSales([]);
          }}
        >
          <div
            style={{
              background: "#f1f5f9",
              borderRadius: 18,
              maxWidth: 380,
              width: "100%",
              maxHeight: "90vh",
              overflow: "hidden",
              boxShadow: "0 24px 56px rgba(15, 23, 42, 0.32)",
              display: "flex",
              flexDirection: "column",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{
              background: "white",
              borderTop: "4px solid #6366f1",
              borderBottom: "1px solid #e2e8f0",
              padding: "18px 20px 16px",
              position: "relative",
              textAlign: "center",
            }}>
              {businessLogoUrl ? (
                <img
                  src={businessLogoUrl}
                  alt="Business Logo"
                  style={{
                    width: 54,
                    height: 54,
                    borderRadius: "50%",
                    objectFit: "cover",
                    margin: "0 auto 10px",
                    display: "block",
                    border: "2px solid #ddd6fe",
                  }}
                />
              ) : (
                <div style={{
                  width: 54,
                  height: 54,
                  borderRadius: "50%",
                  border: "2px solid #ddd6fe",
                  color: "#6366f1",
                  margin: "0 auto 10px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 700,
                  fontSize: 22,
                  lineHeight: 1,
                }}>
                  POS
                </div>
              )}
              <h2 style={{ fontSize: 28, fontWeight: 800, margin: 0, color: "#0f172a", lineHeight: 1.05 }}>
                {businessName.toUpperCase()}
              </h2>
              <div style={{ marginTop: 4, fontSize: 11, fontWeight: 700, letterSpacing: "1px", color: "#94a3b8" }}>
                OFFICIAL RECEIPT
              </div>
              <div style={{ marginTop: 8, fontSize: 11, color: "#64748b" }}>
                {new Date().toLocaleString()}
              </div>
              <div style={{
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
              onClick={() => {
                if (confirming) return;
                setShowConfirmation(false);
                setPendingSales([]);
              }}
              >×</div>
            </div>

            {/* Scrollable Content */}
            <div style={{ flex: 1, overflow: "auto", padding: "14px 18px 18px" }}>
              <div style={{
                borderTop: "1px dashed #cbd5e1",
                borderBottom: "1px dashed #cbd5e1",
                padding: "10px 0",
                marginBottom: 12,
                fontSize: 12,
                color: "#334155",
                display: "grid",
                gap: 6,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <strong>RECEIPT NO:</strong>
                  <span>#{(pendingSales[0]?.client_sale_id ?? "10").split(":")[0].slice(-8).toUpperCase()}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <strong>SERVED BY:</strong>
                  <span>{salesPerson.toUpperCase()}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <strong>CUSTOMER:</strong>
                  <span>{(pendingSales[0]?.customer_name || "WALK-IN CUSTOMER").toUpperCase()}</span>
                </div>
              </div>

              <div style={{ marginBottom: 12 }}>
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto",
                  gap: 8,
                  paddingBottom: 8,
                  borderBottom: "1px solid #e2e8f0",
                  color: "#94a3b8",
                  fontSize: 11,
                  letterSpacing: "0.9px",
                  fontWeight: 700,
                }}>
                  <span>DESCRIPTION</span>
                  <span>AMOUNT</span>
                </div>

                {pendingSales.map((sale, index) => {
                  const product = products.find((p) => p.id === sale.product_id);
                  return (
                    <div
                      key={index}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr auto",
                        gap: 8,
                        padding: "10px 0",
                        borderBottom: index < pendingSales.length - 1 ? "1px solid #f1f5f9" : "none",
                      }}
                    >
                      <div>
                        <div style={{ fontSize: 16, fontWeight: 700, color: "#0f172a", lineHeight: 1.1 }}>
                          {(product?.name || "ITEM").toUpperCase()}
                        </div>
                        <div style={{ fontSize: 12, color: "#64748b", marginTop: 3 }}>
                          {sale.sale_unit_type === "pack" && typeof sale.pack_quantity === "number"
                            ? `${sale.pack_quantity} pack`
                            : sale.quantity} units @ {Number(sale.unit_price).toFixed(2)}
                        </div>
                      </div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: "#0f172a", whiteSpace: "nowrap" }}>
                        {Number(sale.total_price).toFixed(2)}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div style={{
                borderTop: "1px dashed #cbd5e1",
                marginTop: 8,
                paddingTop: 10,
                display: "grid",
                gap: 6,
                fontSize: 13,
                color: "#334155",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>Payment</span>
                  <strong style={{ textTransform: "uppercase" }}>{pendingSales[0].payment_method}</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 4 }}>
                  <span style={{ fontSize: 13, letterSpacing: "0.5px", color: "#475569" }}>TOTAL</span>
                  <strong style={{ fontSize: 28, color: "#0f172a", lineHeight: 1 }}>
                    GHS {pendingSales.reduce((sum, sale) => sum + sale.total_price, 0).toFixed(2)}
                  </strong>
                </div>
              </div>

              <div style={{
                textAlign: "center",
                marginTop: 14,
                fontSize: 11,
                color: "#94a3b8",
                letterSpacing: "0.7px",
              }}>
                THANK YOU FOR YOUR PURCHASE
              </div>
            </div>

            {/* Action Buttons */}
            <div style={{
              padding: "12px 18px 16px",
              background: "#f8fafc",
              borderTop: "1px solid #e2e8f0",
            }}>
              {!saleConfirmed ? (
                <div style={{ display: "flex", gap: 10 }}>
                  <button
                    type="button"
                    onClick={() => {
                      if (confirming) return;
                      setShowConfirmation(false);
                      setPendingSales([]);
                    }}
                    disabled={confirming}
                    style={{
                      flex: "0 0 auto",
                      padding: "12px 16px",
                      border: "1px solid #cbd5e1",
                      background: "white",
                      borderRadius: 9,
                      fontSize: 15,
                      fontWeight: 600,
                      color: "#64748b",
                      cursor: confirming ? "not-allowed" : "pointer",
                      opacity: confirming ? 0.6 : 1,
                    }}
                  >
                    ← Back
                  </button>

                  <button
                    type="button"
                    onClick={confirmSale}
                    disabled={confirming}
                    style={{
                      flex: 1,
                      padding: "12px 18px",
                      border: "none",
                      background: confirming ? "#94a3b8" : "#0f172a",
                      borderRadius: 9,
                      fontSize: 16,
                      fontWeight: 700,
                      color: "white",
                      cursor: confirming ? "not-allowed" : "pointer",
                    }}
                  >
                    {confirming ? "Processing..." : "Confirm Sale"}
                  </button>
                </div>
              ) : (
                <div style={{ display: "grid", gap: 10 }}>
                  <div style={{ display: "flex", gap: 10 }}>
                    <button
                      type="button"
                      onClick={printReceipt}
                      style={{
                        flex: 1,
                        padding: "12px 18px",
                        border: "1px solid #cbd5e1",
                        background: "white",
                        borderRadius: 9,
                        fontSize: 15,
                        fontWeight: 600,
                        color: "#334155",
                        cursor: "pointer",
                      }}
                    >
                      Print
                    </button>

                    <button
                      type="button"
                      onClick={handleDone}
                      style={{
                        flex: 1,
                        padding: "12px 18px",
                        border: "none",
                        background: "#0f172a",
                        borderRadius: 9,
                        fontSize: 16,
                        fontWeight: 700,
                        color: "white",
                        cursor: "pointer",
                      }}
                    >
                      Done
                    </button>
                  </div>

                  <div style={{ display: "grid", gap: 8, padding: 10, border: "1px solid #dbe5f2", borderRadius: 10, background: "#ffffff" }}>
                    <label style={{ display: "grid", gap: 4, margin: 0, fontSize: 12, color: "#475569", fontWeight: 600 }}>
                      Email receipt to customer
                      <input
                        type="email"
                        value={receiptEmail}
                        onChange={(e) => setReceiptEmail(e.target.value)}
                        placeholder="customer@email.com"
                        style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid #cbd5e1", fontSize: 14 }}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={sendReceiptToEmail}
                      disabled={emailSending || !receiptEmail.trim()}
                      style={{
                        padding: "10px 12px",
                        border: "none",
                        borderRadius: 8,
                        background: emailSending ? "#94a3b8" : "#2563eb",
                        color: "white",
                        fontWeight: 700,
                        cursor: emailSending ? "not-allowed" : "pointer",
                      }}
                    >
                      {emailSending ? "Sending..." : "Send Receipt Email"}
                    </button>
                    {emailStatus && (
                      <p style={{ margin: 0, fontSize: 12, color: emailStatus.toLowerCase().includes("success") ? "#166534" : "#b91c1c" }}>
                        {emailStatus}
                      </p>
                    )}
                    {confirmedSales.length === 0 && (
                      <p style={{ margin: 0, fontSize: 11, color: "#92400e" }}>
                        Receipt email is available after online sale sync.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Full History Modal */}
      {showHistoryModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0, 0, 0, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 20,
          }}
          onClick={() => setShowHistoryModal(false)}
        >
          <div
            style={{
              background: "white",
              borderRadius: 12,
              maxWidth: 900,
              width: "100%",
              maxHeight: "90vh",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div style={{
              padding: "16px 20px",
              borderBottom: "1px solid #e5e7eb",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              background: "#f9fafb",
            }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Sales History</h2>
                <p style={{ margin: "4px 0 0", fontSize: 12, color: "#6b7280" }}>
                  {filteredSales.length} total sales
                </p>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => exportSalesPDF(filteredSales)}
                  style={{
                    padding: "8px 14px",
                    borderRadius: 6,
                    border: "1px solid #e5e7eb",
                    background: "white",
                    color: "#374151",
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  📄 Export PDF
                </button>
                <button
                  onClick={() => setShowHistoryModal(false)}
                  style={{
                    padding: "8px 14px",
                    borderRadius: 6,
                    border: "none",
                    background: "#111827",
                    color: "white",
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: "pointer",
                  }}
                >
                  Close
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div style={{ flex: 1, overflow: "auto", padding: 16 }}>
              <SalesList sales={filteredSales} products={products} onDelete={handleDeleteSale} onRefresh={loadData} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}