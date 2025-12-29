import { useEffect, useMemo, useRef, useState } from "react";
import { Sale, Product, NewSale } from "../types";
import { fetchSales, createSaleForBranch, createSalesBulk, deleteSale, fetchProducts } from "../api";
import POSSaleForm from "../components/POSSaleForm";
import SalesList from "../components/SalesList";
import {
  applyLocalSaleToCachedProducts,
  cacheProducts,
  enqueueSales,
  getSalesOutboxCount,
  getSalesOutbox,
  removeOutboxItem,
  loadCachedProducts,
} from "../offline/storage";

export default function Sales() {
  const [sales, setSales] = useState<Sale[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingSales, setPendingSales] = useState<NewSale[]>([]);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [saleConfirmed, setSaleConfirmed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [offlineNotice, setOfflineNotice] = useState<string | null>(null);
  const [outboxCount, setOutboxCount] = useState<number>(() => getSalesOutboxCount());
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const receiptWindowRef = useRef<Window | null>(null);

  // Get user and business info for receipt
  const currentUser = localStorage.getItem("user");
  const userData = currentUser ? JSON.parse(currentUser) : null;
  const businessName = userData?.business_name || "Your Business";
  const salesPerson = userData?.name || "Sales Person";

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const productsData = await fetchProducts();
      setProducts(productsData);
      cacheProducts(productsData);

      try {
        const salesData = await fetchSales();
        setSales(salesData);
      } catch {
        // Sales list is optional for offline selling.
      }
    } catch (err) {
      // If products can't be fetched, fall back to cached products so POS can still work.
      const cached = loadCachedProducts();
      if (cached?.length) {
        setProducts(cached);
        setOfflineNotice("Offline mode: using cached products. Sales will sync when internet returns.");
      } else {
        setError(err instanceof Error ? err.message : "Failed to load data");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

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

  const syncOutboxOnce = async () => {
    if (!navigator.onLine) return;
    const outbox = getSalesOutbox().sort((a, b) => a.createdAt - b.createdAt);
    if (!outbox.length) return;

    for (const item of outbox) {
      try {
        await createSaleForBranch(item.sale, item.branchId);
        removeOutboxItem(item.id);
      } catch {
        // Stop on first failure (likely network/auth). We'll retry later.
        break;
      }
    }

    // Refresh products/sales after syncing.
    try {
      await loadData();
      setOfflineNotice(null);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    const onOnline = () => {
      void syncOutboxOnce();
    };
    window.addEventListener("online", onOnline);
    // Also try syncing shortly after mount.
    void syncOutboxOnce();
    return () => window.removeEventListener("online", onOnline);
  }, []);

  const handleCreateSale = async (salesArray: NewSale[]) => {
    // Show confirmation modal instead of submitting immediately
    const receiptId = (globalThis.crypto as Crypto | undefined)?.randomUUID?.() ?? `sale_${Date.now()}`;
    const withClientIds = salesArray.map((s, idx) => ({
      ...s,
      client_sale_id: s.client_sale_id ?? `${receiptId}:${idx}`,
    }));
    setPendingSales(withClientIds);
    setShowConfirmation(true);
    setSaleConfirmed(false); // Reset confirmed state for new sale
  };

  const confirmSale = async () => {
    if (pendingSales.length === 0) return;
    setConfirming(true);
    try {
      if (!navigator.onLine) {
        throw new Error("Offline");
      }

      // Create all sales
      await createSalesBulk(pendingSales);
      await loadData(); // Refresh sales and products (to update stock)
      setSaleConfirmed(true); // Show success state with print/done buttons
    } catch (err) {
      // Network issue: queue sale locally and sync later.
      enqueueSales(pendingSales);
      const updated = applyLocalSaleToCachedProducts(pendingSales);
      if (updated) setProducts(updated);
      setOfflineNotice("Offline mode: sale saved locally. It will sync when internet returns.");
      setSaleConfirmed(true);
    } finally {
      setConfirming(false);
    }
  };

  const handleDone = () => {
    setShowConfirmation(false);
    setPendingSales([]);
    setSaleConfirmed(false);
  };

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!event?.data) return;
      if (event.data !== "receipt:printed") return;
      if (receiptWindowRef.current && event.source !== receiptWindowRef.current) return;
      handleDone();
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const productById = useMemo(() => {
    const map = new Map<number, Product>();
    for (const p of products) map.set(p.id, p);
    return map;
  }, [products]);

  const printReceipt = () => {
    if (pendingSales.length === 0) return;

    // Open receipt window
    let receiptWindow = window.open("", "_blank");
    if (!receiptWindow) {
      alert("Please allow popups to print receipts");
      return;
    }
    receiptWindowRef.current = receiptWindow;

    try {
      // Calculate totals
      const total = pendingSales.reduce((sum, sale) => sum + (Number(sale.total_price) || 0), 0);
      const customerName = pendingSales[0]?.customer_name;
      const paymentMethod = pendingSales[0]?.payment_method ?? "cash";
      const amountPaid = Number(pendingSales[0]?.amount_paid) || 0;

      // Calculate remaining balance for credit sales
      const remainingBalance = paymentMethod === "credit" ? total - amountPaid : 0;

      // Build items HTML
      const itemsHTML = pendingSales
        .map((sale) => {
          const product = productById.get(sale.product_id);
          if (!product) return "";

          const quantity = Number(sale.quantity) || 0;
          const unitPrice = Number(sale.unit_price) || 0;
          const lineTotal = Number(sale.total_price) || quantity * unitPrice;

          return `
        <div class="item-row">
          <div><strong>${product.name}</strong></div>
        </div>
        <div class="item-row">
          <div>${quantity} × GHS ${unitPrice.toFixed(2)}</div>
          <div>GHS ${lineTotal.toFixed(2)}</div>
        </div>
      `;
        })
        .join("");

    const receiptHTML = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Receipt</title>
        <style>
          body {
            font-family: 'Courier New', monospace;
            max-width: 300px;
            margin: 20px auto;
            padding: 20px;
          }
          .header {
            text-align: center;
            margin-bottom: 20px;
            border-bottom: 2px dashed #000;
            padding-bottom: 10px;
          }
          .business-name {
            font-size: 18px;
            font-weight: bold;
            margin-bottom: 5px;
          }
          .receipt-info {
            font-size: 12px;
            margin-bottom: 15px;
          }
          .items {
            border-top: 1px dashed #000;
            border-bottom: 1px dashed #000;
            padding: 10px 0;
            margin: 15px 0;
          }
          .item-row {
            display: flex;
            justify-content: space-between;
            margin: 5px 0;
          }
          .total-section {
            margin-top: 15px;
          }
          .total-row {
            display: flex;
            justify-content: space-between;
            margin: 5px 0;
            font-weight: bold;
          }
          .footer {
            text-align: center;
            margin-top: 20px;
            font-size: 11px;
            border-top: 2px dashed #000;
            padding-top: 10px;
          }
          @media print {
            body {
              margin: 0;
              padding: 10px;
            }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="business-name">${businessName}</div>
          <div>Sales Receipt</div>
        </div>
        
        <div class="receipt-info">
          <div>Date: ${new Date().toLocaleString()}</div>
          <div>Served by: ${salesPerson}</div>
          ${customerName ? `<div>Customer: ${customerName}</div>` : ''}
        </div>

        <div class="items">
          ${itemsHTML}
        </div>

        <div class="total-section">
          <div class="total-row">
            <div>TOTAL:</div>
            <div>GHS ${total.toFixed(2)}</div>
          </div>
          <div class="item-row">
            <div>Payment:</div>
            <div>${paymentMethod.toUpperCase()}</div>
          </div>
          ${paymentMethod === 'credit' ? `
            <div class="item-row" style="margin-top: 10px; padding-top: 10px; border-top: 1px dashed #000;">
              <div>Paid:</div>
              <div>GHS ${amountPaid.toFixed(2)}</div>
            </div>
            <div class="item-row" style="font-weight: bold;">
              <div>Balance:</div>
              <div>GHS ${remainingBalance.toFixed(2)}</div>
            </div>
          ` : ''}
        </div>

        <div class="footer">
          <div>Thank you for your business!</div>
          <div>Please come again</div>
        </div>

        <script>
          window.onload = function() {
            function safeClose() {
              try {
                window.close();
              } catch (e) {
                // ignore
              }
            }

            var printed = false;
            function notifyPrintedAndClose() {
              if (printed) return;
              printed = true;
              try {
                if (window.opener && typeof window.opener.postMessage === 'function') {
                  window.opener.postMessage('receipt:printed', '*');
                }
              } catch (e) {
                // ignore
              }
              safeClose();
            }

            // Close the receipt window after the print dialog completes
            window.onafterprint = notifyPrintedAndClose;
            try {
              window.addEventListener('afterprint', notifyPrintedAndClose);
            } catch (e) {
              // ignore
            }

            // Some browsers fire matchMedia print events more reliably than afterprint
            try {
              var mql = window.matchMedia('print');
              if (mql && typeof mql.addEventListener === 'function') {
                mql.addEventListener('change', function (e) {
                  if (!e.matches) notifyPrintedAndClose();
                });
              } else if (mql && typeof mql.addListener === 'function') {
                mql.addListener(function (e) {
                  if (!e.matches) notifyPrintedAndClose();
                });
              }
            } catch (e) {
              // ignore
            }

            setTimeout(function() {
              window.print();
            }, 250);

            // Fallback: if print events don't fire, don't leave the tab open.
            setTimeout(function() {
              if (!printed) safeClose();
            }, 15000);
          };
        </script>
      </body>
      </html>
    `;

      // Write receipt HTML immediately (synchronously)
      receiptWindow.document.write(receiptHTML);
      receiptWindow.document.close();
      
      // Close POS confirmation modal after a tiny delay to prevent UI freeze
      window.setTimeout(() => {
        handleDone();
      }, 100);
      
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      try {
        receiptWindow.document.write(
          `<!doctype html><html><head><title>Receipt Error</title></head><body style="font-family:system-ui;padding:16px">
            <h3 style="margin:0 0 8px 0">Failed to render receipt</h3>
            <div style="white-space:pre-wrap;color:#b91c1c">${message}</div>
          </body></html>`,
        );
        receiptWindow.document.close();
      } catch {
        // ignore
      }
      // Still close the modal even if receipt failed
      window.setTimeout(() => {
        handleDone();
      }, 100);
    }
  };

  const handleDeleteSale = async (saleId: number) => {
    try {
      await deleteSale(saleId);
      await loadData(); // Refresh sales and products (to update stock)
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete sale");
    }
  };

  // PDF Export function
  const exportSalesPDF = () => {
    if (sales.length === 0) return;

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

    const totalRevenue = sales.reduce((sum, s) => sum + Number(s.total_price), 0);

    const pdfWindow = window.open("", "_blank");
    if (!pdfWindow) {
      alert("Please allow popups to export PDF");
      return;
    }

    const rowsHTML = sales.map(sale => `
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
          <strong>Total Sales:</strong> ${sales.length} transactions | 
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
      <h1 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>💳 Point of Sale</h1>

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
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => exportSalesPDF()}
              disabled={sales.length === 0}
              style={{
                padding: "6px 12px",
                borderRadius: 4,
                border: "1px solid #e5e7eb",
                background: "white",
                color: "#374151",
                fontSize: 12,
                fontWeight: 500,
                cursor: sales.length === 0 ? "not-allowed" : "pointer",
                opacity: sales.length === 0 ? 0.5 : 1,
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              📄 Export PDF
            </button>
            {sales.length > 5 && (
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
                View All ({sales.length})
              </button>
            )}
          </div>
        </div>
        {sales.length === 0 && loading ? (
          <p style={{ margin: 0, color: "#6b7280", fontSize: 13 }}>Loading sales...</p>
        ) : (
          <>
            {loading ? <p style={{ margin: "0 0 8px 0", color: "#6b7280", fontSize: 12 }}>Refreshing...</p> : null}
            <SalesList sales={sales.slice(0, 5)} products={products} onDelete={handleDeleteSale} />
            {sales.length > 5 && (
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
                  View {sales.length - 5} more sales →
                </button>
              </div>
            )}
          </>
        )}
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
            background: "rgba(0, 0, 0, 0.5)",
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
              background: "white",
              borderRadius: 16,
              maxWidth: 480,
              width: "100%",
              maxHeight: "90vh",
              overflow: "hidden",
              boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
              display: "flex",
              flexDirection: "column",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{ 
              background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
              padding: "24px 24px 28px",
              color: "white",
              position: "relative",
            }}>
              <div style={{ fontSize: 40, marginBottom: 8, textAlign: "center" }}>🛒</div>
              <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0, textAlign: "center" }}>
                Order Confirmation
              </h2>
              <div style={{ fontSize: 11, textAlign: "center", opacity: 0.9, marginTop: 4 }}>
                v2.0 • New Design
              </div>
              <div style={{
                position: "absolute",
                top: 16,
                right: 16,
                background: "rgba(255,255,255,0.2)",
                borderRadius: "50%",
                width: 32,
                height: 32,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 18,
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
            <div style={{ flex: 1, overflow: "auto", padding: 24 }}>
              {/* Items List */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ 
                  fontSize: 11, 
                  fontWeight: 700, 
                  letterSpacing: "0.5px",
                  color: "#9ca3af", 
                  marginBottom: 12,
                  textTransform: "uppercase",
                }}>
                  Order Items • {pendingSales.length}
                </div>
                <div style={{ 
                  background: "#f9fafb", 
                  borderRadius: 12, 
                  padding: "16px",
                  border: "1px solid #f3f4f6",
                }}>
                  {pendingSales.map((sale, index) => {
                    const product = products.find(p => p.id === sale.product_id);
                    return (
                      <div 
                        key={index} 
                        style={{ 
                          paddingBottom: index < pendingSales.length - 1 ? 16 : 0,
                          marginBottom: index < pendingSales.length - 1 ? 16 : 0,
                          borderBottom: index < pendingSales.length - 1 ? "1px solid #e5e7eb" : "none",
                        }}
                      >
                        <div style={{ display: "flex", gap: 12, alignItems: "start" }}>
                          <div style={{
                            background: "white",
                            width: 40,
                            height: 40,
                            borderRadius: 8,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: 18,
                            flexShrink: 0,
                            border: "1px solid #e5e7eb",
                          }}>📦</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ 
                              fontSize: 15, 
                              fontWeight: 600, 
                              color: "#111827",
                              marginBottom: 4,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}>
                              {product?.name}
                            </div>
                            <div style={{ fontSize: 13, color: "#6b7280" }}>
                              {sale.quantity} × GHS {sale.unit_price.toFixed(2)}
                            </div>
                          </div>
                          <div style={{ 
                            fontSize: 16, 
                            fontWeight: 700, 
                            color: "#059669",
                            flexShrink: 0,
                          }}>
                            GHS {sale.total_price.toFixed(2)}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Customer & Payment Info */}
              <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
                {pendingSales[0].customer_name && (
                  <div style={{ 
                    flex: 1,
                    background: "#eff6ff",
                    border: "1px solid #dbeafe",
                    borderRadius: 10,
                    padding: 12,
                  }}>
                    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.5px", color: "#3b82f6", marginBottom: 4, textTransform: "uppercase" }}>Customer</div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#1e40af" }}>
                      {pendingSales[0].customer_name}
                    </div>
                  </div>
                )}
                
                <div style={{ 
                  flex: 1,
                  background: "#fef3c7",
                  border: "1px solid #fde68a",
                  borderRadius: 10,
                  padding: 12,
                }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.5px", color: "#d97706", marginBottom: 4, textTransform: "uppercase" }}>Payment</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#92400e", textTransform: "capitalize" }}>
                    {pendingSales[0].payment_method}
                  </div>
                </div>
              </div>

              {/* Total */}
              <div style={{ 
                background: "linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)",
                borderRadius: 12,
                padding: 20,
                border: "2px solid #10b981",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: "#065f46", textTransform: "uppercase", letterSpacing: "0.5px" }}>Total Amount</span>
                  <span style={{ fontSize: 32, fontWeight: 800, color: "#059669" }}>
                    GHS {pendingSales.reduce((sum, sale) => sum + sale.total_price, 0).toFixed(2)}
                  </span>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div style={{ 
              padding: "16px 24px 24px",
              background: "white",
              borderTop: "1px solid #f3f4f6",
            }}>
              {!saleConfirmed ? (
                // Before confirmation: Back and Confirm buttons
                <div style={{ display: "flex", gap: 12 }}>
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
                      padding: "14px 20px",
                      border: "2px solid #e5e7eb",
                      background: "white",
                      borderRadius: 10,
                      fontSize: 15,
                      fontWeight: 600,
                      color: "#6b7280",
                      cursor: confirming ? "not-allowed" : "pointer",
                      opacity: confirming ? 0.5 : 1,
                      transition: "all 0.2s",
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
                      padding: "14px 24px",
                      border: "none",
                      background: confirming 
                        ? "#9ca3af" 
                        : "linear-gradient(135deg, #10b981, #059669)",
                      borderRadius: 10,
                      fontSize: 16,
                      fontWeight: 700,
                      color: "white",
                      cursor: confirming ? "not-allowed" : "pointer",
                      boxShadow: confirming ? "none" : "0 4px 14px rgba(16, 185, 129, 0.4)",
                      transition: "all 0.2s",
                    }}
                  >
                    {confirming ? "⏳ Processing..." : "✓ Confirm Sale"}
                  </button>
                </div>
              ) : (
                // After confirmation: Print and Done buttons
                <div style={{ display: "flex", gap: 12 }}>
                  <button
                    type="button"
                    onClick={printReceipt}
                    style={{
                      flex: 1,
                      padding: "14px 24px",
                      border: "2px solid #3b82f6",
                      background: "white",
                      borderRadius: 10,
                      fontSize: 15,
                      fontWeight: 600,
                      color: "#3b82f6",
                      cursor: "pointer",
                      transition: "all 0.2s",
                    }}
                  >
                    🖨️ Print
                  </button>
                  
                  <button
                    type="button"
                    onClick={handleDone}
                    style={{
                      flex: 1,
                      padding: "14px 24px",
                      border: "none",
                      background: "linear-gradient(135deg, #10b981, #059669)",
                      borderRadius: 10,
                      fontSize: 16,
                      fontWeight: 700,
                      color: "white",
                      cursor: "pointer",
                      boxShadow: "0 4px 12px rgba(16, 185, 129, 0.3)",
                    }}
                  >
                    ✓ Done
                  </button>
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
                  {sales.length} total sales
                </p>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => exportSalesPDF()}
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
              <SalesList sales={sales} products={products} onDelete={handleDeleteSale} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}