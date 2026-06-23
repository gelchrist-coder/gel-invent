import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchSaleBatchOptions } from "../api";
import { NewSale, Product, SaleBatchOption } from "../types";
import { useAppCategories, userNeedsSupplyTracking } from "../categories";
import { startCameraBarcodeScan } from "../barcode-scanner";
import { getProductBatchSummary, getProductSearchText, getProductVariantSummary } from "../product-display";
import { useCapabilities } from "../settings";

type RepeatDraft = {
  token: string;
  sales: NewSale[];
  sourceLabel?: string;
};

type POSSaleFormProps = {
  products: Product[];
  onSubmit: (sales: NewSale[]) => void;
  onCancel?: () => void;
  customerSuggestions?: string[];
  repeatDraft?: RepeatDraft | null;
};

interface CartItem {
  id: string;
  product: Product;
  quantity: number;
  saleUnitType: string;
  selectedConversionId?: number | null;
  selectedVariantId?: number | null;
  preferredBatchNumber?: string | null;
}

const PAYMENT_METHODS = ["cash", "card", "mobile money", "bank transfer", "credit"];
const SUSPENDED_CARTS_STORAGE_KEY = "pos_suspended_carts_v1";
const MAX_SUSPENDED_CARTS = 20;

type SuspendedCartLine = {
  product_id: number;
  quantity: number;
  sale_unit_type: string;
  selected_conversion_id?: number | null;
  variant_id?: number | null;
  preferred_batch_number?: string | null;
};

type SuspendedCart = {
  id: string;
  label: string;
  createdAt: number;
  lines: SuspendedCartLine[];
  customerName: string;
  paymentMethod: string;
  notes: string;
};

const normalizeQuantityStep = (value: number | null | undefined): number => {
  const parsed = Number(value ?? 1);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 1;
  }
  return Number(parsed.toFixed(2));
};

const roundToStep = (value: number, step: number): number => {
  const normalizedStep = normalizeQuantityStep(step);
  return Number((Math.round(value / normalizedStep) * normalizedStep).toFixed(2));
};

const formatQuantityValue = (value: number): string => {
  const rounded = Number(value.toFixed(2));
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/\.?0+$/, "");
};

const formatShortDate = (value?: string | null): string | null => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

const formatBatchOptionLabel = (batch: SaleBatchOption): string => {
  const availability = `${formatQuantityValue(Number(batch.available_quantity || 0))} left`;
  const expiryLabel = formatShortDate(batch.expiry_date);
  return expiryLabel
    ? `${batch.batch_number} · ${availability} · Exp ${expiryLabel}`
    : `${batch.batch_number} · ${availability}`;
};

const createCartLineId = (): string => {
  return (globalThis.crypto as Crypto | undefined)?.randomUUID?.() ?? `line-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
};

const normalizeSaleUnitType = (value: string | null | undefined): string => {
  const normalized = String(value || "piece").trim();
  return normalized || "piece";
};

const getProductVariantOptions = (product: Product) => {
  return (product.variants ?? [])
    .filter((variant) => variant.is_active !== false)
    .sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0) || left.label.localeCompare(right.label));
};

const getProductSaleUnitOptions = (product: Product) => {
  const options: Array<{ value: string; label: string; baseQuantity: number; conversionId: number | null; unitPrice: number }> = [
    {
      value: "piece",
      label: `Base unit (${product.unit})`,
      baseQuantity: 1,
      conversionId: null,
      unitPrice: Number(product.selling_price || 0),
    },
  ];

  if (Number(product.pack_size || 0) > 0) {
    options.push({
      value: "pack",
      label: `Pack (${Number(product.pack_size || 0)} ${product.unit})`,
      baseQuantity: Number(product.pack_size || 0),
      conversionId: null,
      unitPrice: Number(product.pack_selling_price || 0) || (Number(product.selling_price || 0) * Number(product.pack_size || 0)),
    });
  }

  (product.unit_conversions ?? [])
    .filter((conversion) => conversion.is_sale_unit !== false)
    .sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0) || left.unit_name.localeCompare(right.unit_name))
    .forEach((conversion) => {
      options.push({
        value: conversion.unit_name,
        label: `${conversion.unit_name} (${Number(conversion.base_quantity || 0)} ${product.unit})`,
        baseQuantity: Number(conversion.base_quantity || 0),
        conversionId: conversion.id,
        unitPrice: Number(product.selling_price || 0) * Number(conversion.base_quantity || 0),
      });
    });

  return options;
};

const getCartItemBaseQuantity = (item: Pick<CartItem, "product" | "quantity" | "saleUnitType" | "selectedConversionId">): number => {
  const saleUnitType = normalizeSaleUnitType(item.saleUnitType).toLowerCase();
  if (saleUnitType === "piece") {
    return item.quantity;
  }

  if (saleUnitType === "pack") {
    return item.quantity * Number(item.product.pack_size || 1);
  }

  const conversion = (item.product.unit_conversions ?? []).find((entry) => entry.id === item.selectedConversionId);
  return item.quantity * Number(conversion?.base_quantity || 1);
};

const getCartItemUnitPrice = (item: Pick<CartItem, "product" | "saleUnitType" | "selectedConversionId">): number => {
  const saleUnitType = normalizeSaleUnitType(item.saleUnitType).toLowerCase();
  if (saleUnitType === "piece") {
    return Number(item.product.selling_price || 0);
  }
  if (saleUnitType === "pack") {
    return Number(item.product.pack_selling_price || 0) || (Number(item.product.selling_price || 0) * Number(item.product.pack_size || 0));
  }
  const conversion = (item.product.unit_conversions ?? []).find((entry) => entry.id === item.selectedConversionId);
  return Number(item.product.selling_price || 0) * Number(conversion?.base_quantity || 1);
};

const getCartItemDisplayUnit = (item: Pick<CartItem, "saleUnitType" | "quantity">): string => {
  const saleUnitType = normalizeSaleUnitType(item.saleUnitType).toLowerCase();
  if (saleUnitType === "piece") {
    return item.quantity === 1 ? "unit" : "units";
  }
  if (saleUnitType === "pack") {
    return item.quantity === 1 ? "pack" : "packs";
  }
  return normalizeSaleUnitType(item.saleUnitType);
};

const getBatchCacheKey = (productId: number, variantId?: number | null): string => {
  return `${productId}:${variantId ?? "base"}`;
};

const getCartItemPieceQuantity = (item: Pick<CartItem, "product" | "quantity" | "saleUnitType" | "selectedConversionId">): number => {
  return getCartItemBaseQuantity(item);
};

const getPieceQuantityStep = (product: Product, fractionalSalesEnabled: boolean): number => {
  if (!fractionalSalesEnabled || !product.allows_fractional_sales) {
    return 1;
  }
  return normalizeQuantityStep(product.quantity_step ?? 1);
};

export default function POSSaleForm({
  products,
  onSubmit,
  onCancel: _onCancel,
  customerSuggestions = [],
  repeatDraft = null,
}: POSSaleFormProps) {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [scanInput, setScanInput] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [collectLater, setCollectLater] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [notes, setNotes] = useState("");
  const [uiMessage, setUiMessage] = useState<{ type: "error" | "info"; text: string } | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [suspendedCarts, setSuspendedCarts] = useState<SuspendedCart[]>([]);
  const [selectedSuspendedCartId, setSelectedSuspendedCartId] = useState("");
  const [batchOptionsByKey, setBatchOptionsByKey] = useState<Record<string, SaleBatchOption[]>>({});
  const [batchLoadingByKey, setBatchLoadingByKey] = useState<Record<string, boolean>>({});
  const [batchErrorByKey, setBatchErrorByKey] = useState<Record<string, string | null>>({});

  const messageTimeoutRef = useRef<number | null>(null);
  const customerInputRef = useRef<HTMLInputElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const scanInputRef = useRef<HTMLInputElement | null>(null);
  const checkoutFormRef = useRef<HTMLFormElement | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const stopCameraScannerRef = useRef<(() => void) | null>(null);
  const lastAppliedRepeatTokenRef = useRef<string | null>(null);
  const handleScannedCodeRef = useRef<(value: string, source: "scanner" | "camera") => void>(() => {});
  const suspendCurrentCartRef = useRef<() => void>(() => {});
  const restoreSuspendedCartRef = useRef<(cartId: string) => void>(() => {});

  const userCategories = useAppCategories();
  const capabilities = useCapabilities();
  const fractionalSalesEnabled = capabilities.fractional_sales;
  // Only businesses that sell collect-later goods (cement, feed, etc.) see the
  // "leave in store" option, mirroring how expiry tracking is gated by type.
  const supplyTrackingEnabled = useMemo(() => userNeedsSupplyTracking(), []);

  // Quantity actually free to sell. current_stock is the physical in-store count;
  // reserved goods are physically present but already paid for, so they must be
  // excluded so a clerk can't sell goods that belong to a collect-later customer.
  const availableToSell = useCallback(
    (product: Product): number => {
      const physical = Number(product.current_stock ?? 0);
      const reserved = supplyTrackingEnabled ? Number(product.reserved_stock ?? 0) : 0;
      return Math.max(0, physical - reserved);
    },
    [supplyTrackingEnabled],
  );
  // For "leave in store" sales: how much of each cart line the customer takes at
  // the counter now (keyed by cart line id). Empty/0 means the whole line stays
  // reserved in the shop.
  const [collectNowByLine, setCollectNowByLine] = useState<Record<string, string>>({});

  // Credit sale states
  const [showCreditModal, setShowCreditModal] = useState(false);
  const [creditorName, setCreditorName] = useState("");
  const [creditorPhone, setCreditorPhone] = useState("");
  const [initialPayment, setInitialPayment] = useState<number>(0);

  const customerLookupSuggestions = useMemo(() => {
    const query = customerName.trim().toLowerCase();
    const unique = Array.from(new Set(customerSuggestions.map((name) => String(name || "").trim()).filter(Boolean)));
    if (!query) {
      return unique.slice(0, 8);
    }
    return unique.filter((name) => name.toLowerCase().includes(query)).slice(0, 8);
  }, [customerName, customerSuggestions]);

  useEffect(() => {
    return () => {
      if (messageTimeoutRef.current != null) {
        window.clearTimeout(messageTimeoutRef.current);
      }
    };
  }, []);

  const showMessage = useCallback((text: string, type: "error" | "info" = "error") => {
    setUiMessage({ type, text });
    if (messageTimeoutRef.current != null) {
      window.clearTimeout(messageTimeoutRef.current);
    }
    messageTimeoutRef.current = window.setTimeout(() => {
      setUiMessage(null);
      messageTimeoutRef.current = null;
    }, 3500);
  }, []);

  const loadBatchOptions = useCallback(async (productId: number, variantId?: number | null) => {
    if (!capabilities.batch_tracking) {
      return;
    }

    const cacheKey = getBatchCacheKey(productId, variantId);

    setBatchLoadingByKey((previous) => ({ ...previous, [cacheKey]: true }));
    setBatchErrorByKey((previous) => ({ ...previous, [cacheKey]: null }));

    try {
      const options = await fetchSaleBatchOptions(productId, variantId);
      setBatchOptionsByKey((previous) => ({ ...previous, [cacheKey]: options }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load live batches";
      setBatchErrorByKey((previous) => ({ ...previous, [cacheKey]: message }));
    } finally {
      setBatchLoadingByKey((previous) => ({ ...previous, [cacheKey]: false }));
    }
  }, [capabilities.batch_tracking]);

  const persistSuspendedCarts = (next: SuspendedCart[]) => {
    setSuspendedCarts(next);
    try {
      localStorage.setItem(SUSPENDED_CARTS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore persistence failures so checkout flow stays responsive.
    }
  };

  const stopCameraScanner = useCallback(() => {
    stopCameraScannerRef.current?.();
    stopCameraScannerRef.current = null;
  }, []);

  const findProductFromScan = (rawScanValue: string): Product | null => {
    const normalized = rawScanValue.trim().toLowerCase();
    if (!normalized) return null;

    const exactBarcode = products.find((product) => String(product.barcode || "").trim().toLowerCase() === normalized);
    if (exactBarcode) return exactBarcode;

    const exactSku = products.find((product) => String(product.sku || "").trim().toLowerCase() === normalized);
    if (exactSku) return exactSku;

    const exactName = products.find((product) => String(product.name || "").trim().toLowerCase() === normalized);
    if (exactName) return exactName;

    const startsWithSku = products.find((product) => String(product.sku || "").trim().toLowerCase().startsWith(normalized));
    if (startsWithSku) return startsWithSku;

    return null;
  };

  const handleScannedCode = (rawScanValue: string, source: "scanner" | "camera") => {
    const value = rawScanValue.trim();
    if (!value) return;

    const matchedProduct = findProductFromScan(value);
    if (matchedProduct) {
      addToCart(matchedProduct, "piece");
      setSearchTerm(matchedProduct.name);
      setScanInput("");
      showMessage(`Added ${matchedProduct.name} from ${source}`, "info");
      return;
    }

    setSearchTerm(value);
    showMessage(`No exact barcode match. Filtered catalog by \"${value}\".`, "info");
  };

  const suspendCurrentCart = () => {
    if (cart.length === 0) {
      showMessage("Add at least one item before suspending.");
      return;
    }

    const now = Date.now();
    const id = (globalThis.crypto as Crypto | undefined)?.randomUUID?.() ?? `suspend-${now}`;
    const firstProduct = cart[0]?.product?.name || "Quick cart";
    const snapshot: SuspendedCart = {
      id,
      label: customerName.trim() || `${firstProduct} (${cart.length} item${cart.length === 1 ? "" : "s"})`,
      createdAt: now,
      lines: cart.map((item) => ({
        product_id: item.product.id,
        quantity: item.quantity,
        sale_unit_type: item.saleUnitType,
        selected_conversion_id: item.selectedConversionId ?? null,
        variant_id: item.selectedVariantId ?? null,
        preferred_batch_number: item.preferredBatchNumber ?? null,
      })),
      customerName,
      paymentMethod,
      notes,
    };

    const next = [snapshot, ...suspendedCarts].slice(0, MAX_SUSPENDED_CARTS);
    persistSuspendedCarts(next);
    setSelectedSuspendedCartId(snapshot.id);
    clearCart();
    showMessage(`Cart suspended as \"${snapshot.label}\".`, "info");
  };

  const restoreSuspendedCart = (cartId: string) => {
    if (!cartId) return;
    const snapshot = suspendedCarts.find((entry) => entry.id === cartId);
    if (!snapshot) {
      showMessage("Suspended cart not found.");
      return;
    }

    const restoredLines: CartItem[] = snapshot.lines
      .map((line) => {
        const product = products.find((entry) => entry.id === line.product_id);
        if (!product) {
          return null;
        }
        const saleUnitType = normalizeSaleUnitType(line.sale_unit_type);
        const selectedConversionId = line.selected_conversion_id ?? null;
        const isKnownCustomUnit = saleUnitType === "piece"
          || saleUnitType === "pack"
          || (product.unit_conversions ?? []).some((entry) => entry.id === selectedConversionId);
        if (!isKnownCustomUnit) {
          return null;
        }
        return {
          id: createCartLineId(),
          product,
          quantity: saleUnitType === "piece"
            ? Math.max(0.01, Number(line.quantity) || 0)
            : Math.max(1, Math.round(Number(line.quantity) || 0)),
          saleUnitType,
          selectedConversionId,
          selectedVariantId: line.variant_id ?? null,
          preferredBatchNumber: line.preferred_batch_number ?? null,
        } as CartItem;
      })
      .filter((line): line is CartItem => line !== null);

    if (restoredLines.length === 0) {
      showMessage("Could not restore this cart because its products are missing.");
      return;
    }

    setCart(restoredLines);
    setCustomerName(snapshot.customerName || "");
    setPaymentMethod(snapshot.paymentMethod || "cash");
    setNotes(snapshot.notes || "");

    const next = suspendedCarts.filter((entry) => entry.id !== cartId);
    persistSuspendedCarts(next);
    setSelectedSuspendedCartId("");
    showMessage(`Resumed \"${snapshot.label}\".`, "info");
  };

  handleScannedCodeRef.current = handleScannedCode;
  suspendCurrentCartRef.current = suspendCurrentCart;
  restoreSuspendedCartRef.current = restoreSuspendedCart;

  // Get categories from user registration + existing products
  const categories = [
    "all",
    ...Array.from(
      new Set(
        [...userCategories, ...products.map((p) => p.category).filter(Boolean)].map((c) => String(c)),
      ),
    ),
  ];

  // Filter products by category and search
  const filteredProducts = products.filter(p => {
    const matchesCategory = selectedCategory === "all" || p.category === selectedCategory;
    const normalizedSearch = searchTerm.trim().toLowerCase();
    const matchesSearch = !normalizedSearch || getProductSearchText(p).includes(normalizedSearch);
    return matchesCategory && matchesSearch;
  });

  // Add product to cart
  const addToCart = (product: Product, saleUnitType: string = "piece", selectedConversionId: number | null = null) => {
    const availablePieces = availableToSell(product);
    if (availablePieces <= 0) {
      showMessage("Out of stock");
      return;
    }

    const normalizedSaleUnitType = normalizeSaleUnitType(saleUnitType);
    const defaultVariant = getProductVariantOptions(product).length === 1 ? getProductVariantOptions(product)[0] : null;
    const quantityIncrement = normalizedSaleUnitType === "piece" ? getPieceQuantityStep(product, fractionalSalesEnabled) : 1;
    const addedBaseQuantity = getCartItemBaseQuantity({
      product,
      quantity: quantityIncrement,
      saleUnitType: normalizedSaleUnitType,
      selectedConversionId,
    });

    const existingItem = cart.find((item) => (
      item.product.id === product.id
      && normalizeSaleUnitType(item.saleUnitType) === normalizedSaleUnitType
      && (item.selectedConversionId ?? null) === (selectedConversionId ?? null)
      && (item.selectedVariantId ?? null) === (defaultVariant?.id ?? null)
    ));

    const cartPiecesForProduct = cart.reduce((sum, item) => {
      if (item.product.id !== product.id) return sum;
      return sum + getCartItemBaseQuantity(item);
    }, 0);

    if (cartPiecesForProduct + addedBaseQuantity > availablePieces) {
      showMessage(`Not enough stock. Available: ${availablePieces}`);
      return;
    }
    
    if (existingItem) {
      // Increase quantity if already in cart
      setCart(cart.map(item => 
        item.id === existingItem.id
          ? { ...item, quantity: item.quantity + quantityIncrement }
          : item
      ));
    } else {
      // Add new item
      setCart([
        ...cart,
        {
          id: createCartLineId(),
          product,
          quantity: quantityIncrement,
          saleUnitType: normalizedSaleUnitType,
          selectedConversionId,
          selectedVariantId: defaultVariant?.id ?? null,
          preferredBatchNumber: null,
        },
      ]);
    }
  };

  const updatePreferredBatch = (lineId: string, preferredBatchNumber: string | null) => {
    setCart((previousCart) => previousCart.map((item) =>
      item.id === lineId
        ? { ...item, preferredBatchNumber }
        : item
    ));
  };

  // Update quantity
  const updateQuantity = (lineId: string, newQuantity: number) => {
    const line = cart.find((item) => item.id === lineId);
    if (!line) return;

    const normalizedQuantity =
      normalizeSaleUnitType(line.saleUnitType) === "piece"
        ? roundToStep(newQuantity, getPieceQuantityStep(line.product, fractionalSalesEnabled))
        : Math.floor(newQuantity);

    if (!Number.isFinite(normalizedQuantity)) return;

    if (normalizeSaleUnitType(line.saleUnitType) !== "piece") {
      if (normalizedQuantity < 1) {
        removeFromCart(lineId);
        return;
      }
    } else {
      if (normalizedQuantity <= 0) {
        removeFromCart(lineId);
        return;
      }
    }

    const availablePieces = availableToSell(line.product);
    if (availablePieces <= 0) {
      showMessage("Out of stock");
      removeFromCart(lineId);
      return;
    }

    const nextPiecesForProduct = cart.reduce((sum, item) => {
      if (item.product.id !== line.product.id) return sum;
      const quantity = item.id === lineId ? normalizedQuantity : item.quantity;
      return sum + getCartItemBaseQuantity({ ...item, quantity });
    }, 0);

    if (nextPiecesForProduct > availablePieces) {
      showMessage(`Not enough stock. Available: ${availablePieces}`);
      return;
    }
    setCart(cart.map(item => 
      item.id === lineId
        ? { ...item, quantity: normalizedQuantity }
        : item
    ));
  };

  const updateSelectedVariant = (lineId: string, variantId: number | null) => {
    setCart((previousCart) => previousCart.map((item) => (
      item.id === lineId
        ? { ...item, selectedVariantId: variantId, preferredBatchNumber: null }
        : item
    )));
  };

  const updateSaleUnit = (lineId: string, nextSaleUnitType: string, nextConversionId: number | null) => {
    setCart((previousCart) => previousCart.map((item) => {
      if (item.id !== lineId) {
        return item;
      }

      const normalizedSaleUnitType = normalizeSaleUnitType(nextSaleUnitType);
      const nextQuantity = normalizedSaleUnitType === "piece"
        ? Math.max(getPieceQuantityStep(item.product, fractionalSalesEnabled), item.quantity)
        : Math.max(1, Math.round(item.quantity));

      return {
        ...item,
        saleUnitType: normalizedSaleUnitType,
        selectedConversionId: normalizedSaleUnitType === "piece" || normalizedSaleUnitType === "pack" ? null : nextConversionId,
        quantity: nextQuantity,
        preferredBatchNumber: null,
      };
    }));
  };

  // Remove item from cart
  const removeFromCart = (lineId: string) => {
    setCart(cart.filter(item => item.id !== lineId));
  };

  // Clear cart
  const clearCart = () => {
    setCart([]);
    setCustomerName("");
    setCustomerPhone("");
    setCollectLater(false);
    setPaymentMethod("cash");
    setNotes("");
    setScanInput("");
    setSearchTerm("");
    setCollectNowByLine({});
    setCreditorName("");
    setCreditorPhone("");
    setInitialPayment(0);
  };

  // Calculate totals
  const cartTotal = cart.reduce((sum, item) => {
    return sum + (getCartItemUnitPrice(item) * item.quantity);
  }, 0);

  const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
  const formattedTotalItems = Number.isInteger(totalItems) ? String(totalItems) : totalItems.toFixed(2);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SUSPENDED_CARTS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as SuspendedCart[];
      if (!Array.isArray(parsed)) return;
      setSuspendedCarts(parsed);
    } catch {
      // Ignore malformed local state so POS can still load.
    }
  }, []);

  useEffect(() => {
    if (!capabilities.batch_tracking) {
      return;
    }

    for (const item of cart) {
      if (Number(item.product.active_batch_count ?? 0) <= 0) {
        continue;
      }
      if ((item.product.variants ?? []).length > 0 && item.selectedVariantId == null) {
        continue;
      }

      const cacheKey = getBatchCacheKey(item.product.id, item.selectedVariantId);
      if (batchOptionsByKey[cacheKey] !== undefined || batchLoadingByKey[cacheKey]) {
        continue;
      }
      void loadBatchOptions(item.product.id, item.selectedVariantId);
    }
  }, [batchLoadingByKey, batchOptionsByKey, capabilities.batch_tracking, cart, loadBatchOptions]);

  useEffect(() => {
    if (!cameraOpen) {
      stopCameraScanner();
      return;
    }

    const startCamera = async () => {
      setCameraError(null);
      const videoElement = cameraVideoRef.current;
      if (!videoElement) {
        setCameraError("Camera preview is not available.");
        return;
      }

      stopCameraScannerRef.current = await startCameraBarcodeScan({
        videoElement,
        onDetected: (rawValue) => {
          handleScannedCodeRef.current(rawValue, "camera");
          setCameraOpen(false);
        },
        onError: setCameraError,
      });
    };

    void startCamera();

    return () => {
      stopCameraScanner();
    };
  }, [cameraOpen, stopCameraScanner]);

  useEffect(() => {
    if (!repeatDraft || !repeatDraft.token || lastAppliedRepeatTokenRef.current === repeatDraft.token) {
      return;
    }

    const restored: CartItem[] = repeatDraft.sales
      .map((line) => {
        const product = products.find((entry) => entry.id === line.product_id);
        if (!product) return null;

        const saleUnitType = normalizeSaleUnitType(line.sale_unit_type);
        const selectedConversion = (product.unit_conversions ?? []).find((entry) => entry.unit_name.toLowerCase() === saleUnitType.toLowerCase()) ?? null;
        if (saleUnitType !== "piece" && saleUnitType !== "pack" && !selectedConversion) {
          return null;
        }

        const baseQuantityPerUnit = saleUnitType === "piece"
          ? 1
          : saleUnitType === "pack"
            ? Math.max(1, Number(product.pack_size || 1))
            : Math.max(1, Number(selectedConversion?.base_quantity || 1));
        const fallbackPackQty = saleUnitType === "piece"
          ? 0
          : Math.max(1, Math.round((Number(line.quantity) || 0) / baseQuantityPerUnit));
        const quantity = saleUnitType === "piece"
          ? Number(line.quantity || 0)
          : Number(line.pack_quantity ?? fallbackPackQty);

        if (!Number.isFinite(quantity) || quantity <= 0) return null;
        return {
          id: createCartLineId(),
          product,
          quantity,
          saleUnitType,
          selectedConversionId: selectedConversion?.id ?? null,
          selectedVariantId: line.variant_id ?? null,
          preferredBatchNumber: line.preferred_batch_number ?? null,
        } as CartItem;
      })
      .filter((entry): entry is CartItem => entry !== null);

    if (!restored.length) {
      showMessage("Could not repeat sale because items are unavailable.");
      return;
    }

    setCart(restored);
    setPaymentMethod(repeatDraft.sales[0]?.payment_method || "cash");
    setCustomerName(String(repeatDraft.sales[0]?.customer_name || ""));
    setNotes(String(repeatDraft.sales[0]?.notes || ""));
    setSearchTerm("");
    lastAppliedRepeatTokenRef.current = repeatDraft.token;
    showMessage(`Loaded repeat sale${repeatDraft.sourceLabel ? ` from ${repeatDraft.sourceLabel}` : ""}.`, "info");
  }, [repeatDraft, products, showMessage]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping = !!target && (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable
      );

      if (event.ctrlKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }

      if (event.ctrlKey && event.key.toLowerCase() === "b") {
        event.preventDefault();
        scanInputRef.current?.focus();
        scanInputRef.current?.select();
        return;
      }

      if (event.ctrlKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        customerInputRef.current?.focus();
        customerInputRef.current?.select();
        return;
      }

      if (event.altKey && event.key.toLowerCase() === "s") {
        event.preventDefault();
        suspendCurrentCartRef.current();
        return;
      }

      if (event.altKey && event.key.toLowerCase() === "r") {
        event.preventDefault();
        if (suspendedCarts[0]) {
          restoreSuspendedCartRef.current(suspendedCarts[0].id);
        } else {
          showMessage("No suspended carts available.", "info");
        }
        return;
      }

      if (event.key === "F4") {
        event.preventDefault();
        checkoutFormRef.current?.requestSubmit();
        return;
      }

      if (event.key === "Escape" && cameraOpen) {
        event.preventDefault();
        setCameraOpen(false);
        return;
      }

      if (isTyping) return;
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cameraOpen, paymentMethod, showMessage, suspendedCarts]);

  // Submit order
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (cart.length === 0) {
      showMessage("Please add items to cart");
      return;
    }

    // Validate stock before checkout
    const byProduct = new Map<number, { requiredPieces: number; availablePieces: number }>();
    for (const item of cart) {
      if (getProductVariantOptions(item.product).length > 0 && item.selectedVariantId == null) {
        showMessage(`Select a variant for ${item.product.name}`);
        return;
      }

      const availablePieces = availableToSell(item.product);
      const pieceQuantity = getCartItemBaseQuantity(item);
      const prev = byProduct.get(item.product.id) || { requiredPieces: 0, availablePieces };
      byProduct.set(item.product.id, {
        requiredPieces: prev.requiredPieces + pieceQuantity,
        availablePieces,
      });
    }

    for (const [productId, v] of byProduct.entries()) {
      if (v.requiredPieces > v.availablePieces) {
        const p = products.find((x) => x.id === productId);
        const name = p?.name || "This product";
        showMessage(`${name}: not enough stock (available ${v.availablePieces})`);
        return;
      }
    }

    // If credit payment, validate customer name and show credit modal
    if (paymentMethod === "credit") {
      if (!customerName.trim()) {
        showMessage("Customer name is required for credit sale");
        customerInputRef.current?.focus();
        return;
      }
      setCreditorName(customerName); // Use customer name as creditor name
      setShowCreditModal(true);
      return;
    }

    processOrder();
  };

  const processOrder = () => {
    // Create a sale row for each item in cart.
    // IMPORTANT: For credit sales, the optional initial payment should be applied ONCE
    // across the whole cart, not repeated for every product.
    const sales: NewSale[] = [];
    let remainingInitialPayment = paymentMethod === "credit" ? Number(initialPayment || 0) : 0;

    const collectLaterActive = supplyTrackingEnabled && collectLater;

    for (const item of cart) {
      const unitPrice = getCartItemUnitPrice(item);
      const pieceQuantity = getCartItemBaseQuantity(item);

      // "Leave in store": convert the per-line "taking now" amount (entered in the
      // line's own sale unit) into pieces so the backend can deduct exactly that
      // much and reserve the rest.
      let collectedPieces: number | undefined;
      if (collectLaterActive) {
        const basePerUnit = item.quantity > 0 ? pieceQuantity / item.quantity : 1;
        const takingUnitsRaw = Number(collectNowByLine[item.id] ?? 0);
        const takingUnits = Number.isFinite(takingUnitsRaw)
          ? Math.min(Math.max(takingUnitsRaw, 0), item.quantity)
          : 0;
        collectedPieces = Number((takingUnits * basePerUnit).toFixed(2));
      }

      // For credit sales, add phone to notes (backend extracts it for creditor record).
      let saleNotes = notes || null;
      if (paymentMethod === "credit") {
        const creditInfo = `Phone: ${creditorPhone}`;
        saleNotes = notes ? `${notes} | ${creditInfo}` : creditInfo;
      }

      const lineTotal = unitPrice * item.quantity;
      const appliedPayment =
        paymentMethod === "credit" && remainingInitialPayment > 0
          ? Math.min(remainingInitialPayment, Math.max(0, lineTotal))
          : 0;
      remainingInitialPayment = remainingInitialPayment - appliedPayment;

      sales.push({
        product_id: item.product.id,
        variant_id: item.selectedVariantId ?? undefined,
        quantity: pieceQuantity, // Always store in pieces for inventory
        sale_unit_type: item.saleUnitType,
        pack_quantity: normalizeSaleUnitType(item.saleUnitType) !== 'piece' ? item.quantity : undefined,
        preferred_batch_number: item.preferredBatchNumber || undefined,
        unit_price: unitPrice,
        total_price: lineTotal,
        customer_name: paymentMethod === "credit" ? creditorName : (customerName || null),
        customer_phone: paymentMethod === "credit" ? (creditorPhone || null) : (customerPhone.trim() || null),
        payment_method: paymentMethod,
        notes: saleNotes,
        amount_paid: paymentMethod === "credit" && appliedPayment > 0 ? appliedPayment : undefined,
        partial_payment_method: paymentMethod === "credit" && appliedPayment > 0 ? "cash" : undefined,
        not_supplied: collectLaterActive ? true : undefined,
        collected_quantity: collectLaterActive ? collectedPieces : undefined,
      });
    }

    onSubmit(sales);
    clearCart();
    setShowCreditModal(false);
  };

  const handleCreditSubmit = () => {
    if (!creditorName.trim()) {
      showMessage("Please enter customer name");
      return;
    }

    if (!creditorPhone.trim()) {
      showMessage("Please enter customer phone number");
      return;
    }

    if (initialPayment < 0 || initialPayment > cartTotal) {
      showMessage(`Initial payment must be between 0 and GHS ${cartTotal.toFixed(2)}`);
      return;
    }

    // Process the order
    processOrder();
  };

  return (
    <div className="pos-layout">
      {/* Left Side - Product Selection */}
      <div className="pos-left">
        {/* Search Bar */}
        <div style={{ marginBottom: 8, display: "grid", gap: 6 }}>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              type="text"
              placeholder="Scan barcode or SKU then press Enter"
              value={scanInput}
              ref={scanInputRef}
              onChange={(e) => setScanInput(e.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                handleScannedCode(scanInput, "scanner");
              }}
              style={{
                width: "100%",
                padding: "10px 12px",
                border: "1px solid #dbeafe",
                borderRadius: 6,
                fontSize: 13,
                background: "#f8fbff",
                outline: "none",
              }}
            />
            <button
              type="button"
              onClick={() => {
                setCameraError(null);
                setCameraOpen(true);
              }}
              style={{
                padding: "10px 12px",
                borderRadius: 6,
                border: "1px solid #bfdbfe",
                background: "#eff6ff",
                color: "#1d4ed8",
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              Camera
            </button>
          </div>

          <input
            type="text"
            placeholder="Search products..."
            value={searchTerm}
            ref={searchInputRef}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{
              width: "100%",
              padding: "10px 12px",
              border: "1px solid #e5e7eb",
              borderRadius: 6,
              fontSize: 13,
              background: "white",
              outline: "none",
            }}
          />
        </div>

        {/* Category Tabs - Horizontal Scroll */}
        <div style={{ 
          display: "flex", 
          gap: 6, 
          overflowX: "auto", 
          paddingBottom: 2,
          scrollbarWidth: "none",
        }}>
          {categories.map(category => (
            <button
              key={category}
              type="button"
              onClick={() => setSelectedCategory(category || "all")}
              style={{
                padding: "5px 12px",
                border: "none",
                background: selectedCategory === category ? "#111827" : "white",
                color: selectedCategory === category ? "white" : "#6b7280",
                borderRadius: 4,
                cursor: "pointer",
                fontWeight: 500,
                fontSize: 12,
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              {category === "all" ? "All" : category}
            </button>
          ))}
        </div>

        {/* Products Grid */}
        <div style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
          gap: 8,
          padding: 0,
        }}>
          {filteredProducts.map((product) => {
            const variantSummary = capabilities.variants || capabilities.size_color_variants || capabilities.brand_shade_attributes
              ? getProductVariantSummary(product)
              : null;
            const batchSummary = capabilities.batch_tracking
              ? getProductBatchSummary(product, { includeNextExpiry: capabilities.expiry_tracking })
              : null;
            const available = availableToSell(product);

            return (
              <button
                key={product.id}
                type="button"
                onClick={() => addToCart(product, 'piece')}
                disabled={available <= 0}
                style={{
                  padding: 0,
                  border: "1px solid #e5e7eb",
                  borderRadius: 6,
                  background: "white",
                  display: "flex",
                  flexDirection: "column",
                  cursor: available <= 0 ? "not-allowed" : "pointer",
                  opacity: available <= 0 ? 0.5 : 1,
                  overflow: "hidden",
                  textAlign: "left",
                }}
              >
                <div style={{ padding: "10px 10px 8px" }}>
                  <div style={{
                    fontWeight: 600,
                    fontSize: 12,
                    color: "#111827",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    marginBottom: 2,
                  }}>
                    {product.name}
                  </div>
                  {variantSummary ? (
                    <div style={{ fontSize: 10, color: "#475569", marginBottom: 4 }}>{variantSummary}</div>
                  ) : null}
                  <div style={{ fontSize: 10, color: available <= 0 ? "#dc2626" : "#9ca3af" }}>
                    {available <= 0 ? "Out of stock" : `${available} available`}
                  </div>
                  {batchSummary ? (
                    <div style={{ fontSize: 10, color: "#1d4ed8", marginTop: 4 }}>{batchSummary}</div>
                  ) : null}
                </div>
                <div style={{ 
                  padding: "8px 10px",
                  background: "#f9fafb",
                  borderTop: "1px solid #f3f4f6",
                  fontSize: 14,
                  fontWeight: 700,
                  color: "#111827",
                }}>
                  GHS {Number(product.selling_price || 0).toFixed(2)}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Right Side - Cart & Checkout */}
      <div className="pos-right">
        {/* Cart Header */}
        <div style={{
          padding: "12px 14px",
          background: "#111827",
          color: "white",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>Order</span>
            <span style={{ fontSize: 13, opacity: 0.8 }}>{formattedTotalItems} items</span>
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={suspendCurrentCart}
              style={{
                border: "1px solid rgba(255,255,255,0.25)",
                borderRadius: 999,
                background: "rgba(255,255,255,0.15)",
                color: "white",
                fontSize: 11,
                fontWeight: 700,
                padding: "4px 10px",
                cursor: "pointer",
              }}
            >
              Suspend (Alt+S)
            </button>

            <button
              type="button"
              onClick={() => {
                if (suspendedCarts[0]) {
                  restoreSuspendedCart(suspendedCarts[0].id);
                  return;
                }
                showMessage("No suspended carts available.", "info");
              }}
              style={{
                border: "1px solid rgba(255,255,255,0.25)",
                borderRadius: 999,
                background: "rgba(255,255,255,0.08)",
                color: "white",
                fontSize: 11,
                fontWeight: 700,
                padding: "4px 10px",
                cursor: "pointer",
              }}
            >
              Resume Last (Alt+R)
            </button>
          </div>

          {suspendedCarts.length > 0 && (
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              <select
                value={selectedSuspendedCartId}
                onChange={(event) => setSelectedSuspendedCartId(event.target.value)}
                style={{
                  flex: 1,
                  border: "1px solid rgba(255,255,255,0.25)",
                  borderRadius: 6,
                  background: "rgba(255,255,255,0.08)",
                  color: "white",
                  fontSize: 12,
                  padding: "6px 8px",
                }}
              >
                <option value="" style={{ color: "#111827" }}>Select suspended cart</option>
                {suspendedCarts.map((entry) => (
                  <option key={entry.id} value={entry.id} style={{ color: "#111827" }}>
                    {entry.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => restoreSuspendedCart(selectedSuspendedCartId)}
                disabled={!selectedSuspendedCartId}
                style={{
                  border: "1px solid rgba(255,255,255,0.25)",
                  borderRadius: 6,
                  background: selectedSuspendedCartId ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.08)",
                  color: "white",
                  fontSize: 12,
                  fontWeight: 700,
                  padding: "6px 10px",
                  cursor: selectedSuspendedCartId ? "pointer" : "not-allowed",
                }}
              >
                Load
              </button>
            </div>
          )}

          <div style={{ marginTop: 8, fontSize: 11, opacity: 0.85 }}>
            Shortcuts: Ctrl+F search, Ctrl+B scan, Ctrl+K customer, F4 charge.
          </div>
        </div>

        {/* Cart Items */}
        <div className="pos-cart-items" style={{ padding: "0 14px" }}>
          {uiMessage && (
            <div
              style={{
                margin: "10px 0",
                padding: "8px 10px",
                borderRadius: 4,
                background: uiMessage.type === "error" ? "#fef2f2" : "#eff6ff",
                color: uiMessage.type === "error" ? "#b91c1c" : "#1d4ed8",
                fontSize: 12,
              }}
              role={uiMessage.type === "error" ? "alert" : "status"}
            >
              {uiMessage.text}
            </div>
          )}

          {cart.length === 0 ? (
            <div style={{ 
              textAlign: "center", 
              padding: "40px 16px", 
              color: "#9ca3af",
            }}>
              <div style={{ fontSize: 32, marginBottom: 8, opacity: 0.3 }}></div>
              <p style={{ fontSize: 13, margin: 0 }}>No items</p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {cart.map(item => {
                const normalizedSaleUnitType = normalizeSaleUnitType(item.saleUnitType);
                const unitPrice = getCartItemUnitPrice(item);
                const pieceQuantity = getCartItemPieceQuantity(item);
                const quantityStep = normalizedSaleUnitType === 'piece'
                  ? getPieceQuantityStep(item.product, fractionalSalesEnabled)
                  : 1;
                const showsFractionalQuantityControls =
                  normalizedSaleUnitType === 'piece' && fractionalSalesEnabled && Boolean(item.product.allows_fractional_sales) && quantityStep < 1;
                const variantSummary = capabilities.variants || capabilities.size_color_variants || capabilities.brand_shade_attributes
                  ? getProductVariantSummary(item.product)
                  : null;
                const variantOptions = getProductVariantOptions(item.product);
                const selectedVariant = variantOptions.find((variant) => variant.id === item.selectedVariantId) ?? null;
                const saleUnitOptions = getProductSaleUnitOptions(item.product);
                const selectedSaleUnit = saleUnitOptions.find((option) => (
                  option.value === normalizedSaleUnitType && (option.conversionId ?? null) === (item.selectedConversionId ?? null)
                )) ?? null;
                const batchSummary = capabilities.batch_tracking
                  ? getProductBatchSummary(item.product, { includeNextExpiry: capabilities.expiry_tracking })
                  : null;
                const batchCacheKey = getBatchCacheKey(item.product.id, item.selectedVariantId);
                const batchOptions = batchOptionsByKey[batchCacheKey] ?? [];
                const batchLoading = Boolean(batchLoadingByKey[batchCacheKey]);
                const batchError = batchErrorByKey[batchCacheKey];
                const selectedBatch = batchOptions.find((option) => option.batch_number === item.preferredBatchNumber) ?? null;
                const selectedBatchAvailable = Math.max(0, Number(selectedBatch?.available_quantity ?? 0));
                const selectedBatchCoverage = selectedBatch ? Math.min(pieceQuantity, selectedBatchAvailable) : 0;
                const remainingAfterSelectedBatch = selectedBatch ? Math.max(pieceQuantity - selectedBatchCoverage, 0) : 0;
                const showBatchPicker = capabilities.batch_tracking
                  && Number(item.product.active_batch_count ?? 0) > 0
                  && (variantOptions.length === 0 || item.selectedVariantId != null);
                
                return (
                <div
                  key={item.id}
                  style={{
                    padding: "10px 0",
                    borderBottom: "1px solid #f3f4f6",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, color: "#111827", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {item.product.name}
                      </div>
                      {selectedVariant ? (
                        <div style={{ fontSize: 11, color: "#475569", marginTop: 3 }}>Variant: {selectedVariant.label}</div>
                      ) : variantSummary ? (
                        <div style={{ fontSize: 11, color: "#475569", marginTop: 3 }}>{variantSummary}</div>
                      ) : null}
                      {selectedSaleUnit ? (
                        <div style={{ fontSize: 11, color: "#0f766e", marginTop: 3 }}>{selectedSaleUnit.label}</div>
                      ) : null}
                      {batchSummary ? (
                        <div style={{ fontSize: 11, color: "#1d4ed8", marginTop: 3 }}>{batchSummary}</div>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeFromCart(item.id)}
                      style={{
                        width: 24,
                        height: 24,
                        background: "transparent",
                        color: "#9ca3af",
                        border: "none",
                        cursor: "pointer",
                        fontSize: 14,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                        marginLeft: 8,
                      }}
                    >
                      X
                    </button>
                  </div>

                  {(variantOptions.length > 0 || saleUnitOptions.length > 1) ? (
                    <div style={{ display: "grid", gap: 8, marginBottom: 8 }}>
                      {variantOptions.length > 0 ? (
                        <label style={{ display: "grid", gap: 4 }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: "#475569" }}>Variant</span>
                          <select
                            value={item.selectedVariantId ?? ""}
                            onChange={(event) => updateSelectedVariant(item.id, event.target.value ? Number(event.target.value) : null)}
                            style={{
                              width: "100%",
                              padding: "8px 10px",
                              borderRadius: 6,
                              border: item.selectedVariantId == null ? "1px solid #f59e0b" : "1px solid #d1d5db",
                              background: "white",
                              fontSize: 12,
                              color: "#0f172a",
                            }}
                          >
                            <option value="">Select a variant</option>
                            {variantOptions.map((variant) => (
                              <option key={variant.id} value={variant.id}>{variant.label}</option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                      {saleUnitOptions.length > 1 ? (
                        <label style={{ display: "grid", gap: 4 }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: "#475569" }}>Sale Unit</span>
                          <select
                            value={`${normalizedSaleUnitType}:${item.selectedConversionId ?? "base"}`}
                            onChange={(event) => {
                              const nextOption = saleUnitOptions.find((option) => `${option.value}:${option.conversionId ?? "base"}` === event.target.value);
                              if (!nextOption) {
                                return;
                              }
                              updateSaleUnit(item.id, nextOption.value, nextOption.conversionId ?? null);
                            }}
                            style={{
                              width: "100%",
                              padding: "8px 10px",
                              borderRadius: 6,
                              border: "1px solid #d1d5db",
                              background: "white",
                              fontSize: 12,
                              color: "#0f172a",
                            }}
                          >
                            {saleUnitOptions.map((option) => (
                              <option key={`${option.value}-${option.conversionId ?? "base"}`} value={`${option.value}:${option.conversionId ?? "base"}`}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                    </div>
                  ) : null}
                  
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div className="pos-stepper" style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <button
                        type="button"
                        onClick={() => updateQuantity(item.id, item.quantity - quantityStep)}
                        style={{
                          width: 28,
                          height: 28,
                          border: "1px solid #e5e7eb",
                          background: "white",
                          borderRadius: 4,
                          cursor: "pointer",
                          fontSize: 16,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: "#6b7280",
                        }}
                      >
                        −
                      </button>
                      {showsFractionalQuantityControls ? (
                        <button
                          type="button"
                          onClick={() => updateQuantity(item.id, quantityStep)}
                          style={{
                            height: 28,
                            padding: "0 10px",
                            border: "1px solid #e5e7eb",
                            background: "white",
                            borderRadius: 4,
                            cursor: "pointer",
                            fontSize: 12,
                            fontWeight: 700,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: "#6b7280",
                          }}
                        >
                          Min {formatQuantityValue(quantityStep)}
                        </button>
                      ) : null}
                      <input
                        type="number"
                        inputMode="decimal"
                        step={quantityStep}
                        min={quantityStep}
                        value={Number.isFinite(item.quantity) ? String(item.quantity) : ""}
                        onChange={(e) => {
                          const raw = e.target.value;
                          if (!raw) return;
                          const parsed = Number(raw);
                          if (!Number.isFinite(parsed)) return;
                          updateQuantity(item.id, parsed);
                        }}
                        aria-label={`Quantity for ${item.product.name}`}
                        style={{
                          width: 60,
                          height: 28,
                          textAlign: "center",
                          fontSize: 14,
                          fontWeight: 600,
                          border: "1px solid #e5e7eb",
                          borderRadius: 4,
                          padding: "0 6px",
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => updateQuantity(item.id, item.quantity + quantityStep)}
                        style={{
                          width: 28,
                          height: 28,
                          border: "1px solid #e5e7eb",
                          background: "white",
                          borderRadius: 4,
                          cursor: "pointer",
                          fontSize: 16,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: "#6b7280",
                        }}
                      >
                        +
                      </button>
                    </div>
                    <div style={{ fontWeight: 700, color: "#111827", fontSize: 14 }}>
                      GHS {(unitPrice * item.quantity).toFixed(2)}
                    </div>
                  </div>

                  {supplyTrackingEnabled && collectLater ? (() => {
                    const takingRaw = Number(collectNowByLine[item.id] ?? 0);
                    const taking = Number.isFinite(takingRaw) ? Math.min(Math.max(takingRaw, 0), item.quantity) : 0;
                    const leftInStore = Math.max(0, item.quantity - taking);
                    return (
                      <div
                        style={{
                          marginTop: 8,
                          padding: "8px 10px",
                          borderRadius: 6,
                          border: "1px solid #fde68a",
                          background: "#fffbeb",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 8,
                          flexWrap: "wrap",
                        }}
                      >
                        <span style={{ fontSize: 11, fontWeight: 700, color: "#92400e" }}>Taking now</span>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <input
                            type="number"
                            inputMode="decimal"
                            min={0}
                            max={item.quantity}
                            step={quantityStep}
                            value={collectNowByLine[item.id] ?? "0"}
                            onChange={(event) =>
                              setCollectNowByLine((prev) => ({ ...prev, [item.id]: event.target.value }))
                            }
                            aria-label={`Quantity taken now for ${item.product.name}`}
                            style={{
                              width: 64,
                              padding: "6px 8px",
                              border: "1px solid #fbbf24",
                              borderRadius: 4,
                              fontSize: 13,
                              fontWeight: 600,
                              textAlign: "center",
                              background: "white",
                            }}
                          />
                          <span style={{ fontSize: 11, color: "#92400e" }}>
                            of {formatQuantityValue(item.quantity)} · {formatQuantityValue(leftInStore)} left in store
                          </span>
                        </div>
                      </div>
                    );
                  })() : null}

                  {showBatchPicker ? (
                    <div
                      style={{
                        marginTop: 10,
                        padding: 10,
                        borderRadius: 8,
                        border: "1px solid #dbeafe",
                        background: "#f8fbff",
                        display: "grid",
                        gap: 6,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: "#1d4ed8" }}>Batch allocation</span>
                        <button
                          type="button"
                          onClick={() => void loadBatchOptions(item.product.id, item.selectedVariantId)}
                          style={{
                            padding: 0,
                            border: "none",
                            background: "transparent",
                            color: "#1d4ed8",
                            cursor: "pointer",
                            fontSize: 11,
                            fontWeight: 700,
                          }}
                        >
                          Refresh
                        </button>
                      </div>

                      <select
                        value={item.preferredBatchNumber ?? ""}
                        onChange={(event) => updatePreferredBatch(item.id, event.target.value || null)}
                        disabled={batchLoading || batchOptions.length === 0}
                        style={{
                          width: "100%",
                          padding: "8px 10px",
                          borderRadius: 6,
                          border: "1px solid #bfdbfe",
                          background: "white",
                          fontSize: 12,
                          color: "#0f172a",
                        }}
                      >
                        <option value="">Auto allocate oldest available batch</option>
                        {batchOptions.map((option) => (
                          <option key={option.batch_number} value={option.batch_number}>
                            {formatBatchOptionLabel(option)}
                          </option>
                        ))}
                      </select>

                      {batchLoading ? (
                        <div style={{ fontSize: 11, color: "#64748b" }}>Loading live batch balances...</div>
                      ) : null}
                      {batchError ? (
                        <div style={{ fontSize: 11, color: "#b91c1c" }}>
                          {batchError}. Checkout can still fall back to automatic FEFO allocation.
                        </div>
                      ) : null}
                      {selectedBatch ? (
                        <div style={{ fontSize: 11, color: "#334155" }}>
                          {remainingAfterSelectedBatch > 0
                            ? `This sale starts with ${selectedBatch.batch_number} for ${formatQuantityValue(selectedBatchCoverage)} ${item.product.unit}; the remaining ${formatQuantityValue(remainingAfterSelectedBatch)} ${item.product.unit} follow FEFO.`
                            : `This sale will use ${selectedBatch.batch_number} first as long as availability holds.`}
                        </div>
                      ) : batchOptions.length > 0 ? (
                        <div style={{ fontSize: 11, color: "#334155" }}>
                          Auto mode sells from the oldest available batch first.
                        </div>
                      ) : (
                        <div style={{ fontSize: 11, color: "#64748b" }}>
                          No tracked batches are currently available for manual selection.
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              );
              })}
            </div>
          )}
        </div>

        {/* Checkout Form - Always visible when cart has items */}
        {cart.length > 0 && (
          <div
            style={{
              borderTop: "1px solid #e5e7eb",
              background: "white",
            }}
          >
              <form
                className="pos-checkout"
                ref={checkoutFormRef}
                onSubmit={handleSubmit}
              >
                {/* Total */}
                <div style={{
                  padding: "12px 14px",
                  borderBottom: "1px solid #f3f4f6",
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 12, color: "#6b7280" }}>Subtotal</span>
                    <span style={{ fontSize: 18, fontWeight: 700, color: "#111827" }}>GHS {cartTotal.toFixed(2)}</span>
                  </div>
                </div>

                {/* Form fields */}
                <div style={{ padding: "12px 14px" }}>

                <div style={{ marginBottom: 10 }}>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      border: "1px solid #e5e7eb",
                      borderRadius: 4,
                      fontSize: 13,
                      background: "white",
                      cursor: "pointer",
                      color: "#111827",
                    }}
                  >
                    {PAYMENT_METHODS.map((method) => (
                      <option key={method} value={method}>
                        {method.charAt(0).toUpperCase() + method.slice(1)}
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ marginBottom: 10 }}>
                  <input
                    type="text"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder={paymentMethod === "credit" ? "Customer name (required)" : "Customer name (optional)"}
                    ref={customerInputRef}
                    list="quick-customer-lookup"
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      border: paymentMethod === "credit" ? "1px solid #fbbf24" : "1px solid #e5e7eb",
                      borderRadius: 4,
                      fontSize: 13,
                      background: paymentMethod === "credit" ? "#fffbeb" : "white",
                    }}
                  />
                  <datalist id="quick-customer-lookup">
                    {customerLookupSuggestions.map((suggestion) => (
                      <option key={suggestion} value={suggestion} />
                    ))}
                  </datalist>
                  {customerLookupSuggestions.length > 0 && (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                      {customerLookupSuggestions.slice(0, 5).map((suggestion) => (
                        <button
                          key={suggestion}
                          type="button"
                          onClick={() => setCustomerName(suggestion)}
                          style={{
                            border: "1px solid #d1d5db",
                            borderRadius: 999,
                            background: "white",
                            color: "#374151",
                            fontSize: 11,
                            padding: "4px 9px",
                            cursor: "pointer",
                            fontWeight: 700,
                          }}
                        >
                          {suggestion}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {supplyTrackingEnabled && (
                  <div
                    style={{
                      marginBottom: 10,
                      padding: "10px 12px",
                      border: `1px solid ${collectLater ? "#fbbf24" : "#e5e7eb"}`,
                      borderRadius: 6,
                      background: collectLater ? "#fffbeb" : "#f8fafc",
                    }}
                  >
                    <label
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 8,
                        cursor: "pointer",
                        fontSize: 13,
                        fontWeight: 700,
                        color: "#111827",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={collectLater}
                        onChange={(e) => setCollectLater(e.target.checked)}
                        style={{ marginTop: 2, width: 16, height: 16, cursor: "pointer" }}
                      />
                      <span>
                        Leave in store — collect later
                        <span style={{ display: "block", fontSize: 11, fontWeight: 500, color: "#92400e", marginTop: 2 }}>
                          Paid in full but goods stay in the shop. Stock is reserved until the customer picks it up.
                        </span>
                      </span>
                    </label>
                    {collectLater && (
                      <input
                        type="tel"
                        value={customerPhone}
                        onChange={(e) => setCustomerPhone(e.target.value)}
                        placeholder="Customer phone (optional)"
                        style={{
                          width: "100%",
                          marginTop: 10,
                          padding: "9px 12px",
                          border: "1px solid #fbbf24",
                          borderRadius: 4,
                          fontSize: 13,
                          background: "white",
                        }}
                      />
                    )}
                  </div>
                )}

                </div>

                {/* Submit button — sticky above the bottom tab bar on mobile. */}
                <div className="pos-checkout" style={{ padding: "12px 14px" }}>
                  <button
                    type="submit"
                    style={{
                      width: "100%",
                      minHeight: 52,
                      padding: "15px",
                      background: "#10b981",
                      color: "white",
                      border: "none",
                      borderRadius: 10,
                      fontSize: 16,
                      fontWeight: 800,
                      cursor: "pointer",
                      boxShadow: "0 8px 18px rgba(16, 185, 129, 0.3)",
                    }}
                  >
                    Charge GHS {cartTotal.toFixed(2)}
                  </button>
                </div>
              </form>
          </div>
        )}
      </div>

      {/* Camera Scanner Modal */}
      {cameraOpen && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(15, 23, 42, 0.78)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1050,
            padding: 16,
          }}
          onClick={() => setCameraOpen(false)}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 520,
              background: "#020617",
              borderRadius: 12,
              border: "1px solid #1e293b",
              padding: 14,
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <h3 style={{ margin: 0, fontSize: 16, color: "#e2e8f0" }}>Scan Barcode</h3>
              <button
                type="button"
                onClick={() => setCameraOpen(false)}
                style={{
                  border: "1px solid #334155",
                  borderRadius: 6,
                  background: "#0f172a",
                  color: "#e2e8f0",
                  fontSize: 12,
                  fontWeight: 700,
                  padding: "6px 10px",
                  cursor: "pointer",
                }}
              >
                Close
              </button>
            </div>
            <video
              ref={cameraVideoRef}
              autoPlay
              muted
              playsInline
              style={{ width: "100%", borderRadius: 10, background: "#0b1220", minHeight: 280, objectFit: "cover" }}
            />
            <p style={{ margin: "10px 0 0", fontSize: 12, color: "#94a3b8" }}>
              Align barcode inside the frame. Scan auto-adds one item to cart.
            </p>
            {cameraError ? (
              <p style={{ margin: "8px 0 0", fontSize: 12, color: "#fca5a5" }}>{cameraError}</p>
            ) : null}
          </div>
        </div>
      )}

      {/* Credit Modal */}
      {showCreditModal && (
        <div style={{
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
        }}>
          <div style={{
            background: "white",
            borderRadius: 12,
            padding: 24,
            width: "90%",
            maxWidth: 500,
            boxShadow: "0 20px 60px rgba(0, 0, 0, 0.3)",
          }}>
            <h2 style={{ marginTop: 0, marginBottom: 20, fontSize: 20, fontWeight: 700 }}>
              Credit Sale Details
            </h2>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
                Customer Name
              </label>
              <input
                type="text"
                value={creditorName}
                readOnly
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  border: "2px solid #e5e7eb",
                  borderRadius: 8,
                  fontSize: 14,
                  background: "#f9fafb",
                  color: "#6b7280",
                }}
              />
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
                Phone Number *
              </label>
              <input
                type="tel"
                value={creditorPhone}
                onChange={(e) => setCreditorPhone(e.target.value)}
                placeholder="Enter phone number"
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  border: "2px solid #e5e7eb",
                  borderRadius: 8,
                  fontSize: 14,
                }}
                autoFocus
              />
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ display: "block", fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
                Initial Payment (Optional)
              </label>
              <input
                type="number"
                value={initialPayment || ''}
                onChange={(e) => setInitialPayment(e.target.value === '' ? 0 : Number(e.target.value))}
                placeholder="0.00"
                min="0"
                max={cartTotal}
                step="0.01"
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  border: "2px solid #e5e7eb",
                  borderRadius: 8,
                  fontSize: 14,
                }}
              />
              <p style={{ margin: "6px 0 0", fontSize: 12, color: "#6b7280" }}>
                Total: GHS {cartTotal.toFixed(2)} | Remaining: GHS {(cartTotal - (initialPayment || 0)).toFixed(2)}
              </p>
            </div>

            <div style={{ display: "flex", gap: 12 }}>
              <button
                onClick={() => setShowCreditModal(false)}
                style={{
                  flex: 1,
                  padding: 12,
                  background: "#e5e7eb",
                  color: "#374151",
                  border: "none",
                  borderRadius: 8,
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleCreditSubmit}
                style={{
                  flex: 1,
                  padding: 12,
                  background: "#10b981",
                  color: "white",
                  border: "none",
                  borderRadius: 8,
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Confirm Credit Sale
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
