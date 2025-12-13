import { useEffect, useMemo, useState } from "react";

import { createMovement, createProduct, deleteProduct, fetchMe, fetchMovements, fetchProducts, updateProduct } from "./api";
import Layout from "./components/Layout";
import MovementForm from "./components/MovementForm";
import MovementTable from "./components/MovementTable";
import ProductForm from "./components/ProductForm";
import ProductList from "./components/ProductList";
import { useAppCategories } from "./categories";
import { computeBalance } from "./state";
import { NewMovement, NewProduct, Product, StockMovement } from "./types";
import Creditors from "./views/Creditors";
import Dashboard from "./views/Dashboard";
import Inventory from "./views/Inventory";
import Login from "./views/Login";
import Profile from "./views/Profile";
import Reports from "./views/Reports";
import RevenueAnalysis from "./views/RevenueAnalysis";
import Sales from "./views/Sales";
import UserManagement from "./views/UserManagement";

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [activeView, setActiveView] = useState("dashboard");
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [loadingMovements, setLoadingMovements] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterExpiry, setFilterExpiry] = useState("all");
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [userName, setUserName] = useState("User");
  const [businessName, setBusinessName] = useState("Business");
  const [userRole, setUserRole] = useState("Admin");
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const categoryOptions = useAppCategories();

  const logoutAndReset = () => {
    setIsAuthenticated(false);
    localStorage.removeItem("user");
    localStorage.removeItem("token");
    setUserName("User");
    setBusinessName("Business");
    setUserRole("Admin");
    setCurrentUserId(null);
  };

  // Check if user is authenticated on mount
  useEffect(() => {
    const userStr = localStorage.getItem("user");
    const token = localStorage.getItem("token");
    if (userStr) {
      setIsAuthenticated(true);
      try {
        const user = JSON.parse(userStr);
        setUserName(user.name || "User");
        setBusinessName(user.business_name || "Business");
        setUserRole(user.role || "Admin");
        setCurrentUserId(user.id || null);
      } catch (error) {
        console.error("Error parsing user data:", error);
      }
    }

    // If we have a token, validate the session against the backend.
    // This ensures deleting a user in the DB logs them out on refresh.
    if (token) {
      fetchMe()
        .then((me) => {
          localStorage.setItem("user", JSON.stringify(me));
          setIsAuthenticated(true);
          setUserName(me.name || "User");
          setBusinessName(me.business_name || "Business");
          setUserRole(me.role || "Admin");
          setCurrentUserId(me.id || null);
        })
        .catch(() => {
          logoutAndReset();
        });
    }
  }, []);

  // Auto-refresh when another user signs in
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      // Detect when user data changes in localStorage
      if (e.key === "user" && e.newValue) {
        try {
          const newUser = JSON.parse(e.newValue);
          // If a different user logged in, reload the page
          if (newUser.id && newUser.id !== currentUserId) {
            console.log("Different user detected, refreshing...");
            window.location.reload();
          }
        } catch (error) {
          console.error("Error parsing user change:", error);
        }
      }
    };

    // Listen to storage events (fires when localStorage changes in another tab/window)
    window.addEventListener("storage", handleStorageChange);

    // Also listen for custom event in the same tab
    const handleCustomUserChange = (e: CustomEvent) => {
      const newUser = e.detail;
      if (!newUser) {
        logoutAndReset();
        return;
      }
      if (newUser?.id && newUser.id !== currentUserId) {
        console.log("Different user detected in same tab, refreshing...");
        window.location.reload();
      }
    };

    window.addEventListener("userChanged", handleCustomUserChange as EventListener);

    return () => {
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener("userChanged", handleCustomUserChange as EventListener);
    };
  }, [currentUserId]);

  useEffect(() => {
    if (!isAuthenticated) {
      setLoadingProducts(false);
      return;
    }
    
    const run = async () => {
      setLoadingProducts(true);
      try {
        const data = await fetchProducts();
        setProducts(data);
        setSelectedId((prev) => prev ?? (data[0]?.id ?? null));
      } finally {
        setLoadingProducts(false);
      }
    };
    run();
  }, [isAuthenticated]);

  useEffect(() => {
    const loadMovements = async () => {
      if (selectedId === null) {
        setMovements([]);
        return;
      }
      setLoadingMovements(true);
      try {
        const data = await fetchMovements(selectedId);
        setMovements(data);
      } finally {
        setLoadingMovements(false);
      }
    };

    loadMovements();
  }, [selectedId]);

  const selectedProduct = useMemo(
    () => products.find((p) => p.id === selectedId) ?? null,
    [products, selectedId],
  );

  const balance = useMemo(() => computeBalance(movements), [movements]);

  const handleLogin = (email: string, password: string) => {
    // In production, this would validate against a backend API
    // For now, we just set authentication to true
    setIsAuthenticated(true);
  };

  const handleLogout = () => {
    logoutAndReset();
  };

  // Show login page if not authenticated
  if (!isAuthenticated) {
    return <Login onLogin={handleLogin} />;
  }

  const handleCreateProduct = async (payload: NewProduct) => {
    const created = await createProduct(payload);
    setProducts((prev) => [created, ...prev]);
    setSelectedId(created.id);
    setShowAddProduct(false);
  };

  const handleEditProduct = async (id: number, updates: Partial<Product>) => {
    const updated = await updateProduct(id, updates);
    setProducts((prev) => prev.map((p) => (p.id === id ? updated : p)));
  };

  const handleDeleteProduct = async (id: number) => {
    await deleteProduct(id);
    setProducts((prev) => prev.filter((p) => p.id !== id));
    if (selectedId === id) {
      setSelectedId(products.find((p) => p.id !== id)?.id ?? null);
    }
  };

  const handleStockAdjustment = async (productId: number, change: number, reason: string, expiry_date?: string, location?: string) => {
    await createMovement(productId, { change, reason, expiry_date: expiry_date || null, location: location || null });
    // Refresh movements to show the new adjustment
    if (selectedId === productId) {
      const updated = await fetchMovements(productId);
      setMovements(updated);
    }
  };

  const handleCreateMovement = async (payload: NewMovement) => {
    if (!selectedProduct) return;
    const created = await createMovement(selectedProduct.id, payload);
    setMovements((prev) => [created, ...prev]);
  };

  const renderView = () => {
    switch (activeView) {
      case "dashboard":
        return <Dashboard onNavigate={setActiveView} />;
      case "products":
        return (
          <div className="app-shell">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>Products</h1>
              <button
                className="button"
                onClick={() => setShowAddProduct(true)}
                style={{
                  background: "#1f7aff",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "12px 20px",
                  fontSize: 15,
                  fontWeight: 600,
                }}
              >
                <span style={{ fontSize: 18 }}>➕</span>
                <span>Add New Product</span>
              </button>
            </div>
            
            {/* Add Product Modal */}
            {showAddProduct && (
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
                onClick={() => setShowAddProduct(false)}
              >
                <div
                  style={{
                    background: "white",
                    borderRadius: 12,
                    maxWidth: 600,
                    width: "100%",
                    maxHeight: "90vh",
                    overflow: "auto",
                    padding: 24,
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                    <h2 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Add New Product</h2>
                    <button
                      onClick={() => setShowAddProduct(false)}
                      style={{
                        background: "transparent",
                        border: "none",
                        fontSize: 24,
                        cursor: "pointer",
                        color: "#6b7280",
                        padding: 4,
                      }}
                    >
                      ✕
                    </button>
                  </div>
                  <ProductForm onCreate={handleCreateProduct} />
                </div>
              </div>
            )}
            
            {/* Search and Filter Bar */}
            <div className="card" style={{ marginBottom: 16, padding: 16 }}>
              <div className="grid" style={{ gridTemplateColumns: "2fr 1fr 1fr", gap: 12, alignItems: "end" }}>
                <label style={{ margin: 0 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, display: "block" }}>
                    🔍 Search Products
                  </span>
                  <input
                    className="input"
                    type="text"
                    placeholder="Search by name, SKU, or description..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    style={{ padding: 10 }}
                  />
                </label>
                <label style={{ margin: 0 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, display: "block" }}>
                    Category
                  </span>
                  <select
                    className="input"
                    value={filterCategory}
                    onChange={(e) => setFilterCategory(e.target.value)}
                    style={{ padding: 10 }}
                  >
                    <option value="all">All Categories</option>
                    {categoryOptions.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ margin: 0 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, display: "block" }}>
                    Expiry Status
                  </span>
                  <select
                    className="input"
                    value={filterExpiry}
                    onChange={(e) => setFilterExpiry(e.target.value)}
                    style={{ padding: 10 }}
                  >
                    <option value="all">All Products</option>
                    <option value="expired">Expired Only</option>
                    <option value="expiring">Expiring Soon</option>
                    <option value="fresh">Fresh Items</option>
                  </select>
                </label>
              </div>
              {(searchTerm || filterCategory !== "all" || filterExpiry !== "all") && (
                <button
                  onClick={() => {
                    setSearchTerm("");
                    setFilterCategory("all");
                    setFilterExpiry("all");
                  }}
                  style={{
                    marginTop: 12,
                    padding: "6px 12px",
                    background: "transparent",
                    border: "1px solid #d8dce8",
                    borderRadius: 6,
                    cursor: "pointer",
                    fontSize: 13,
                    fontWeight: 600,
                    color: "#4a5368",
                  }}
                >
                  ✕ Clear Filters
                </button>
              )}
            </div>

            <div className="grid" style={{ gap: 16 }}>
              <ProductList
                products={products}
                selectedId={selectedId}
                onSelect={(id: number) => setSelectedId(id)}
                onEdit={handleEditProduct}
                onDelete={handleDeleteProduct}
                onStockAdjust={handleStockAdjustment}
                searchTerm={searchTerm}
                filterCategory={filterCategory}
                filterExpiry={filterExpiry}
                userRole={userRole}
              />
            </div>
          </div>
        );
      case "inventory":
        return <Inventory />;
      case "sales":
        return <Sales />;
      case "revenue":
        return <RevenueAnalysis />;
      case "reports":
        return <Reports />;
      case "creditors":
        return <Creditors />;
      case "profile":
        return <Profile />;
      case "users":
        return <UserManagement />;
      default:
        return <Dashboard onNavigate={setActiveView} />;
    }
  };

  return (
    <Layout activeView={activeView} onNavigate={setActiveView} onLogout={handleLogout} userName={userName} businessName={businessName} userRole={userRole}>
      {renderView()}
    </Layout>
  );
}
