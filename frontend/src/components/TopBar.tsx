import { useState, useRef, useEffect } from "react";

import { Branch } from "../types";

type Props = {
  userName?: string;
  userRole?: string;
  businessName?: string;
  onLogout?: () => void;
  branches?: Branch[];
  activeBranchId?: number | null;
  onChangeBranch?: (branchId: number) => void;
};

export default function TopBar({
  userName = "User",
  userRole = "Admin",
  businessName = "Gel Invent",
  onLogout,
  branches,
  activeBranchId,
  onChangeBranch,
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

    if (showDropdown) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showDropdown]);

  return (
    <header
      style={{
        height: 70,
        background: "#ffffff",
        borderBottom: "1px solid #e6e9f2",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 32px",
        boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
        position: "sticky",
        top: 0,
        zIndex: 100,
      }}
    >
      {/* Left - Business Name */}
      <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 12 }}>
        <h1
          style={{
            margin: 0,
            fontSize: 22,
            fontWeight: 700,
            background: "linear-gradient(120deg, #1f7aff, #8246ff)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
            letterSpacing: "-0.5px",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            maxWidth: 520,
          }}
          title={businessName}
        >
          {businessName}
        </h1>

        {userRole === "Admin" && onChangeBranch && branches && branches.length > 0 ? (
          <select
            value={activeBranchId ?? branches[0]?.id}
            onChange={(e) => onChangeBranch?.(Number(e.target.value))}
            style={{
              height: 36,
              borderRadius: 10,
              border: "1px solid #e6e9f2",
              background: "#ffffff",
              padding: "0 10px",
              fontSize: 13,
              color: "#0b1021",
              maxWidth: 220,
            }}
            aria-label="Select branch"
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        ) : branches && branches.length > 0 ? (
          <div
            style={{
              height: 36,
              display: "inline-flex",
              alignItems: "center",
              padding: "0 10px",
              borderRadius: 10,
              border: "1px solid #e6e9f2",
              background: "#ffffff",
              fontSize: 13,
              color: "#0b1021",
              maxWidth: 240,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
            title={branches.find((b) => b.id === (activeBranchId ?? branches[0]?.id))?.name}
          >
            {branches.find((b) => b.id === (activeBranchId ?? branches[0]?.id))?.name ?? branches[0]?.name ?? "Branch"}
          </div>
        ) : null}
      </div>

      {/* Right - User Info */}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <div style={{ position: "relative" }} ref={dropdownRef}>
          <div
            onClick={() => setShowDropdown(!showDropdown)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "8px 16px 8px 8px",
              background: "#f9fbff",
              borderRadius: 999,
              border: "1px solid #e6e9f2",
              cursor: "pointer",
              transition: "all 0.2s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "#f0f5ff";
              e.currentTarget.style.borderColor = "#1f7aff";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "#f9fbff";
              e.currentTarget.style.borderColor = "#e6e9f2";
            }}
          >
            <div
              style={{
                width: 42,
                height: 42,
                borderRadius: "50%",
                background: "linear-gradient(135deg, #1f7aff, #8246ff)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 700,
                fontSize: 16,
                color: "#fff",
                boxShadow: "0 4px 12px rgba(31, 122, 255, 0.3)",
              }}
            >
              {userName.charAt(0).toUpperCase()}
            </div>
            <div style={{ textAlign: "left" }}>
              <div style={{ fontWeight: 600, fontSize: 14, color: "#0b1021" }}>{userName}</div>
              <div style={{ fontSize: 12, color: "#5f6475" }}>{userRole}</div>
            </div>
            <div style={{ marginLeft: 4, fontSize: 12, color: "#5f6475" }}>
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
                  <span
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 999,
                      background: "#fee2e2",
                      border: "1px solid #fecaca",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 14,
                      lineHeight: 1,
                      flex: "0 0 auto",
                    }}
                    aria-hidden="true"
                  >
                    🚪
                  </span>
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
