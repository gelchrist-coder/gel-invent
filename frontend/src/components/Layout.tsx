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
  { id: "dashboard", label: "Dashboard", icon: "" },
  { id: "products", label: "Products", icon: "" },
  { id: "sales", label: "Sales", icon: "" },
  { id: "inventory", label: "Inventory Tracking", icon: "", adminOnly: true },
  { id: "revenue", label: "Revenue Analysis", icon: "", adminOnly: true },
  { id: "reports", label: "Reports", icon: "", adminOnly: true },
  { id: "creditors", label: "Creditors", icon: "" },
  { id: "profile", label: "Profile", icon: "" },
  { id: "users", label: "User Management", icon: "", adminOnly: true },
];

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

  // Close sidebar when navigating on mobile
  const handleNavigate = (view: string) => {
    onNavigate(view);
    if (isMobile) {
      setSidebarOpen(false);
    }
  };

  // Filter navigation items based on user role
  const visibleNavItems = NAV_ITEMS.filter(item => !item.adminOnly || userRole === "Admin");
  
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
          width: 260,
          minWidth: 260,
          maxWidth: 260,
          background: "linear-gradient(180deg, #0b1021 0%, #1a2235 100%)",
          color: "#fff",
          padding: "24px 0",
          boxShadow: "4px 0 20px rgba(0,0,0,0.15)",
          position: isMobile ? "fixed" : "sticky",
          top: 0,
          left: isMobile ? (sidebarOpen ? 0 : -260) : 0,
          height: "100vh",
          overflowY: "auto",
          flexShrink: 0,
          zIndex: 999,
          transition: "left 0.3s ease",
        }}
      >
        <div style={{ padding: "0 20px", marginBottom: 32, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: "-0.5px" }}>
              Gel Invent
            </h1>
            <p style={{ margin: "4px 0 0", opacity: 0.7, fontSize: 13 }}>Inventory System</p>
          </div>
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
          <div style={{ padding: "0 20px", marginBottom: 20 }}>
            <select
              value={activeBranchId ?? branches[0]?.id}
              onChange={(e) => onChangeBranch?.(Number(e.target.value))}
              style={{
                width: "100%",
                height: 40,
                borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.2)",
                background: "rgba(255,255,255,0.1)",
                padding: "0 12px",
                fontSize: 14,
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

        <nav>
          {visibleNavItems.map((item) => (
            <button
              key={item.id}
              onClick={() => handleNavigate(item.id)}
              style={{
                width: "100%",
                padding: "14px 20px",
                background: activeView === item.id ? "rgba(31, 122, 255, 0.15)" : "transparent",
                border: "none",
                borderLeft: activeView === item.id ? "4px solid #1f7aff" : "4px solid transparent",
                color: activeView === item.id ? "#fff" : "rgba(255,255,255,0.7)",
                textAlign: "left",
                cursor: "pointer",
                fontSize: 15,
                fontWeight: activeView === item.id ? 600 : 500,
                transition: "all 0.15s ease",
                display: "flex",
                alignItems: "center",
                gap: 12,
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
              <span style={{ fontSize: 18 }}>{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
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
