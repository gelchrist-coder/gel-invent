import { useState } from "react";
import { Link } from "react-router-dom";

import { fetchWithSameOriginApiFallback } from "../../api";
import AuthShell from "./AuthShell";
import {
  ArrowRightIcon,
  AuthMessage,
  AuthResponse,
  AUTH_PRIMARY,
  BUSINESS_TYPE_OPTIONS,
  BuildingIcon,
  FieldLabel,
  IconInput,
  IconPasswordInput,
  MailIcon,
  PhoneIcon,
  PinIcon,
  ShieldIcon,
  UserIcon,
  completeAuthenticatedSession,
  getPasswordRuleError,
  isRecord,
  linkButtonStyle,
  safeJson,
  submitButtonStyle,
  useRecaptcha,
  useWarmBackend,
} from "./authShared";

type SignUpProps = {
  onLogin: (email: string, password: string) => void;
};

export default function SignUp({ onLogin }: SignUpProps) {
  const recaptcha = useRecaptcha(true);
  useWarmBackend();

  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    password: "",
    confirmPassword: "",
    businessName: "",
    businessLocation: "",
    businessTypes: [] as string[],
    hasBranches: false,
    branches: [] as string[],
  });
  const [branchInput, setBranchInput] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);

  const toggleBusinessType = (value: string) => {
    const exists = formData.businessTypes.some((t) => t.toLowerCase() === value.toLowerCase());
    setFormData({
      ...formData,
      businessTypes: exists
        ? formData.businessTypes.filter((t) => t.toLowerCase() !== value.toLowerCase())
        : [...formData.businessTypes, value],
    });
  };

  const addBranch = (raw: string) => {
    const value = raw.trim();
    if (!value) return;
    if (formData.businessLocation.trim().toLowerCase() === value.toLowerCase()) {
      setBranchInput("");
      return;
    }
    if (formData.branches.some((b) => b.toLowerCase() === value.toLowerCase())) return;
    setFormData({ ...formData, branches: [...formData.branches, value] });
    setBranchInput("");
  };

  const removeBranch = (value: string) => {
    setFormData({ ...formData, branches: formData.branches.filter((b) => b !== value) });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setInfo("");
    setLoading(true);

    try {
      if (!formData.name.trim()) {
        setError("Please enter your name");
        setLoading(false);
        return;
      }
      if (!formData.businessName.trim()) {
        setError("Please enter your business name");
        setLoading(false);
        return;
      }
      if (!formData.businessLocation.trim()) {
        setError("Please enter your primary business location");
        setLoading(false);
        return;
      }
      if (formData.businessTypes.length === 0) {
        setError("Please select at least one business type");
        setLoading(false);
        return;
      }
      if (formData.password !== formData.confirmPassword) {
        setError("Passwords do not match");
        setLoading(false);
        return;
      }
      const passwordRuleError = getPasswordRuleError(formData.password);
      if (passwordRuleError) {
        setError(passwordRuleError);
        setLoading(false);
        return;
      }
      if (formData.hasBranches && formData.branches.length === 0) {
        setError("Please add at least one additional branch/location or uncheck 'I have multiple branches'");
        setLoading(false);
        return;
      }
      if (recaptcha.enabled && !recaptcha.token) {
        setError("Please complete the reCAPTCHA checkbox");
        setLoading(false);
        return;
      }

      const signupPayload = {
        email: formData.email.trim(),
        phone: formData.phone.trim() || null,
        name: formData.name.trim(),
        password: formData.password,
        business_name: formData.businessName.trim(),
        business_location: formData.businessLocation.trim(),
        business_types: formData.businessTypes,
        branches: formData.hasBranches ? formData.branches : [],
        ...(recaptcha.enabled ? { recaptcha_token: recaptcha.token } : {}),
      };

      const signupResponse = await fetchWithSameOriginApiFallback("/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(signupPayload),
      });

      if (!signupResponse.ok) {
        const errorData = await safeJson(signupResponse);
        const detail = isRecord(errorData) && typeof errorData.detail === "string" ? errorData.detail : null;
        if (recaptcha.enabled) recaptcha.reset();
        setError(detail || "Signup failed");
        setLoading(false);
        return;
      }

      setInfo("Account created successfully.");
      const signupData = (await signupResponse.json().catch(() => {
        throw new Error(`Server returned non-JSON response (status ${signupResponse.status}). The backend URL may be misconfigured.`);
      })) as AuthResponse;
      await completeAuthenticatedSession(signupData, formData.email.trim(), formData.password, formData.businessName, onLogin);
      setLoading(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[SignUp] Unhandled error:", err);
      if (recaptcha.enabled) recaptcha.reset();
      if (message.includes("Failed to fetch") || message.includes("NetworkError") || message.includes("fetch")) {
        setError("Cannot reach the server. Check your internet connection and try again.");
      } else {
        setError(message || "An unexpected error occurred. Please try again.");
      }
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="Create Account"
      subtitle="Secure your supply chain with professional tools."
      footer={
        <>
          Already have an account?{" "}
          <Link to="/login" style={linkButtonStyle}>
            Sign In
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit}>
        <AuthMessage error={error} info={info} />

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div>
            <FieldLabel>Full Name</FieldLabel>
            <IconInput
              icon={<UserIcon />}
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="John Doe"
              required
              autoComplete="name"
            />
          </div>

          <div>
            <FieldLabel>Business Name</FieldLabel>
            <IconInput
              icon={<BuildingIcon />}
              type="text"
              value={formData.businessName}
              onChange={(e) => setFormData({ ...formData, businessName: e.target.value })}
              placeholder="My Business Ltd"
              required
              autoComplete="organization"
            />
          </div>

          <div>
            <FieldLabel>Primary Business Location</FieldLabel>
            <IconInput
              icon={<PinIcon />}
              type="text"
              value={formData.businessLocation}
              onChange={(e) => setFormData({ ...formData, businessLocation: e.target.value })}
              placeholder="e.g., Accra Main Store"
              required
            />
            <span style={{ display: "block", marginTop: 6, fontSize: 12, color: "#94a3b8" }}>
              This becomes your first branch name.
            </span>
          </div>

          <div>
            <FieldLabel>Phone Number</FieldLabel>
            <IconInput
              icon={<PhoneIcon />}
              type="tel"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              placeholder="e.g., 0241234567"
              autoComplete="tel"
            />
          </div>

          <div>
            <FieldLabel>Business Types</FieldLabel>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
              {BUSINESS_TYPE_OPTIONS.map((businessType) => {
                const isSelected = formData.businessTypes.some((value) => value === businessType);
                return (
                  <button
                    key={businessType}
                    type="button"
                    onClick={() => toggleBusinessType(businessType)}
                    style={{
                      padding: "11px 14px",
                      borderRadius: 10,
                      border: isSelected ? `1px solid ${AUTH_PRIMARY}` : "1px solid #d1d5db",
                      background: isSelected ? "#eff6ff" : "#ffffff",
                      color: isSelected ? AUTH_PRIMARY : "#374151",
                      fontSize: 13.5,
                      fontWeight: 700,
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    {businessType}
                  </button>
                );
              })}
            </div>

            {formData.businessTypes.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                {formData.businessTypes.map((businessType) => (
                  <span
                    key={businessType}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      background: "#eef2ff",
                      border: "1px solid #c7d2fe",
                      color: "#3730a3",
                      padding: "6px 10px",
                      borderRadius: 999,
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    {businessType}
                    <button
                      type="button"
                      onClick={() => toggleBusinessType(businessType)}
                      style={{ border: "none", background: "transparent", cursor: "pointer", color: "#3730a3", fontWeight: 800, lineHeight: 1 }}
                      aria-label={`Remove ${businessType}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Branches */}
          <div style={{ padding: 16, background: "#f8fafc", borderRadius: 10, border: "1px solid #e5e7eb" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={formData.hasBranches}
                onChange={(e) => setFormData({ ...formData, hasBranches: e.target.checked, branches: e.target.checked ? formData.branches : [] })}
                style={{ width: 18, height: 18 }}
              />
              <span style={{ fontSize: 14, fontWeight: 600, color: "#374151" }}>I have multiple branches/locations</span>
            </label>
            <p style={{ margin: "8px 0 0", fontSize: 12, color: "#94a3b8" }}>
              If you have multiple store locations, check this to add them now. You can also add branches later from Settings.
            </p>
          </div>

          {formData.hasBranches && (
            <div>
              <FieldLabel>Branch Names</FieldLabel>
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  type="text"
                  value={branchInput}
                  onChange={(e) => setBranchInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addBranch(branchInput);
                    }
                  }}
                  placeholder="e.g., Main Store, Accra Branch"
                  className="input"
                  style={{ padding: 12, flex: 1, background: "#ffffff" }}
                />
                <button type="button" onClick={() => addBranch(branchInput)} className="button" style={{ padding: "12px 14px" }}>
                  Add
                </button>
              </div>
              <p style={{ margin: "6px 0 0", fontSize: 12, color: "#94a3b8" }}>
                Add only the extra branch names. Your primary business location is used as the first branch automatically.
              </p>

              {formData.branches.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                  {formData.branches.map((b) => (
                    <span
                      key={b}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 8,
                        background: "#ecfdf5",
                        border: "1px solid #a7f3d0",
                        color: "#065f46",
                        padding: "6px 10px",
                        borderRadius: 999,
                        fontSize: 12,
                        fontWeight: 600,
                      }}
                    >
                      {b}
                      <button
                        type="button"
                        onClick={() => removeBranch(b)}
                        style={{ border: "none", background: "transparent", cursor: "pointer", color: "#065f46", fontWeight: 800, lineHeight: 1 }}
                        aria-label={`Remove ${b}`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          <div>
            <FieldLabel>Business Email</FieldLabel>
            <IconInput
              icon={<MailIcon />}
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              placeholder="name@company.com"
              required
              autoComplete="email"
            />
          </div>

          <div>
            <FieldLabel>Password</FieldLabel>
            <IconPasswordInput
              value={formData.password}
              onChange={(value) => setFormData({ ...formData, password: value })}
              placeholder="••••••••"
              required
              show={showPassword}
              onToggle={() => setShowPassword(!showPassword)}
              autoComplete="new-password"
            />
          </div>

          <div>
            <FieldLabel>Confirm Password</FieldLabel>
            <IconPasswordInput
              icon={<ShieldIcon />}
              value={formData.confirmPassword}
              onChange={(value) => setFormData({ ...formData, confirmPassword: value })}
              placeholder="••••••••"
              required
              show={showConfirmPassword}
              onToggle={() => setShowConfirmPassword(!showConfirmPassword)}
              autoComplete="new-password"
            />
          </div>

          {recaptcha.enabled && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div ref={recaptcha.containerRef} />
              {recaptcha.loadError && <span style={{ fontSize: 12, color: "#b91c1c" }}>{recaptcha.loadError}</span>}
            </div>
          )}
        </div>

        <button type="submit" disabled={loading} style={submitButtonStyle(loading)}>
          {loading ? "Processing..." : <>Create Account <ArrowRightIcon size={17} /></>}
        </button>
      </form>
    </AuthShell>
  );
}
