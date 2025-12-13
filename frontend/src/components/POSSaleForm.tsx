import { useState, useEffect } from "react";
import { NewSale, Product } from "../types";
import { useAppCategories } from "../categories";

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

export default function POSSaleForm({ products, onSubmit, onCancel }: POSSaleFormProps) {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [notes, setNotes] = useState("");

  const userCategories = useAppCategories();
  
  // Credit sale states
  const [showCreditModal, setShowCreditModal] = useState(false);
  const [creditorName, setCreditorName] = useState("");
  const [creditorPhone, setCreditorPhone] = useState("");
  const [initialPayment, setInitialPayment] = useState<number>(0);

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
    const existingItem = cart.find(item => item.product.id === product.id && item.sellingUnit === unit);
    
    if (existingItem) {
      // Increase quantity if already in cart
      setCart(cart.map(item => 
        item.product.id === product.id && item.sellingUnit === unit
          ? { ...item, quantity: item.quantity + 1 }
          : item
      ));
    } else {
      // Add new item
      setCart([...cart, { product, quantity: 1, sellingUnit: unit }]);
    }
  };

  // Update quantity
  const updateQuantity = (productId: number, unit: 'piece' | 'pack', newQuantity: number) => {
    if (newQuantity < 1) {
      removeFromCart(productId, unit);
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
      alert("Please add items to cart");
      return;
    }

    // If credit payment, validate customer name and show credit modal
    if (paymentMethod === "credit") {
      if (!customerName.trim()) {
        alert("Please enter customer name for credit sale");
        return;
      }
      setCreditorName(customerName); // Use customer name as creditor name
      setShowCreditModal(true);
      return;
    }

    processOrder();
  };

  const processOrder = () => {
    // Create sale for each item in cart
    const sales: NewSale[] = cart.map(item => {
      const unitPrice = item.sellingUnit === 'pack'
        ? Number(item.product.pack_selling_price || 0)
        : Number(item.product.selling_price || 0);
      const pieceQuantity = item.sellingUnit === 'pack'
        ? item.quantity * (item.product.pack_size || 1)
        : item.quantity;
      
      // For credit sales, add initial payment info to notes
      let saleNotes = notes || null;
      if (paymentMethod === "credit") {
        const creditInfo = `Phone: ${creditorPhone}`;
        saleNotes = notes ? `${notes} | ${creditInfo}` : creditInfo;
      }
      
      return {
        product_id: item.product.id,
        quantity: pieceQuantity, // Always store in pieces for inventory
        unit_price: unitPrice,
        total_price: unitPrice * item.quantity,
        customer_name: paymentMethod === "credit" ? creditorName : (customerName || null),
        payment_method: paymentMethod,
        notes: saleNotes,
        amount_paid: paymentMethod === "credit" ? initialPayment : undefined,
      };
    });

    onSubmit(sales);
    clearCart();
    setShowCreditModal(false);
  };

  const handleCreditSubmit = () => {
    if (!creditorPhone.trim()) {
      alert("Please enter creditor phone number");
      return;
    }

    if (initialPayment < 0 || initialPayment > cartTotal) {
      alert(`Initial payment must be between 0 and GHS ${cartTotal.toFixed(2)}`);
      return;
    }

    // Process the order
    processOrder();
  };

  return (
    <div style={{ display: "flex", height: "calc(100vh - 200px)", gap: 16 }}>
      {/* Left Side - Product Selection */}
      <div style={{ flex: 2, display: "flex", flexDirection: "column", gap: 12 }}>
        {/* Search and Category Filter */}
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="text"
            placeholder="🔍 Search products..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{
              flex: 1,
              padding: "10px 12px",
              border: "2px solid #e5e7eb",
              borderRadius: 8,
              fontSize: 14,
            }}
          />
        </div>

        {/* Category Tabs */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {categories.map(category => (
            <button
              key={category}
              type="button"
              onClick={() => setSelectedCategory(category || "all")}
              style={{
                padding: "8px 16px",
                border: selectedCategory === category ? "2px solid #10b981" : "1px solid #d1d5db",
                background: selectedCategory === category ? "#f0fdf4" : "white",
                color: selectedCategory === category ? "#059669" : "#6b7280",
                borderRadius: 6,
                cursor: "pointer",
                fontWeight: selectedCategory === category ? 600 : 400,
                fontSize: 13,
              }}
            >
              {category === "all" ? "All Products" : category}
            </button>
          ))}
        </div>

        {/* Products Grid */}
        <div style={{
          flex: 1,
          overflowY: "auto",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
          gap: 12,
          padding: 4,
        }}>
          {filteredProducts.map(product => (
            <div
              key={product.id}
              style={{
                padding: 12,
                border: "1px solid #e5e7eb",
                borderRadius: 8,
                background: "white",
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 14, color: "#111827" }}>
                {product.name}
              </div>
              <div style={{ fontSize: 12, color: "#6b7280" }}>
                {product.sku}
              </div>
              
              {/* Price buttons */}
              <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                <button
                  type="button"
                  onClick={() => addToCart(product, 'piece')}
                  style={{
                    flex: 1,
                    padding: "8px 12px",
                    border: "1px solid #10b981",
                    borderRadius: 6,
                    background: "linear-gradient(135deg, #ecfdf5, #d1fae5)",
                    cursor: "pointer",
                    fontSize: 13,
                    fontWeight: 600,
                    color: "#059669",
                    transition: "all 0.2s",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "#10b981";
                    e.currentTarget.style.color = "white";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "linear-gradient(135deg, #ecfdf5, #d1fae5)";
                    e.currentTarget.style.color = "#059669";
                  }}
                >
                  <div>{product.unit || 'Piece'}</div>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>
                    GHS {Number(product.selling_price || 0).toFixed(2)}
                  </div>
                </button>
                
                {product.pack_selling_price && product.pack_size && (
                  <button
                    type="button"
                    onClick={() => addToCart(product, 'pack')}
                    style={{
                      flex: 1,
                      padding: "8px 12px",
                      border: "1px solid #3b82f6",
                      borderRadius: 6,
                      background: "linear-gradient(135deg, #eff6ff, #dbeafe)",
                      cursor: "pointer",
                      fontSize: 13,
                      fontWeight: 600,
                      color: "#2563eb",
                      transition: "all 0.2s",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "#3b82f6";
                      e.currentTarget.style.color = "white";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "linear-gradient(135deg, #eff6ff, #dbeafe)";
                      e.currentTarget.style.color = "#2563eb";
                    }}
                  >
                    <div>Pack ({product.pack_size})</div>
                    <div style={{ fontSize: 15, fontWeight: 700 }}>
                      GHS {Number(product.pack_selling_price || 0).toFixed(2)}
                    </div>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Right Side - Cart & Checkout */}
      <div style={{
        flex: 1,
        minWidth: 350,
        display: "flex",
        flexDirection: "column",
        border: "2px solid #e5e7eb",
        borderRadius: 12,
        background: "#f9fafb",
      }}>
        {/* Cart Header */}
        <div style={{
          padding: 16,
          borderBottom: "2px solid #e5e7eb",
          background: "white",
          borderRadius: "12px 12px 0 0",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ margin: 0, fontSize: 18 }}>🛒 Cart ({totalItems} items)</h3>
            {cart.length > 0 && (
              <button
                type="button"
                onClick={clearCart}
                style={{
                  padding: "6px 12px",
                  fontSize: 12,
                  background: "#fee2e2",
                  color: "#dc2626",
                  border: "none",
                  borderRadius: 6,
                  cursor: "pointer",
                }}
              >
                Clear All
              </button>
            )}
          </div>
        </div>

        {/* Cart Items */}
        <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
          {cart.length === 0 ? (
            <div style={{ textAlign: "center", padding: 40, color: "#9ca3af" }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>🛍️</div>
              <p>Cart is empty</p>
              <p style={{ fontSize: 13 }}>Click on products to add</p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {cart.map(item => {
                const unitPrice = item.sellingUnit === 'pack'
                  ? Number(item.product.pack_selling_price || 0)
                  : Number(item.product.selling_price || 0);
                const unitLabel = item.sellingUnit === 'pack'
                  ? `Pack (${item.product.pack_size || 1})`
                  : (item.product.unit || 'Piece');
                
                // Debugging: log if we get NaN
                if (isNaN(unitPrice)) {
                  console.error('Invalid price:', {
                    sellingUnit: item.sellingUnit,
                    pack_selling_price: item.product.pack_selling_price,
                    selling_price: item.product.selling_price,
                    product: item.product
                  });
                }
                
                return (
                <div
                  key={`${item.product.id}-${item.sellingUnit}`}
                  style={{
                    background: "white",
                    padding: 12,
                    borderRadius: 8,
                    border: "1px solid #e5e7eb",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{item.product.name}</div>
                      <div style={{ fontSize: 12, color: "#6b7280" }}>
                        GHS {unitPrice.toFixed(2)} per {unitLabel}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeFromCart(item.product.id, item.sellingUnit)}
                      style={{
                        padding: "4px 8px",
                        background: "#fee2e2",
                        color: "#dc2626",
                        border: "none",
                        borderRadius: 4,
                        cursor: "pointer",
                        fontSize: 12,
                        height: 24,
                      }}
                    >
                      ✕
                    </button>
                  </div>
                  
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <button
                        type="button"
                        onClick={() => updateQuantity(item.product.id, item.sellingUnit, item.quantity - 1)}
                        style={{
                          width: 28,
                          height: 28,
                          border: "1px solid #d1d5db",
                          background: "white",
                          borderRadius: 4,
                          cursor: "pointer",
                          fontSize: 16,
                        }}
                      >
                        −
                      </button>
                      <input
                        type="number"
                        min="1"
                        value={item.quantity || 1}
                        onChange={(e) => {
                          const val = parseInt(e.target.value);
                          if (!isNaN(val) && val > 0) {
                            updateQuantity(item.product.id, item.sellingUnit, val);
                          }
                        }}
                        style={{
                          width: 50,
                          padding: "4px 8px",
                          border: "1px solid #d1d5db",
                          borderRadius: 4,
                          textAlign: "center",
                          fontSize: 14,
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => updateQuantity(item.product.id, item.sellingUnit, item.quantity + 1)}
                        style={{
                          width: 28,
                          height: 28,
                          border: "1px solid #d1d5db",
                          background: "white",
                          borderRadius: 4,
                          cursor: "pointer",
                          fontSize: 16,
                        }}
                      >
                        +
                      </button>
                    </div>
                    <div style={{ fontWeight: 700, color: "#10b981", fontSize: 16 }}>
                      GHS {(unitPrice * item.quantity).toFixed(2)}
                    </div>
                  </div>
                </div>
              );
              })}
            </div>
          )}
        </div>

        {/* Checkout Form */}
        {cart.length > 0 && (
          <form onSubmit={handleSubmit} style={{
            padding: 16,
            borderTop: "2px solid #e5e7eb",
            background: "white",
            borderRadius: "0 0 12px 12px",
          }}>
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                Customer Name (Optional)
              </label>
              <input
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Enter customer name"
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  border: "1px solid #d1d5db",
                  borderRadius: 6,
                  fontSize: 14,
                }}
              />
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                Payment Method
              </label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  border: "1px solid #d1d5db",
                  borderRadius: 6,
                  fontSize: 14,
                }}
              >
                {PAYMENT_METHODS.map(method => (
                  <option key={method} value={method}>
                    {method.charAt(0).toUpperCase() + method.slice(1)}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                Notes (Optional)
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add notes..."
                rows={2}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  border: "1px solid #d1d5db",
                  borderRadius: 6,
                  fontSize: 14,
                  resize: "none",
                }}
              />
            </div>

            {/* Total */}
            <div style={{
              padding: 12,
              background: "#f0fdf4",
              borderRadius: 8,
              marginBottom: 12,
              border: "2px solid #10b981",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 16, fontWeight: 600 }}>Total:</span>
                <span style={{ fontSize: 24, fontWeight: 700, color: "#059669" }}>
                  GHS {cartTotal.toFixed(2)}
                </span>
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              style={{
                width: "100%",
                padding: 16,
                background: "linear-gradient(135deg, #10b981, #059669)",
                color: "white",
                border: "none",
                borderRadius: 8,
                fontSize: 16,
                fontWeight: 700,
                cursor: "pointer",
                boxShadow: "0 4px 12px rgba(16, 185, 129, 0.3)",
              }}
            >
              💳 Complete Sale - GHS {cartTotal.toFixed(2)}
            </button>
          </form>
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
              💳 Credit Sale Details
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
