import { useEffect, useState } from "react";
import { Sale, Product, NewSale } from "../types";
import { fetchSales, createSale, createSaleForBranch, deleteSale, fetchProducts } from "../api";
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
      for (const sale of pendingSales) {
        await createSale(sale);
      }
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

  const printReceipt = () => {
    if (pendingSales.length === 0) return;

    const receiptWindow = window.open('', '_blank');
    if (!receiptWindow) return;

    // Calculate totals
    const total = pendingSales.reduce((sum, sale) => sum + sale.total_price, 0);
    const customerName = pendingSales[0].customer_name;
    const paymentMethod = pendingSales[0].payment_method ?? "cash";
    const amountPaid = pendingSales[0].amount_paid || 0;
    
    // Calculate remaining balance for credit sales
    const remainingBalance = paymentMethod === 'credit' ? total - amountPaid : 0;

    // Build items HTML
    const itemsHTML = pendingSales.map(sale => {
      const product = products.find(p => p.id === sale.product_id);
      if (!product) return '';
      
      return `
        <div class="item-row">
          <div><strong>${product.name}</strong></div>
        </div>
        <div class="item-row">
          <div>${sale.quantity} × GHS ${sale.unit_price.toFixed(2)}</div>
          <div>GHS ${sale.total_price.toFixed(2)}</div>
        </div>
      `;
    }).join('');

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
            setTimeout(function() {
              window.print();
            }, 250);
          };
        </script>
      </body>
      </html>
    `;

    receiptWindow.document.write(receiptHTML);
    receiptWindow.document.close();
  };

  const handleDeleteSale = async (saleId: number) => {
    try {
      await deleteSale(saleId);
      await loadData(); // Refresh sales and products (to update stock)
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete sale");
    }
  };

  return (
    <div className="app-shell">
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 24 }}>💳 Point of Sale</h1>

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
        <h3 style={{ margin: "0 0 16px 0" }}>Recent Sales</h3>
        {sales.length === 0 && loading ? (
          <p style={{ margin: 0, color: "#6b7280" }}>Loading sales...</p>
        ) : (
          <>
            {loading ? <p style={{ margin: "0 0 12px 0", color: "#6b7280", fontSize: 13 }}>Refreshing...</p> : null}
            <SalesList sales={sales} products={products} onDelete={handleDeleteSale} />
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
              borderRadius: 12,
              maxWidth: 500,
              width: "100%",
              maxHeight: "90vh",
              overflow: "auto",
              padding: 32,
              boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ textAlign: "center", marginBottom: 24 }}>
              <div style={{ fontSize: 48, marginBottom: 8 }}>✅</div>
              <h2 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 8px", color: "#059669" }}>
                Confirm Sale
              </h2>
              <p style={{ color: "#6b7280", margin: 0 }}>
                Please review the transaction details before confirming
              </p>
            </div>

            {/* Sale Summary */}
            <div style={{ background: "#f9fafb", borderRadius: 8, padding: 20, marginBottom: 24 }}>
              <div style={{ marginBottom: 16, paddingBottom: 16, borderBottom: "2px dashed #e5e7eb" }}>
                <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>ITEMS ({pendingSales.length})</div>
                {pendingSales.map((sale, index) => {
                  const product = products.find(p => p.id === sale.product_id);
                  return (
                    <div key={index} style={{ marginBottom: 12 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
                        <div>
                          <div style={{ fontSize: 16, fontWeight: 600, color: "#111827" }}>
                            {product?.name}
                          </div>
                          <div style={{ fontSize: 13, color: "#6b7280" }}>
                            {sale.quantity} × GHS {sale.unit_price.toFixed(2)}
                          </div>
                        </div>
                        <div style={{ fontSize: 16, fontWeight: 700, color: "#059669" }}>
                          GHS {sale.total_price.toFixed(2)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {pendingSales[0].customer_name && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>CUSTOMER</div>
                  <div style={{ fontSize: 16, fontWeight: 600, color: "#374151" }}>
                    {pendingSales[0].customer_name}
                  </div>
                </div>
              )}

              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>PAYMENT METHOD</div>
                <div style={{ fontSize: 16, fontWeight: 600, color: "#374151", textTransform: "uppercase" }}>
                  {pendingSales[0].payment_method}
                </div>
              </div>

              <div style={{ paddingTop: 16, borderTop: "2px solid #e5e7eb" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 18, fontWeight: 600, color: "#111827" }}>TOTAL</span>
                  <span style={{ fontSize: 28, fontWeight: 700, color: "#059669" }}>
                    GHS {pendingSales.reduce((sum, sale) => sum + sale.total_price, 0).toFixed(2)}
                  </span>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div style={{ display: "flex", gap: 12 }}>
              {!saleConfirmed ? (
                // Before confirmation: Back and Confirm buttons
                <>
                  <button
                    type="button"
                    onClick={() => {
                      if (confirming) return;
                      setShowConfirmation(false);
                      setPendingSales([]);
                    }}
                    disabled={confirming}
                    style={{
                      flex: 1,
                      padding: "12px 24px",
                      border: "2px solid #e5e7eb",
                      background: "white",
                      borderRadius: 8,
                      fontSize: 15,
                      fontWeight: 600,
                      color: "#6b7280",
                      cursor: confirming ? "not-allowed" : "pointer",
                      opacity: confirming ? 0.6 : 1,
                    }}
                  >
                    ← Go Back
                  </button>
                  
                  <button
                    type="button"
                    onClick={confirmSale}
                    disabled={confirming}
                    style={{
                      flex: 1,
                      padding: "12px 24px",
                      border: "none",
                      background: "linear-gradient(135deg, #10b981, #059669)",
                      borderRadius: 8,
                      fontSize: 15,
                      fontWeight: 600,
                      color: "white",
                      cursor: confirming ? "not-allowed" : "pointer",
                      opacity: confirming ? 0.8 : 1,
                      boxShadow: "0 4px 12px rgba(16, 185, 129, 0.3)",
                    }}
                  >
                    {confirming ? "Processing..." : "✓ Confirm Sale"}
                  </button>
                </>
              ) : (
                // After confirmation: Print and Done buttons
                <>
                  <button
                    type="button"
                    onClick={printReceipt}
                    style={{
                      flex: 1,
                      padding: "12px 24px",
                      border: "2px solid #3b82f6",
                      background: "#eff6ff",
                      borderRadius: 8,
                      fontSize: 15,
                      fontWeight: 600,
                      color: "#3b82f6",
                      cursor: "pointer",
                    }}
                  >
                    🖨️ Print Receipt
                  </button>
                  
                  <button
                    type="button"
                    onClick={handleDone}
                    style={{
                      flex: 1,
                      padding: "12px 24px",
                      border: "none",
                      background: "linear-gradient(135deg, #10b981, #059669)",
                      borderRadius: 8,
                      fontSize: 15,
                      fontWeight: 600,
                      color: "white",
                      cursor: "pointer",
                      boxShadow: "0 4px 12px rgba(16, 185, 129, 0.3)",
                    }}
                  >
                    ✓ Done
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

