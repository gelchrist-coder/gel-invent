import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createProduct, createSupplier, deleteProduct, fetchBranchesCached, fetchInventoryAnalytics, fetchMe, fetchProductsCached, fetchSalesCached, fetchSalesDashboard, fetchSuppliersCached, updateProduct, getCachedProducts, clearDataCache, isTemporaryServerDelayError, warmBackend } from "./api";
import Layout from "./components/Layout";
import { getSalesOutboxCount } from "./offline/storage";
import { syncSalesOutboxOnce } from "./offline/sync";
import { useAppCategories } from "./categories";
import { updateMyCategories } from "./api";
import { Branch, NewProduct, Product, Supplier } from "./types";
import { useExpiryTracking } from "./settings";
import { getEffectiveUserRole, hasUserPermission, readStoredUser } from "./user-storage";

const ProductForm = lazy(() => import("./components/ProductForm"));
const ProductList = lazy(() => import("./components/ProductList"));
const Creditors = lazy(() => import("./views/Creditors"));
const Dashboard = lazy(() => import("./views/Dashboard"));
const Inventory = lazy(() => import("./views/Inventory"));
const Invoice = lazy(() => import("./views/Invoice"));
const Login = lazy(() => import("./views/Login"));
const Profile = lazy(() => import("./views/Profile"));
const Reports = lazy(() => import("./views/Reports"));
const RevenueAnalysis = lazy(() => import("./views/RevenueAnalysis"));
const Sales = lazy(() => import("./views/Sales"));
const UserManagement = lazy(() => import("./views/UserManagement"));

function LazyViewFallback() {
  return (
    <div className="card" style={{ margin: 16, padding: 18, color: "#64748b" }}>
      Loading...
    </div>
  );
}

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(() => !!localStorage.getItem("token"));
  const [isOnline, setIsOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const [outboxCount, setOutboxCount] = useState(() => getSalesOutboxCount());
  const [isSyncingOutbox, setIsSyncingOutbox] = useState(false);
  const [installPromptEvent, setInstallPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [activeView, setActiveView] = useState("dashboard");
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterExpiry, setFilterExpiry] = useState("all");
  const [filterStock, setFilterStock] = useState("all");
  const [filterSupplier, setFilterSupplier] = useState("all");
  const [sortBy, setSortBy] = useState("name_asc");
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [userName, setUserName] = useState(() => readStoredUser()?.name || "User");
  const [businessName, setBusinessName] = useState(() => readStoredUser()?.business_name || "Business");
  const [businessLogoUrl, setBusinessLogoUrl] = useState(() => readStoredUser()?.business_logo_url || null);
  const [userRole, setUserRole] = useState(() => readStoredUser()?.role || "Admin");
  const [currentUserId, setCurrentUserId] = useState<number | null>(() => readStoredUser()?.id ?? null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [supplierDirectory, setSupplierDirectory] = useState<Supplier[]>([]);
  const [activeBranchId, setActiveBranchId] = useState<number | null>(() => {
    const raw = localStorage.getItem("activeBranchId");
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  });
  const categoryOptions = useAppCategories();
  const usesExpiryTracking = useExpiryTracking();

  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const prefetchedBranchRef = useRef<number | null>(null);
  const syncInFlightRef = useRef(false);
  const supplierSyncInFlightRef = useRef(false);
  const storedUser = readStoredUser();
  const accessUser = storedUser ?? { role: userRole };
  const userPermissions = storedUser?.permissions ?? [];
  const canManageBranches = hasUserPermission("manage_branches", accessUser);
  const canManageCatalog = hasUserPermission("manage_catalog", accessUser);
  const canManageEmployees = hasUserPermission("manage_employees", accessUser);
  const canManageProcurement = hasUserPermission("manage_procurement", accessUser);
  const canViewProcurement = hasUserPermission("view_procurement", accessUser);
  const canViewReports = hasUserPermission("view_reports", accessUser);
  const canViewRevenue = hasUserPermission("view_revenue", accessUser);

  const showExpiryStatusFilter = usesExpiryTracking && products.length > 0 && products.some((p) => !!p.expiry_date);

  const supplierOptions = useMemo(() => {
    const uniqueSuppliers = new Set<string>();
    products.forEach((product) => {
      const supplierName = product.supplier?.trim();
      if (supplierName) {
        uniqueSuppliers.add(supplierName);
      }
    });
    return Array.from(uniqueSuppliers).sort((a, b) => a.localeCompare(b));
  }, [products]);

  const productKpis = useMemo(() => {
    let lowStockCount = 0;
    let outOfStockCount = 0;
    let inventoryValue = 0;
    let marginSum = 0;
    let marginCount = 0;

    products.forEach((product) => {
      const stock = Math.max(0, Number(product.current_stock ?? 0));
      const costPrice = Number(product.cost_price ?? 0);
      const sellingPrice = Number(product.selling_price ?? 0);

      if (stock === 0) {
        outOfStockCount += 1;
      } else if (stock <= 5) {
        lowStockCount += 1;
      }

      if (stock > 0 && Number.isFinite(costPrice) && costPrice > 0) {
        inventoryValue += stock * costPrice;
      }

      if (Number.isFinite(costPrice) && Number.isFinite(sellingPrice) && costPrice > 0 && sellingPrice > 0) {
        marginSum += ((sellingPrice - costPrice) / costPrice) * 100;
        marginCount += 1;
      }
    });

    return {
      totalSkus: products.length,
      lowStockCount,
      outOfStockCount,
      inventoryValue,
      averageMarginPercent: marginCount > 0 ? marginSum / marginCount : 0,
    };
  }, [products]);

  useEffect(() => {
    if (!showExpiryStatusFilter && filterExpiry !== "all") {
      setFilterExpiry("all");
    }
  }, [showExpiryStatusFilter, filterExpiry]);

  useEffect(() => {
    if (filterSupplier === "all") {
      return;
    }
    if (!supplierOptions.includes(filterSupplier)) {
      setFilterSupplier("all");
    }
  }, [filterSupplier, supplierOptions]);

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    if (!canManageProcurement) {
      return;
    }

    if (supplierSyncInFlightRef.current) {
      return;
    }

    if (supplierOptions.length === 0) {
      return;
    }

    const supplierDirectorySet = new Set(
      supplierDirectory
        .map((supplier) => supplier.name.trim().toLowerCase())
        .filter((name) => name.length > 0),
    );
    const missingSupplierNames = supplierOptions.filter(
      (supplierName) => !supplierDirectorySet.has(supplierName.trim().toLowerCase()),
    );

    if (missingSupplierNames.length === 0) {
      return;
    }

    supplierSyncInFlightRef.current = true;

    void (async () => {
      try {
        for (const supplierName of missingSupplierNames) {
          try {
            await createSupplier({ name: supplierName });
          } catch (error) {
            const message = error instanceof Error ? error.message : "";
            if (!/already exists/i.test(message) && import.meta.env.DEV) {
              console.warn(`Failed to sync supplier '${supplierName}' from products:`, error);
            }
          }
        }

        const refreshedSuppliers = await fetchSuppliersCached((fresh) => setSupplierDirectory(fresh));
        setSupplierDirectory(refreshedSuppliers);
      } finally {
        supplierSyncInFlightRef.current = false;
      }
    })();
  }, [canManageProcurement, isAuthenticated, supplierDirectory, supplierOptions]);

  const logoutAndReset = () => {
    setIsAuthenticated(false);
    localStorage.removeItem("user");
    localStorage.removeItem("token");
    localStorage.removeItem("activeBranchId");
    setUserName("User");
    setBusinessName("Business");
    setBusinessLogoUrl(null);
    setUserRole("Admin");
    setCurrentUserId(null);
    setBranches([]);
    setSupplierDirectory([]);
    setActiveBranchId(null);
    setOutboxCount(0);
  };

  const syncQueuedSales = useCallback(async () => {
    if (!isAuthenticated || !navigator.onLine || syncInFlightRef.current || getSalesOutboxCount() === 0) {
      setOutboxCount(getSalesOutboxCount());
      return;
    }

    syncInFlightRef.current = true;
    setIsSyncingOutbox(true);
    try {
      const result = await syncSalesOutboxOnce();
      setOutboxCount(result.remainingCount);

      if (result.syncedCount > 0) {
        fetchProductsCached((fresh) => setProducts(fresh)).catch(() => {});
        fetchSalesCached().catch(() => {});
        if (canViewReports) {
          fetchSalesDashboard().catch(() => {});
        }
      }
    } finally {
      syncInFlightRef.current = false;
      setIsSyncingOutbox(false);
    }
  }, [canViewReports, isAuthenticated]);

  // Check if user is authenticated on mount
  useEffect(() => {
    const initialUser = readStoredUser();
    const token = localStorage.getItem("token");
    if (initialUser) {
      setIsAuthenticated(true);
      setUserName(initialUser.name || "User");
      setBusinessName(initialUser.business_name || "Business");
      setBusinessLogoUrl(initialUser.business_logo_url ?? null);
      setUserRole(initialUser.role || "Admin");
      setCurrentUserId(initialUser.id || null);
      if (!hasUserPermission("manage_branches", initialUser)) {
        const bid = typeof initialUser.branch_id === "number" ? initialUser.branch_id : null;
        setActiveBranchId(bid);
        if (bid != null) localStorage.setItem("activeBranchId", String(bid));
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
          setBusinessLogoUrl(me.business_logo_url ?? null);
          setUserRole(getEffectiveUserRole(me));
          setCurrentUserId(me.id || null);

          // Employees are locked to their assigned branch.
          if (!hasUserPermission("manage_branches", me)) {
            const bid = typeof me.branch_id === "number" ? me.branch_id : null;
            setActiveBranchId(bid);
            if (bid != null) localStorage.setItem("activeBranchId", String(bid));
            else localStorage.removeItem("activeBranchId");
          }
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : "";
          const isAuthFailure =
            message === "Not authenticated" ||
            /unauth|401|invalid token|expired token/i.test(message);

          // Keep local session on transient startup failures (network/cold start).
          if (isAuthFailure) {
            logoutAndReset();
            return;
          }

          if (import.meta.env.DEV) {
            console.warn("Session revalidation skipped due to temporary error:", err);
          }
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
        const data = await fetchBranchesCached((fresh) => setBranches(fresh));
        setBranches(data);

        const existing = activeBranchId;
        const existingBranch = existing != null ? data.find((b) => b.id === existing) : undefined;

        // Keep selection if still valid.
        if (existingBranch) {
          return;
        }

        const nextId = data[0]?.id ?? null;
        setActiveBranchId(nextId);
        if (nextId != null) {
          localStorage.setItem("activeBranchId", String(nextId));
        } else {
          localStorage.removeItem("activeBranchId");
        }
      } catch (error) {
        if (isTemporaryServerDelayError(error)) {
          const isReady = await warmBackend("/health/db", true, {
            timeoutMs: 90000,
            probeTimeoutMs: 35000,
            retryIntervalMs: 2000,
          });

          if (isReady) {
            try {
              const data = await fetchBranchesCached((fresh) => setBranches(fresh));
              setBranches(data);

              const existing = activeBranchId;
              const existingBranch = existing != null ? data.find((b) => b.id === existing) : undefined;
              if (existingBranch) {
                return;
              }

              const nextId = data[0]?.id ?? null;
              setActiveBranchId(nextId);
              if (nextId != null) {
                localStorage.setItem("activeBranchId", String(nextId));
              } else {
                localStorage.removeItem("activeBranchId");
              }
              return;
            } catch {
              // Fall through to stale-branch cleanup below.
            }
          }
        }

        // Branches are optional UI, but stale branch headers can break all data reads.
        setBranches([]);
        setActiveBranchId(null);
        localStorage.removeItem("activeBranchId");
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
      fetchBranchesCached((fresh) => setBranches(fresh))
        .then((data) => {
          setBranches(data);
          const existing = activeBranchId;
          const existingBranch = existing != null ? data.find((b) => b.id === existing) : undefined;
          if (existingBranch) return;

          const nextId = data[0]?.id ?? null;
          setActiveBranchId(nextId);
          if (nextId != null) localStorage.setItem("activeBranchId", String(nextId));
          else localStorage.removeItem("activeBranchId");
        })
        .catch(() => {
          setBranches([]);
          setActiveBranchId(null);
          localStorage.removeItem("activeBranchId");
        });
    };

    window.addEventListener("branchesChanged", handler as EventListener);
    return () => window.removeEventListener("branchesChanged", handler as EventListener);
  }, [isAuthenticated, activeBranchId]);

  // Warm caches in background so page switches feel instant.
  useEffect(() => {
    if (!isAuthenticated) return;

    if (prefetchedBranchRef.current === activeBranchId) return;
    prefetchedBranchRef.current = activeBranchId;

    fetchSalesCached().catch(() => {});
    fetchInventoryAnalytics().catch(() => {});

    if (canViewReports) {
      fetchSalesDashboard().catch(() => {});
    }
  }, [canViewReports, isAuthenticated, activeBranchId]);

  useEffect(() => {
    const handleOutboxChanged = () => {
      setOutboxCount(getSalesOutboxCount());
      if (navigator.onLine) {
        void syncQueuedSales();
      }
    };

    const handleOnline = () => {
      setIsOnline(true);
      void syncQueuedSales();
    };

    const handleOffline = () => {
      setIsOnline(false);
    };

    const handleBeforeInstallPrompt = (event: BeforeInstallPromptEvent) => {
      event.preventDefault();
      setInstallPromptEvent(event);
    };

    const handleAppInstalled = () => {
      setInstallPromptEvent(null);
    };

    window.addEventListener("offlineOutboxChanged", handleOutboxChanged);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt as EventListener);
    window.addEventListener("appinstalled", handleAppInstalled);

    setOutboxCount(getSalesOutboxCount());
    if (navigator.onLine) {
      void syncQueuedSales();
    }

    return () => {
      window.removeEventListener("offlineOutboxChanged", handleOutboxChanged);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt as EventListener);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, [syncQueuedSales]);

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
      const changedUser = e.detail as { id?: number } | null;
      if (!changedUser) {
        logoutAndReset();
        return;
      }
      // Only reload when switching between two different logged-in users (not for initial login).
      if (currentUserId !== null && changedUser?.id && changedUser.id !== currentUserId) {
        console.log("Different user detected in same tab, refreshing...");
        window.location.reload();
        return;
      }

      const nextUser = readStoredUser();
      if (!nextUser) {
        logoutAndReset();
        return;
      }

      setUserName(nextUser.name || "User");
      setBusinessName(nextUser.business_name || "Business");
      setBusinessLogoUrl(nextUser.business_logo_url ?? null);
      setUserRole(nextUser.role || "Admin");
    };

    window.addEventListener("userChanged", handleCustomUserChange as EventListener);

    const handleProductsUpdated = () => {
      fetchProductsCached((fresh) => setProducts(fresh)).catch(() => {});
    };
    window.addEventListener("productsUpdated", handleProductsUpdated);

    return () => {
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener("userChanged", handleCustomUserChange as EventListener);
      window.removeEventListener("productsUpdated", handleProductsUpdated);
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

      try {
        // Refresh in the background, but keep startup resilient to cold-start timeouts.
        const data = await fetchProductsCached((fresh) => setProducts(fresh));
        setProducts(data);
        setSelectedId((prev) => prev ?? (data[0]?.id ?? null));
      } catch {
        // Keep whatever cached shell state we already had.
      }
    };

    void run();
  }, [isAuthenticated, activeBranchId]);

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    if (!canViewProcurement) {
      setSupplierDirectory([]);
      return;
    }

    let isMounted = true;

    fetchSuppliersCached((fresh) => {
      if (isMounted) {
        setSupplierDirectory(fresh);
      }
    })
      .then((data) => {
        if (isMounted) {
          setSupplierDirectory(data);
        }
      })
      .catch(() => {
        if (isMounted) {
          setSupplierDirectory([]);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [canViewProcurement, isAuthenticated, activeBranchId]);

  useEffect(() => {
    if (!showAddProduct || !isAuthenticated || !canViewProcurement) {
      return;
    }

    fetchSuppliersCached((fresh) => setSupplierDirectory(fresh))
      .then((data) => setSupplierDirectory(data))
      .catch(() => {});
  }, [showAddProduct, canViewProcurement, isAuthenticated, activeBranchId]);

  useEffect(() => {
    if (showAddProduct && !canManageCatalog) {
      setShowAddProduct(false);
    }
  }, [canManageCatalog, showAddProduct]);

  const handleLogin = (_email: string, _password: string) => {
    const user = readStoredUser();
    if (user) {
      setUserName(user.name || "User");
      setBusinessName(user.business_name || "Business");
      setBusinessLogoUrl(user.business_logo_url ?? null);
      setUserRole(user.role || "Admin");
      setCurrentUserId(user.id ?? null);

      if (!hasUserPermission("manage_branches", user)) {
        const bid = typeof user.branch_id === "number" ? user.branch_id : null;
        setActiveBranchId(bid);
        if (bid != null) localStorage.setItem("activeBranchId", String(bid));
      }
    }

    // Always start authenticated users on dashboard.
    setActiveView("dashboard");
    setIsAuthenticated(true);
  };

  const handleLogout = () => {
    logoutAndReset();
  };

  const handleInstallApp = async () => {
    if (!installPromptEvent) return;
    await installPromptEvent.prompt();
    await installPromptEvent.userChoice.catch(() => undefined);
    setInstallPromptEvent(null);
  };

  const handleChangeBranch = (branchId: number) => {
    if (branchId === activeBranchId) return;
    setActiveBranchId(branchId);
    localStorage.setItem("activeBranchId", String(branchId));

    // Clear cached branch-scoped responses and reset product selection immediately.
    clearDataCache();
    setProducts([]);
    setSupplierDirectory([]);
    setSelectedId(null);

    // Notify other components that the active branch changed
    window.dispatchEvent(new CustomEvent("activeBranchChanged", { detail: branchId }));
  };

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    if (activeView === "reports" && !canViewReports) {
      setActiveView("dashboard");
      return;
    }

    if (activeView === "revenue" && !canViewRevenue) {
      setActiveView("dashboard");
      return;
    }

    if (activeView === "users" && !canManageEmployees) {
      setActiveView("dashboard");
    }
  }, [activeView, canManageEmployees, canViewReports, canViewRevenue, isAuthenticated]);

  // Show login page if not authenticated
  if (!isAuthenticated) {
    return (
      <Suspense fallback={<LazyViewFallback />}>
        <Login onLogin={handleLogin} />
      </Suspense>
    );
  }

  const handleCreateProduct = async (payload: NewProduct, branchIdOverride?: number | null) => {
    const created = await createProduct(payload, branchIdOverride);

    // If admin created into a different branch, switch to it so the list matches.
    if (canManageBranches && branchIdOverride != null && branchIdOverride !== activeBranchId) {
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

  const renderView = (view: string) => {
    switch (view) {
      case "dashboard":
        return <Dashboard onNavigate={setActiveView} />;
      case "products": {
        const stockFilterLabels: Record<string, string> = {
          in_stock: "In stock",
          low_stock: "Low stock",
          out_of_stock: "Out of stock",
        };
        const expiryFilterLabels: Record<string, string> = {
          expired: "Expired only",
          expiring: "Expiring soon",
          fresh: "Fresh items",
        };
        const sortLabels: Record<string, string> = {
          name_asc: "Name A-Z",
          name_desc: "Name Z-A",
          stock_desc: "Stock high-low",
          stock_asc: "Stock low-high",
          margin_desc: "Margin high-low",
          newest: "Newest first",
        };

        const activeFilterChips: Array<{ key: string; label: string; onClear: () => void }> = [];
        if (searchTerm.trim()) {
          activeFilterChips.push({ key: "search", label: `Search: ${searchTerm.trim()}`, onClear: () => setSearchTerm("") });
        }
        if (filterCategory !== "all") {
          activeFilterChips.push({ key: "category", label: `Category: ${filterCategory}`, onClear: () => setFilterCategory("all") });
        }
        if (showExpiryStatusFilter && filterExpiry !== "all") {
          activeFilterChips.push({ key: "expiry", label: `Expiry: ${expiryFilterLabels[filterExpiry] ?? filterExpiry}`, onClear: () => setFilterExpiry("all") });
        }
        if (filterStock !== "all") {
          activeFilterChips.push({ key: "stock", label: `Stock: ${stockFilterLabels[filterStock] ?? filterStock}`, onClear: () => setFilterStock("all") });
        }
        if (filterSupplier !== "all") {
          activeFilterChips.push({ key: "supplier", label: `Supplier: ${filterSupplier}`, onClear: () => setFilterSupplier("all") });
        }
        if (sortBy !== "name_asc") {
          activeFilterChips.push({ key: "sort", label: `Sort: ${sortLabels[sortBy] ?? sortBy}`, onClear: () => setSortBy("name_asc") });
        }

        const hasActiveFilters = activeFilterChips.length > 0;

        return (
          <div className="app-shell">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
              <div>
                <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0, letterSpacing: -0.3 }}>Products</h1>
                <p style={{ margin: "4px 0 0", fontSize: 13, color: "#64748b" }}>Manage catalog pricing, stock health, and product quality in one place.</p>
              </div>
              {canManageCatalog ? (
                <button
                  className="button"
                  onClick={() => setShowAddProduct(true)}
                  style={{
                    background: "linear-gradient(135deg, #1f7aff, #2563eb)",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "11px 18px",
                    fontSize: 14,
                    fontWeight: 700,
                    borderRadius: 12,
                    boxShadow: "0 10px 20px rgba(37, 99, 235, 0.24)",
                  }}
                >
                  <span>Add New Product</span>
                </button>
              ) : null}
            </div>
            
            {/* Add Product Modal */}
            {showAddProduct && canManageCatalog && (
              <div
                style={{
                  position: "fixed",
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  background: "rgba(15, 23, 42, 0.55)",
                  backdropFilter: "blur(2px)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  zIndex: 1000,
                  padding: 16,
                }}
                onClick={() => setShowAddProduct(false)}
              >
                <div
                  style={{
                    background: "white",
                      borderRadius: 20,
                      maxWidth: 860,
                    width: "100%",
                    maxHeight: "90vh",
                    overflow: "auto",
                      padding: 20,
                      position: "relative",
                      border: "1px solid #dbe5f2",
                      boxShadow: "0 24px 44px rgba(15, 23, 42, 0.28)",
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                    <button
                      type="button"
                      onClick={() => setShowAddProduct(false)}
                      style={{
                        position: "absolute",
                        top: 12,
                        right: 12,
                        background: "#f8fafc",
                        border: "1px solid #dbe5f2",
                        fontSize: 12,
                        cursor: "pointer",
                        color: "#475569",
                        padding: "6px 10px",
                        borderRadius: 999,
                        fontWeight: 700,
                        zIndex: 3,
                      }}
                    >
                      Close
                    </button>
                  <ProductForm
                    onCreate={handleCreateProduct}
                    onCancel={() => setShowAddProduct(false)}
                    onSupplierDirectoryChanged={async () => {
                      try {
                        const data = await fetchSuppliersCached((fresh) => setSupplierDirectory(fresh));
                        setSupplierDirectory(data);
                      } catch {
                        // Supplier refresh is best-effort for the product form.
                      }
                    }}
                    userRole={userRole}
                    branches={branches}
                    activeBranchId={activeBranchId}
                    existingSuppliers={supplierDirectory}
                    layoutMode="modal"
                  />
                </div>
              </div>
            )}

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(176px, 1fr))",
                gap: 12,
                marginBottom: 14,
              }}
            >
              <div className="card" style={{ margin: 0, padding: 14, border: "1px solid #dbe5f2", borderRadius: 14, boxShadow: "0 8px 22px rgba(15, 23, 42, 0.06)" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 }}>Total SKUs</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: "#0f172a", lineHeight: 1 }}>{productKpis.totalSkus}</div>
              </div>
              <div className="card" style={{ margin: 0, padding: 14, border: "1px solid #fde68a", borderRadius: 14, boxShadow: "0 8px 22px rgba(15, 23, 42, 0.06)" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#92400e", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 }}>Low Stock</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: "#b45309", lineHeight: 1 }}>{productKpis.lowStockCount}</div>
              </div>
              <div className="card" style={{ margin: 0, padding: 14, border: "1px solid #fecaca", borderRadius: 14, boxShadow: "0 8px 22px rgba(15, 23, 42, 0.06)" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#991b1b", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 }}>Out of Stock</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: "#dc2626", lineHeight: 1 }}>{productKpis.outOfStockCount}</div>
              </div>
              <div className="card" style={{ margin: 0, padding: 14, border: "1px solid #bfdbfe", borderRadius: 14, boxShadow: "0 8px 22px rgba(15, 23, 42, 0.06)" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#1d4ed8", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 }}>Inventory Value</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: "#1e40af", lineHeight: 1 }}>₵{productKpis.inventoryValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
              </div>
              <div className="card" style={{ margin: 0, padding: 14, border: "1px solid #bbf7d0", borderRadius: 14, boxShadow: "0 8px 22px rgba(15, 23, 42, 0.06)" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#166534", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 }}>Avg Margin</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: "#15803d", lineHeight: 1 }}>{productKpis.averageMarginPercent.toFixed(1)}%</div>
              </div>
            </div>
            
            {/* Search and Filter Bar */}
            <div
              className="card"
              style={{
                marginBottom: 14,
                padding: 14,
                border: "1px solid #dbe5f2",
                background: "linear-gradient(180deg, #ffffff 0%, #f8fbff 100%)",
                boxShadow: "0 8px 22px rgba(15, 23, 42, 0.06)",
                borderRadius: 14,
              }}
            >
              <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10, alignItems: "end" }}>
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
                    Stock Status
                  </span>
                  <select
                    className="input"
                    value={filterStock}
                    onChange={(e) => setFilterStock(e.target.value)}
                    style={{ padding: 10 }}
                  >
                    <option value="all">All Stock Levels</option>
                    <option value="in_stock">In Stock</option>
                    <option value="low_stock">Low Stock (1-5)</option>
                    <option value="out_of_stock">Out of Stock</option>
                  </select>
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
                <label style={{ margin: 0 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, display: "block" }}>
                    Supplier
                  </span>
                  <select
                    className="input"
                    value={filterSupplier}
                    onChange={(e) => setFilterSupplier(e.target.value)}
                    style={{ padding: 10 }}
                  >
                    <option value="all">All Suppliers</option>
                    {supplierOptions.map((supplier) => (
                      <option key={supplier} value={supplier}>
                        {supplier}
                      </option>
                    ))}
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
                <label style={{ margin: 0 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, display: "block" }}>
                    Sort By
                  </span>
                  <select
                    className="input"
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value)}
                    style={{ padding: 10 }}
                  >
                    <option value="name_asc">Name (A-Z)</option>
                    <option value="name_desc">Name (Z-A)</option>
                    <option value="stock_desc">Stock (High-Low)</option>
                    <option value="stock_asc">Stock (Low-High)</option>
                    <option value="margin_desc">Margin (High-Low)</option>
                    <option value="newest">Newest First</option>
                  </select>
                </label>
              </div>
              {hasActiveFilters ? (
                <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                  {activeFilterChips.map((chip) => (
                    <button
                      key={chip.key}
                      type="button"
                      onClick={chip.onClear}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "5px 11px",
                        borderRadius: 999,
                        border: "1px solid #cbd5e1",
                        background: "#f8fafc",
                        color: "#334155",
                        cursor: "pointer",
                        fontSize: 12,
                        fontWeight: 600,
                      }}
                    >
                      <span>{chip.label}</span>
                      <span style={{ color: "#64748b", fontWeight: 900 }}>x</span>
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      setSearchTerm("");
                      setFilterCategory("all");
                      setFilterExpiry("all");
                      setFilterStock("all");
                      setFilterSupplier("all");
                      setSortBy("name_asc");
                    }}
                    style={{
                      padding: "6px 12px",
                      background: "#ffffff",
                      border: "1px solid #d8dce8",
                      borderRadius: 999,
                      cursor: "pointer",
                      fontSize: 12,
                      fontWeight: 700,
                      color: "#4a5368",
                    }}
                  >
                    Clear All
                  </button>
                </div>
              ) : null}
            </div>

            <div className="grid" style={{ gap: 16 }}>
              <ProductList
                products={products}
                selectedId={selectedId}
                onSelect={(id: number) => setSelectedId(id)}
                onEdit={handleEditProduct}
                onDelete={handleDeleteProduct}
                onOpenInventory={() => setActiveView("inventory")}
                searchTerm={searchTerm}
                filterCategory={filterCategory}
                filterExpiry={filterExpiry}
                filterStock={filterStock}
                filterSupplier={filterSupplier}
                sortBy={sortBy}
                userRole={userRole}
              />
            </div>
          </div>
        );
      }
      case "inventory":
        return <Inventory />;
      case "sales":
        return <Sales />;
      case "invoice":
        return <Invoice />;
      case "revenue":
        return <RevenueAnalysis />;
      case "reports":
        return <Reports onNavigate={setActiveView} />;
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
      businessLogoUrl={businessLogoUrl}
      userRole={userRole}
      userPermissions={userPermissions}
      isOnline={isOnline}
      outboxCount={outboxCount}
      isSyncingOutbox={isSyncingOutbox}
      canInstallApp={installPromptEvent !== null}
      onInstallApp={handleInstallApp}
      branches={branches}
      activeBranchId={activeBranchId}
      onChangeBranch={canManageBranches ? handleChangeBranch : undefined}
    >
      <Suspense fallback={<LazyViewFallback />}>
        {renderView(activeView)}
      </Suspense>
    </Layout>
  );
}
