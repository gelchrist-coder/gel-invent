import { useCallback, useEffect, useMemo, useState } from "react";

import { createPurchase, createSupplier, createSupplierPayment, deactivateSupplier, fetchPurchases, fetchSupplierDetail, fetchSupplierPayments, fetchSuppliers, updateSupplier } from "../api";
import type { Product, Purchase, Supplier, SupplierDetail, SupplierPayment } from "../types";

type Props = {
  products: Product[];
  initialProductId?: number | null;
  usesExpiryTracking?: boolean;
  onPurchaseRecorded?: () => Promise<void> | void;
};

const emptySupplierForm = {
  name: "",
  contact_person: "",
  phone: "",
  email: "",
  address: "",
  notes: "",
};

const paymentMethodOptions = [
  { value: "cash", label: "Cash" },
  { value: "bank_transfer", label: "Bank Transfer" },
  { value: "mobile_money", label: "Mobile Money" },
  { value: "cheque", label: "Cheque" },
  { value: "other", label: "Other" },
];

function toISODate(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function trimOrUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function formatCurrency(value: number): string {
  const normalized = Number.isFinite(value) ? value : 0;
  return `GHS ${normalized.toFixed(2)}`;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  return new Date(value).toLocaleDateString();
}

function getStatusMeta(status: Purchase["payment_status"] | string | null | undefined) {
  if (status === "paid") {
    return { label: "Paid", background: "#dcfce7", color: "#166534", border: "#86efac" };
  }
  if (status === "partial") {
    return { label: "Partial", background: "#fef3c7", color: "#92400e", border: "#fcd34d" };
  }
  return { label: "Unpaid", background: "#fee2e2", color: "#b91c1c", border: "#fca5a5" };
}

function getPurchaseDateValue(purchase: Purchase): number {
  const raw = purchase.purchase_date || purchase.created_at;
  const timestamp = new Date(raw).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function getSupplierFormValues(supplier: Supplier) {
  return {
    name: supplier.name || "",
    contact_person: supplier.contact_person || "",
    phone: supplier.phone || "",
    email: supplier.email || "",
    address: supplier.address || "",
    notes: supplier.notes || "",
  };
}

export default function PurchasingPanel({
  products,
  initialProductId = null,
  usesExpiryTracking = true,
  onPurchaseRecorded,
}: Props) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [payments, setPayments] = useState<SupplierPayment[]>([]);
  const [supplierDetail, setSupplierDetail] = useState<SupplierDetail | null>(null);
  const [loadingSupplierDetail, setLoadingSupplierDetail] = useState(false);
  const [editingSupplierId, setEditingSupplierId] = useState<number | null>(null);
  const [supplierEditForm, setSupplierEditForm] = useState(emptySupplierForm);
  const [selectedProductId, setSelectedProductId] = useState<number | null>(null);
  const [selectedSupplierId, setSelectedSupplierId] = useState<number | null>(null);
  const [manualSupplierName, setManualSupplierName] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unitCostPrice, setUnitCostPrice] = useState("");
  const [unitSellingPrice, setUnitSellingPrice] = useState("");
  const [amountPaid, setAmountPaid] = useState("");
  const [purchasePaymentMethod, setPurchasePaymentMethod] = useState("cash");
  const [purchaseDate, setPurchaseDate] = useState(() => toISODate(new Date()));
  const [dueDate, setDueDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [notes, setNotes] = useState("");
  const [paymentSupplierId, setPaymentSupplierId] = useState<number | null>(null);
  const [paymentPurchaseId, setPaymentPurchaseId] = useState<number | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [paymentDate, setPaymentDate] = useState(() => toISODate(new Date()));
  const [paymentNotes, setPaymentNotes] = useState("");
  const [supplierForm, setSupplierForm] = useState(emptySupplierForm);
  const [loading, setLoading] = useState(true);
  const [submittingPurchase, setSubmittingPurchase] = useState(false);
  const [submittingSupplier, setSubmittingSupplier] = useState(false);
  const [submittingPayment, setSubmittingPayment] = useState(false);
  const [savingSupplierDetail, setSavingSupplierDetail] = useState(false);
  const [deactivatingSupplierId, setDeactivatingSupplierId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadPanelData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [supplierData, purchaseData, paymentData] = await Promise.all([
        fetchSuppliers(),
        fetchPurchases(100),
        fetchSupplierPayments(30),
      ]);
      setSuppliers(supplierData);
      setPurchases(purchaseData);
      setPayments(paymentData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load purchasing data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPanelData();
  }, [loadPanelData]);

  useEffect(() => {
    if (products.length === 0) {
      setSelectedProductId(null);
      return;
    }

    setSelectedProductId((prev) => {
      if (initialProductId != null && products.some((product) => product.id === initialProductId)) {
        return initialProductId;
      }
      if (prev != null && products.some((product) => product.id === prev)) {
        return prev;
      }
      return products[0].id;
    });
  }, [initialProductId, products]);

  const selectedProduct = useMemo(
    () => products.find((product) => product.id === selectedProductId) ?? null,
    [products, selectedProductId],
  );
  const isPerishableProduct = usesExpiryTracking && !!selectedProduct?.expiry_date;
  const totalPurchaseValue = useMemo(() => purchases.reduce((sum, purchase) => sum + Number(purchase.total_cost || 0), 0), [purchases]);
  const totalOutstandingBalance = useMemo(
    () => suppliers.reduce((sum, supplier) => sum + Number(supplier.outstanding_balance || 0), 0),
    [suppliers],
  );
  const totalUnpaidInvoices = useMemo(
    () => suppliers.reduce((sum, supplier) => sum + Number(supplier.unpaid_purchases_count || 0), 0),
    [suppliers],
  );
  const totalPaidToSuppliers = useMemo(
    () => purchases.reduce((sum, purchase) => sum + Number(purchase.amount_paid || 0), 0),
    [purchases],
  );
  const estimatedTotal = useMemo(
    () => (Number(quantity || 0) || 0) * (Number(unitCostPrice || 0) || 0),
    [quantity, unitCostPrice],
  );
  const amountPaidNow = useMemo(() => {
    if (amountPaid.trim() === "") return 0;
    const numericValue = Number(amountPaid);
    return Number.isFinite(numericValue) ? numericValue : NaN;
  }, [amountPaid]);
  const estimatedBalanceDue = useMemo(() => {
    if (!Number.isFinite(amountPaidNow)) return NaN;
    return Math.max(estimatedTotal - amountPaidNow, 0);
  }, [amountPaidNow, estimatedTotal]);
  const estimatedPaymentStatus = useMemo<Purchase["payment_status"]>(() => {
    if (estimatedBalanceDue <= 0 && estimatedTotal > 0) return "paid";
    if (amountPaidNow > 0) return "partial";
    return "unpaid";
  }, [amountPaidNow, estimatedBalanceDue, estimatedTotal]);
  const unpaidPurchases = useMemo(
    () => purchases.filter((purchase) => Number(purchase.amount_due || 0) > 0).sort((left, right) => getPurchaseDateValue(left) - getPurchaseDateValue(right)),
    [purchases],
  );

  useEffect(() => {
    if (!selectedProduct) {
      return;
    }

    setUnitCostPrice(selectedProduct.cost_price != null ? String(selectedProduct.cost_price) : "");
    setUnitSellingPrice(selectedProduct.selling_price != null ? String(selectedProduct.selling_price) : "");
    setExpiryDate("");

    if (selectedProduct.supplier) {
      const matchedSupplier = suppliers.find(
        (supplier) => supplier.name.toLowerCase() === selectedProduct.supplier?.toLowerCase(),
      );
      if (matchedSupplier) {
        setSelectedSupplierId(matchedSupplier.id);
        setManualSupplierName("");
      } else {
        setSelectedSupplierId(null);
        setManualSupplierName(selectedProduct.supplier);
      }
    } else {
      setSelectedSupplierId(null);
      setManualSupplierName("");
    }
  }, [selectedProduct?.id, suppliers]);

  const resolveSupplierIdForPurchase = useCallback(
    (purchase: Purchase) => {
      if (purchase.supplier_id != null) {
        return purchase.supplier_id;
      }
      return suppliers.find((supplier) => supplier.name.toLowerCase() === purchase.supplier_name.toLowerCase())?.id ?? null;
    },
    [suppliers],
  );

  const paymentSuppliers = useMemo(
    () => suppliers.filter((supplier) => Number(supplier.outstanding_balance || 0) > 0 || Number(supplier.unpaid_purchases_count || 0) > 0),
    [suppliers],
  );

  const selectedSupplierRecord = useMemo(
    () => suppliers.find((supplier) => supplier.id === supplierDetail?.supplier.id) ?? supplierDetail?.supplier ?? null,
    [supplierDetail, suppliers],
  );

  const paymentPurchasesForSupplier = useMemo(
    () => unpaidPurchases.filter((purchase) => paymentSupplierId == null || resolveSupplierIdForPurchase(purchase) === paymentSupplierId),
    [paymentSupplierId, resolveSupplierIdForPurchase, unpaidPurchases],
  );

  const selectedPaymentPurchase = useMemo(
    () => purchases.find((purchase) => purchase.id === paymentPurchaseId) ?? null,
    [paymentPurchaseId, purchases],
  );

  useEffect(() => {
    if (paymentSupplierId == null) {
      return;
    }

    if (paymentPurchasesForSupplier.length === 0) {
      setPaymentPurchaseId(null);
      setPaymentAmount("");
      return;
    }

    setPaymentPurchaseId((prev) => (
      prev != null && paymentPurchasesForSupplier.some((purchase) => purchase.id === prev)
        ? prev
        : paymentPurchasesForSupplier[0].id
    ));
  }, [paymentPurchasesForSupplier, paymentSupplierId]);

  useEffect(() => {
    if (!selectedPaymentPurchase) {
      return;
    }

    setPaymentAmount((previousValue) => {
      const numericPrevious = Number(previousValue);
      const currentDue = Number(selectedPaymentPurchase.amount_due || 0);
      if (!Number.isFinite(numericPrevious) || numericPrevious <= 0 || numericPrevious > currentDue) {
        return String(currentDue);
      }
      return previousValue;
    });
  }, [selectedPaymentPurchase?.id, selectedPaymentPurchase?.amount_due]);

  const resetPaymentForm = () => {
    setPaymentSupplierId(null);
    setPaymentPurchaseId(null);
    setPaymentAmount("");
    setPaymentMethod("cash");
    setPaymentDate(toISODate(new Date()));
    setPaymentNotes("");
  };

  const loadSupplierDetail = useCallback(async (supplierId: number) => {
    setLoadingSupplierDetail(true);
    try {
      const detail = await fetchSupplierDetail(supplierId);
      setSupplierDetail(detail);
      setSupplierEditForm(getSupplierFormValues(detail.supplier));
      return detail;
    } finally {
      setLoadingSupplierDetail(false);
    }
  }, []);

  const refreshOpenSupplierDetail = useCallback(async (supplierId?: number | null) => {
    const targetId = supplierId ?? supplierDetail?.supplier.id ?? null;
    if (targetId == null) {
      return null;
    }
    return loadSupplierDetail(targetId);
  }, [loadSupplierDetail, supplierDetail?.supplier.id]);

  const focusPurchaseSupplier = (supplier: Supplier) => {
    setSelectedSupplierId(supplier.id);
    setManualSupplierName("");
    setNotice(`Supplier ${supplier.name} selected for the purchase form`);
  };

  const openPaymentForPurchase = (purchase: Purchase) => {
    const resolvedSupplierId = resolveSupplierIdForPurchase(purchase);
    if (resolvedSupplierId == null) {
      setError("This purchase is missing a supplier record. Refresh and try again.");
      return;
    }

    if (Number(purchase.amount_due || 0) <= 0) {
      setNotice(`Purchase ${purchase.invoice_number || purchase.product_name} is already fully paid`);
      return;
    }

    setError(null);
    setNotice(`Ready to record a payment for ${purchase.supplier_name}`);
    setPaymentSupplierId(resolvedSupplierId);
    setPaymentPurchaseId(purchase.id);
    setPaymentAmount(String(Number(purchase.amount_due || 0)));
    setPaymentMethod(purchase.payment_method || "cash");
    setPaymentDate(toISODate(new Date()));
    setPaymentNotes("");
  };

  const openPaymentForSupplier = (supplier: Supplier) => {
    const targetPurchase = unpaidPurchases.find((purchase) => resolveSupplierIdForPurchase(purchase) === supplier.id);
    if (!targetPurchase) {
      setNotice(`No unpaid purchases found for ${supplier.name}`);
      return;
    }
    openPaymentForPurchase(targetPurchase);
  };

  const openSupplierDetail = async (supplier: Supplier) => {
    setError(null);
    setNotice(null);
    setEditingSupplierId(null);
    try {
      await loadSupplierDetail(supplier.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load supplier detail");
    }
  };

  const handlePaymentSupplierChange = (supplierId: number | null) => {
    setPaymentSupplierId(supplierId);
    if (supplierId == null) {
      setPaymentPurchaseId(null);
      setPaymentAmount("");
      return;
    }

    const firstOutstandingPurchase = unpaidPurchases.find((purchase) => resolveSupplierIdForPurchase(purchase) === supplierId) ?? null;
    setPaymentPurchaseId(firstOutstandingPurchase?.id ?? null);
    setPaymentAmount(firstOutstandingPurchase ? String(Number(firstOutstandingPurchase.amount_due || 0)) : "");
  };

  const handlePaymentPurchaseChange = (purchaseId: number | null) => {
    setPaymentPurchaseId(purchaseId);
    const purchase = purchases.find((item) => item.id === purchaseId) ?? null;
    if (!purchase) {
      setPaymentAmount("");
      return;
    }

    setPaymentAmount(String(Number(purchase.amount_due || 0)));
    setPaymentSupplierId(resolveSupplierIdForPurchase(purchase));
  };

  const handleCreateSupplier = async () => {
    if (!supplierForm.name.trim()) {
      setError("Supplier name is required");
      return;
    }

    setSubmittingSupplier(true);
    setError(null);
    setNotice(null);
    try {
      const created = await createSupplier({
        name: supplierForm.name.trim(),
        contact_person: trimOrUndefined(supplierForm.contact_person),
        phone: trimOrUndefined(supplierForm.phone),
        email: trimOrUndefined(supplierForm.email),
        address: trimOrUndefined(supplierForm.address),
        notes: trimOrUndefined(supplierForm.notes),
      });
      setSupplierForm(emptySupplierForm);
      setSelectedSupplierId(created.id);
      setManualSupplierName("");
      setNotice(`Supplier ${created.name} added`);
      await loadPanelData();
      await loadSupplierDetail(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create supplier");
    } finally {
      setSubmittingSupplier(false);
    }
  };

  const handleRecordPurchase = async () => {
    if (!selectedProductId) {
      setError("Select a product first");
      return;
    }

    const quantityValue = Number(quantity);
    const unitCostValue = Number(unitCostPrice);
    const unitSellingValue = unitSellingPrice.trim() === "" ? null : Number(unitSellingPrice);
    const amountPaidValue = amountPaid.trim() === "" ? 0 : Number(amountPaid);

    if (!Number.isFinite(quantityValue) || quantityValue <= 0) {
      setError("Enter a valid purchase quantity");
      return;
    }

    if (!Number.isFinite(unitCostValue) || unitCostValue < 0) {
      setError("Enter a valid unit cost price");
      return;
    }

    if (unitSellingValue != null && (!Number.isFinite(unitSellingValue) || unitSellingValue < 0)) {
      setError("Enter a valid unit selling price");
      return;
    }

    if (!Number.isFinite(amountPaidValue) || amountPaidValue < 0) {
      setError("Enter a valid amount paid");
      return;
    }

    if (amountPaidValue > estimatedTotal) {
      setError("Amount paid cannot exceed the estimated total");
      return;
    }

    if (amountPaidValue > 0 && !purchasePaymentMethod.trim()) {
      setError("Choose a payment method for the upfront payment");
      return;
    }

    if (isPerishableProduct && !expiryDate) {
      setError("Expiry date is required for this perishable product");
      return;
    }

    if (selectedSupplierId == null && !manualSupplierName.trim()) {
      setError("Select a supplier or type a supplier name");
      return;
    }

    setSubmittingPurchase(true);
    setError(null);
    setNotice(null);
    try {
      const purchase = await createPurchase({
        product_id: selectedProductId,
        supplier_id: selectedSupplierId ?? undefined,
        supplier_name: selectedSupplierId == null ? manualSupplierName.trim() : undefined,
        invoice_number: trimOrUndefined(invoiceNumber),
        quantity: quantityValue,
        unit_cost_price: unitCostValue,
        unit_selling_price: unitSellingValue ?? undefined,
        amount_paid: amountPaidValue || undefined,
        payment_method: amountPaidValue > 0 ? purchasePaymentMethod : undefined,
        purchase_date: purchaseDate || undefined,
        due_date: dueDate || undefined,
        expiry_date: isPerishableProduct ? (expiryDate || undefined) : undefined,
        notes: trimOrUndefined(notes),
      });

      setInvoiceNumber("");
      setQuantity("1");
      setAmountPaid("");
      setPurchasePaymentMethod("cash");
      setDueDate("");
      setNotes("");
      setExpiryDate("");
      setNotice(`Purchase recorded for ${purchase.product_name} with status ${getStatusMeta(purchase.payment_status).label.toLowerCase()}`);
      await loadPanelData();
      await refreshOpenSupplierDetail(purchase.supplier_id ?? selectedSupplierId);
      if (onPurchaseRecorded) {
        await onPurchaseRecorded();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record purchase");
    } finally {
      setSubmittingPurchase(false);
    }
  };

  const handleRecordPayment = async () => {
    if (!selectedPaymentPurchase) {
      setError("Select an unpaid purchase to pay");
      return;
    }

    const amountValue = Number(paymentAmount);
    if (!Number.isFinite(amountValue) || amountValue <= 0) {
      setError("Enter a valid supplier payment amount");
      return;
    }

    const outstandingAmount = Number(selectedPaymentPurchase.amount_due || 0);
    if (amountValue > outstandingAmount) {
      setError("Payment amount cannot exceed the outstanding balance");
      return;
    }

    if (!paymentMethod.trim()) {
      setError("Choose a payment method");
      return;
    }

    setSubmittingPayment(true);
    setError(null);
    setNotice(null);
    try {
      const payment = await createSupplierPayment({
        purchase_id: selectedPaymentPurchase.id,
        amount: amountValue,
        payment_method: paymentMethod,
        payment_date: paymentDate || undefined,
        notes: trimOrUndefined(paymentNotes),
      });
      setNotice(`Recorded ${formatCurrency(Number(payment.amount || 0))} payment for ${payment.supplier_name}`);
      resetPaymentForm();
      await loadPanelData();
      await refreshOpenSupplierDetail(payment.supplier_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record supplier payment");
    } finally {
      setSubmittingPayment(false);
    }
  };

  const handleSaveSupplierDetail = async () => {
    if (!supplierDetail) {
      return;
    }

    if (!supplierEditForm.name.trim()) {
      setError("Supplier name is required");
      return;
    }

    setSavingSupplierDetail(true);
    setError(null);
    setNotice(null);
    try {
      const updatedSupplier = await updateSupplier(supplierDetail.supplier.id, {
        name: supplierEditForm.name.trim(),
        contact_person: trimOrUndefined(supplierEditForm.contact_person),
        phone: trimOrUndefined(supplierEditForm.phone),
        email: trimOrUndefined(supplierEditForm.email),
        address: trimOrUndefined(supplierEditForm.address),
        notes: trimOrUndefined(supplierEditForm.notes),
      });
      setNotice(`Supplier ${updatedSupplier.name} updated`);
      setEditingSupplierId(null);
      await loadPanelData();
      await loadSupplierDetail(updatedSupplier.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update supplier");
    } finally {
      setSavingSupplierDetail(false);
    }
  };

  const handleDeactivateSupplier = async () => {
    if (!supplierDetail) {
      return;
    }

    const supplier = supplierDetail.supplier;
    if (!confirm(`Deactivate ${supplier.name}? This keeps purchase history but removes the supplier from active purchasing lists.`)) {
      return;
    }

    setDeactivatingSupplierId(supplier.id);
    setError(null);
    setNotice(null);
    try {
      const result = await deactivateSupplier(supplier.id);
      if (selectedSupplierId === supplier.id) {
        setSelectedSupplierId(null);
      }
      if (paymentSupplierId === supplier.id) {
        resetPaymentForm();
      }
      setSupplierDetail(null);
      setEditingSupplierId(null);
      setNotice(result.message);
      await loadPanelData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to deactivate supplier");
    } finally {
      setDeactivatingSupplierId(null);
    }
  };

  return (
    <div style={{ display: "grid", gap: 20 }}>
      {error ? (
        <div style={{ padding: "12px 14px", borderRadius: 10, border: "1px solid #fecaca", background: "#fef2f2", color: "#991b1b", fontSize: 14 }}>
          {error}
        </div>
      ) : null}
      {notice ? (
        <div style={{ padding: "12px 14px", borderRadius: 10, border: "1px solid #bbf7d0", background: "#f0fdf4", color: "#166534", fontSize: 14 }}>
          {notice}
        </div>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
        <div style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 14, padding: 18 }}>
          <div style={{ fontSize: 13, color: "#64748b", marginBottom: 6 }}>Active Suppliers</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: "#0f172a" }}>{suppliers.length}</div>
        </div>
        <div style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 14, padding: 18 }}>
          <div style={{ fontSize: 13, color: "#64748b", marginBottom: 6 }}>Purchase Value</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: "#0f172a" }}>{formatCurrency(totalPurchaseValue)}</div>
        </div>
        <div style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 14, padding: 18 }}>
          <div style={{ fontSize: 13, color: "#64748b", marginBottom: 6 }}>Outstanding Balance</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: totalOutstandingBalance > 0 ? "#b45309" : "#0f172a" }}>{formatCurrency(totalOutstandingBalance)}</div>
        </div>
        <div style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 14, padding: 18 }}>
          <div style={{ fontSize: 13, color: "#64748b", marginBottom: 6 }}>Unpaid Invoices</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: totalUnpaidInvoices > 0 ? "#b91c1c" : "#0f172a" }}>{totalUnpaidInvoices}</div>
          <div style={{ marginTop: 6, fontSize: 12, color: "#64748b" }}>Paid so far: {formatCurrency(totalPaidToSuppliers)}</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 20, alignItems: "start" }}>
        <div className="card" style={{ marginBottom: 0 }}>
          <div style={{ marginBottom: 16 }}>
            <h3 style={{ margin: "0 0 6px", fontSize: 18, fontWeight: 700 }}>Supplier Directory</h3>
            <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>
              Save suppliers once, then reuse them when recording purchases.
            </p>
          </div>

          <div style={{ display: "grid", gap: 12 }}>
            <label>
              <span style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 600, color: "#374151" }}>Supplier Name</span>
              <input
                className="input"
                value={supplierForm.name}
                onChange={(e) => setSupplierForm((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="e.g. Kasapreko Distributor"
              />
            </label>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
              <label>
                <span style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 600, color: "#374151" }}>Contact Person</span>
                <input
                  className="input"
                  value={supplierForm.contact_person}
                  onChange={(e) => setSupplierForm((prev) => ({ ...prev, contact_person: e.target.value }))}
                  placeholder="Optional"
                />
              </label>
              <label>
                <span style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 600, color: "#374151" }}>Phone</span>
                <input
                  className="input"
                  value={supplierForm.phone}
                  onChange={(e) => setSupplierForm((prev) => ({ ...prev, phone: e.target.value }))}
                  placeholder="024..."
                />
              </label>
            </div>

            <label>
              <span style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 600, color: "#374151" }}>Email</span>
              <input
                className="input"
                value={supplierForm.email}
                onChange={(e) => setSupplierForm((prev) => ({ ...prev, email: e.target.value }))}
                placeholder="supplier@example.com"
              />
            </label>

            <label>
              <span style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 600, color: "#374151" }}>Address / Notes</span>
              <textarea
                className="textarea"
                value={`${supplierForm.address}${supplierForm.address && supplierForm.notes ? "\n" : ""}${supplierForm.notes}`}
                onChange={(e) => {
                  const [firstLine, ...rest] = e.target.value.split("\n");
                  setSupplierForm((prev) => ({
                    ...prev,
                    address: firstLine,
                    notes: rest.join("\n"),
                  }));
                }}
                rows={3}
                placeholder="Address on the first line, extra notes below"
              />
            </label>

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                type="button"
                className="button"
                onClick={() => void handleCreateSupplier()}
                disabled={submittingSupplier}
              >
                {submittingSupplier ? "Saving..." : "Add Supplier"}
              </button>
            </div>
          </div>

          <div style={{ marginTop: 18, borderTop: "1px solid #e5e7eb", paddingTop: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#334155", marginBottom: 10 }}>Saved Suppliers</div>
            {loading && suppliers.length === 0 ? (
              <p style={{ margin: 0, color: "#6b7280", fontSize: 14 }}>Loading suppliers...</p>
            ) : suppliers.length === 0 ? (
              <p style={{ margin: 0, color: "#6b7280", fontSize: 14 }}>No suppliers yet.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {suppliers.map((supplier) => (
                  <div
                    key={supplier.id}
                    style={{
                      padding: "10px 12px",
                      borderRadius: 10,
                      border: supplier.id === supplierDetail?.supplier.id ? "1px solid #0f172a" : supplier.id === selectedSupplierId ? "1px solid #2563eb" : "1px solid #e2e8f0",
                      background: supplier.id === supplierDetail?.supplier.id ? "#f8fafc" : supplier.id === selectedSupplierId ? "#eff6ff" : "#ffffff",
                      display: "grid",
                      gap: 10,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a" }}>{supplier.name}</div>
                        <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                          {supplier.contact_person || supplier.phone || supplier.email || "No contact details yet"}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button
                          type="button"
                          onClick={() => void openSupplierDetail(supplier)}
                          style={{
                            padding: "7px 10px",
                            borderRadius: 8,
                            border: "1px solid #0f172a",
                            background: supplier.id === supplierDetail?.supplier.id ? "#0f172a" : "white",
                            color: supplier.id === supplierDetail?.supplier.id ? "#ffffff" : "#0f172a",
                            fontSize: 12,
                            fontWeight: 700,
                            cursor: "pointer",
                          }}
                        >
                          View Details
                        </button>
                        <button
                          type="button"
                          onClick={() => focusPurchaseSupplier(supplier)}
                          style={{
                            padding: "7px 10px",
                            borderRadius: 8,
                            border: "1px solid #d1d5db",
                            background: "white",
                            color: "#1f2937",
                            fontSize: 12,
                            fontWeight: 700,
                            cursor: "pointer",
                          }}
                        >
                          Use for Purchase
                        </button>
                        <button
                          type="button"
                          onClick={() => openPaymentForSupplier(supplier)}
                          disabled={Number(supplier.unpaid_purchases_count || 0) === 0}
                          style={{
                            padding: "7px 10px",
                            borderRadius: 8,
                            border: "1px solid #2563eb",
                            background: Number(supplier.unpaid_purchases_count || 0) === 0 ? "#e5e7eb" : "#2563eb",
                            color: Number(supplier.unpaid_purchases_count || 0) === 0 ? "#6b7280" : "#ffffff",
                            fontSize: 12,
                            fontWeight: 700,
                            cursor: Number(supplier.unpaid_purchases_count || 0) === 0 ? "not-allowed" : "pointer",
                          }}
                        >
                          Record Payment
                        </button>
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ padding: "4px 8px", borderRadius: 999, background: "#f8fafc", color: "#334155", fontSize: 12, fontWeight: 700, border: "1px solid #e2e8f0" }}>
                        Purchased: {formatCurrency(Number(supplier.total_purchased || 0))}
                      </span>
                      <span style={{ padding: "4px 8px", borderRadius: 999, background: "#eff6ff", color: "#1d4ed8", fontSize: 12, fontWeight: 700, border: "1px solid #bfdbfe" }}>
                        Paid: {formatCurrency(Number(supplier.total_paid || 0))}
                      </span>
                      <span style={{ padding: "4px 8px", borderRadius: 999, background: Number(supplier.outstanding_balance || 0) > 0 ? "#fff7ed" : "#ecfdf5", color: Number(supplier.outstanding_balance || 0) > 0 ? "#c2410c" : "#047857", fontSize: 12, fontWeight: 700, border: Number(supplier.outstanding_balance || 0) > 0 ? "1px solid #fdba74" : "1px solid #a7f3d0" }}>
                        Outstanding: {formatCurrency(Number(supplier.outstanding_balance || 0))}
                      </span>
                      <span style={{ padding: "4px 8px", borderRadius: 999, background: "#fef2f2", color: "#b91c1c", fontSize: 12, fontWeight: 700, border: "1px solid #fecaca" }}>
                        Open invoices: {Number(supplier.unpaid_purchases_count || 0)}
                      </span>
                      {supplier.last_payment_date ? (
                        <span style={{ padding: "4px 8px", borderRadius: 999, background: "#f8fafc", color: "#475569", fontSize: 12, fontWeight: 600, border: "1px solid #e2e8f0" }}>
                          Last payment: {formatDate(supplier.last_payment_date)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="card" style={{ marginBottom: 0 }}>
          <div style={{ marginBottom: 16 }}>
            <h3 style={{ margin: "0 0 6px", fontSize: 18, fontWeight: 700 }}>Record Purchase</h3>
            <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>
              Use this for supplier-backed restocks so stock-in stays linked to supplier, invoice, and cost details.
            </p>
          </div>

          <div style={{ display: "grid", gap: 12 }}>
            <label>
              <span style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 600, color: "#374151" }}>Product</span>
              <select
                className="input"
                value={selectedProductId ?? ""}
                onChange={(e) => setSelectedProductId(e.target.value ? Number(e.target.value) : null)}
                disabled={products.length === 0 || submittingPurchase}
              >
                {products.length === 0 ? <option value="">No products available</option> : null}
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name} ({product.sku})
                  </option>
                ))}
              </select>
            </label>

            {selectedProduct ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, padding: 12, border: "1px solid #e2e8f0", background: "#f8fafc", borderRadius: 10 }}>
                <div>
                  <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>Current Stock</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a" }}>{Number(selectedProduct.current_stock || 0)}</div>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>Current Supplier</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a" }}>{selectedProduct.supplier || "Not set"}</div>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>Perishability</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: isPerishableProduct ? "#b45309" : "#334155" }}>
                    {isPerishableProduct ? "Perishable" : "Non-perishable"}
                  </div>
                </div>
              </div>
            ) : null}

            <label>
              <span style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 600, color: "#374151" }}>Supplier</span>
              <select
                className="input"
                value={selectedSupplierId ?? ""}
                onChange={(e) => setSelectedSupplierId(e.target.value ? Number(e.target.value) : null)}
                disabled={submittingPurchase}
              >
                <option value="">Type supplier name manually</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </select>
            </label>

            {selectedSupplierId == null ? (
              <label>
                <span style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 600, color: "#374151" }}>Supplier Name</span>
                <input
                  className="input"
                  value={manualSupplierName}
                  onChange={(e) => setManualSupplierName(e.target.value)}
                  placeholder="Type a supplier name"
                  disabled={submittingPurchase}
                />
              </label>
            ) : null}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
              <label>
                <span style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 600, color: "#374151" }}>Invoice Number</span>
                <input
                  className="input"
                  value={invoiceNumber}
                  onChange={(e) => setInvoiceNumber(e.target.value)}
                  placeholder="Optional"
                  disabled={submittingPurchase}
                />
              </label>
              <label>
                <span style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 600, color: "#374151" }}>Purchase Date</span>
                <input
                  className="input"
                  type="date"
                  value={purchaseDate}
                  onChange={(e) => setPurchaseDate(e.target.value)}
                  disabled={submittingPurchase}
                />
              </label>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
              <label>
                <span style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 600, color: "#374151" }}>Quantity</span>
                <input
                  className="input"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  disabled={submittingPurchase}
                />
              </label>
              <label>
                <span style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 600, color: "#374151" }}>Unit Cost Price</span>
                <input
                  className="input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={unitCostPrice}
                  onChange={(e) => setUnitCostPrice(e.target.value)}
                  disabled={submittingPurchase}
                />
              </label>
              <label>
                <span style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 600, color: "#374151" }}>Unit Selling Price</span>
                <input
                  className="input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={unitSellingPrice}
                  onChange={(e) => setUnitSellingPrice(e.target.value)}
                  disabled={submittingPurchase}
                />
              </label>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
              <label>
                <span style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 600, color: "#374151" }}>Amount Paid Now</span>
                <input
                  className="input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={amountPaid}
                  onChange={(e) => setAmountPaid(e.target.value)}
                  placeholder="Optional upfront payment"
                  disabled={submittingPurchase}
                />
              </label>
              <label>
                <span style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 600, color: "#374151" }}>Payment Method</span>
                <select
                  className="input"
                  value={purchasePaymentMethod}
                  onChange={(e) => setPurchasePaymentMethod(e.target.value)}
                  disabled={submittingPurchase}
                >
                  {paymentMethodOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label>
                <span style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 600, color: "#374151" }}>Due Date</span>
                <input
                  className="input"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  disabled={submittingPurchase}
                />
              </label>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, padding: 12, border: "1px solid #e2e8f0", background: "#f8fafc", borderRadius: 10 }}>
              <div>
                <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>Estimated Total</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a" }}>{formatCurrency(estimatedTotal)}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>Paid Now</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a" }}>{formatCurrency(Number.isFinite(amountPaidNow) ? amountPaidNow : 0)}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>Balance Due</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: Number.isFinite(estimatedBalanceDue) && estimatedBalanceDue > 0 ? "#b45309" : "#166534" }}>
                  {formatCurrency(Number.isFinite(estimatedBalanceDue) ? estimatedBalanceDue : 0)}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>Payment Status</div>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    padding: "4px 8px",
                    borderRadius: 999,
                    fontSize: 12,
                    fontWeight: 700,
                    border: `1px solid ${getStatusMeta(estimatedPaymentStatus).border}`,
                    background: getStatusMeta(estimatedPaymentStatus).background,
                    color: getStatusMeta(estimatedPaymentStatus).color,
                  }}
                >
                  {getStatusMeta(estimatedPaymentStatus).label}
                </span>
              </div>
            </div>

            {isPerishableProduct ? (
              <label>
                <span style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 600, color: "#374151" }}>Batch Expiry Date</span>
                <input
                  className="input"
                  type="date"
                  value={expiryDate}
                  onChange={(e) => setExpiryDate(e.target.value)}
                  disabled={submittingPurchase}
                />
              </label>
            ) : null}

            <label>
              <span style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 600, color: "#374151" }}>Notes</span>
              <textarea
                className="textarea"
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional purchase note"
                disabled={submittingPurchase}
              />
            </label>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div style={{ fontSize: 13, color: "#475569" }}>
                Every purchase now records payment status and remaining supplier balance.
              </div>
              <button
                type="button"
                className="button"
                onClick={() => void handleRecordPurchase()}
                disabled={submittingPurchase || products.length === 0}
              >
                {submittingPurchase ? "Recording..." : "Record Purchase"}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 0 }}>
        <div style={{ marginBottom: 16 }}>
          <h3 style={{ margin: "0 0 6px", fontSize: 18, fontWeight: 700 }}>Supplier Detail</h3>
          <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>
            Inspect supplier activity, edit contact details, and deactivate suppliers once their balances are settled.
          </p>
        </div>

        {loadingSupplierDetail ? (
          <p style={{ margin: 0, color: "#6b7280" }}>Loading supplier detail...</p>
        ) : !supplierDetail || !selectedSupplierRecord ? (
          <p style={{ margin: 0, color: "#6b7280" }}>Select a supplier from the directory to view details and manage it.</p>
        ) : (
          <div style={{ display: "grid", gap: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
              <div>
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <h4 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "#0f172a" }}>{selectedSupplierRecord.name}</h4>
                  <span
                    style={{
                      padding: "4px 8px",
                      borderRadius: 999,
                      fontSize: 12,
                      fontWeight: 700,
                      border: selectedSupplierRecord.is_active ? "1px solid #86efac" : "1px solid #fca5a5",
                      background: selectedSupplierRecord.is_active ? "#dcfce7" : "#fee2e2",
                      color: selectedSupplierRecord.is_active ? "#166534" : "#b91c1c",
                    }}
                  >
                    {selectedSupplierRecord.is_active ? "Active" : "Inactive"}
                  </span>
                </div>
                <div style={{ marginTop: 6, fontSize: 13, color: "#64748b" }}>
                  {selectedSupplierRecord.contact_person || selectedSupplierRecord.phone || selectedSupplierRecord.email || "No contact details added yet"}
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => focusPurchaseSupplier(selectedSupplierRecord)}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 8,
                    border: "1px solid #d1d5db",
                    background: "white",
                    color: "#1f2937",
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Use for Purchase
                </button>
                <button
                  type="button"
                  onClick={() => openPaymentForSupplier(selectedSupplierRecord)}
                  disabled={Number(selectedSupplierRecord.unpaid_purchases_count || 0) === 0}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 8,
                    border: "1px solid #2563eb",
                    background: Number(selectedSupplierRecord.unpaid_purchases_count || 0) === 0 ? "#e5e7eb" : "#2563eb",
                    color: Number(selectedSupplierRecord.unpaid_purchases_count || 0) === 0 ? "#6b7280" : "#ffffff",
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: Number(selectedSupplierRecord.unpaid_purchases_count || 0) === 0 ? "not-allowed" : "pointer",
                  }}
                >
                  Record Payment
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (editingSupplierId === selectedSupplierRecord.id) {
                      setEditingSupplierId(null);
                      setSupplierEditForm(getSupplierFormValues(selectedSupplierRecord));
                      return;
                    }
                    setEditingSupplierId(selectedSupplierRecord.id);
                    setSupplierEditForm(getSupplierFormValues(selectedSupplierRecord));
                  }}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 8,
                    border: "1px solid #0f172a",
                    background: editingSupplierId === selectedSupplierRecord.id ? "#0f172a" : "white",
                    color: editingSupplierId === selectedSupplierRecord.id ? "#ffffff" : "#0f172a",
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  {editingSupplierId === selectedSupplierRecord.id ? "Cancel Edit" : "Edit Supplier"}
                </button>
                <button
                  type="button"
                  onClick={() => void handleDeactivateSupplier()}
                  disabled={deactivatingSupplierId === selectedSupplierRecord.id}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 8,
                    border: "1px solid #dc2626",
                    background: deactivatingSupplierId === selectedSupplierRecord.id ? "#fecaca" : "white",
                    color: "#b91c1c",
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: deactivatingSupplierId === selectedSupplierRecord.id ? "not-allowed" : "pointer",
                  }}
                >
                  {deactivatingSupplierId === selectedSupplierRecord.id ? "Deactivating..." : "Deactivate Supplier"}
                </button>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
              <div style={{ padding: 14, borderRadius: 12, border: "1px solid #e2e8f0", background: "#ffffff" }}>
                <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6 }}>Total Purchased</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: "#0f172a" }}>{formatCurrency(Number(selectedSupplierRecord.total_purchased || 0))}</div>
              </div>
              <div style={{ padding: 14, borderRadius: 12, border: "1px solid #e2e8f0", background: "#ffffff" }}>
                <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6 }}>Total Paid</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: "#1d4ed8" }}>{formatCurrency(Number(selectedSupplierRecord.total_paid || 0))}</div>
              </div>
              <div style={{ padding: 14, borderRadius: 12, border: "1px solid #e2e8f0", background: "#ffffff" }}>
                <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6 }}>Outstanding</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: Number(selectedSupplierRecord.outstanding_balance || 0) > 0 ? "#b45309" : "#166534" }}>
                  {formatCurrency(Number(selectedSupplierRecord.outstanding_balance || 0))}
                </div>
              </div>
              <div style={{ padding: 14, borderRadius: 12, border: "1px solid #e2e8f0", background: "#ffffff" }}>
                <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6 }}>Open Invoices</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: Number(selectedSupplierRecord.unpaid_purchases_count || 0) > 0 ? "#b91c1c" : "#0f172a" }}>
                  {Number(selectedSupplierRecord.unpaid_purchases_count || 0)}
                </div>
              </div>
            </div>

            {editingSupplierId === selectedSupplierRecord.id ? (
              <div style={{ display: "grid", gap: 12, padding: 16, borderRadius: 12, border: "1px solid #dbe5f2", background: "#f8fbff" }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
                  <label>
                    <span style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 600, color: "#374151" }}>Supplier Name</span>
                    <input className="input" value={supplierEditForm.name} onChange={(e) => setSupplierEditForm((prev) => ({ ...prev, name: e.target.value }))} />
                  </label>
                  <label>
                    <span style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 600, color: "#374151" }}>Contact Person</span>
                    <input className="input" value={supplierEditForm.contact_person} onChange={(e) => setSupplierEditForm((prev) => ({ ...prev, contact_person: e.target.value }))} />
                  </label>
                  <label>
                    <span style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 600, color: "#374151" }}>Phone</span>
                    <input className="input" value={supplierEditForm.phone} onChange={(e) => setSupplierEditForm((prev) => ({ ...prev, phone: e.target.value }))} />
                  </label>
                  <label>
                    <span style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 600, color: "#374151" }}>Email</span>
                    <input className="input" value={supplierEditForm.email} onChange={(e) => setSupplierEditForm((prev) => ({ ...prev, email: e.target.value }))} />
                  </label>
                </div>
                <label>
                  <span style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 600, color: "#374151" }}>Address</span>
                  <textarea className="textarea" rows={2} value={supplierEditForm.address} onChange={(e) => setSupplierEditForm((prev) => ({ ...prev, address: e.target.value }))} />
                </label>
                <label>
                  <span style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 600, color: "#374151" }}>Notes</span>
                  <textarea className="textarea" rows={3} value={supplierEditForm.notes} onChange={(e) => setSupplierEditForm((prev) => ({ ...prev, notes: e.target.value }))} />
                </label>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingSupplierId(null);
                      setSupplierEditForm(getSupplierFormValues(selectedSupplierRecord));
                    }}
                    style={{
                      padding: "8px 12px",
                      borderRadius: 8,
                      border: "1px solid #d1d5db",
                      background: "white",
                      color: "#334155",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    Cancel
                  </button>
                  <button type="button" className="button" onClick={() => void handleSaveSupplierDetail()} disabled={savingSupplierDetail}>
                    {savingSupplierDetail ? "Saving..." : "Save Supplier"}
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
                <div style={{ padding: 14, borderRadius: 12, border: "1px solid #e2e8f0", background: "#ffffff" }}>
                  <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6 }}>Contact Person</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a" }}>{selectedSupplierRecord.contact_person || "-"}</div>
                </div>
                <div style={{ padding: 14, borderRadius: 12, border: "1px solid #e2e8f0", background: "#ffffff" }}>
                  <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6 }}>Phone</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a" }}>{selectedSupplierRecord.phone || "-"}</div>
                </div>
                <div style={{ padding: 14, borderRadius: 12, border: "1px solid #e2e8f0", background: "#ffffff" }}>
                  <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6 }}>Email</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a" }}>{selectedSupplierRecord.email || "-"}</div>
                </div>
                <div style={{ padding: 14, borderRadius: 12, border: "1px solid #e2e8f0", background: "#ffffff" }}>
                  <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6 }}>Last Payment</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a" }}>{formatDate(selectedSupplierRecord.last_payment_date)}</div>
                </div>
                <div style={{ padding: 14, borderRadius: 12, border: "1px solid #e2e8f0", background: "#ffffff", gridColumn: "1 / -1" }}>
                  <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6 }}>Address</div>
                  <div style={{ fontSize: 14, color: "#0f172a" }}>{selectedSupplierRecord.address || "No address recorded"}</div>
                </div>
                <div style={{ padding: 14, borderRadius: 12, border: "1px solid #e2e8f0", background: "#ffffff", gridColumn: "1 / -1" }}>
                  <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6 }}>Notes</div>
                  <div style={{ fontSize: 14, color: "#0f172a", whiteSpace: "pre-wrap" }}>{selectedSupplierRecord.notes || "No notes recorded"}</div>
                </div>
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 20, alignItems: "start" }}>
              <div style={{ overflowX: "auto" }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a", marginBottom: 10 }}>Supplier Purchases</div>
                {supplierDetail.purchases.length === 0 ? (
                  <p style={{ margin: 0, color: "#6b7280" }}>No purchases recorded for this supplier yet.</p>
                ) : (
                  <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 520 }}>
                    <thead>
                      <tr style={{ background: "#f8fafc" }}>
                        <th style={{ padding: 12, textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>Date</th>
                        <th style={{ padding: 12, textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>Product</th>
                        <th style={{ padding: 12, textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>Status</th>
                        <th style={{ padding: 12, textAlign: "right", borderBottom: "1px solid #e5e7eb" }}>Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {supplierDetail.purchases.map((purchase) => {
                        const statusMeta = getStatusMeta(purchase.payment_status);
                        return (
                          <tr key={purchase.id} style={{ borderBottom: "1px solid #e5e7eb" }}>
                            <td style={{ padding: 12, fontSize: 14 }}>{formatDate(purchase.purchase_date || purchase.created_at)}</td>
                            <td style={{ padding: 12, fontSize: 14 }}>
                              <div style={{ fontWeight: 700, color: "#0f172a" }}>{purchase.product_name}</div>
                              <div style={{ fontSize: 12, color: "#64748b" }}>{purchase.invoice_number || purchase.product_sku}</div>
                            </td>
                            <td style={{ padding: 12, fontSize: 14 }}>
                              <span
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  padding: "4px 8px",
                                  borderRadius: 999,
                                  fontSize: 12,
                                  fontWeight: 700,
                                  border: `1px solid ${statusMeta.border}`,
                                  background: statusMeta.background,
                                  color: statusMeta.color,
                                }}
                              >
                                {statusMeta.label}
                              </span>
                            </td>
                            <td style={{ padding: 12, fontSize: 14, textAlign: "right", fontWeight: 700 }}>{formatCurrency(Number(purchase.amount_due || 0))}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              <div style={{ overflowX: "auto" }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a", marginBottom: 10 }}>Supplier Payments</div>
                {supplierDetail.payments.length === 0 ? (
                  <p style={{ margin: 0, color: "#6b7280" }}>No payments recorded for this supplier yet.</p>
                ) : (
                  <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 520 }}>
                    <thead>
                      <tr style={{ background: "#f8fafc" }}>
                        <th style={{ padding: 12, textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>Date</th>
                        <th style={{ padding: 12, textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>Invoice</th>
                        <th style={{ padding: 12, textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>Method</th>
                        <th style={{ padding: 12, textAlign: "right", borderBottom: "1px solid #e5e7eb" }}>Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {supplierDetail.payments.map((payment) => (
                        <tr key={payment.id} style={{ borderBottom: "1px solid #e5e7eb" }}>
                          <td style={{ padding: 12, fontSize: 14 }}>{formatDate(payment.payment_date || payment.created_at)}</td>
                          <td style={{ padding: 12, fontSize: 14 }}>
                            <div style={{ fontWeight: 700, color: "#0f172a" }}>{payment.purchase_invoice_number || "-"}</div>
                            <div style={{ fontSize: 12, color: "#64748b" }}>{payment.product_name || "Payment record"}</div>
                          </td>
                          <td style={{ padding: 12, fontSize: 14, textTransform: "capitalize" }}>{payment.payment_method.replace(/_/g, " ")}</td>
                          <td style={{ padding: 12, fontSize: 14, textAlign: "right", fontWeight: 700 }}>{formatCurrency(Number(payment.amount || 0))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 20, alignItems: "start" }}>
        <div className="card" style={{ marginBottom: 0 }}>
          <div style={{ marginBottom: 16 }}>
            <h3 style={{ margin: "0 0 6px", fontSize: 18, fontWeight: 700 }}>Record Supplier Payment</h3>
            <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>
              Apply payments against unpaid purchase invoices so supplier balances stay accurate.
            </p>
          </div>

          {paymentSuppliers.length === 0 ? (
            <p style={{ margin: 0, color: "#6b7280" }}>No unpaid supplier balances right now.</p>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              <label>
                <span style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 600, color: "#374151" }}>Supplier</span>
                <select
                  className="input"
                  value={paymentSupplierId ?? ""}
                  onChange={(e) => handlePaymentSupplierChange(e.target.value ? Number(e.target.value) : null)}
                  disabled={submittingPayment}
                >
                  <option value="">Select supplier</option>
                  {paymentSuppliers.map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>
                      {supplier.name} ({formatCurrency(Number(supplier.outstanding_balance || 0))} due)
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 600, color: "#374151" }}>Purchase / Invoice</span>
                <select
                  className="input"
                  value={paymentPurchaseId ?? ""}
                  onChange={(e) => handlePaymentPurchaseChange(e.target.value ? Number(e.target.value) : null)}
                  disabled={submittingPayment || paymentSupplierId == null}
                >
                  <option value="">Select unpaid purchase</option>
                  {paymentPurchasesForSupplier.map((purchase) => (
                    <option key={purchase.id} value={purchase.id}>
                      {purchase.product_name} - {purchase.invoice_number || "No invoice"} - {formatCurrency(Number(purchase.amount_due || 0))} due
                    </option>
                  ))}
                </select>
              </label>

              {selectedPaymentPurchase ? (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, padding: 12, border: "1px solid #e2e8f0", background: "#f8fafc", borderRadius: 10 }}>
                  <div>
                    <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>Invoice</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a" }}>{selectedPaymentPurchase.invoice_number || "-"}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>Total</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a" }}>{formatCurrency(Number(selectedPaymentPurchase.total_cost || 0))}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>Paid</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#1d4ed8" }}>{formatCurrency(Number(selectedPaymentPurchase.amount_paid || 0))}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>Balance Due</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#b45309" }}>{formatCurrency(Number(selectedPaymentPurchase.amount_due || 0))}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>Status</div>
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        padding: "4px 8px",
                        borderRadius: 999,
                        fontSize: 12,
                        fontWeight: 700,
                        border: `1px solid ${getStatusMeta(selectedPaymentPurchase.payment_status).border}`,
                        background: getStatusMeta(selectedPaymentPurchase.payment_status).background,
                        color: getStatusMeta(selectedPaymentPurchase.payment_status).color,
                      }}
                    >
                      {getStatusMeta(selectedPaymentPurchase.payment_status).label}
                    </span>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>Due Date</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a" }}>{formatDate(selectedPaymentPurchase.due_date)}</div>
                  </div>
                </div>
              ) : null}

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
                <label>
                  <span style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 600, color: "#374151" }}>Amount</span>
                  <input
                    className="input"
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={paymentAmount}
                    onChange={(e) => setPaymentAmount(e.target.value)}
                    disabled={submittingPayment || paymentPurchaseId == null}
                  />
                </label>
                <label>
                  <span style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 600, color: "#374151" }}>Payment Method</span>
                  <select
                    className="input"
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                    disabled={submittingPayment}
                  >
                    {paymentMethodOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 600, color: "#374151" }}>Payment Date</span>
                  <input
                    className="input"
                    type="date"
                    value={paymentDate}
                    onChange={(e) => setPaymentDate(e.target.value)}
                    disabled={submittingPayment}
                  />
                </label>
              </div>

              <label>
                <span style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 600, color: "#374151" }}>Notes</span>
                <textarea
                  className="textarea"
                  rows={3}
                  value={paymentNotes}
                  onChange={(e) => setPaymentNotes(e.target.value)}
                  placeholder="Optional supplier payment note"
                  disabled={submittingPayment}
                />
              </label>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={resetPaymentForm}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 8,
                    border: "1px solid #d1d5db",
                    background: "white",
                    color: "#334155",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Clear
                </button>
                <button
                  type="button"
                  className="button"
                  onClick={() => void handleRecordPayment()}
                  disabled={submittingPayment || paymentPurchaseId == null}
                >
                  {submittingPayment ? "Saving..." : "Record Payment"}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="card" style={{ marginBottom: 0 }}>
          <div style={{ marginBottom: 16 }}>
            <h3 style={{ margin: "0 0 6px", fontSize: 18, fontWeight: 700 }}>Recent Supplier Payments</h3>
            <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>
              Keep a clean audit trail of payments made against supplier invoices.
            </p>
          </div>

          {loading && payments.length === 0 ? (
            <p style={{ margin: 0, color: "#6b7280" }}>Loading payment history...</p>
          ) : payments.length === 0 ? (
            <p style={{ margin: 0, color: "#6b7280" }}>No supplier payments recorded yet.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
                <thead>
                  <tr style={{ background: "#f8fafc" }}>
                    <th style={{ padding: 12, textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>Date</th>
                    <th style={{ padding: 12, textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>Supplier</th>
                    <th style={{ padding: 12, textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>Invoice</th>
                    <th style={{ padding: 12, textAlign: "right", borderBottom: "1px solid #e5e7eb" }}>Amount</th>
                    <th style={{ padding: 12, textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>Method</th>
                    <th style={{ padding: 12, textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>By</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((payment) => (
                    <tr key={payment.id} style={{ borderBottom: "1px solid #e5e7eb" }}>
                      <td style={{ padding: 12, fontSize: 14 }}>{formatDate(payment.payment_date || payment.created_at)}</td>
                      <td style={{ padding: 12, fontSize: 14 }}>
                        <div style={{ fontWeight: 700, color: "#0f172a" }}>{payment.supplier_name}</div>
                        <div style={{ color: "#6b7280", fontSize: 12 }}>{payment.product_name || "Payment record"}</div>
                      </td>
                      <td style={{ padding: 12, fontSize: 14, color: "#475569" }}>{payment.purchase_invoice_number || "-"}</td>
                      <td style={{ padding: 12, fontSize: 14, textAlign: "right", fontWeight: 700 }}>{formatCurrency(Number(payment.amount || 0))}</td>
                      <td style={{ padding: 12, fontSize: 14, textTransform: "capitalize" }}>{payment.payment_method.replace(/_/g, " ")}</td>
                      <td style={{ padding: 12, fontSize: 14, color: "#475569" }}>{payment.created_by_name || "System"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 0 }}>
        <div style={{ marginBottom: 16 }}>
          <h3 style={{ margin: "0 0 6px", fontSize: 18, fontWeight: 700 }}>Recent Purchases</h3>
          <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>
            Review recent stock purchases and supplier activity for this branch.
          </p>
        </div>

        {loading && purchases.length === 0 ? (
          <p style={{ margin: 0, color: "#6b7280" }}>Loading purchase history...</p>
        ) : purchases.length === 0 ? (
          <p style={{ margin: 0, color: "#6b7280" }}>No purchases recorded yet.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}>
              <thead>
                <tr style={{ background: "#f8fafc" }}>
                  <th style={{ padding: 12, textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>Date</th>
                  <th style={{ padding: 12, textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>Supplier</th>
                  <th style={{ padding: 12, textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>Product</th>
                  <th style={{ padding: 12, textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>Status</th>
                  <th style={{ padding: 12, textAlign: "right", borderBottom: "1px solid #e5e7eb" }}>Total</th>
                  <th style={{ padding: 12, textAlign: "right", borderBottom: "1px solid #e5e7eb" }}>Paid</th>
                  <th style={{ padding: 12, textAlign: "right", borderBottom: "1px solid #e5e7eb" }}>Balance</th>
                  <th style={{ padding: 12, textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>Invoice</th>
                  <th style={{ padding: 12, textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {purchases.map((purchase) => {
                  const statusMeta = getStatusMeta(purchase.payment_status);
                  const balanceDue = Number(purchase.amount_due || 0);
                  return (
                  <tr key={purchase.id} style={{ borderBottom: "1px solid #e5e7eb" }}>
                    <td style={{ padding: 12, fontSize: 14 }}>{formatDate(purchase.purchase_date || purchase.created_at)}</td>
                    <td style={{ padding: 12, fontSize: 14 }}>
                      <div style={{ fontWeight: 700, color: "#0f172a" }}>{purchase.supplier_name}</div>
                      <div style={{ color: "#6b7280", fontSize: 12 }}>{purchase.created_by_name || "System"}</div>
                    </td>
                    <td style={{ padding: 12, fontSize: 14 }}>
                      <div style={{ fontWeight: 700, color: "#0f172a" }}>{purchase.product_name}</div>
                      <div style={{ color: "#6b7280", fontSize: 12 }}>{purchase.product_sku} · Qty {Number(purchase.quantity).toFixed(2)}</div>
                    </td>
                    <td style={{ padding: 12, fontSize: 14 }}>
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          padding: "4px 8px",
                          borderRadius: 999,
                          fontSize: 12,
                          fontWeight: 700,
                          border: `1px solid ${statusMeta.border}`,
                          background: statusMeta.background,
                          color: statusMeta.color,
                        }}
                      >
                        {statusMeta.label}
                      </span>
                      {purchase.due_date ? (
                        <div style={{ color: "#6b7280", fontSize: 12, marginTop: 6 }}>Due {formatDate(purchase.due_date)}</div>
                      ) : null}
                    </td>
                    <td style={{ padding: 12, fontSize: 14, textAlign: "right", fontWeight: 700 }}>{formatCurrency(Number(purchase.total_cost || 0))}</td>
                    <td style={{ padding: 12, fontSize: 14, textAlign: "right", color: "#1d4ed8", fontWeight: 700 }}>{formatCurrency(Number(purchase.amount_paid || 0))}</td>
                    <td style={{ padding: 12, fontSize: 14, textAlign: "right", color: balanceDue > 0 ? "#b45309" : "#166534", fontWeight: 700 }}>{formatCurrency(balanceDue)}</td>
                    <td style={{ padding: 12, fontSize: 14, color: "#475569" }}>{purchase.invoice_number || "-"}</td>
                    <td style={{ padding: 12, fontSize: 14 }}>
                      <button
                        type="button"
                        onClick={() => openPaymentForPurchase(purchase)}
                        disabled={balanceDue <= 0}
                        style={{
                          padding: "7px 10px",
                          borderRadius: 8,
                          border: "1px solid #2563eb",
                          background: balanceDue <= 0 ? "#e5e7eb" : "#2563eb",
                          color: balanceDue <= 0 ? "#6b7280" : "#ffffff",
                          fontSize: 12,
                          fontWeight: 700,
                          cursor: balanceDue <= 0 ? "not-allowed" : "pointer",
                        }}
                      >
                        Record Payment
                      </button>
                    </td>
                  </tr>
                )})}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
