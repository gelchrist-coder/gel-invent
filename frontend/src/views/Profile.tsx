import { useEffect, useMemo, useRef, useState } from "react";

import { changePassword, clearAllData, clearClientOperationalData, convertBusinessCurrency, deleteBranch, deleteMyAccount, exportData, exportDataXlsx, fetchBranches, fetchSystemSettings, importData, TaxLine, updateBranch, updateBusinessLogo, updateMyBusinessProfile, updateSystemSettings } from "../api";
import { Branch } from "../types";
import { getStoredBusinessLogo, hasUserPermission, readStoredUser, setStoredBusinessLogo } from "../user-storage";

// Downscale + compress an uploaded image to a small square-ish data URL so it
// stays light enough to store and to embed in printed receipts.
//
// Loads via an object URL rather than FileReader.readAsDataURL: object URLs
// don't read the whole file into memory as base64, so they handle large images
// and mobile photos (incl. not-yet-downloaded iCloud photos) far more reliably.
function compressImageToDataUrl(file: File, maxSize = 240): Promise<string> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    const cleanup = () => URL.revokeObjectURL(objectUrl);

    img.onerror = () => {
      cleanup();
      reject(new Error("Couldn't read that image. Please pick a PNG or JPG (a screenshot works too)."));
    };

    img.onload = () => {
      try {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Image processing is not supported on this device."));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        // PNG preserves logos with transparency; fine for photos too.
        resolve(canvas.toDataURL("image/png"));
      } catch (error) {
        reject(error instanceof Error ? error : new Error("Could not process the image."));
      } finally {
        cleanup();
      }
    };

    img.src = objectUrl;
  });
}

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
  const currentUserData = readStoredUser();
  const canManageBranches = hasUserPermission("manage_branches", currentUserData);
  const canManageBusinessProfile = hasUserPermission("manage_business_profile", currentUserData);
  const canManageSettings = hasUserPermission("manage_settings", currentUserData);
  const canManageData = hasUserPermission("manage_data", currentUserData);
  const canAccessSystemTab = canManageSettings || canManageData;

  const [activeTab, setActiveTab] = useState<"business" | "user" | "system">(
    canManageBusinessProfile ? "business" : canAccessSystemTab ? "system" : "user",
  );
  const [businessInfo, setBusinessInfo] = useState({
    name: currentUserData?.business_name || "Gel Invent Business",
    owner: currentUserData?.name || "Gel Christ Boateng",
    phone: currentUserData?.phone || "",
    email: currentUserData?.email || "",
    address: "",
    taxId: "",
    currency: "GHS",
  });

  const [userInfo, setUserInfo] = useState({
    name: currentUserData?.name || "Admin User",
    email: currentUserData?.email || "",
    phone: currentUserData?.phone || "",
    role: currentUserData?.role || "Admin",
  });

  const [systemSettings, setSystemSettings] = useState({
    lowStockThreshold: "10",
    expiryWarningDays: "45",
    currencyCode: "GHS",
    autoBackup: true,
    emailNotifications: false,
  });
  const [taxes, setTaxes] = useState<TaxLine[]>([]);

  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);

  const [businessLogo, setBusinessLogo] = useState<string | null>(() => getStoredBusinessLogo());
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement | null>(null);

  const handleLogoFile = async (file: File | null) => {
    if (!file) return;
    setLogoError(null);
    // Some mobile browsers report an empty type for a valid photo, so only
    // reject when a non-image type is explicitly given; otherwise let the
    // image decoder validate it.
    if (file.type && !file.type.startsWith("image/")) {
      setLogoError("Please choose an image file (PNG or JPG).");
      return;
    }
    setLogoBusy(true);
    try {
      const dataUrl = await compressImageToDataUrl(file);
      const saved = await updateBusinessLogo(dataUrl);
      setStoredBusinessLogo(saved);
      setBusinessLogo(saved);
    } catch (error) {
      setLogoError(error instanceof Error ? error.message : "Could not upload the logo.");
    } finally {
      setLogoBusy(false);
      if (logoInputRef.current) logoInputRef.current.value = "";
    }
  };

  const handleRemoveLogo = async () => {
    setLogoError(null);
    setLogoBusy(true);
    try {
      await updateBusinessLogo(null);
      setStoredBusinessLogo(null);
      setBusinessLogo(null);
    } catch (error) {
      setLogoError(error instanceof Error ? error.message : "Could not remove the logo.");
    } finally {
      setLogoBusy(false);
    }
  };

  const [showChangePassword, setShowChangePassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changePasswordError, setChangePasswordError] = useState<string | null>(null);
  const [changingPassword, setChangingPassword] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deleteAccountError, setDeleteAccountError] = useState<string | null>(null);

  const importFileRef = useRef<HTMLInputElement | null>(null);
  const [exportingData, setExportingData] = useState(false);
  const [importingData, setImportingData] = useState(false);
  const [clearingData, setClearingData] = useState(false);
  const [dataMessage, setDataMessage] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);

  // Branch management state
  const [branches, setBranches] = useState<Branch[]>([]);
  const [editingBranchId, setEditingBranchId] = useState<number | null>(null);
  const [editingBranchName, setEditingBranchName] = useState("");
  const [branchSaving, setBranchSaving] = useState(false);
  const [branchError, setBranchError] = useState<string | null>(null);

  const managedBranches = useMemo(() => branches, [branches]);

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
          phone: String(parsedUser.phone ?? ""),
          role: String(parsedUser.role ?? "Admin"),
        });
        setBusinessInfo((prev) => ({
          ...prev,
          name: String(parsedUser.business_name ?? prev.name),
          owner: String(parsedUser.name ?? prev.owner),
          phone: prev.phone || String(parsedUser.phone ?? ""),
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
          currencyCode: String(settings.currency_code || "GHS"),
          autoBackup: settings.auto_backup,
          emailNotifications: settings.email_notifications,
        });
        setTaxes(Array.isArray(settings.taxes) ? settings.taxes : []);
        setBusinessInfo((prev) => ({
          ...prev,
          currency: String(settings.currency_code || prev.currency || "GHS"),
        }));
      } catch {
        // If unauthenticated or API unavailable, keep defaults.
      }

      if (canManageBranches) {
        try {
          const branchData = await fetchBranches();
          setBranches(branchData);
        } catch {
          // Branches optional
        }
      }
    })();
  }, [canManageBranches]);

  useEffect(() => {
    if (activeTab === "business" && !canManageBusinessProfile) {
      setActiveTab(canAccessSystemTab ? "system" : "user");
      return;
    }

    if (activeTab === "system" && !canAccessSystemTab) {
      setActiveTab(canManageBusinessProfile ? "business" : "user");
    }
  }, [activeTab, canAccessSystemTab, canManageBusinessProfile]);

  const handleSave = async () => {
    setDataMessage(null);
    setSavingProfile(true);

    try {
      const nextBusinessInfo = {
        ...businessInfo,
        name: businessInfo.name.trim() || "Gel Invent Business",
        owner: businessInfo.owner.trim() || userInfo.name || "Admin User",
        phone: businessInfo.phone.trim(),
        email: businessInfo.email.trim(),
        address: businessInfo.address.trim(),
        taxId: businessInfo.taxId.trim(),
        currency: (businessInfo.currency || "GHS").toUpperCase(),
      };

      if (canManageBusinessProfile) {
        await updateMyBusinessProfile({
          business_name: nextBusinessInfo.name,
        });
      }

      localStorage.setItem("businessInfo", JSON.stringify(nextBusinessInfo));
      localStorage.setItem("userInfo", JSON.stringify(userInfo));
      window.dispatchEvent(new CustomEvent("businessInfoChanged", { detail: nextBusinessInfo }));
      setBusinessInfo(nextBusinessInfo);

      if (canManageSettings) {
        const selectedCurrency = nextBusinessInfo.currency;
        const previousCurrency = (systemSettings.currencyCode || "GHS").toUpperCase();

        const payload = {
          low_stock_threshold: Number(systemSettings.lowStockThreshold) || 0,
          expiry_warning_days: Number(systemSettings.expiryWarningDays) || 0,
          uses_expiry_tracking: true,
          currency_code: selectedCurrency,
          auto_backup: systemSettings.autoBackup,
          email_notifications: systemSettings.emailNotifications,
          taxes: taxes
            .map((t) => ({ name: t.name.trim(), rate: Number(t.rate) || 0, enabled: !!t.enabled }))
            .filter((t) => t.name.length > 0),
        };
        const updated = await updateSystemSettings(payload);

        let conversionMessage = "";
        if (selectedCurrency !== previousCurrency) {
          const convertExisting = confirm(
            `Convert existing prices and amounts from ${previousCurrency} to ${selectedCurrency} using live exchange rate?\n\nChoose OK to convert all existing records. Choose Cancel if you are just starting the business in ${selectedCurrency}.`
          );

          const result = await convertBusinessCurrency({
            target_currency: selectedCurrency,
            convert_existing: convertExisting,
          });

          conversionMessage = convertExisting
            ? ` Currency converted using live rate ${result.previous_currency}->${result.currency_code} (${result.conversion_rate.toFixed(4)}).`
            : ` Currency switched to ${result.currency_code} without converting existing records.`;
        }

        setSystemSettings({
          lowStockThreshold: String(updated.low_stock_threshold),
          expiryWarningDays: String(updated.expiry_warning_days),
          currencyCode: String(updated.currency_code || selectedCurrency),
          autoBackup: updated.auto_backup,
          emailNotifications: updated.email_notifications,
        });
        setTaxes(Array.isArray(updated.taxes) ? updated.taxes : []);

        window.dispatchEvent(new CustomEvent("systemSettingsChanged", { detail: updated }));
        if (conversionMessage) {
          setDataMessage(`Settings saved.${conversionMessage}`);
        }
      }

      setEditing(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (error) {
      setDataMessage(error instanceof Error ? error.message : "Failed to save profile");
    } finally {
      setSavingProfile(false);
    }
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

  const handleDeleteAccount = async () => {
    if (deletingAccount) return;
    setDeleteAccountError(null);

    const confirmed = confirm(
      "Delete your account permanently? This will remove your account and all related data. This action cannot be undone."
    );
    if (!confirmed) return;

    const typed = prompt('Type DELETE to confirm account deletion:');
    if (typed !== "DELETE") {
      setDeleteAccountError("Account deletion cancelled. Confirmation text did not match.");
      return;
    }

    const password = prompt("Enter your current password to continue:");
    if (!password) {
      setDeleteAccountError("Account deletion cancelled. Password is required.");
      return;
    }

    setDeletingAccount(true);
    try {
      await deleteMyAccount({ current_password: password });
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      localStorage.removeItem("activeBranchId");
      window.dispatchEvent(new CustomEvent("userChanged", { detail: null }));
    } catch (error) {
      setDeleteAccountError(error instanceof Error ? error.message : "Failed to delete account");
    } finally {
      setDeletingAccount(false);
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

  const handleClearAllData = async () => {
    const confirmed = confirm(
      "Reset the entire application database? This permanently deletes users, branches, products, suppliers, purchases, sales, settings, returns, creditors, and cached offline app data. All IDs will restart from 1."
    );
    if (!confirmed) {
      return;
    }

    const typed = prompt("Type CLEAR to confirm this data wipe:");
    if (typed !== "CLEAR") {
      setDataMessage("Clear data cancelled.");
      return;
    }

    setDataMessage(null);
    setClearingData(true);
    let didResetDatabase = false;
    try {
      const result = await clearAllData();
      didResetDatabase = true;
      window.alert(`${result.message} You will be signed out now. Create a new account to start again from ID 1.`);
      await clearClientOperationalData();
      return;
    } catch (error) {
      setDataMessage(error instanceof Error ? error.message : "Failed to clear data");
    } finally {
      if (!didResetDatabase) {
        setClearingData(false);
      }
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
        <h1 className="page-title" style={{ margin: 0 }}>Profile & Settings</h1>
        {editing ? (
          <div style={{ display: "flex", gap: 12 }}>
            <button
              onClick={() => setEditing(false)}
              disabled={savingProfile}
              style={{
                padding: "10px 20px",
                background: "transparent",
                border: "1px solid #d1d5db",
                borderRadius: 8,
                cursor: savingProfile ? "not-allowed" : "pointer",
                fontWeight: 600,
                opacity: savingProfile ? 0.7 : 1,
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="button"
              disabled={savingProfile}
              style={{
                background: "#10b981",
                opacity: savingProfile ? 0.7 : 1,
                cursor: savingProfile ? "not-allowed" : "pointer",
              }}
            >
              {savingProfile ? "Saving..." : "Save Changes"}
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
          { id: "business", label: "Business Info", icon: "", hidden: !canManageBusinessProfile },
          { id: "user", label: "User Account", icon: "" },
          { id: "system", label: "System Settings", icon: "", hidden: !canAccessSystemTab },
        ]
          .filter((tab) => !tab.hidden)
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
            {/* Business logo — shows on the header and printed receipts. */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 16,
                flexWrap: "wrap",
                padding: 16,
                border: "1px solid #e5e7eb",
                borderRadius: 12,
                background: "#f9fafb",
              }}
            >
              <div
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: 14,
                  background: "#fff",
                  border: "1px solid #e5e7eb",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  overflow: "hidden",
                  flexShrink: 0,
                }}
              >
                {businessLogo ? (
                  <img src={businessLogo} alt="Business logo" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                  <span style={{ fontSize: 26, fontWeight: 800, color: "#1e3a8a" }}>
                    {(businessInfo.name || "B").charAt(0).toUpperCase()}
                  </span>
                )}
              </div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#374151" }}>Business Logo</div>
                <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
                  Shown on the app header and on printed receipts. Square PNG/JPG works best.
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="button"
                    disabled={logoBusy}
                    onClick={() => logoInputRef.current?.click()}
                    style={{ background: "#1f7aff", fontSize: 13, padding: "8px 14px", opacity: logoBusy ? 0.6 : 1 }}
                  >
                    {logoBusy ? "Saving..." : businessLogo ? "Change Logo" : "Upload Logo"}
                  </button>
                  {businessLogo && (
                    <button
                      type="button"
                      className="button"
                      disabled={logoBusy}
                      onClick={handleRemoveLogo}
                      style={{ background: "#ef4444", fontSize: 13, padding: "8px 14px", opacity: logoBusy ? 0.6 : 1 }}
                    >
                      Remove
                    </button>
                  )}
                  <input
                    ref={logoInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(e) => void handleLogoFile(e.target.files?.[0] ?? null)}
                    style={{ display: "none" }}
                  />
                </div>
                {logoError && (
                  <div style={{ marginTop: 8, fontSize: 12, color: "#b91c1c" }}>{logoError}</div>
                )}
              </div>
            </div>

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

            <div
              style={{
                padding: 16,
                background: "#fef2f2",
                borderRadius: 8,
                border: "1px solid #fecaca",
                marginTop: 12,
              }}
            >
              <h3 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 8px", color: "#991b1b" }}>
                Danger Zone
              </h3>
              <p style={{ margin: "0 0 12px", fontSize: 13, color: "#b91c1c" }}>
                Permanently delete this account and all associated business data.
              </p>
              <button
                className="button"
                style={{
                  background: deletingAccount ? "#fca5a5" : "#ef4444",
                  fontSize: 14,
                  padding: "8px 16px",
                  cursor: deletingAccount ? "not-allowed" : "pointer",
                }}
                onClick={handleDeleteAccount}
                disabled={deletingAccount}
              >
                {deletingAccount ? "Deleting..." : "Delete Account"}
              </button>
              {deleteAccountError ? (
                <p style={{ margin: "10px 0 0", fontSize: 12, color: "#991b1b", fontWeight: 600 }}>
                  {deleteAccountError}
                </p>
              ) : null}
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
            <div>
              <h3 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 16px", color: "#374151" }}>
                Inventory Alerts
              </h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
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
                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: "#374151" }}>
                    Expiry Warning Days
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
                    Mark products as expiring when within this many days
                  </small>
                </label>
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

            {/* Taxes & Levies */}
            <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: 24 }}>
              <h3 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 6px", color: "#374151" }}>
                Taxes &amp; Levies
              </h3>
              <p style={{ fontSize: 12, color: "#6b7280", margin: "0 0 16px" }}>
                Prices are treated as tax-inclusive — the total a customer pays never changes.
                Enabled taxes are shown as a breakdown on the receipt.
              </p>

              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {taxes.map((tax, index) => (
                  <div
                    key={index}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: 12,
                      background: "#f9fafb",
                      border: "1px solid #e5e7eb",
                      borderRadius: 8,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={tax.enabled}
                      disabled={!editing}
                      onChange={(e) =>
                        setTaxes((prev) => prev.map((t, i) => (i === index ? { ...t, enabled: e.target.checked } : t)))
                      }
                      style={{ width: 18, height: 18, cursor: editing ? "pointer" : "not-allowed", flexShrink: 0 }}
                      title="Enable this tax"
                    />
                    <input
                      type="text"
                      value={tax.name}
                      disabled={!editing}
                      placeholder="Tax name"
                      onChange={(e) =>
                        setTaxes((prev) => prev.map((t, i) => (i === index ? { ...t, name: e.target.value } : t)))
                      }
                      style={{
                        flex: 1,
                        minWidth: 0,
                        padding: "8px 10px",
                        border: "1px solid #d1d5db",
                        borderRadius: 6,
                        fontSize: 14,
                        background: editing ? "#fff" : "#f3f4f6",
                        color: tax.enabled ? "#111827" : "#6b7280",
                      }}
                    />
                    <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                      <input
                        type="number"
                        value={tax.rate}
                        disabled={!editing}
                        min={0}
                        max={100}
                        step={0.5}
                        onChange={(e) =>
                          setTaxes((prev) => prev.map((t, i) => (i === index ? { ...t, rate: Number(e.target.value) } : t)))
                        }
                        style={{
                          width: 74,
                          padding: "8px 10px",
                          border: "1px solid #d1d5db",
                          borderRadius: 6,
                          fontSize: 14,
                          textAlign: "right",
                          background: editing ? "#fff" : "#f3f4f6",
                        }}
                      />
                      <span style={{ fontSize: 14, color: "#6b7280" }}>%</span>
                    </div>
                    {editing && (
                      <button
                        type="button"
                        onClick={() => setTaxes((prev) => prev.filter((_, i) => i !== index))}
                        style={{
                          border: "none",
                          background: "transparent",
                          color: "#ef4444",
                          cursor: "pointer",
                          fontSize: 20,
                          lineHeight: 1,
                          padding: "0 4px",
                          flexShrink: 0,
                        }}
                        aria-label="Remove tax"
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
                {taxes.length === 0 && (
                  <p style={{ fontSize: 13, color: "#9ca3af", margin: 0 }}>No taxes configured.</p>
                )}
              </div>

              {editing && (
                <button
                  type="button"
                  onClick={() => setTaxes((prev) => [...prev, { name: "", rate: 0, enabled: true }])}
                  style={{
                    marginTop: 12,
                    padding: "8px 14px",
                    border: "1px dashed #9ca3af",
                    background: "#fff",
                    borderRadius: 8,
                    fontSize: 13,
                    fontWeight: 600,
                    color: "#374151",
                    cursor: "pointer",
                  }}
                >
                  + Add tax / levy
                </button>
              )}
            </div>

            {/* Branch Management */}
            {canManageBranches && (
              <div
                style={{
                  borderTop: "1px solid #e5e7eb",
                  paddingTop: 24,
                }}
              >
                <h3 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 16px", color: "#374151" }}>
                  Branch Management
                </h3>
                {managedBranches.length === 0 ? (
                  <div
                    style={{
                      padding: 14,
                      background: "#f9fafb",
                      border: "1px solid #e5e7eb",
                      borderRadius: 8,
                      color: "#6b7280",
                      fontSize: 14,
                    }}
                  >
                    No extra branches created yet.
                  </div>
                ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {managedBranches.map((branch) => (
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
                )}
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
                  disabled={exportingData || importingData || clearingData}
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
                  disabled={exportingData || importingData || clearingData}
                >
                  {importingData ? "⏳ Importing..." : "📤 Import Data"}
                </button>
                <button
                  className="button"
                  style={{
                    background: "#ef4444",
                    fontSize: 14,
                  }}
                  onClick={handleClearAllData}
                  disabled={exportingData || importingData || clearingData}
                >
                  {clearingData ? "⏳ Clearing..." : "Clear All Data"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
