import { useEffect, useRef, useState } from "react";
import { NewSale, Product } from "../types";
import { useAppCategories } from "../categories";
import { updateMyCategories } from "../api";

type POSSaleFormProps = {
  products: Product[];
  onSubmit: (sales: NewSale[]) => void;
  onCancel?: () => void;
};

interface CartItem {
  product: Product;
  quantity: number;
  sellingUnit: 'piece' | 'pack'; // Whether selling by piece or pack
}

const PAYMENT_METHODS = ["cash", "card", "mobile money", "bank transfer", "credit"];

export default function POSSaleForm({ products, onSubmit, onCancel: _onCancel }: POSSaleFormProps) {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [notes, setNotes] = useState("");
  const [uiMessage, setUiMessage] = useState<{ type: "error" | "info"; text: string } | null>(null);

  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [clearArmed, setClearArmed] = useState(false);
  const clearArmTimeoutRef = useRef<number | null>(null);
  const messageTimeoutRef = useRef<number | null>(null);
  const customerInputRef = useRef<HTMLInputElement | null>(null);
  const [lastAdded, setLastAdded] = useState<{ productId: number; unit: 'piece' | 'pack' } | null>(null);

  const userCategories = useAppCategories();

  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  
  // Credit sale states
  const [showCreditModal, setShowCreditModal] = useState(false);
  const [creditorName, setCreditorName] = useState("");
  const [creditorPhone, setCreditorPhone] = useState("");
  const [initialPayment, setInitialPayment] = useState<number>(0);

  useEffect(() => {
    if (cart.length === 0) {
      setCheckoutOpen(false);
      setClearArmed(false);
    }
  }, [cart.length]);

  useEffect(() => {
    return () => {
      if (clearArmTimeoutRef.current != null) {
        window.clearTimeout(clearArmTimeoutRef.current);
      }
      if (messageTimeoutRef.current != null) {
        window.clearTimeout(messageTimeoutRef.current);
      }
    };
  }, []);

  const showMessage = (text: string, type: "error" | "info" = "error") => {
    setUiMessage({ type, text });
    if (messageTimeoutRef.current != null) {
      window.clearTimeout(messageTimeoutRef.current);
    }
    messageTimeoutRef.current = window.setTimeout(() => {
      setUiMessage(null);
      messageTimeoutRef.current = null;
    }, 3500);
  };

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
    const matchesSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          p.sku.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  // Add product to cart
  const addToCart = (product: Product, unit: 'piece' | 'pack' = 'piece') => {
    const availablePieces = Math.max(0, Number(product.current_stock ?? 0));
    if (availablePieces <= 0) {
      showMessage("Out of stock");
      return;
    }

    const existingItem = cart.find(item => item.product.id === product.id && item.sellingUnit === unit);

    const cartPiecesForProduct = cart.reduce((sum, item) => {
      if (item.product.id !== product.id) return sum;
      const pieceQty = item.sellingUnit === 'pack'
        ? item.quantity * (item.product.pack_size || 1)
        : item.quantity;
      return sum + pieceQty;
    }, 0);

    const addPieceQty = unit === 'pack' ? (product.pack_size || 1) : 1;
    if (cartPiecesForProduct + addPieceQty > availablePieces) {
      showMessage(`Not enough stock. Available: ${availablePieces}`);
      return;
    }
    
    if (existingItem) {
      // Increase quantity if already in cart
      setLastAdded({ productId: product.id, unit });
      setCart(cart.map(item => 
        item.product.id === product.id && item.sellingUnit === unit
          ? { ...item, quantity: item.quantity + 1 }
          : item
      ));
    } else {
      // Add new item
      setLastAdded({ productId: product.id, unit });
      setCart([...cart, { product, quantity: 1, sellingUnit: unit }]);
    }
  };

  // Update quantity
  const updateQuantity = (productId: number, unit: 'piece' | 'pack', newQuantity: number) => {
    if (newQuantity < 1) {
      removeFromCart(productId, unit);
      return;
    }

    const product = products.find((p) => p.id === productId);
    const availablePieces = Math.max(0, Number(product?.current_stock ?? 0));
    if (availablePieces <= 0) {
      showMessage("Out of stock");
      removeFromCart(productId, unit);
      return;
    }

    const nextPiecesForProduct = cart.reduce((sum, item) => {
      if (item.product.id !== productId) return sum;
      const qty = item.sellingUnit === unit ? newQuantity : item.quantity;
      const pieceQty = item.sellingUnit === 'pack'
        ? qty * (item.product.pack_size || 1)
        : qty;
      return sum + pieceQty;
    }, 0);

    if (nextPiecesForProduct > availablePieces) {
      showMessage(`Not enough stock. Available: ${availablePieces}`);
      return;
    }
    setCart(cart.map(item => 
      item.product.id === productId && item.sellingUnit === unit
        ? { ...item, quantity: newQuantity }
        : item
    ));
  };

  // Remove item from cart
  const removeFromCart = (productId: number, unit: 'piece' | 'pack') => {
    setCart(cart.filter(item => !(item.product.id === productId && item.sellingUnit === unit)));
  };

  // Clear cart
  const clearCart = () => {
    setCart([]);
    setCustomerName("");
    setPaymentMethod("cash");
    setNotes("");
    setCreditorName("");
    setCreditorPhone("");
    setInitialPayment(0);
    setLastAdded(null);
    setCheckoutOpen(false);
    setClearArmed(false);
  };

  const armOrClearCart = () => {
    if (!clearArmed) {
      setClearArmed(true);
      if (clearArmTimeoutRef.current != null) {
        window.clearTimeout(clearArmTimeoutRef.current);
      }
      clearArmTimeoutRef.current = window.setTimeout(() => {
        setClearArmed(false);
        clearArmTimeoutRef.current = null;
      }, 2500);
      return;
    }
    clearCart();
  };

  const undoLastAdd = () => {
    if (!lastAdded) return;
    const match = cart.find(
      (item) => item.product.id === lastAdded.productId && item.sellingUnit === lastAdded.unit,
    );
    if (!match) {
      setLastAdded(null);
      return;
    }

    if (match.quantity > 1) {
      updateQuantity(match.product.id, match.sellingUnit, match.quantity - 1);
    } else {
      removeFromCart(match.product.id, match.sellingUnit);
    }
    setLastAdded(null);
  };

  // Calculate totals
  const cartTotal = cart.reduce((sum, item) => {
    const price = item.sellingUnit === 'pack' 
      ? Number(item.product.pack_selling_price || 0)
      : Number(item.product.selling_price || 0);
    return sum + (price * item.quantity);
  }, 0);

  const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);

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
      const availablePieces = Math.max(0, Number(item.product.current_stock ?? 0));
      const pieceQuantity = item.sellingUnit === 'pack'
        ? item.quantity * (item.product.pack_size || 1)
        : item.quantity;
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

    for (const item of cart) {
      const unitPrice = item.sellingUnit === 'pack'
        ? Number(item.product.pack_selling_price || 0)
        : Number(item.product.selling_price || 0);
      const pieceQuantity = item.sellingUnit === 'pack'
        ? item.quantity * (item.product.pack_size || 1)
        : item.quantity;

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
        quantity: pieceQuantity, // Always store in pieces for inventory
        sale_unit_type: item.sellingUnit,
        pack_quantity: item.sellingUnit === 'pack' ? item.quantity : undefined,
        unit_price: unitPrice,
        total_price: lineTotal,
        customer_name: paymentMethod === "credit" ? creditorName : (customerName || null),
        payment_method: paymentMethod,
        notes: saleNotes,
        amount_paid: paymentMethod === "credit" && appliedPayment > 0 ? appliedPayment : undefined,
        partial_payment_method: paymentMethod === "credit" && appliedPayment > 0 ? "cash" : undefined,
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
        <div style={{ marginBottom: 8 }}>
          <input
            type="text"
            placeholder="Search products..."
            value={searchTerm}
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

          <button
            type="button"
            onClick={() => {
              setAddingCategory(true);
              setNewCategoryName("");
            }}
            style={{
              padding: "5px 10px",
              border: "1px dashed #d1d5db",
              background: "white",
              color: "#9ca3af",
              borderRadius: 4,
              cursor: "pointer",
              fontSize: 11,
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            + Add
          </button>
        </div>

        {addingCategory && (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="text"
              placeholder="Type a category"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              style={{
                flex: 1,
                padding: "10px 12px",
                border: "2px solid #e5e7eb",
                borderRadius: 8,
                fontSize: 14,
              }}
            />
            <button
              type="button"
              onClick={async () => {
                const value = newCategoryName.trim();
                if (!value) return;
                setAddingCategory(false);
                setNewCategoryName("");
                try {
                  await updateMyCategories([...userCategories, value]);
                } catch {
                  // Ignore; user may not be admin.
                }
                setSelectedCategory(value);
              }}
              style={{
                padding: "10px 12px",
                border: "1px solid #d1d5db",
                borderRadius: 8,
                background: "white",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 600,
                color: "#374151",
              }}
            >
              Add
            </button>
            <button
              type="button"
              onClick={() => {
                setAddingCategory(false);
                setNewCategoryName("");
              }}
              style={{
                padding: "10px 12px",
                border: "1px solid #d1d5db",
                borderRadius: 8,
                background: "white",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 600,
                color: "#6b7280",
              }}
            >
              Cancel
            </button>
          </div>
        )}

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
          {filteredProducts.map(product => (
            <button
              key={product.id}
              type="button"
              onClick={() => addToCart(product, 'piece')}
              disabled={Number(product.current_stock ?? 0) <= 0}
              style={{
                padding: 0,
                border: "1px solid #e5e7eb",
                borderRadius: 6,
                background: "white",
                display: "flex",
                flexDirection: "column",
                cursor: Number(product.current_stock ?? 0) <= 0 ? "not-allowed" : "pointer",
                opacity: Number(product.current_stock ?? 0) <= 0 ? 0.5 : 1,
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
                <div style={{ fontSize: 10, color: Number(product.current_stock ?? 0) <= 0 ? "#dc2626" : "#9ca3af" }}>
                  {Number(product.current_stock ?? 0) <= 0 ? "Out of stock" : `${Math.max(0, Number(product.current_stock ?? 0))} in stock`}
                </div>
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
          ))}
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
            <span style={{ fontSize: 13, opacity: 0.8 }}>{totalItems} items</span>
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
                const unitPrice = item.sellingUnit === 'pack'
                  ? Number(item.product.pack_selling_price || 0)
                  : Number(item.product.selling_price || 0);
                
                return (
                <div
                  key={`${item.product.id}-${item.sellingUnit}`}
                  style={{
                    padding: "10px 0",
                    borderBottom: "1px solid #f3f4f6",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: "#111827", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item.product.name}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeFromCart(item.product.id, item.sellingUnit)}
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
                  
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <button
                        type="button"
                        onClick={() => updateQuantity(item.product.id, item.sellingUnit, item.quantity - 1)}
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
                      <span style={{ 
                        width: 32, 
                        textAlign: "center", 
                        fontSize: 14, 
                        fontWeight: 600 
                      }}>
                        {item.quantity}
                      </span>
                      <button
                        type="button"
                        onClick={() => updateQuantity(item.product.id, item.sellingUnit, item.quantity + 1)}
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
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      border: paymentMethod === "credit" ? "1px solid #fbbf24" : "1px solid #e5e7eb",
                      borderRadius: 4,
                      fontSize: 13,
                      background: paymentMethod === "credit" ? "#fffbeb" : "white",
                    }}
                  />
                </div>

                </div>

                {/* Submit button */}
                <div style={{ padding: "0 14px 14px" }}>
                  <button
                    type="submit"
                    style={{
                      width: "100%",
                      padding: "14px",
                      background: "#10b981",
                      color: "white",
                      border: "none",
                      borderRadius: 6,
                      fontSize: 15,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    Charge GHS {cartTotal.toFixed(2)}
                  </button>
                </div>
              </form>
          </div>
        )}
      </div>

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
