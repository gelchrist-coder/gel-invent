import { ReactNode, useState, useEffect } from "react";

import TopBar from "./TopBar";
import { Branch } from "../types";

type NavItem = {
  id: string;
  label: string;
  icon: string;
  adminOnly?: boolean; // Only visible to Admin/Owner
};

const NAV_ITEMS: NavItem[] = [
  { id: "dashboard", label: "Dashboard", icon: "D" },
  { id: "products", label: "Products", icon: "P" },
  { id: "sales", label: "Sales", icon: "S" },
  { id: "inventory", label: "Inventory", icon: "I", adminOnly: true },
  { id: "revenue", label: "Revenue", icon: "R", adminOnly: true },
  { id: "reports", label: "Reports", icon: "T", adminOnly: true },
  { id: "creditors", label: "Creditors", icon: "C" },
  { id: "profile", label: "Profile", icon: "U" },
  { id: "users", label: "Users", icon: "M", adminOnly: true },
];

const SIDEBAR_EXPANDED_WIDTH = 240;
const SIDEBAR_COLLAPSED_WIDTH = 70;

type Props = {
  activeView: string;
  onNavigate: (view: string) => void;
  onLogout: () => void;
  children: ReactNode;
  userName?: string;
  businessName?: string;
  userRole?: string;
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
  branches,
  activeBranchId,
  onChangeBranch,
}: Props) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    // Load collapsed state from localStorage
    const saved = localStorage.getItem("sidebarCollapsed");
    return saved === "true";
  });
  const [isMobile, setIsMobile] = useState(false);

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

  // Save collapsed state to localStorage
  useEffect(() => {
    localStorage.setItem("sidebarCollapsed", String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  // Close sidebar when navigating on mobile
  const handleNavigate = (view: string) => {
    onNavigate(view);
    if (isMobile) {
      setSidebarOpen(false);
    }
  };

  // Filter navigation items based on user role
  const visibleNavItems = NAV_ITEMS.filter(item => !item.adminOnly || userRole === "Admin");

  const sidebarWidth = isMobile ? 260 : (sidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_EXPANDED_WIDTH);
  
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
            background: "rgba(0,0,0,0.5)",
            zIndex: 998,
          }}
        />
      )}

      {/* Sidebar */}
      <aside
        style={{
          width: sidebarWidth,
          minWidth: sidebarWidth,
          maxWidth: sidebarWidth,
          background: "linear-gradient(180deg, #0b1021 0%, #1a2235 100%)",
          color: "#fff",
          padding: "20px 0",
          boxShadow: "4px 0 20px rgba(0,0,0,0.15)",
          position: isMobile ? "fixed" : "sticky",
          top: 0,
          left: isMobile ? (sidebarOpen ? 0 : -260) : 0,
          height: "100vh",
          overflowY: "auto",
          overflowX: "hidden",
          flexShrink: 0,
          zIndex: 999,
          transition: "all 0.3s ease",
        }}
      >
        {/* Header */}
        <div style={{ 
          padding: sidebarCollapsed && !isMobile ? "0 8px" : "0 16px", 
          marginBottom: 24, 
          display: "flex", 
          justifyContent: "space-between", 
          alignItems: "center",
          minHeight: 48,
        }}>
          {(!sidebarCollapsed || isMobile) ? (
            <div style={{ overflow: "hidden" }}>
              <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: "-0.5px", whiteSpace: "nowrap" }}>
                Gel Invent
              </h1>
              <p style={{ margin: "2px 0 0", opacity: 0.7, fontSize: 12, whiteSpace: "nowrap" }}>Inventory System</p>
            </div>
          ) : (
            <div style={{ 
              width: 40, 
              height: 40, 
              borderRadius: 8, 
              background: "linear-gradient(135deg, #1f7aff, #8246ff)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 700,
              fontSize: 16,
              margin: "0 auto",
            }}>
              GI
            </div>
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

        {/* Branch Selector for Mobile */}
        {isMobile && userRole === "Admin" && onChangeBranch && branches && branches.length > 0 && (
          <div style={{ padding: "0 16px", marginBottom: 16 }}>
            <select
              value={activeBranchId ?? branches[0]?.id}
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
              {branches.map((b) => (
                <option key={b.id} value={b.id} style={{ color: "#0b1021" }}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Navigation */}
        <nav style={{ flex: 1 }}>
          {visibleNavItems.map((item) => (
            <button
              key={item.id}
              onClick={() => handleNavigate(item.id)}
              title={sidebarCollapsed && !isMobile ? item.label : undefined}
              style={{
                width: "100%",
                padding: sidebarCollapsed && !isMobile ? "12px 0" : "12px 16px",
                background: activeView === item.id ? "rgba(31, 122, 255, 0.15)" : "transparent",
                border: "none",
                borderLeft: activeView === item.id ? "3px solid #1f7aff" : "3px solid transparent",
                color: activeView === item.id ? "#fff" : "rgba(255,255,255,0.7)",
                textAlign: sidebarCollapsed && !isMobile ? "center" : "left",
                cursor: "pointer",
                fontSize: 14,
                fontWeight: activeView === item.id ? 600 : 500,
                transition: "all 0.15s ease",
                display: "flex",
                alignItems: "center",
                justifyContent: sidebarCollapsed && !isMobile ? "center" : "flex-start",
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
                fontWeight: 600,
                fontSize: 12,
                flexShrink: 0,
              }}>
                {item.icon}
              </span>
              {(!sidebarCollapsed || isMobile) && (
                <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {item.label}
                </span>
              )}
            </button>
          ))}
        </nav>

        {/* Collapse Toggle (Desktop Only) */}
        {!isMobile && (
          <div style={{ padding: "16px 8px", borderTop: "1px solid rgba(255,255,255,0.1)", marginTop: 16 }}>
            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              style={{
                width: "100%",
                padding: "10px",
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 8,
                color: "rgba(255,255,255,0.7)",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 500,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                transition: "all 0.15s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(255,255,255,0.1)";
                e.currentTarget.style.color = "#fff";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "rgba(255,255,255,0.05)";
                e.currentTarget.style.color = "rgba(255,255,255,0.7)";
              }}
            >
              <span style={{ fontSize: 16 }}>{sidebarCollapsed ? "»" : "«"}</span>
              {!sidebarCollapsed && <span>Collapse</span>}
            </button>
          </div>
        )}
      </aside>

      {/* Main Content */}
      <main style={{ flex: 1, background: "#f7f9ff", display: "flex", flexDirection: "column", minWidth: 0 }}>
        <TopBar
          userName={userName}
          userRole={userRole}
          businessName={businessName}
          onLogout={onLogout}
          branches={branches}
          activeBranchId={activeBranchId}
          onChangeBranch={onChangeBranch}
          onMenuClick={() => setSidebarOpen(true)}
          isMobile={isMobile}
        />
        <div style={{ flex: 1 }}>{children}</div>
      </main>
    </div>
  );
}
