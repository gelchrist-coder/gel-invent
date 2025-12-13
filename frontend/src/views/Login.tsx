import { useState } from "react";
import { API_BASE } from "../api";

type LoginProps = {
  onLogin: (email: string, password: string) => void;
};

type PasswordInputProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  required?: boolean;
  show: boolean;
  onToggle: () => void;
  autoComplete?: string;
};

function PasswordInput({
  value,
  onChange,
  placeholder,
  required,
  show,
  onToggle,
  autoComplete,
}: PasswordInputProps) {
  return (
    <div style={{ position: "relative" }}>
      <input
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        autoComplete={autoComplete}
        className="input"
        style={{ padding: 12, paddingRight: 56, width: "100%" }}
      />
      <button
        type="button"
        onClick={onToggle}
        style={{
          position: "absolute",
          right: 10,
          top: "50%",
          transform: "translateY(-50%)",
          border: "none",
          background: "transparent",
          color: "#1f7aff",
          fontSize: 12,
          fontWeight: 700,
          cursor: "pointer",
          padding: 6,
        }}
      >
        {show ? "Hide" : "Show"}
      </button>
    </div>
  );
}

export default function Login({ onLogin }: LoginProps) {
  const [isSignUp, setIsSignUp] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
    businessName: "",
    categories: [] as string[],
  });
  const [categoryInput, setCategoryInput] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);

  const [showReset, setShowReset] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [resetConfirmPassword, setResetConfirmPassword] = useState("");

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [showResetConfirmPassword, setShowResetConfirmPassword] = useState(false);

  const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

  const safeJson = async (res: Response): Promise<unknown> => {
    try {
      return await res.json();
    } catch {
      return null;
    }
  };

  const getPasswordRuleError = (password: string): string | null => {
    if (password.length < 8) return "Password must be at least 8 characters";
    if (!/[a-z]/.test(password)) return "Password must include a lowercase letter";
    if (!/[A-Z]/.test(password)) return "Password must include an uppercase letter";
    if (!/\d/.test(password)) return "Password must include a number";
    if (!/[^A-Za-z0-9]/.test(password)) return "Password must include a special character";
    return null;
  };

  const COMMON_CATEGORIES = [
    "Beverages",
    "Food",
    "Groceries",
    "Cosmetics",
    "Pharmacy",
    "Stationery",
    "Electronics",
    "Household",
    "Baby Products",
    "Cleaning",
  ];

  const addCategory = (raw: string) => {
    const value = raw.trim();
    if (!value) return;
    if (formData.categories.some((c) => c.toLowerCase() === value.toLowerCase())) return;
    setFormData({
      ...formData,
      categories: [...formData.categories, value],
    });
    setCategoryInput("");
  };

  const removeCategory = (value: string) => {
    setFormData({
      ...formData,
      categories: formData.categories.filter((c) => c !== value),
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setInfo("");
    setLoading(true);

    try {
      if (showReset) {
        const email = (resetEmail || formData.email).trim();
        if (!email) {
          setError("Please enter your email");
          setLoading(false);
          return;
        }

        if (!resetCode) {
          // Request reset code
          const res = await fetch(`${API_BASE}/auth/password-reset/request`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email }),
          });

          const data = await safeJson(res);
          if (!res.ok) {
            const detail = isRecord(data) && typeof data.detail === "string" ? data.detail : null;
            setError(detail || "Could not request reset code");
            setLoading(false);
            return;
          }

          const message =
            isRecord(data) && typeof data.message === "string"
              ? data.message
              : "Check your email for the reset code.";
          setInfo(message);
          if (isRecord(data) && typeof data.reset_code === "string" && data.reset_code.trim()) {
            setResetCode(data.reset_code);
          }
          setLoading(false);
          return;
        }

        // Confirm reset
        if (resetPassword !== resetConfirmPassword) {
          setError("Passwords do not match");
          setLoading(false);
          return;
        }
        const resetRuleError = getPasswordRuleError(resetPassword);
        if (resetRuleError) {
          setError(resetRuleError);
          setLoading(false);
          return;
        }

        const confirmRes = await fetch(`${API_BASE}/auth/password-reset/confirm`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            code: resetCode,
            new_password: resetPassword,
          }),
        });

        const confirmData = await safeJson(confirmRes);
        if (!confirmRes.ok) {
          const detail =
            isRecord(confirmData) && typeof confirmData.detail === "string" ? confirmData.detail : null;
          setError(detail || "Reset failed. Check your code and try again.");
          setLoading(false);
          return;
        }

        setInfo("Password updated. Please sign in with your new password.");
        setShowReset(false);
        setResetEmail("");
        setResetCode("");
        setResetPassword("");
        setResetConfirmPassword("");
        setFormData({
          ...formData,
          email,
          password: resetPassword,
          confirmPassword: "",
        });
        setLoading(false);
        return;
      }

      if (isSignUp) {
        // Sign up validation
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

        // Call signup API
        const signupResponse = await fetch(`${API_BASE}/auth/signup`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: formData.email,
            name: formData.name,
            password: formData.password,
            business_name: formData.businessName,
            categories: formData.categories,
          }),
        });

        if (!signupResponse.ok) {
          const errorData = await signupResponse.json();
          setError(errorData.detail || "Signup failed");
          setLoading(false);
          return;
        }

        // After successful signup, login automatically
        const loginFormData = new FormData();
        loginFormData.append("username", formData.email);
        loginFormData.append("password", formData.password);

        const loginResponse = await fetch(`${API_BASE}/auth/login`, {
          method: "POST",
          body: loginFormData,
        });

        if (!loginResponse.ok) {
          setError("Account created but login failed. Please sign in manually.");
          setLoading(false);
          return;
        }

        const loginData = await loginResponse.json();
        localStorage.setItem("token", loginData.access_token);

        // Get user info
        const userResponse = await fetch(`${API_BASE}/auth/me`, {
          headers: { Authorization: `Bearer ${loginData.access_token}` },
        });

        if (userResponse.ok) {
          const userData = await userResponse.json();
          localStorage.setItem("user", JSON.stringify(userData));
          localStorage.setItem("businessInfo", JSON.stringify({
            name: userData.business_name || formData.businessName,
            owner: userData.name,
            phone: "",
            email: userData.email,
            address: "",
            taxId: "",
            currency: "GHS",
            logo: "",
          }));
          
          // Dispatch custom event for same-tab user change detection
          window.dispatchEvent(new CustomEvent("userChanged", { detail: userData }));
        }

        onLogin(formData.email, formData.password);
      } else {
        // Sign in validation
        if (!formData.email.trim() || !formData.password.trim()) {
          setError("Please enter both email and password");
          setLoading(false);
          return;
        }

        // Call login API
        const loginFormData = new FormData();
        loginFormData.append("username", formData.email);
        loginFormData.append("password", formData.password);

        const loginResponse = await fetch(`${API_BASE}/auth/login`, {
          method: "POST",
          body: loginFormData,
        });

        if (!loginResponse.ok) {
          const errorData = await loginResponse.json();
          setError(errorData.detail || "Invalid email or password");
          setLoading(false);
          return;
        }

        const loginData = await loginResponse.json();
        localStorage.setItem("token", loginData.access_token);

        // Get user info
        const userResponse = await fetch(`${API_BASE}/auth/me`, {
          headers: { Authorization: `Bearer ${loginData.access_token}` },
        });

        if (userResponse.ok) {
          const userData = await userResponse.json();
          localStorage.setItem("user", JSON.stringify(userData));
          
          // Dispatch custom event for same-tab user change detection
          window.dispatchEvent(new CustomEvent("userChanged", { detail: userData }));
        }

        onLogin(formData.email, formData.password);
      }
      setLoading(false);
    } catch (err) {
      setError("Network error. Please try again.");
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
        padding: 20,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 440,
          background: "white",
          borderRadius: 16,
          boxShadow: "0 20px 60px rgba(0, 0, 0, 0.3)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            background: "linear-gradient(135deg, #1f7aff, #8246ff)",
            padding: "32px 24px",
            textAlign: "center",
            color: "white",
          }}
        >
          <h1 style={{ margin: "0 0 8px", fontSize: 32, fontWeight: 700 }}>
            Gel Invent
          </h1>
          <p style={{ margin: 0, opacity: 0.9, fontSize: 15 }}>
            Inventory Management System
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ padding: "32px 24px" }}>
          <div style={{ marginBottom: 24, textAlign: "center" }}>
            <h2 style={{ margin: "0 0 8px", fontSize: 24, fontWeight: 600, color: "#1a2235" }}>
              {isSignUp ? "Create Account" : "Welcome Back"}
            </h2>
            <p style={{ margin: 0, color: "#6b7280", fontSize: 14 }}>
              {isSignUp
                ? "Sign up to start managing your inventory"
                : "Sign in to continue to your account"}
            </p>
          </div>

          {error && (
            <div
              style={{
                padding: 12,
                background: "#fee2e2",
                border: "1px solid #ef4444",
                borderRadius: 8,
                color: "#dc2626",
                fontSize: 14,
                marginBottom: 20,
              }}
            >
              {error}
            </div>
          )}

          {info && (
            <div
              style={{
                padding: 12,
                background: "#ecfeff",
                border: "1px solid #06b6d4",
                borderRadius: 8,
                color: "#155e75",
                fontSize: 14,
                marginBottom: 20,
              }}
            >
              {info}
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {isSignUp && !showReset && (
              <>
                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: "#374151" }}>
                    Full Name *
                  </span>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="John Doe"
                    required={isSignUp}
                    className="input"
                    style={{ padding: 12 }}
                  />
                </label>

                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: "#374151" }}>
                    Business Name *
                  </span>
                  <input
                    type="text"
                    value={formData.businessName}
                    onChange={(e) => setFormData({ ...formData, businessName: e.target.value })}
                    placeholder="My Business Ltd"
                    required={isSignUp}
                    className="input"
                    style={{ padding: 12 }}
                  />
                </label>

                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: "#374151" }}>
                    Business Categories
                  </span>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      type="text"
                      value={categoryInput}
                      onChange={(e) => setCategoryInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addCategory(categoryInput);
                        }
                      }}
                      placeholder="Type a category and press Enter"
                      list="category-suggestions"
                      className="input"
                      style={{ padding: 12, flex: 1 }}
                    />
                    <button
                      type="button"
                      onClick={() => addCategory(categoryInput)}
                      className="button"
                      style={{ padding: "12px 14px" }}
                    >
                      Add
                    </button>
                  </div>
                  <datalist id="category-suggestions">
                    {COMMON_CATEGORIES.map((c) => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>

                  <select
                    value=""
                    onChange={(e) => {
                      addCategory(e.target.value);
                      e.currentTarget.value = "";
                    }}
                    className="input"
                    style={{ padding: 12 }}
                  >
                    <option value="" disabled>
                      Or select a common category
                    </option>
                    {COMMON_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>

                  {formData.categories.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
                      {formData.categories.map((c) => (
                        <span
                          key={c}
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
                          {c}
                          <button
                            type="button"
                            onClick={() => removeCategory(c)}
                            style={{
                              border: "none",
                              background: "transparent",
                              cursor: "pointer",
                              color: "#3730a3",
                              fontWeight: 800,
                              lineHeight: 1,
                            }}
                            aria-label={`Remove ${c}`}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </label>
              </>
            )}

            {!isSignUp && showReset && (
              <>
                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: "#374151" }}>
                    Email Address *
                  </span>
                  <input
                    type="email"
                    value={resetEmail}
                    onChange={(e) => setResetEmail(e.target.value)}
                    placeholder="you@example.com"
                    required
                    className="input"
                    style={{ padding: 12 }}
                  />
                </label>

                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: "#374151" }}>
                    Reset Code
                  </span>
                  <input
                    type="text"
                    value={resetCode}
                    onChange={(e) => setResetCode(e.target.value)}
                    placeholder="Enter the 6-digit code"
                    className="input"
                    style={{ padding: 12 }}
                  />
                </label>

                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: "#374151" }}>
                    New Password
                  </span>
                  <PasswordInput
                    value={resetPassword}
                    onChange={setResetPassword}
                    placeholder="••••••••"
                    show={showResetPassword}
                    onToggle={() => setShowResetPassword(!showResetPassword)}
                    autoComplete="new-password"
                  />
                </label>

                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: "#374151" }}>
                    Confirm New Password
                  </span>
                  <PasswordInput
                    value={resetConfirmPassword}
                    onChange={setResetConfirmPassword}
                    placeholder="••••••••"
                    show={showResetConfirmPassword}
                    onToggle={() => setShowResetConfirmPassword(!showResetConfirmPassword)}
                    autoComplete="new-password"
                  />
                </label>
              </>
            )}

            {!showReset && (
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: "#374151" }}>
                Email Address *
              </span>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="you@example.com"
                required
                className="input"
                style={{ padding: 12 }}
              />
            </label>
            )}

            {!showReset && (
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: "#374151" }}>
                Password *
              </span>
              <PasswordInput
                value={formData.password}
                onChange={(value) => setFormData({ ...formData, password: value })}
                placeholder="••••••••"
                required
                show={showPassword}
                onToggle={() => setShowPassword(!showPassword)}
                autoComplete={isSignUp ? "new-password" : "current-password"}
              />
            </label>
            )}

            {!isSignUp && !showReset && (
              <div style={{ marginTop: -8, textAlign: "right" }}>
                <button
                  type="button"
                  onClick={() => {
                    setShowReset(true);
                    setError("");
                    setInfo("");
                    setResetEmail(formData.email);
                    setResetCode("");
                    setResetPassword("");
                    setResetConfirmPassword("");
                  }}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "#1f7aff",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                    textDecoration: "underline",
                    padding: 0,
                  }}
                >
                  Forgot password?
                </button>
              </div>
            )}

            {isSignUp && (
              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: "#374151" }}>
                  Confirm Password *
                </span>
                <PasswordInput
                  value={formData.confirmPassword}
                  onChange={(value) => setFormData({ ...formData, confirmPassword: value })}
                  placeholder="••••••••"
                  required={isSignUp}
                  show={showConfirmPassword}
                  onToggle={() => setShowConfirmPassword(!showConfirmPassword)}
                  autoComplete="new-password"
                />
              </label>
            )}
          </div>

          <button
            type="submit"
            disabled={loading}
            className="button"
            style={{
              width: "100%",
              marginTop: 24,
              padding: 14,
              fontSize: 16,
              fontWeight: 600,
              background: "linear-gradient(135deg, #1f7aff, #8246ff)",
              opacity: loading ? 0.7 : 1,
              cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            {loading
              ? "Processing..."
              : showReset
                ? (resetCode ? "Reset Password" : "Send Reset Code")
                : isSignUp
                  ? "Sign Up"
                  : "Sign In"}
          </button>

          {!isSignUp && showReset && (
            <div style={{ marginTop: 16, textAlign: "center" }}>
              <button
                type="button"
                onClick={() => {
                  setShowReset(false);
                  setError("");
                  setInfo("");
                }}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#1f7aff",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                  textDecoration: "underline",
                }}
              >
                Back to Sign In
              </button>
            </div>
          )}

          {/* Toggle Sign In/Sign Up */}
          {!showReset && (
          <div style={{ marginTop: 24, textAlign: "center" }}>
            <button
              type="button"
              onClick={() => {
                setIsSignUp(!isSignUp);
                setError("");
                setInfo("");
                setFormData({
                  name: "",
                  email: "",
                  password: "",
                  confirmPassword: "",
                  businessName: "",
                  categories: [],
                });
                setCategoryInput("");
                setShowReset(false);
                setResetEmail("");
                setResetCode("");
                setResetPassword("");
                setResetConfirmPassword("");
              }}
              style={{
                background: "transparent",
                border: "none",
                color: "#1f7aff",
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
                textDecoration: "underline",
              }}
            >
              {isSignUp
                ? "Already have an account? Sign In"
                : "Don't have an account? Sign Up"}
            </button>
          </div>
          )}
        </form>

        {/* Footer */}
        <div
          style={{
            padding: "16px 24px",
            background: "#f9fafb",
            borderTop: "1px solid #e5e7eb",
            textAlign: "center",
          }}
        >
          <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>
            © 2025 Gel Invent. All rights reserved.
          </p>
        </div>
      </div>
    </div>
  );
}
