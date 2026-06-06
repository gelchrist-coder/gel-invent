import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Sale, Product, NewSale } from "../types";
import { assignSaleCustomer, fetchSalesCached, createSalesBulk, deleteSale, fetchProductsCached, getCachedProducts, getCachedSales, isTemporaryServerDelayError, sendSalesReceiptEmail } from "../api";
import POSSaleForm from "../components/POSSaleForm";
import SalesList from "../components/SalesList";
import ReturnsList from "../components/ReturnsList";
import { SaleTransaction, formatSaleQuantityLabel, groupSalesIntoTransactions } from "../sales-transactions";
import {
  applyLocalSaleToCachedProducts,
  cacheProducts,
  enqueueSales,
  getSalesOutboxCount,
  loadCachedProducts,
  removeOutboxItem,
} from "../offline/storage";
import { syncSalesOutboxOnce } from "../offline/sync";
import { getDisplayBusinessLogoUrl, getDisplayBusinessName, hasUserPermission, readStoredUser } from "../user-storage";

type SalesPaymentFilterOption = {
  key: string;
  label: string;
  count: number;
};

const SALES_PERIOD_LABEL: Record<"all" | "day" | "week" | "month", string> = {
  all: "All time",
  day: "Today",
  week: "This week",
  month: "This month",
};

const WALK_IN_NAMES = new Set(["walk in", "walk in customer", "walkin", "guest", "anonymous"]);

function normalizeSalePaymentMethod(paymentMethod: string | null | undefined): string {
  const normalized = String(paymentMethod ?? "").trim().toLowerCase();
  return normalized || "unknown";
}

function formatPaymentLabel(paymentMethod: string): string {
  if (paymentMethod === "unknown") return "Unknown";
  return paymentMethod
    .replace(/_/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function toCurrency(value: number): string {
  return `GHS ${value.toFixed(2)}`;
}

function isWalkInCustomerName(name: string | null | undefined): boolean {
  const raw = String(name || "").trim();
  if (!raw) return true;
  const normalized = raw.toLowerCase().replace(/[-_]/g, " ").replace(/\s+/g, " ").trim();
  return WALK_IN_NAMES.has(normalized);
}

function shouldQueueSaleRetry(error: unknown): boolean {
  if (!navigator.onLine) {
    return true;
  }

  if (isTemporaryServerDelayError(error)) {
    return true;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return message.includes("unable to reach the server") || message.includes("appear to be offline");
}

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
  const [confirmationError, setConfirmationError] = useState<string | null>(null);
  const [confirmedSales, setConfirmedSales] = useState<Sale[]>([]);
  const [receiptEmail, setReceiptEmail] = useState("");
  const [emailSending, setEmailSending] = useState(false);
  const [emailStatus, setEmailStatus] = useState<string | null>(null);
  const [offlineNotice, setOfflineNotice] = useState<string | null>(null);
  const [outboxCount, setOutboxCount] = useState<number>(() => getSalesOutboxCount());
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [salesPeriod, setSalesPeriod] = useState<"all" | "day" | "week" | "month">("all");
  const [salesSearchTerm, setSalesSearchTerm] = useState("");
  const [salesPaymentFilter, setSalesPaymentFilter] = useState("all");
  const [salesRowsLimit, setSalesRowsLimit] = useState<number>(5);
  const [assignCustomerTransaction, setAssignCustomerTransaction] = useState<SaleTransaction | null>(null);
  const [assignCustomerName, setAssignCustomerName] = useState("");
  const [assignCustomerPhone, setAssignCustomerPhone] = useState("");
  const [assignCustomerEmail, setAssignCustomerEmail] = useState("");
  const [assignCustomerNotes, setAssignCustomerNotes] = useState("");
  const [assignCustomerError, setAssignCustomerError] = useState<string | null>(null);
  const [assigningCustomer, setAssigningCustomer] = useState(false);
  const [repeatDraft, setRepeatDraft] = useState<{ token: string; sales: NewSale[]; sourceLabel?: string } | null>(null);
  const hasLoadedOnce = useRef(false);

  // Get user and business info for receipt
  const userData = readStoredUser();
  const businessName = getDisplayBusinessName(userData);
  const businessLogoUrl = getDisplayBusinessLogoUrl(userData);
  const salesPerson = userData?.name || "Sales Person";
  const canDeleteSales = hasUserPermission("delete_sales", userData);
  const canSendSaleReceipts = hasUserPermission("send_sale_receipts", userData);

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
    setConfirmationError(null);
    setShowConfirmation(true);
    setSaleConfirmed(false); // Reset confirmed state for new sale
  };

  const confirmSale = async () => {
    if (pendingSales.length === 0) return;
    setConfirming(true);
    setConfirmationError(null);
    try {
      // Instant UI: mark as confirmed and sync in the background.
      setSaleConfirmed(true);
      setConfirmedSales([]);

      // Optimistically update local stock and queue the sale.
      const queuedItems = enqueueSales(pendingSales);
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
        } catch (error) {
          if (shouldQueueSaleRetry(error)) {
            setOfflineNotice("Sale queued for sync. We'll retry automatically.");
            return;
          }

          queuedItems.forEach((item) => removeOutboxItem(item.id));
          setSaleConfirmed(false);
          setConfirmedSales([]);
          setConfirmationError(error instanceof Error ? error.message : "Sale could not be completed.");
          try {
            await loadData();
          } catch {
            // Keep the validation error visible even if the reload fails.
          }
        }
      })();
    } catch {
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
    setConfirmationError(null);
    setSaleConfirmed(false);
    // Reset flag after state updates
    setTimeout(() => { doneRef.current = false; }, 100);
  };

  const sendReceiptToEmail = async () => {
    if (!canSendSaleReceipts) {
      setEmailStatus("You do not have permission to send receipt emails.");
      return;
    }

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

        const unitPrice = Number(sale.unit_price) || 0;
        const lineTotal = Number(sale.total_price) || 0;

        return `
          <div class="item-row"><div><strong>${product.name}</strong></div></div>
          <div class="item-row"><div>${formatSaleQuantityLabel(sale)} × GHS ${unitPrice.toFixed(2)}</div><div>GHS ${lineTotal.toFixed(2)}</div></div>
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

  const reprintSaleReceipt = (transaction: SaleTransaction) => {
    const salesSorted = [...transaction.sales].sort((left, right) => {
      const timeDiff = new Date(left.created_at).getTime() - new Date(right.created_at).getTime();
      if (timeDiff !== 0) return timeDiff;
      return left.id - right.id;
    });
    const logoHtml = businessLogoUrl
      ? `<div style="margin-bottom:8px;"><img src="${businessLogoUrl}" alt="Logo" style="height:40px;max-width:140px;object-fit:contain;" /></div>`
      : "";
    const watermarkHtml = businessLogoUrl ? "" : '<div class="watermark">Gel Invent</div>';
    const itemsHTML = salesSorted
      .map((sale) => {
        const product = productById.get(sale.product_id);
        const productName = product?.name || `Product #${sale.product_id}`;

        return `
          <div class="item-row"><div><strong>${productName}</strong></div></div>
          <div class="item-row"><div>${formatSaleQuantityLabel(sale)} × GHS ${Number(sale.unit_price).toFixed(2)}</div><div>GHS ${Number(sale.total_price).toFixed(2)}</div></div>
        `;
      })
      .join("");
    const totalPaid = Number(transaction.amount_paid || 0);
    const paymentMethod = String(transaction.payment_method || "cash");
    const remainingBalance = Math.max(0, Number(transaction.total_price || 0) - totalPaid);

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
          <div>Receipt No: #${transaction.receiptNumber}</div>
          <div>Date: ${new Date(transaction.created_at).toLocaleString()}</div>
          <div>Served by: ${transaction.created_by_name || salesPerson}</div>
          ${transaction.customer_name ? `<div>Customer: ${transaction.customer_name}</div>` : "<div>Customer: Walk-in</div>"}
        </div>
        <div class="items">${itemsHTML}</div>
        <div class="total-section">
          <div class="total-row"><div>TOTAL:</div><div>GHS ${Number(transaction.total_price || 0).toFixed(2)}</div></div>
          <div class="item-row"><div>Payment:</div><div>${paymentMethod.toUpperCase()}</div></div>
          ${totalPaid > 0 ? `<div class="item-row"><div>Paid:</div><div>GHS ${totalPaid.toFixed(2)}</div></div>` : ""}
          ${transaction.partial_payment_method ? `<div class="item-row"><div>Received via:</div><div>${String(transaction.partial_payment_method).toUpperCase()}</div></div>` : ""}
          ${remainingBalance > 0 ? `<div class="item-row"><div>Balance:</div><div>GHS ${remainingBalance.toFixed(2)}</div></div>` : ""}
        </div>
        <div class="footer">
          <div>Thank you for your business!</div>
          <div>Please come again</div>
        </div>
        <script>
          window.onload = function() { window.print(); }
        </script>
      </body>
      </html>
    `;

    const receiptWindow = window.open("", "_blank");
    if (!receiptWindow) {
      alert("Please allow popups to print receipt");
      return;
    }

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

  const closeAssignCustomerModal = () => {
    setAssignCustomerTransaction(null);
    setAssignCustomerName("");
    setAssignCustomerPhone("");
    setAssignCustomerEmail("");
    setAssignCustomerNotes("");
    setAssignCustomerError(null);
  };

  const openAssignCustomerModal = (transaction: SaleTransaction) => {
    setAssignCustomerTransaction(transaction);
    setAssignCustomerName(isWalkInCustomerName(transaction.customer_name) ? "" : String(transaction.customer_name || ""));
    setAssignCustomerPhone("");
    setAssignCustomerEmail("");
    setAssignCustomerNotes("");
    setAssignCustomerError(null);
  };

  const submitAssignCustomer = async (event: FormEvent) => {
    event.preventDefault();
    if (!assignCustomerTransaction) return;

    const customerName = assignCustomerName.trim();
    const customerPhone = assignCustomerPhone.trim();
    const customerEmail = assignCustomerEmail.trim();
    const notes = assignCustomerNotes.trim();

    if (!customerName) {
      setAssignCustomerError("Customer name is required.");
      return;
    }

    setAssigningCustomer(true);
    setAssignCustomerError(null);
    try {
      await assignSaleCustomer(assignCustomerTransaction.primarySale.id, {
        customer_name: customerName,
        phone: customerPhone || undefined,
        email: customerEmail || undefined,
        notes: notes || undefined,
      });
      closeAssignCustomerModal();
      await loadData();
    } catch (err) {
      setAssignCustomerError(err instanceof Error ? err.message : "Failed to assign customer.");
    } finally {
      setAssigningCustomer(false);
    }
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

  const periodFilteredSales = useMemo(() => {
    if (!periodStart) return sales;
    const startTime = periodStart.getTime();
    return sales.filter((sale) => new Date(sale.created_at).getTime() >= startTime);
  }, [sales, periodStart]);

  const periodTransactions = useMemo(
    () => groupSalesIntoTransactions(periodFilteredSales, productById),
    [periodFilteredSales, productById],
  );

  const paymentFilterOptions = useMemo<SalesPaymentFilterOption[]>(() => {
    const paymentCounts = new Map<string, number>();

    for (const sale of periodTransactions) {
      const key = normalizeSalePaymentMethod(sale.payment_method);
      paymentCounts.set(key, (paymentCounts.get(key) ?? 0) + 1);
    }

    const dynamicOptions = Array.from(paymentCounts.entries())
      .sort((a, b) => formatPaymentLabel(a[0]).localeCompare(formatPaymentLabel(b[0])))
      .map(([key, count]) => ({
        key,
        label: formatPaymentLabel(key),
        count,
      }));

    return [{ key: "all", label: "All", count: periodTransactions.length }, ...dynamicOptions];
  }, [periodTransactions]);

  useEffect(() => {
    if (paymentFilterOptions.some((option) => option.key === salesPaymentFilter)) {
      return;
    }
    setSalesPaymentFilter("all");
  }, [paymentFilterOptions, salesPaymentFilter]);

  const filteredSales = useMemo(() => {
    const query = salesSearchTerm.trim().toLowerCase();

    return periodTransactions.filter((sale) => {
      const paymentKey = normalizeSalePaymentMethod(sale.payment_method);
      const matchesPayment = salesPaymentFilter === "all" || paymentKey === salesPaymentFilter;
      if (!matchesPayment) return false;

      if (!query) return true;

      return sale.searchText.includes(query) || formatPaymentLabel(paymentKey).toLowerCase().includes(query);
    });
  }, [periodTransactions, salesPaymentFilter, salesSearchTerm]);

  const periodSalesTotal = useMemo(
    () => periodTransactions.reduce((sum, sale) => sum + Number(sale.total_price || 0), 0),
    [periodTransactions]
  );

  const filteredSalesTotal = useMemo(
    () => filteredSales.reduce((sum, sale) => sum + Number(sale.total_price || 0), 0),
    [filteredSales]
  );

  const visibleSales = useMemo(
    () => filteredSales.slice(0, salesRowsLimit),
    [filteredSales, salesRowsLimit],
  );

  const salesAverageTicket = useMemo(
    () => (filteredSales.length > 0 ? filteredSalesTotal / filteredSales.length : 0),
    [filteredSales.length, filteredSalesTotal],
  );

  const filteredCreditSalesCount = useMemo(
    () => filteredSales.reduce((count, sale) => (
      normalizeSalePaymentMethod(sale.payment_method) === "credit" ? count + 1 : count
    ), 0),
    [filteredSales],
  );

  const quickCustomerSuggestions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const sale of sales) {
      const customer = String(sale.customer_name || "").trim();
      if (!customer || isWalkInCustomerName(customer)) continue;
      counts.set(customer, (counts.get(customer) || 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((left, right) => right[1] - left[1])
      .map(([name]) => name)
      .slice(0, 30);
  }, [sales]);

  const handleRepeatSale = (transaction: SaleTransaction) => {
    const mappedSales: NewSale[] = transaction.sales.map((sale) => ({
      product_id: sale.product_id,
      quantity: Number(sale.quantity || 0),
      sale_unit_type: sale.sale_unit_type,
      pack_quantity: sale.pack_quantity ?? undefined,
      unit_price: Number(sale.unit_price || 0),
      total_price: Number(sale.total_price || 0),
      customer_name: sale.customer_name ?? null,
      payment_method: sale.payment_method || "cash",
      notes: sale.notes ?? null,
      amount_paid: sale.amount_paid ?? undefined,
      partial_payment_method: sale.partial_payment_method ?? undefined,
    }));

    if (mappedSales.length === 0) {
      return;
    }

    const token = `repeat:${transaction.key}:${Date.now()}`;
    setRepeatDraft({
      token,
      sales: mappedSales,
      sourceLabel: `receipt #${transaction.receiptNumber}`,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const salesKpiItems = useMemo(
    () => [
      {
        label: "Transactions",
        value: String(periodTransactions.length),
        helper: SALES_PERIOD_LABEL[salesPeriod],
        accent: "#0f172a",
      },
      {
        label: "Filtered Transactions",
        value: String(filteredSales.length),
        helper: "After current filters",
        accent: "#1d4ed8",
      },
      {
        label: "Average Ticket",
        value: toCurrency(salesAverageTicket),
        helper: "Filtered sales",
        accent: "#047857",
      },
      {
        label: "Credit Sales",
        value: String(filteredCreditSalesCount),
        helper: "Filtered transactions",
        accent: "#b45309",
      },
    ],
    [filteredCreditSalesCount, filteredSales.length, periodTransactions.length, salesAverageTicket, salesPeriod],
  );

  // PDF Export function
  const exportSalesPDF = (list: SaleTransaction[]) => {
    if (list.length === 0) return;

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

    const rowsHTML = list.map((sale) => {
      const itemsHTML = sale.items
        .map((item) => `${item.productName} (${item.quantityLabel})`)
        .join("<br />");

      return `
      <tr>
        <td>${formatDate(sale.created_at)}</td>
        <td>${sale.customer_name || "Walk-in"}</td>
        <td>${itemsHTML}</td>
        <td>${sale.payment_method}</td>
        <td style="text-align:right;font-weight:600">GHS ${Number(sale.total_price).toFixed(2)}</td>
      </tr>
    `;
    }).join("");

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
              <th>Customer</th>
              <th>Items</th>
              <th>Payment</th>
              <th style="text-align:right">Total</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHTML}
            <tr class="total-row">
              <td colspan="3" style="text-align:right"><strong>Grand Total:</strong></td>
              <td></td>
              <td style="text-align:right"><strong>GHS ${totalRevenue.toFixed(2)}</strong></td>
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
          <POSSaleForm
            products={products}
            onSubmit={handleCreateSale}
            customerSuggestions={quickCustomerSuggestions}
            repeatDraft={repeatDraft}
          />
        )}
      </div>

      {/* Sales List */}
      <div className="card">
        <div style={{ display: "grid", gap: 10, marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Recent Sales</h3>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
              <div style={{ fontSize: 12, color: "#6b7280" }}>
                Total ({SALES_PERIOD_LABEL[salesPeriod]}): <strong style={{ color: "#111827" }}>{toCurrency(periodSalesTotal)}</strong>
                {(salesSearchTerm.trim() || salesPaymentFilter !== "all") && (
                  <>
                    {" "}· Filtered: <strong style={{ color: "#0f766e" }}>{toCurrency(filteredSalesTotal)}</strong>
                  </>
                )}
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
              {filteredSales.length > salesRowsLimit && (
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

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
              gap: 8,
            }}
          >
            {salesKpiItems.map((item) => (
              <div
                key={item.label}
                style={{
                  border: "1px solid #e5e7eb",
                  borderRadius: 10,
                  padding: "10px 12px",
                  background: "#f8fafc",
                }}
              >
                <div style={{ fontSize: 11, color: "#64748b", fontWeight: 700, marginBottom: 3 }}>{item.label}</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: item.accent, lineHeight: 1.15 }}>{item.value}</div>
                <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>{item.helper}</div>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input
              type="text"
              value={salesSearchTerm}
              onChange={(event) => setSalesSearchTerm(event.target.value)}
              placeholder="Search customer, items, payment"
              className="input"
              style={{ minWidth: 220, flex: "1 1 240px" }}
            />
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              {paymentFilterOptions.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setSalesPaymentFilter(option.key)}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 999,
                    border: salesPaymentFilter === option.key ? "1px solid #1d4ed8" : "1px solid #e5e7eb",
                    background: salesPaymentFilter === option.key ? "#eff6ff" : "white",
                    color: salesPaymentFilter === option.key ? "#1d4ed8" : "#374151",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  {option.label} ({option.count})
                </button>
              ))}
            </div>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12,
                color: "#64748b",
                fontWeight: 700,
              }}
            >
              Rows
              <select
                value={salesRowsLimit}
                onChange={(event) => setSalesRowsLimit(Number(event.target.value))}
                className="input"
                style={{ width: 84, minWidth: 84, height: 34, padding: "0 10px" }}
              >
                {[5, 10, 20].map((limit) => (
                  <option key={limit} value={limit}>
                    {limit}
                  </option>
                ))}
              </select>
            </label>
            <div style={{ marginLeft: "auto", fontSize: 12, color: "#6b7280" }}>
              Showing {visibleSales.length} of {filteredSales.length}
            </div>
          </div>
        </div>
        {filteredSales.length === 0 && loading ? (
          <p style={{ margin: 0, color: "#6b7280", fontSize: 13 }}>Loading sales...</p>
        ) : (
          <>
            {loading ? <p style={{ margin: "0 0 8px 0", color: "#6b7280", fontSize: 12 }}>Refreshing...</p> : null}
            <SalesList
              sales={visibleSales}
              products={products}
              onDelete={handleDeleteSale}
              onRefresh={loadData}
              allowDelete={canDeleteSales}
              onPrintReceipt={reprintSaleReceipt}
              onConvertWalkIn={openAssignCustomerModal}
              onRepeatSale={handleRepeatSale}
            />
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

      {/* Assign Customer Modal */}
      {assignCustomerTransaction && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(15, 23, 42, 0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1100,
            padding: 20,
          }}
          onClick={() => {
            if (assigningCustomer) return;
            closeAssignCustomerModal();
          }}
        >
          <form
            onSubmit={submitAssignCustomer}
            style={{
              width: "100%",
              maxWidth: 460,
              background: "white",
              borderRadius: 12,
              boxShadow: "0 24px 56px rgba(15, 23, 42, 0.3)",
              border: "1px solid #e5e7eb",
              overflow: "hidden",
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <div style={{ padding: "16px 18px", borderBottom: "1px solid #e5e7eb", background: "#f8fafc" }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#0f172a" }}>Assign Customer to Sale</h3>
              <p style={{ margin: "6px 0 0", fontSize: 12, color: "#64748b" }}>
                Receipt #{assignCustomerTransaction.receiptNumber} · {assignCustomerTransaction.item_count} item{assignCustomerTransaction.item_count === 1 ? "" : "s"} · {toCurrency(Number(assignCustomerTransaction.total_price || 0))}
              </p>
            </div>

            <div style={{ display: "grid", gap: 10, padding: "16px 18px" }}>
              <label style={{ display: "grid", gap: 4, fontSize: 12, fontWeight: 600, color: "#334155" }}>
                Customer Name
                <input
                  type="text"
                  value={assignCustomerName}
                  onChange={(event) => setAssignCustomerName(event.target.value)}
                  placeholder="Enter customer name"
                  className="input"
                  maxLength={255}
                  required
                  disabled={assigningCustomer}
                />
              </label>

              <label style={{ display: "grid", gap: 4, fontSize: 12, fontWeight: 600, color: "#334155" }}>
                Phone (optional)
                <input
                  type="text"
                  value={assignCustomerPhone}
                  onChange={(event) => setAssignCustomerPhone(event.target.value)}
                  placeholder="e.g. 024 000 0000"
                  className="input"
                  maxLength={50}
                  disabled={assigningCustomer}
                />
              </label>

              <label style={{ display: "grid", gap: 4, fontSize: 12, fontWeight: 600, color: "#334155" }}>
                Email (optional)
                <input
                  type="email"
                  value={assignCustomerEmail}
                  onChange={(event) => setAssignCustomerEmail(event.target.value)}
                  placeholder="customer@email.com"
                  className="input"
                  maxLength={255}
                  disabled={assigningCustomer}
                />
              </label>

              <label style={{ display: "grid", gap: 4, fontSize: 12, fontWeight: 600, color: "#334155" }}>
                Note (optional)
                <textarea
                  value={assignCustomerNotes}
                  onChange={(event) => setAssignCustomerNotes(event.target.value)}
                  placeholder="Add context, e.g. rushed checkout"
                  rows={3}
                  style={{ resize: "vertical", minHeight: 78 }}
                  className="input"
                  disabled={assigningCustomer}
                />
              </label>

              {assignCustomerError && (
                <p style={{ margin: 0, fontSize: 12, color: "#b91c1c" }}>{assignCustomerError}</p>
              )}
            </div>

            <div style={{ padding: "12px 18px", borderTop: "1px solid #e5e7eb", display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                type="button"
                onClick={closeAssignCustomerModal}
                disabled={assigningCustomer}
                style={{
                  padding: "8px 14px",
                  borderRadius: 6,
                  border: "1px solid #d1d5db",
                  background: "white",
                  color: "#374151",
                  cursor: assigningCustomer ? "not-allowed" : "pointer",
                  opacity: assigningCustomer ? 0.65 : 1,
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={assigningCustomer}
                style={{
                  padding: "8px 14px",
                  borderRadius: 6,
                  border: "none",
                  background: assigningCustomer ? "#94a3b8" : "#111827",
                  color: "white",
                  fontWeight: 700,
                  cursor: assigningCustomer ? "not-allowed" : "pointer",
                }}
              >
                {assigningCustomer ? "Saving..." : "Assign Customer"}
              </button>
            </div>
          </form>
        </div>
      )}

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
            setConfirmationError(null);
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
                setConfirmationError(null);
              }}
              >×</div>
            </div>

            {/* Scrollable Content */}
            <div style={{ flex: 1, overflow: "auto", padding: "14px 18px 18px" }}>
              {confirmationError ? (
                <div
                  style={{
                    marginBottom: 12,
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: "1px solid #fecaca",
                    background: "#fef2f2",
                    color: "#b91c1c",
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  {confirmationError}
                </div>
              ) : null}

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
                          {formatSaleQuantityLabel(sale)} @ {Number(sale.unit_price).toFixed(2)}
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
                      setConfirmationError(null);
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

                  {canSendSaleReceipts ? (
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
                  ) : null}
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
                  {filteredSales.length} total transactions
                </p>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
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
              <SalesList
                sales={filteredSales}
                products={products}
                onDelete={handleDeleteSale}
                onRefresh={loadData}
                allowDelete={canDeleteSales}
                onPrintReceipt={reprintSaleReceipt}
                onConvertWalkIn={openAssignCustomerModal}
                onRepeatSale={handleRepeatSale}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}