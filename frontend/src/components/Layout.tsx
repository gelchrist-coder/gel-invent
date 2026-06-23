import { ReactNode, useState, useEffect } from "react";

import TopBar from "./TopBar";
import { Branch } from "../types";
import appLogo from "../asset/logo.png";
import { FrontendPermission, hasUserPermission } from "../user-storage";

type NavItem = {
  id: string;
  label: string;
  icon: ReactNode;
  requiredPermission?: FrontendPermission;
};

// SVG Icons
const DashboardIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
  </svg>
);

const ProductsIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
    <line x1="12" y1="22.08" x2="12" y2="12" />
  </svg>
);

const SalesIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="9" cy="21" r="1" />
    <circle cx="20" cy="21" r="1" />
    <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
  </svg>
);

const InvoiceIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 2h9l3 3v17a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" />
    <path d="M15 2v4h4" />
    <line x1="8" y1="11" x2="16" y2="11" />
    <line x1="8" y1="15" x2="16" y2="15" />
    <line x1="8" y1="19" x2="13" y2="19" />
  </svg>
);

const InventoryIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <polyline points="9 22 9 12 15 12 15 22" />
  </svg>
);

const ReportsIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="20" x2="18" y2="10" />
    <line x1="12" y1="20" x2="12" y2="4" />
    <line x1="6" y1="20" x2="6" y2="14" />
  </svg>
);

const CreditorsIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

const ProfileIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

const UsersIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

const MoreIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="4" y1="6" x2="20" y2="6" />
    <line x1="4" y1="12" x2="20" y2="12" />
    <line x1="4" y1="18" x2="20" y2="18" />
  </svg>
);

// Primary destinations promoted to the mobile bottom tab bar (in order).
const BOTTOM_NAV_IDS = ["dashboard", "sales", "products", "inventory"];

const NAV_ITEMS: NavItem[] = [
  { id: "dashboard", label: "Dashboard", icon: <DashboardIcon /> },
  { id: "products", label: "Products", icon: <ProductsIcon /> },
  { id: "sales", label: "Sales", icon: <SalesIcon /> },
  { id: "invoice", label: "Invoice", icon: <InvoiceIcon /> },
  { id: "inventory", label: "Inventory", icon: <InventoryIcon /> },
  { id: "reports", label: "Reports", icon: <ReportsIcon />, requiredPermission: "view_reports" },
  { id: "creditors", label: "Customers", icon: <CreditorsIcon /> },
  { id: "profile", label: "Settings", icon: <ProfileIcon /> },
  { id: "users", label: "Users", icon: <UsersIcon />, requiredPermission: "manage_employees" },
];

const SIDEBAR_EXPANDED_WIDTH = 220;
const SIDEBAR_COLLAPSED_WIDTH = 64;

type Props = {
  activeView: string;
  onNavigate: (view: string) => void;
  onLogout: () => void;
  children: ReactNode;
  userName?: string;
  businessName?: string;
  userRole?: string;
  userPermissions?: FrontendPermission[];
  isOnline?: boolean;
  outboxCount?: number;
  isSyncingOutbox?: boolean;
  canInstallApp?: boolean;
  onInstallApp?: () => void;
  branches?: Branch[];
  activeBranchId?: number | null;
  onChangeBranch?: (branchId: number) => void;
};

export default function Layout({
  activeView,
  onNavigate,
  onLogout,
  children,
  userName = "User",
  businessName = "Business",
  userRole = "Admin",
  userPermissions,
  isOnline = true,
  outboxCount = 0,
  isSyncingOutbox = false,
  canInstallApp = false,
  onInstallApp,
  branches,
  activeBranchId,
  onChangeBranch,
}: Props) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarHovered, setSidebarHovered] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const mobileSidebarWidth = "min(86vw, 320px)";

  // Check for mobile viewport
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
      if (window.innerWidth >= 768) {
        setSidebarOpen(false);
      }
    };
    
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  // Prevent background scroll while the mobile drawer is open.
  useEffect(() => {
    if (!isMobile) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = sidebarOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isMobile, sidebarOpen]);

  // Close sidebar when navigating on mobile
  const handleNavigate = (view: string) => {
    onNavigate(view);
    if (isMobile) {
      setSidebarOpen(false);
    }
  };

  // Filter navigation items based on user role
  const accessUser = { role: userRole, permissions: userPermissions };
  const canManageBranches = hasUserPermission("manage_branches", accessUser);
  const visibleNavItems = NAV_ITEMS.filter(
    (item) => !item.requiredPermission || hasUserPermission(item.requiredPermission, accessUser),
  );

  const bottomNavItems = BOTTOM_NAV_IDS
    .map((id) => visibleNavItems.find((item) => item.id === id))
    .filter((item): item is NavItem => Boolean(item));

  const visibleBranches = branches;

  const firstBranchId = visibleBranches && visibleBranches.length > 0 ? visibleBranches[0].id : undefined;
  const activeBranchName =
    visibleBranches && visibleBranches.length > 0
      ? visibleBranches.find((b) => b.id === (activeBranchId ?? firstBranchId))?.name ?? visibleBranches[0].name
      : undefined;

  // On desktop: collapsed by default, expands on hover
  const isExpanded = isMobile || sidebarHovered;
  const sidebarWidth = isMobile ? 260 : (isExpanded ? SIDEBAR_EXPANDED_WIDTH : SIDEBAR_COLLAPSED_WIDTH);
  
  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      {/* Mobile Overlay */}
      {isMobile && sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(2, 6, 23, 0.5)",
            backdropFilter: "blur(2px)",
            zIndex: 998,
            touchAction: "none",
          }}
        />
      )}

      {/* Sidebar */}
      <aside
        onMouseEnter={() => !isMobile && setSidebarHovered(true)}
        onMouseLeave={() => !isMobile && setSidebarHovered(false)}
        style={{
          width: isMobile ? (sidebarOpen ? mobileSidebarWidth : 0) : sidebarWidth,
          minWidth: isMobile ? (sidebarOpen ? mobileSidebarWidth : 0) : sidebarWidth,
          maxWidth: isMobile ? (sidebarOpen ? mobileSidebarWidth : 0) : sidebarWidth,
          background: "linear-gradient(180deg, #0b1021 0%, #1a2235 100%)",
          color: "#fff",
          padding: "16px 0",
          boxShadow: isExpanded && !isMobile ? "4px 0 24px rgba(0,0,0,0.2)" : "2px 0 8px rgba(0,0,0,0.1)",
          position: isMobile ? "fixed" : "sticky",
          top: 0,
          left: isMobile ? (sidebarOpen ? 0 : "calc(-1 * min(86vw, 320px))") : 0,
          height: "100vh",
          overflowY: "auto",
          overflowX: "hidden",
          flexShrink: 0,
          zIndex: 999,
          transition: "left 0.26s ease, box-shadow 0.2s ease",
          pointerEvents: isMobile && !sidebarOpen ? "none" : "auto",
        }}
      >
        <div
          style={{
            width: isMobile ? mobileSidebarWidth : "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
          }}
        >
        {/* Header */}
        <div style={{ 
          padding: !isExpanded ? "0 8px" : "0 16px", 
          marginBottom: 20, 
          display: "flex", 
          justifyContent: "space-between", 
          alignItems: "center",
          minHeight: 44,
        }}>
          {isExpanded ? (
            <div style={{ overflow: "hidden" }}>
              <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, letterSpacing: "-0.5px", whiteSpace: "nowrap" }}>
                Gel Invent
              </h1>
              <p style={{ margin: "2px 0 0", opacity: 0.6, fontSize: 11, whiteSpace: "nowrap" }}>Inventory System</p>
            </div>
          ) : (
            <img
              src={appLogo}
              alt="Gel Invent"
              style={{
                width: 36,
                height: 36,
                borderRadius: 8,
                objectFit: "cover",
                margin: "0 auto",
                background: "#fff",
              }}
            />
          )}
          {isMobile && (
            <button
              onClick={() => setSidebarOpen(false)}
              style={{
                background: "transparent",
                border: "none",
                color: "#fff",
                fontSize: 24,
                cursor: "pointer",
                padding: 4,
              }}
            >
              ×
            </button>
          )}
        </div>

        {/* Branch Selector / Indicator (Sidebar) */}
        {isExpanded && visibleBranches && visibleBranches.length > 0 && (
          <div style={{ padding: "0 16px", marginBottom: 16 }}>
            <div style={{ fontSize: 11, opacity: 0.65, marginBottom: 6, letterSpacing: 0.2 }}>Branch</div>

            {canManageBranches && onChangeBranch && visibleBranches.length > 1 ? (
              <select
                value={activeBranchId ?? visibleBranches[0]?.id}
                onChange={(e) => onChangeBranch?.(Number(e.target.value))}
                style={{
                  width: "100%",
                  height: 36,
                  borderRadius: 8,
                  border: "1px solid rgba(255,255,255,0.2)",
                  background: "rgba(255,255,255,0.1)",
                  padding: "0 10px",
                  fontSize: 13,
                  color: "#fff",
                }}
                aria-label="Select branch"
              >
                {visibleBranches.map((b) => (
                  <option key={b.id} value={b.id} style={{ color: "#0b1021" }}>
                    {b.name}
                  </option>
                ))}
              </select>
            ) : (
              <div
                style={{
                  width: "100%",
                  minHeight: 36,
                  borderRadius: 8,
                  border: "1px solid rgba(255,255,255,0.2)",
                  background: "rgba(255,255,255,0.08)",
                  padding: "8px 10px",
                  fontSize: 13,
                  color: "#fff",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  display: "flex",
                  alignItems: "center",
                }}
                title={activeBranchName}
              >
                {activeBranchName ?? "Branch"}
              </div>
            )}
          </div>
        )}

        {/* Navigation */}
        <nav style={{ flex: 1 }}>
          {visibleNavItems.map((item) => (
            <button
              key={item.id}
              onClick={() => handleNavigate(item.id)}
              title={!isExpanded ? item.label : undefined}
              style={{
                width: "100%",
                padding: !isExpanded ? "10px 0" : "10px 16px",
                background: activeView === item.id ? "rgba(31, 122, 255, 0.15)" : "transparent",
                border: "none",
                borderLeft: activeView === item.id ? "3px solid #1f7aff" : "3px solid transparent",
                color: activeView === item.id ? "#fff" : "rgba(255,255,255,0.7)",
                textAlign: !isExpanded ? "center" : "left",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: activeView === item.id ? 600 : 500,
                transition: "all 0.15s ease",
                display: "flex",
                alignItems: "center",
                justifyContent: !isExpanded ? "center" : "flex-start",
                gap: 10,
              }}
              onMouseEnter={(e) => {
                if (activeView !== item.id) {
                  e.currentTarget.style.background = "rgba(255,255,255,0.05)";
                  e.currentTarget.style.color = "#fff";
                }
              }}
              onMouseLeave={(e) => {
                if (activeView !== item.id) {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.color = "rgba(255,255,255,0.7)";
                }
              }}
            >
              <span style={{ 
                width: 28, 
                height: 28, 
                borderRadius: 6, 
                background: activeView === item.id ? "rgba(31, 122, 255, 0.3)" : "rgba(255,255,255,0.1)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}>
                {item.icon}
              </span>
              {isExpanded && (
                <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {item.label}
                </span>
              )}
            </button>
          ))}
        </nav>

        {/* User + logout pinned to the bottom of the drawer (mobile only). */}
        {isMobile && (
          <div
            style={{
              marginTop: "auto",
              padding: "14px 16px calc(14px + env(safe-area-inset-bottom))",
              borderTop: "1px solid rgba(255,255,255,0.12)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
              <div
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: "50%",
                  background: "linear-gradient(135deg, #1d4ed8, #2563eb)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 700,
                  fontSize: 16,
                  color: "#fff",
                  flexShrink: 0,
                  boxShadow: "0 8px 16px rgba(37, 99, 235, 0.35)",
                }}
              >
                {userName.charAt(0).toUpperCase()}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {userName}
                </div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", fontWeight: 600 }}>{userRole}</div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setSidebarOpen(false);
                onLogout();
              }}
              style={{
                width: "100%",
                padding: "11px 12px",
                borderRadius: 10,
                border: "1px solid rgba(248, 113, 113, 0.35)",
                background: "rgba(248, 113, 113, 0.12)",
                color: "#fecaca",
                fontSize: 14,
                fontWeight: 700,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
              }}
            >
              <span aria-hidden="true">↪</span>
              <span>Logout</span>
            </button>
          </div>
        )}
        </div>
      </aside>

      {/* Main Content */}
      <main style={{ flex: 1, background: "#f7f9ff", display: "flex", flexDirection: "column", minWidth: 0 }}>
        <TopBar
          userName={userName}
          userRole={userRole}
          businessName={businessName}
          isOnline={isOnline}
          outboxCount={outboxCount}
          isSyncingOutbox={isSyncingOutbox}
          canInstallApp={canInstallApp}
          onInstallApp={onInstallApp}
          onLogout={onLogout}
          onNavigate={onNavigate}
          branches={branches}
          activeBranchId={activeBranchId}
          onChangeBranch={onChangeBranch}
          isMobile={isMobile}
        />
        <div className="app-content" style={{ flex: 1 }}>{children}</div>
      </main>

      {/* Mobile bottom tab bar: primary destinations + More (opens the drawer). */}
      {isMobile && (
        <nav className="mobile-tabbar" aria-label="Primary">
          {bottomNavItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={activeView === item.id ? "active" : undefined}
              aria-current={activeView === item.id ? "page" : undefined}
              onClick={() => handleNavigate(item.id)}
            >
              <span className="tab-icon">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
          <button
            type="button"
            className={sidebarOpen ? "active" : undefined}
            aria-label="More menu"
            aria-expanded={sidebarOpen}
            onClick={() => setSidebarOpen(true)}
          >
            <span className="tab-icon"><MoreIcon /></span>
            <span>More</span>
          </button>
        </nav>
      )}
    </div>
  );
}
