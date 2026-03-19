import { useState, useRef, useEffect } from "react";

import { Branch } from "../types";

type Props = {
  userName?: string;
  userRole?: string;
  businessName?: string;
  onLogout?: () => void;
  onNavigate?: (view: string) => void;
  branches?: Branch[];
  activeBranchId?: number | null;
  onChangeBranch?: (branchId: number) => void;
  onMenuClick?: () => void;
  isMobile?: boolean;
};

export default function TopBar({
  userName = "User",
  userRole = "Admin",
  businessName = "Gel Invent",
  onLogout,
  onNavigate,
  branches,
  activeBranchId,
  onChangeBranch,
  onMenuClick,
  isMobile = false,
}: Props) {
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowDropdown(false);
      }
    };

    if (showDropdown) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleEscape);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [showDropdown]);

  const businessLabel = String(businessName || "Gel Invent").trim();
  const initial = userName.charAt(0).toUpperCase();

  return (
    <header
      style={{
        height: isMobile ? 72 : 76,
        background: "#ffffff",
        borderBottom: "1px solid #dbe4f0",
        display: isMobile ? "flex" : "grid",
        gridTemplateColumns: isMobile ? undefined : "1fr auto 1fr",
        alignItems: "center",
        justifyContent: isMobile ? "space-between" : undefined,
        padding: isMobile ? "0 14px" : "0 28px",
        boxShadow: "0 8px 20px rgba(15, 23, 42, 0.06)",
        position: "sticky",
        top: 0,
        zIndex: 100,
      }}
    >
      {/* Left - Menu Button (mobile) */}
      <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 12, justifyContent: "flex-start" }}>
        {isMobile && onMenuClick ? (
          <button
            onClick={onMenuClick}
            style={{
              background: "transparent",
              border: "none",
              padding: 8,
              cursor: "pointer",
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
            aria-label="Open menu"
          >
            <span style={{ width: 20, height: 2, background: "#0b1021", borderRadius: 1 }} />
            <span style={{ width: 20, height: 2, background: "#0b1021", borderRadius: 1 }} />
            <span style={{ width: 20, height: 2, background: "#0b1021", borderRadius: 1 }} />
          </button>
        ) : null}
      </div>

      {/* Center - Business Name (desktop) / Business Name (mobile) */}
      <div
        style={{
          minWidth: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: isMobile ? "center" : "center",
          gap: isMobile ? 8 : 12,
        }}
      >
        <div
          style={{
            width: isMobile ? 30 : 36,
            height: isMobile ? 30 : 36,
            borderRadius: 10,
            background: "linear-gradient(135deg, #1d4ed8, #3b82f6)",
            color: "#fff",
            display: "grid",
            placeItems: "center",
            fontSize: isMobile ? 12 : 13,
            fontWeight: 800,
            letterSpacing: 0.3,
            boxShadow: "0 8px 18px rgba(37, 99, 235, 0.28)",
            flexShrink: 0,
          }}
        >
          GI
        </div>
        <div style={{ minWidth: 0 }}>
          <h1
            style={{
              margin: 0,
              fontSize: isMobile ? 16 : 20,
              fontWeight: 800,
              color: "#1e3a8a",
              letterSpacing: "0.2px",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              textTransform: "uppercase",
              maxWidth: isMobile ? 160 : 560,
              lineHeight: 1.15,
            }}
            title={businessLabel}
          >
            {businessLabel}
          </h1>
          {!isMobile && (
            <p
              style={{
                margin: "3px 0 0",
                fontSize: 11,
                color: "#64748b",
                fontWeight: 600,
                letterSpacing: "0.3px",
                textTransform: "uppercase",
              }}
            >
              Inventory Management System
            </p>
          )}
        </div>
      </div>

      {/* Right - User Info */}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <div style={{ position: "relative" }} ref={dropdownRef}>
          <div
            onClick={() => setShowDropdown(!showDropdown)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: isMobile ? 8 : 12,
              padding: isMobile ? "6px 10px 6px 6px" : "8px 14px 8px 8px",
              background: "#f8fbff",
              borderRadius: 999,
              border: "1px solid #d6e2f2",
              cursor: "pointer",
              transition: "all 0.2s",
              boxShadow: "0 6px 14px rgba(15, 23, 42, 0.08)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "#eef4ff";
              e.currentTarget.style.borderColor = "#3b82f6";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "#f8fbff";
              e.currentTarget.style.borderColor = "#d6e2f2";
            }}
          >
            <div
              style={{
                width: isMobile ? 36 : 42,
                height: isMobile ? 36 : 42,
                borderRadius: "50%",
                background: "linear-gradient(135deg, #1d4ed8, #2563eb)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 700,
                fontSize: isMobile ? 14 : 16,
                color: "#fff",
                boxShadow: "0 8px 16px rgba(37, 99, 235, 0.35)",
              }}
            >
              {initial}
            </div>
            {!isMobile && (
              <div style={{ textAlign: "left" }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: "#0f172a" }}>{userName}</div>
                <div style={{ fontSize: 12, color: "#475569", fontWeight: 600 }}>{userRole}</div>
              </div>
            )}
            <div style={{ marginLeft: isMobile ? 0 : 4, fontSize: 12, color: "#475569", fontWeight: 700 }}>
              {showDropdown ? "▲" : "▼"}
            </div>
          </div>

          {/* Dropdown Menu */}
          {showDropdown && (
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 8px)",
                right: 0,
                background: "#ffffff",
                borderRadius: 12,
                border: "1px solid #e6e9f2",
                boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
                minWidth: 240,
                padding: 8,
                zIndex: 1000,
              }}
            >
              <button
                onClick={() => {
                  setShowDropdown(false);
                  onNavigate?.("profile");
                }}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  background: "#f8fafc",
                  border: "1px solid #e2e8f0",
                  borderRadius: 10,
                  textAlign: "left",
                  cursor: "pointer",
                  fontSize: 14,
                  fontWeight: 600,
                  color: "#0f172a",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  marginBottom: 6,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "#eef2ff";
                  e.currentTarget.style.borderColor = "#c7d2fe";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "#f8fafc";
                  e.currentTarget.style.borderColor = "#e2e8f0";
                }}
              >
                <span aria-hidden="true">👤</span>
                <span style={{ flex: 1 }}>Profile</span>
              </button>

              <button
                onClick={() => {
                  setShowDropdown(false);
                  onNavigate?.("profile");
                }}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  background: "#f8fafc",
                  border: "1px solid #e2e8f0",
                  borderRadius: 10,
                  textAlign: "left",
                  cursor: "pointer",
                  fontSize: 14,
                  fontWeight: 600,
                  color: "#0f172a",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  marginBottom: 6,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "#eef2ff";
                  e.currentTarget.style.borderColor = "#c7d2fe";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "#f8fafc";
                  e.currentTarget.style.borderColor = "#e2e8f0";
                }}
              >
                <span aria-hidden="true">⚙️</span>
                <span style={{ flex: 1 }}>Settings</span>
              </button>

              {onLogout && (
                <button
                  onClick={() => {
                    setShowDropdown(false);
                    onLogout();
                  }}
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    background: "#fff5f5",
                    border: "1px solid #fee2e2",
                    borderRadius: 10,
                    textAlign: "left",
                    cursor: "pointer",
                    fontSize: 14,
                    fontWeight: 600,
                    color: "#b91c1c",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    transition: "background 0.15s ease, border-color 0.15s ease",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "#fee2e2";
                    e.currentTarget.style.borderColor = "#fecaca";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "#fff5f5";
                    e.currentTarget.style.borderColor = "#fee2e2";
                  }}
                >
                  <span aria-hidden="true">↪</span>
                  <span style={{ flex: 1 }}>Logout</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
