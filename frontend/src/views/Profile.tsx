import { useEffect, useMemo, useRef, useState } from "react";

import { changePassword, deleteBranch, exportData, exportDataXlsx, fetchBranches, fetchSystemSettings, importData, updateBranch, updateSystemSettings } from "../api";
import { Branch } from "../types";

type PasswordInputProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
};

function PasswordInput({ label, value, onChange, autoComplete }: PasswordInputProps) {
  const [show, setShow] = useState(false);

  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 14, fontWeight: 600, color: "#374151" }}>{label}</span>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="input"
          autoComplete={autoComplete}
          style={{ flex: 1 }}
        />
        <button
          type="button"
          onClick={() => setShow((prev) => !prev)}
          className="button"
          style={{ background: "#6b7280", fontSize: 14, padding: "8px 12px" }}
        >
          {show ? "Hide" : "Show"}
        </button>
      </div>
    </label>
  );
}

function getPasswordRuleError(password: string): string | null {
  if (password.length < 8) return "Password must be at least 8 characters";
  if (!/[a-z]/.test(password)) return "Password must include a lowercase letter";
  if (!/[A-Z]/.test(password)) return "Password must include an uppercase letter";
  if (!/[0-9]/.test(password)) return "Password must include a number";
  if (!/[^A-Za-z0-9]/.test(password)) return "Password must include a special character";
  return null;
}

export default function Profile() {
  // Get user role from localStorage
  const currentUserStr = localStorage.getItem("user");
  const currentUserData = currentUserStr ? JSON.parse(currentUserStr) : null;
  const userRole = currentUserData?.role || "Admin";
  const isAdmin = userRole === "Admin";

  const [activeTab, setActiveTab] = useState<"business" | "user" | "system">(isAdmin ? "business" : "user");
  const [businessInfo, setBusinessInfo] = useState({
    name: currentUserData?.business_name || "Gel Invent Business",
    owner: currentUserData?.name || "Gel Christ Boateng",
    phone: "",
    email: currentUserData?.email || "",
    address: "",
    taxId: "",
    currency: "GHS",
    logo: "",
  });

  const [userInfo, setUserInfo] = useState({
    name: currentUserData?.name || "Admin User",
    email: currentUserData?.email || "",
    phone: "",
    role: currentUserData?.role || "Admin",
  });

  const [systemSettings, setSystemSettings] = useState({
    lowStockThreshold: "10",
    expiryWarningDays: "180",
    usesExpiryTracking: true,
    autoBackup: true,
    emailNotifications: false,
  });

  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);

  const [showChangePassword, setShowChangePassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changePasswordError, setChangePasswordError] = useState<string | null>(null);
  const [changingPassword, setChangingPassword] = useState(false);

  const importFileRef = useRef<HTMLInputElement | null>(null);
  const [exportingData, setExportingData] = useState(false);
  const [importingData, setImportingData] = useState(false);
  const [dataMessage, setDataMessage] = useState<string | null>(null);

  // Branch management state
  const [branches, setBranches] = useState<Branch[]>([]);
  const [editingBranchId, setEditingBranchId] = useState<number | null>(null);
  const [editingBranchName, setEditingBranchName] = useState("");
  const [branchSaving, setBranchSaving] = useState(false);
  const [branchError, setBranchError] = useState<string | null>(null);

  const todayStamp = useMemo(() => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }, []);

  // Load saved settings from localStorage on mount
  useEffect(() => {
    const savedBusiness = localStorage.getItem("businessInfo");

    if (savedBusiness) setBusinessInfo(JSON.parse(savedBusiness));
    
    // Always load current user data from the 'user' object
    try {
      const rawUser = localStorage.getItem("user");
      const parsedUser = rawUser ? (JSON.parse(rawUser) as Record<string, unknown>) : null;
      if (parsedUser) {
        setUserInfo({
          name: String(parsedUser.name ?? ""),
          email: String(parsedUser.email ?? ""),
          phone: "",
          role: String(parsedUser.role ?? "Admin"),
        });
        setBusinessInfo((prev) => ({
          ...prev,
          name: String(parsedUser.business_name ?? prev.name),
          owner: String(parsedUser.name ?? prev.owner),
          email: String(parsedUser.email ?? prev.email),
        }));
      }
    } catch {
      // ignore
    }

    // Load persisted system settings from API (tenant-wide)
    (async () => {
      try {
        const settings = await fetchSystemSettings();
        setSystemSettings({
          lowStockThreshold: String(settings.low_stock_threshold),
          expiryWarningDays: String(settings.expiry_warning_days),
          usesExpiryTracking: settings.uses_expiry_tracking,
          autoBackup: settings.auto_backup,
          emailNotifications: settings.email_notifications,
        });
      } catch {
        // If unauthenticated or API unavailable, keep defaults.
      }

      // Load branches for Admin users
      if (isAdmin) {
        try {
          const branchData = await fetchBranches();
          setBranches(branchData);
        } catch {
          // Branches optional
        }
      }
    })();
  }, [isAdmin]);

  const handleSave = async () => {
    localStorage.setItem("businessInfo", JSON.stringify(businessInfo));
    localStorage.setItem("userInfo", JSON.stringify(userInfo));

    // Persist system settings (Admin only)
    if (isAdmin) {
      const payload = {
        low_stock_threshold: Number(systemSettings.lowStockThreshold) || 0,
        expiry_warning_days: Number(systemSettings.expiryWarningDays) || 0,
        uses_expiry_tracking: systemSettings.usesExpiryTracking,
        auto_backup: systemSettings.autoBackup,
        email_notifications: systemSettings.emailNotifications,
      };
      const updated = await updateSystemSettings(payload);
      setSystemSettings({
        lowStockThreshold: String(updated.low_stock_threshold),
        expiryWarningDays: String(updated.expiry_warning_days),
        usesExpiryTracking: updated.uses_expiry_tracking,
        autoBackup: updated.auto_backup,
        emailNotifications: updated.email_notifications,
      });
      // Notify other components that settings have changed
      window.dispatchEvent(new CustomEvent("systemSettingsChanged", { detail: updated }));
    }

    setEditing(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const openChangePassword = () => {
    setChangePasswordError(null);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setShowChangePassword(true);
  };

  const submitChangePassword = async () => {
    setChangePasswordError(null);

    if (!currentPassword) {
      setChangePasswordError("Please enter your current password");
      return;
    }

    if (newPassword !== confirmPassword) {
      setChangePasswordError("New password and confirmation do not match");
      return;
    }

    const ruleError = getPasswordRuleError(newPassword);
    if (ruleError) {
      setChangePasswordError(ruleError);
      return;
    }

    setChangingPassword(true);
    try {
      await changePassword({ current_password: currentPassword, new_password: newPassword });
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      window.dispatchEvent(new CustomEvent("userChanged", { detail: null }));
    } catch (error) {
      setChangePasswordError(error instanceof Error ? error.message : "Failed to change password");
    } finally {
      setChangingPassword(false);
    }
  };

  const handleExportData = async () => {
    setDataMessage(null);
    setExportingData(true);
    try {
      const preferExcel = confirm(
        "Download as Excel (OK) or JSON backup (Cancel)?\n\nExcel includes recent Products, Sales and Inventory Movements. JSON is for full backup/import."
      );
      const { blob, filename } = preferExcel ? await exportDataXlsx(30) : await exportData();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download =
        filename ??
        (preferExcel
          ? `gel-invent-export-${todayStamp}.xlsx`
          : `gel-invent-export-${todayStamp}.json`);
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setDataMessage("Export downloaded.");
    } catch (error) {
      setDataMessage(error instanceof Error ? error.message : "Export failed");
    } finally {
      setExportingData(false);
    }
  };

  const handleEditBranch = (branch: Branch) => {
    setEditingBranchId(branch.id);
    setEditingBranchName(branch.name);
    setBranchError(null);
  };

  const handleSaveBranch = async () => {
    if (!editingBranchId || !editingBranchName.trim()) {
      setBranchError("Branch name cannot be empty");
      return;
    }
    setBranchSaving(true);
    setBranchError(null);
    try {
      const updated = await updateBranch(editingBranchId, { name: editingBranchName.trim() });
      setBranches((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
      setEditingBranchId(null);
      setEditingBranchName("");
      // Notify other components that branches changed
      window.dispatchEvent(new CustomEvent("branchesChanged"));
    } catch (error) {
      setBranchError(error instanceof Error ? error.message : "Failed to update branch");
    } finally {
      setBranchSaving(false);
    }
  };

  const handleCancelEditBranch = () => {
    setEditingBranchId(null);
    setEditingBranchName("");
    setBranchError(null);
  };

  const handleDeleteBranch = async (branch: Branch) => {
    if (branches.length <= 1) {
      setBranchError("Cannot delete the last branch");
      return;
    }
    
    if (!confirm(`Are you sure you want to delete "${branch.name}"? This cannot be undone.`)) {
      return;
    }
    
    setBranchSaving(true);
    setBranchError(null);
    try {
      await deleteBranch(branch.id);
      setBranches((prev) => prev.filter((b) => b.id !== branch.id));
      // Notify other components that branches changed
      window.dispatchEvent(new CustomEvent("branchesChanged"));
    } catch (error) {
      setBranchError(error instanceof Error ? error.message : "Failed to delete branch");
    } finally {
      setBranchSaving(false);
    }
  };

  const handlePickImportFile = () => {
    setDataMessage(null);
    importFileRef.current?.click();
  };

  const handleImportFileSelected = async (file: File | null) => {
    if (!file) return;
    setDataMessage(null);
    setImportingData(true);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;

      // First attempt without force.
      try {
        const result = await importData(parsed, false);
        setDataMessage(result.message || "Import completed");
        return;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.startsWith("409:")) {
          const ok = confirm(
            "Existing data found. Do you want to replace your current data with this import? (This will clear existing products, movements, sales and creditors.)\n\nTip: Use the JSON export for backups you want to import later."
          );
          if (!ok) {
            setDataMessage("Import cancelled.");
            return;
          }
          const result = await importData(parsed, true);
          setDataMessage(result.message || "Import completed");
          return;
        }
        throw e;
      }
    } catch (error) {
      setDataMessage(error instanceof Error ? error.message : "Import failed");
    } finally {
      setImportingData(false);
      if (importFileRef.current) importFileRef.current.value = "";
    }
  };

  return (
    <div className="app-shell">
      <input
        ref={importFileRef}
        type="file"
        accept="application/json,.json"
        style={{ display: "none" }}
        onChange={(e) => handleImportFileSelected(e.target.files?.[0] ?? null)}
      />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>Profile & Settings</h1>
        {editing ? (
          <div style={{ display: "flex", gap: 12 }}>
            <button
              onClick={() => setEditing(false)}
              style={{
                padding: "10px 20px",
                background: "transparent",
                border: "1px solid #d1d5db",
                borderRadius: 8,
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="button"
              style={{ background: "#10b981" }}
            >
              Save Changes
            </button>
          </div>
        ) : (
          <button
            onClick={() => setEditing(true)}
            className="button"
            style={{ background: "#1f7aff" }}
          >
            Edit Profile
          </button>
        )}
      </div>

      {saved && (
        <div
          style={{
            padding: 16,
            background: "#d1fae5",
            border: "1px solid #10b981",
            borderRadius: 8,
            marginBottom: 16,
            color: "#065f46",
            fontWeight: 500,
          }}
        >
          Settings saved successfully!
        </div>
      )}

      {dataMessage && (
        <div
          style={{
            padding: 12,
            borderRadius: 8,
            marginBottom: 16,
            background: "#f3f4f6",
            border: "1px solid #e5e7eb",
            color: "#374151",
          }}
        >
          {dataMessage}
        </div>
      )}

      {/* Tabs */}
      <div
        style={{
          display: "flex",
          gap: 8,
          borderBottom: "2px solid #e6e9f2",
          marginBottom: 24,
        }}
      >
        {[
          { id: "business", label: "Business Info", icon: "", adminOnly: true },
          { id: "user", label: "User Account", icon: "" },
          { id: "system", label: "System Settings", icon: "", adminOnly: true },
        ]
          .filter((tab) => !tab.adminOnly || isAdmin)
          .map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as typeof activeTab)}
            style={{
              padding: "12px 24px",
              background: "transparent",
              border: "none",
              borderBottom:
                activeTab === tab.id ? "3px solid #1f7aff" : "3px solid transparent",
              color: activeTab === tab.id ? "#1f7aff" : "#6b7280",
              fontWeight: activeTab === tab.id ? 600 : 500,
              cursor: "pointer",
              fontSize: 15,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span>{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Business Info Tab */}
      {activeTab === "business" && (
        <div className="card">
          <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 20, color: "#1a2235" }}>
            Business Information
          </h2>
          <div style={{ display: "grid", gap: 20 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: "#374151" }}>
                  Business Name *
                </span>
                <input
                  type="text"
                  value={businessInfo.name}
                  onChange={(e) => setBusinessInfo({ ...businessInfo, name: e.target.value })}
                  disabled={!editing}
                  className="input"
                  style={{ backgroundColor: editing ? "white" : "#f9fafb" }}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: "#374151" }}>
                  Owner Name
                </span>
                <input
                  type="text"
                  value={businessInfo.owner}
                  onChange={(e) => setBusinessInfo({ ...businessInfo, owner: e.target.value })}
                  disabled={!editing}
                  className="input"
                  style={{ backgroundColor: editing ? "white" : "#f9fafb" }}
                />
              </label>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: "#374151" }}>
                  Phone Number
                </span>
                <input
                  type="tel"
                  value={businessInfo.phone}
                  onChange={(e) => setBusinessInfo({ ...businessInfo, phone: e.target.value })}
                  disabled={!editing}
                  className="input"
                  placeholder="+233 XXX XXX XXX"
                  style={{ backgroundColor: editing ? "white" : "#f9fafb" }}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: "#374151" }}>
                  Email Address
                </span>
                <input
                  type="email"
                  value={businessInfo.email}
                  onChange={(e) => setBusinessInfo({ ...businessInfo, email: e.target.value })}
                  disabled={!editing}
                  className="input"
                  placeholder="business@example.com"
                  style={{ backgroundColor: editing ? "white" : "#f9fafb" }}
                />
              </label>
            </div>

            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: "#374151" }}>
                Business Address
              </span>
              <textarea
                value={businessInfo.address}
                onChange={(e) => setBusinessInfo({ ...businessInfo, address: e.target.value })}
                disabled={!editing}
                className="input"
                rows={3}
                placeholder="Street address, city, region"
                style={{ backgroundColor: editing ? "white" : "#f9fafb", resize: "vertical" }}
              />
            </label>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: "#374151" }}>
                  Tax ID / TIN
                </span>
                <input
                  type="text"
                  value={businessInfo.taxId}
                  onChange={(e) => setBusinessInfo({ ...businessInfo, taxId: e.target.value })}
                  disabled={!editing}
                  className="input"
                  placeholder="Tax identification number"
                  style={{ backgroundColor: editing ? "white" : "#f9fafb" }}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: "#374151" }}>
                  Currency
                </span>
                <select
                  value={businessInfo.currency}
                  onChange={(e) => setBusinessInfo({ ...businessInfo, currency: e.target.value })}
                  disabled={!editing}
                  className="input"
                  style={{ backgroundColor: editing ? "white" : "#f9fafb" }}
                >
                  <option value="GHS">GHS (₵) - Ghana Cedi</option>
                  <option value="USD">USD ($) - US Dollar</option>
                  <option value="EUR">EUR (€) - Euro</option>
                  <option value="GBP">GBP (£) - British Pound</option>
                </select>
              </label>
            </div>
          </div>
        </div>
      )}

      {/* User Account Tab */}
      {activeTab === "user" && (
        <div className="card">
          <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 20, color: "#1a2235" }}>
            User Account Information
          </h2>
          <div style={{ display: "grid", gap: 20 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: "#374151" }}>
                  Full Name *
                </span>
                <input
                  type="text"
                  value={userInfo.name}
                  onChange={(e) => setUserInfo({ ...userInfo, name: e.target.value })}
                  disabled={!editing}
                  className="input"
                  style={{ backgroundColor: editing ? "white" : "#f9fafb" }}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: "#374151" }}>
                  Role
                </span>
                <input
                  type="text"
                  value={userInfo.role}
                  disabled
                  className="input"
                  style={{ backgroundColor: "#f9fafb" }}
                />
                <small style={{ fontSize: 12, color: "#6b7280" }}>
                  Contact administrator to change role
                </small>
              </label>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: "#374151" }}>
                  Email Address
                </span>
                <input
                  type="email"
                  value={userInfo.email}
                  onChange={(e) => setUserInfo({ ...userInfo, email: e.target.value })}
                  disabled={!editing}
                  className="input"
                  placeholder="user@example.com"
                  style={{ backgroundColor: editing ? "white" : "#f9fafb" }}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: "#374151" }}>
                  Phone Number
                </span>
                <input
                  type="tel"
                  value={userInfo.phone}
                  onChange={(e) => setUserInfo({ ...userInfo, phone: e.target.value })}
                  disabled={!editing}
                  className="input"
                  placeholder="+233 XXX XXX XXX"
                  style={{ backgroundColor: editing ? "white" : "#f9fafb" }}
                />
              </label>
            </div>

            <div
              style={{
                padding: 16,
                background: "#f9fafb",
                borderRadius: 8,
                border: "1px solid #e5e7eb",
                marginTop: 12,
              }}
            >
              <h3 style={{ fontSize: 15, fontWeight: 600, margin: "0 0 8px", color: "#374151" }}>
                Change Password
              </h3>
              <p style={{ margin: "0 0 12px", fontSize: 13, color: "#6b7280" }}>
                Update your password to keep your account secure
              </p>
              <button
                className="button"
                style={{
                  background: "#6b7280",
                  fontSize: 14,
                  padding: "8px 16px",
                }}
                onClick={openChangePassword}
              >
                Change Password
              </button>
            </div>
          </div>
        </div>
      )}

      {showChangePassword && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 50,
            padding: 16,
          }}
          onClick={() => (changingPassword ? null : setShowChangePassword(false))}
        >
          <div
            className="card"
            style={{ width: 520, maxWidth: "100%" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 12px", color: "#1a2235" }}>
              Change Password
            </h2>

            {changePasswordError && (
              <div
                style={{
                  padding: 12,
                  background: "#fee2e2",
                  border: "1px solid #ef4444",
                  borderRadius: 8,
                  marginBottom: 12,
                  color: "#991b1b",
                  fontWeight: 500,
                  fontSize: 13,
                }}
              >
                {changePasswordError}
              </div>
            )}

            <div style={{ display: "grid", gap: 14 }}>
              <PasswordInput
                label="Current Password"
                value={currentPassword}
                onChange={setCurrentPassword}
                autoComplete="current-password"
              />
              <PasswordInput
                label="New Password"
                value={newPassword}
                onChange={setNewPassword}
                autoComplete="new-password"
              />
              <PasswordInput
                label="Confirm New Password"
                value={confirmPassword}
                onChange={setConfirmPassword}
                autoComplete="new-password"
              />

              <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>
                Must be 8+ characters and include uppercase, lowercase, number, and special character.
              </p>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, marginTop: 6 }}>
                <button
                  type="button"
                  onClick={() => setShowChangePassword(false)}
                  style={{
                    padding: "10px 20px",
                    background: "transparent",
                    border: "1px solid #d1d5db",
                    borderRadius: 8,
                    cursor: changingPassword ? "not-allowed" : "pointer",
                    fontWeight: 600,
                    opacity: changingPassword ? 0.6 : 1,
                  }}
                  disabled={changingPassword}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={submitChangePassword}
                  className="button"
                  style={{ background: "#1f7aff" }}
                  disabled={changingPassword}
                >
                  {changingPassword ? "Updating..." : "Update Password"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* System Settings Tab */}
      {activeTab === "system" && (
        <div className="card">
          <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 20, color: "#1a2235" }}>
            System Settings
          </h2>
          <div style={{ display: "grid", gap: 24 }}>
            {/* Expiry Tracking Toggle */}
            <div>
              <h3 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 16px", color: "#374151" }}>
                Product Features
              </h3>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: 16,
                  background: "#f9fafb",
                  borderRadius: 8,
                  border: "1px solid #e5e7eb",
                  cursor: editing ? "pointer" : "not-allowed",
                }}
              >
                <input
                  type="checkbox"
                  checked={systemSettings.usesExpiryTracking}
                  onChange={(e) =>
                    setSystemSettings({ ...systemSettings, usesExpiryTracking: e.target.checked })
                  }
                  disabled={!editing}
                  style={{ width: 18, height: 18, cursor: editing ? "pointer" : "not-allowed" }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#374151" }}>
                    Enable Expiry Date Tracking
                  </div>
                  <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
                    Track expiry dates for perishable goods like food, medicine, or cosmetics
                  </div>
                </div>
              </label>
            </div>

            <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: 24 }}>
              <h3 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 16px", color: "#374151" }}>
                Inventory Alerts
              </h3>
              <div style={{ display: "grid", gridTemplateColumns: systemSettings.usesExpiryTracking ? "1fr 1fr" : "1fr", gap: 16 }}>
                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: "#374151" }}>
                    Low Stock Threshold
                  </span>
                  <input
                    type="number"
                    value={systemSettings.lowStockThreshold}
                    onChange={(e) =>
                      setSystemSettings({ ...systemSettings, lowStockThreshold: e.target.value })
                    }
                    disabled={!editing}
                    className="input"
                    min="0"
                    style={{ backgroundColor: editing ? "white" : "#f9fafb" }}
                  />
                  <small style={{ fontSize: 12, color: "#6b7280" }}>
                    Alert when stock falls below this number
                  </small>
                </label>
                {systemSettings.usesExpiryTracking && (
                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: "#374151" }}>
                    Expiry Warning (Days)
                  </span>
                  <input
                    type="number"
                    value={systemSettings.expiryWarningDays}
                    onChange={(e) =>
                      setSystemSettings({ ...systemSettings, expiryWarningDays: e.target.value })
                    }
                    disabled={!editing}
                    className="input"
                    min="0"
                    style={{ backgroundColor: editing ? "white" : "#f9fafb" }}
                  />
                  <small style={{ fontSize: 12, color: "#6b7280" }}>
                    Alert when products expire within this many days
                  </small>
                </label>
                )}
              </div>
            </div>

            <div
              style={{
                borderTop: "1px solid #e5e7eb",
                paddingTop: 24,
              }}
            >
              <h3 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 16px", color: "#374151" }}>
                Notifications & Backups
              </h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: 16,
                    background: "#f9fafb",
                    borderRadius: 8,
                    border: "1px solid #e5e7eb",
                    cursor: editing ? "pointer" : "not-allowed",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={systemSettings.autoBackup}
                    onChange={(e) =>
                      setSystemSettings({ ...systemSettings, autoBackup: e.target.checked })
                    }
                    disabled={!editing}
                    style={{ width: 18, height: 18, cursor: editing ? "pointer" : "not-allowed" }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#374151" }}>
                      Enable Automatic Backups
                    </div>
                    <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
                      Automatically backup database daily at midnight
                    </div>
                  </div>
                </label>

                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: 16,
                    background: "#f9fafb",
                    borderRadius: 8,
                    border: "1px solid #e5e7eb",
                    cursor: editing ? "pointer" : "not-allowed",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={systemSettings.emailNotifications}
                    onChange={(e) =>
                      setSystemSettings({ ...systemSettings, emailNotifications: e.target.checked })
                    }
                    disabled={!editing}
                    style={{ width: 18, height: 18, cursor: editing ? "pointer" : "not-allowed" }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#374151" }}>
                      Email Notifications
                    </div>
                    <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
                      Receive email alerts for low stock and expiring products
                    </div>
                  </div>
                </label>
              </div>
            </div>

            {/* Branch Management */}
            {branches.length > 0 && (
              <div
                style={{
                  borderTop: "1px solid #e5e7eb",
                  paddingTop: 24,
                }}
              >
                <h3 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 16px", color: "#374151" }}>
                  Branch Management
                </h3>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {branches.map((branch) => (
                    <div
                      key={branch.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: 16,
                        background: "#f9fafb",
                        borderRadius: 8,
                        border: "1px solid #e5e7eb",
                      }}
                    >
                      {editingBranchId === branch.id ? (
                        <>
                          <input
                            type="text"
                            value={editingBranchName}
                            onChange={(e) => setEditingBranchName(e.target.value)}
                            className="input"
                            style={{ flex: 1 }}
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleSaveBranch();
                              if (e.key === "Escape") handleCancelEditBranch();
                            }}
                          />
                          <button
                            className="button"
                            style={{ background: "#10b981", fontSize: 13, padding: "8px 16px" }}
                            onClick={handleSaveBranch}
                            disabled={branchSaving}
                          >
                            {branchSaving ? "Saving..." : "Save"}
                          </button>
                          <button
                            className="button"
                            style={{ background: "#6b7280", fontSize: 13, padding: "8px 16px" }}
                            onClick={handleCancelEditBranch}
                            disabled={branchSaving}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 14, fontWeight: 600, color: "#374151" }}>
                              {branch.name}
                            </div>
                            <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
                              Branch ID: {branch.id}
                            </div>
                          </div>
                          <div style={{ display: "flex", gap: 8 }}>
                            <button
                              className="button"
                              style={{ background: "#3b82f6", fontSize: 13, padding: "8px 16px" }}
                              onClick={() => handleEditBranch(branch)}
                            >
                              Edit
                            </button>
                            {branches.length > 1 && (
                              <button
                                className="button"
                                style={{ background: "#ef4444", fontSize: 13, padding: "8px 16px" }}
                                onClick={() => handleDeleteBranch(branch)}
                                disabled={branchSaving}
                              >
                                Delete
                              </button>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                  {branchError && (
                    <div style={{ color: "#ef4444", fontSize: 13, marginTop: 4 }}>
                      {branchError}
                    </div>
                  )}
                </div>
              </div>
            )}

            <div
              style={{
                borderTop: "1px solid #e5e7eb",
                paddingTop: 24,
              }}
            >
              <h3 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 16px", color: "#374151" }}>
                Data Management
              </h3>
              <div style={{ display: "flex", gap: 12 }}>
                <button
                  className="button"
                  style={{
                    background: "#10b981",
                    fontSize: 14,
                  }}
                  onClick={handleExportData}
                  disabled={exportingData || importingData}
                >
                  {exportingData ? "⏳ Exporting..." : "📥 Export Data"}
                </button>
                <button
                  className="button"
                  style={{
                    background: "#8246ff",
                    fontSize: 14,
                  }}
                  onClick={handlePickImportFile}
                  disabled={exportingData || importingData}
                >
                  {importingData ? "⏳ Importing..." : "📤 Import Data"}
                </button>
                <button
                  className="button"
                  style={{
                    background: "#ef4444",
                    fontSize: 14,
                  }}
                  onClick={() => {
                    if (confirm("Are you sure you want to clear all data? This cannot be undone!")) {
                      // Clear data logic here
                    }
                  }}
                >
                  Clear All Data
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
