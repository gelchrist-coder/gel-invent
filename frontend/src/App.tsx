import { useEffect, useState } from "react";

import { createMovement, createProduct, deleteProduct, fetchBranches, fetchMe, fetchProducts, updateProduct, getCachedProducts } from "./api";
import Layout from "./components/Layout";
import ProductForm from "./components/ProductForm";
import ProductList from "./components/ProductList";
import { useAppCategories } from "./categories";
import { updateMyCategories } from "./api";
import { Branch, NewProduct, Product } from "./types";
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
  const [searchTerm, setSearchTerm] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterExpiry, setFilterExpiry] = useState("all");
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [userName, setUserName] = useState("User");
  const [businessName, setBusinessName] = useState("Business");
  const [userRole, setUserRole] = useState("Admin");
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [activeBranchId, setActiveBranchId] = useState<number | null>(() => {
    const raw = localStorage.getItem("activeBranchId");
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  });
  const categoryOptions = useAppCategories();

  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");

  const showExpiryStatusFilter = products.length > 0 && products.every((p) => !!p.expiry_date);

  useEffect(() => {
    if (!showExpiryStatusFilter && filterExpiry !== "all") {
      setFilterExpiry("all");
    }
  }, [showExpiryStatusFilter, filterExpiry]);

  const logoutAndReset = () => {
    setIsAuthenticated(false);
    localStorage.removeItem("user");
    localStorage.removeItem("token");
    localStorage.removeItem("activeBranchId");
    setUserName("User");
    setBusinessName("Business");
    setUserRole("Admin");
    setCurrentUserId(null);
    setBranches([]);
    setActiveBranchId(null);
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
        if (user.role && user.role !== "Admin") {
          const bid = typeof user.branch_id === "number" ? user.branch_id : null;
          setActiveBranchId(bid);
          if (bid != null) localStorage.setItem("activeBranchId", String(bid));
        }
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

          // Employees are locked to their assigned branch.
          if (me.role !== "Admin") {
            const bid = typeof me.branch_id === "number" ? me.branch_id : null;
            setActiveBranchId(bid);
            if (bid != null) localStorage.setItem("activeBranchId", String(bid));
            else localStorage.removeItem("activeBranchId");
          }
        })
        .catch(() => {
          logoutAndReset();
        });
    }
  }, []);

  // Load branches after login and pick an active branch.
  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    const run = async () => {
      try {
        const data = await fetchBranches();
        setBranches(data);

        const existing = activeBranchId;
        const stillValid = existing != null && data.some((b) => b.id === existing);
        if (stillValid) {
          return;
        }

        // Use first branch as default (no longer requiring "Main Branch" name)
        const nextId = data[0]?.id ?? null;
        setActiveBranchId(nextId);
        if (nextId != null) {
          localStorage.setItem("activeBranchId", String(nextId));
        } else {
          localStorage.removeItem("activeBranchId");
        }
      } catch {
        // Branches are optional UI; backend may deny for some roles.
        setBranches([]);
      }
    };

    run();
    // Intentionally not depending on activeBranchId to avoid repeated fetches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  // Refresh branches when another part of the app creates/changes them.
  useEffect(() => {
    if (!isAuthenticated) return;

    const handler = () => {
      fetchBranches()
        .then((data) => {
          setBranches(data);
          const stillValid = activeBranchId != null && data.some((b) => b.id === activeBranchId);
          if (stillValid) return;
          // Use first branch as default
          const nextId = data[0]?.id ?? null;
          setActiveBranchId(nextId);
          if (nextId != null) localStorage.setItem("activeBranchId", String(nextId));
          else localStorage.removeItem("activeBranchId");
        })
        .catch(() => {
          setBranches([]);
        });
    };

    window.addEventListener("branchesChanged", handler as EventListener);
    return () => window.removeEventListener("branchesChanged", handler as EventListener);
  }, [isAuthenticated, activeBranchId]);

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
      return;
    }
    
    const run = async () => {
      // Use cached products immediately for instant display
      const cached = getCachedProducts();
      if (cached && cached.length > 0) {
        setProducts(cached);
        setSelectedId((prev) => prev ?? (cached[0]?.id ?? null));
      } else {
        setProducts([]);
        setSelectedId(null);
      }
      
      // Fetch fresh data in background
      const data = await fetchProducts();
      setProducts(data);
      setSelectedId((prev) => prev ?? (data[0]?.id ?? null));
    };
    run();
  }, [isAuthenticated, activeBranchId]);



  const handleLogin = (_email: string, _password: string) => {
    // In production, this would validate against a backend API
    // For now, we just set authentication to true
    setIsAuthenticated(true);
  };

  const handleLogout = () => {
    logoutAndReset();
  };

  const handleChangeBranch = (branchId: number) => {
    setActiveBranchId(branchId);
    localStorage.setItem("activeBranchId", String(branchId));
    // Notify other components that the active branch changed
    window.dispatchEvent(new CustomEvent("activeBranchChanged", { detail: branchId }));
  };

  // Show login page if not authenticated
  if (!isAuthenticated) {
    return <Login onLogin={handleLogin} />;
  }

  const handleCreateProduct = async (payload: NewProduct, branchIdOverride?: number | null) => {
    const created = await createProduct(payload, branchIdOverride);

    // If admin created into a different branch, switch to it so the list matches.
    if (userRole === "Admin" && branchIdOverride != null && branchIdOverride !== activeBranchId) {
      setActiveBranchId(branchIdOverride);
      localStorage.setItem("activeBranchId", String(branchIdOverride));
      return;
    }

    const createdWithName = {
      ...created,
      created_by_name: created.created_by_name ?? userName,
    };
    setProducts((prev) => [createdWithName, ...prev]);
    setSelectedId(created.id);
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

  const handleStockAdjustment = async (
    productId: number,
    change: number,
    reason: string,
    expiry_date?: string,
    location?: string,
    unit_cost_price?: number | null,
    unit_selling_price?: number | null,
  ) => {
    await createMovement(productId, {
      change,
      reason,
      expiry_date: expiry_date || null,
      location: location || null,
      unit_cost_price: unit_cost_price ?? null,
      unit_selling_price: unit_selling_price ?? null,
    });
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
                      X
                    </button>
                  </div>
                  <ProductForm
                    onCreate={handleCreateProduct}
                    onCancel={() => setShowAddProduct(false)}
                    userRole={userRole}
                    branches={branches}
                    activeBranchId={activeBranchId}
                  />
                </div>
              </div>
            )}
            
            {/* Search and Filter Bar */}
            <div className="card" style={{ marginBottom: 16, padding: 16 }}>
              <div className="grid" style={{ gridTemplateColumns: "2fr 1fr 1fr", gap: 12, alignItems: "end" }}>
                <label style={{ margin: 0 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, display: "block" }}>
                    Search Products
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
                    onChange={(e) => {
                      const value = e.target.value;
                      if (value === "__add_new__") {
                        setAddingCategory(true);
                        setNewCategoryName("");
                        return;
                      }
                      setFilterCategory(value);
                    }}
                    style={{ padding: 10 }}
                  >
                    <option value="all">All Categories</option>
                    {categoryOptions.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                    <option value="__add_new__">+ Add new category…</option>
                  </select>
                </label>
                {addingCategory && (
                  <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8, alignItems: "end" }}>
                    <label style={{ margin: 0, flex: 1 }}>
                      <span style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, display: "block" }}>
                        New category
                      </span>
                      <input
                        className="input"
                        type="text"
                        value={newCategoryName}
                        onChange={(e) => setNewCategoryName(e.target.value)}
                        placeholder="Type a category"
                        style={{ padding: 10 }}
                      />
                    </label>
                    <button
                      className="button"
                      type="button"
                      onClick={async () => {
                        const value = newCategoryName.trim();
                        if (!value) return;
                        setAddingCategory(false);
                        setNewCategoryName("");
                        try {
                          await updateMyCategories([...categoryOptions, value]);
                        } catch {
                          // Ignore; user may not be admin.
                        }
                        setFilterCategory(value);
                      }}
                      style={{ padding: "10px 14px" }}
                    >
                      Add
                    </button>
                    <button
                      className="button"
                      type="button"
                      onClick={() => {
                        setAddingCategory(false);
                        setNewCategoryName("");
                      }}
                      style={{ padding: "10px 14px" }}
                    >
                      Cancel
                    </button>
                  </div>
                )}
                {showExpiryStatusFilter ? (
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
                ) : null}
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
                  Clear Filters
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
    <Layout
      activeView={activeView}
      onNavigate={setActiveView}
      onLogout={handleLogout}
      userName={userName}
      businessName={businessName}
      userRole={userRole}
      branches={branches}
      activeBranchId={activeBranchId}
      onChangeBranch={userRole === "Admin" ? handleChangeBranch : undefined}
    >
      <div key={`${activeView}:${activeBranchId ?? "none"}`}>{renderView()}</div>
    </Layout>
  );
}
