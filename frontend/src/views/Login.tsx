import { useEffect, useState } from "react";
import { API_BASE } from "../api";
import appLogo from "../asset/logo.png";
import wareImage from "../asset/Ware.png";

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
  const [scrollProgress, setScrollProgress] = useState(0);
  const [formPanelAnimation, setFormPanelAnimation] = useState<"" | "auth-panel-enter-signin" | "auth-panel-enter-signup">("");
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    password: "",
    confirmPassword: "",
    businessName: "",
    categories: [] as string[],
    hasBranches: false,
    branches: [] as string[],
  });
  const [categoryInput, setCategoryInput] = useState("");
  const [branchInput, setBranchInput] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);

  const [showReset, setShowReset] = useState(false);
  const [resetStep, setResetStep] = useState<"request" | "confirm">("request");
  const [resetEmail, setResetEmail] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [resetConfirmPassword, setResetConfirmPassword] = useState("");

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [showResetConfirmPassword, setShowResetConfirmPassword] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      const next = Math.min(window.scrollY / 700, 1);
      setScrollProgress(next);
    };

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const switchAuthMode = (nextIsSignUp: boolean) => {
    if (nextIsSignUp === isSignUp) return;

    setIsSignUp(nextIsSignUp);
    setShowReset(false);
    setError("");
    setInfo("");
    setFormPanelAnimation(nextIsSignUp ? "auth-panel-enter-signup" : "auth-panel-enter-signin");

    window.setTimeout(() => {
      setFormPanelAnimation("");
    }, 380);
  };

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

  const performLogin = async (identifier: string, password: string) => {
    const loginFormData = new FormData();
    loginFormData.append("username", identifier);
    loginFormData.append("password", password);

    const loginResponse = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      body: loginFormData,
    });

    if (!loginResponse.ok) {
      const errorData = await safeJson(loginResponse);
      const detail = isRecord(errorData) && typeof errorData.detail === "string" ? errorData.detail : null;
      setError(detail || "Invalid email/phone or password");
      return;
    }

    const loginData = await loginResponse.json();
    localStorage.setItem("token", loginData.access_token);

    const userResponse = await fetch(`${API_BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${loginData.access_token}` },
    });

    if (userResponse.ok) {
      const userData = await userResponse.json();
      localStorage.setItem("user", JSON.stringify(userData));

      if (userData?.business_name || userData?.name || userData?.email) {
        localStorage.setItem(
          "businessInfo",
          JSON.stringify({
            name: userData.business_name || formData.businessName,
            owner: userData.name,
            phone: "",
            email: userData.email,
            address: "",
            taxId: "",
            currency: "GHS",
            logo: "",
          })
        );
      }

      window.dispatchEvent(new CustomEvent("userChanged", { detail: userData }));
    }

    onLogin(identifier, password);
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

  const FEATURE_ITEMS = [
    {
      title: "Inventory Tracking",
      description: "See stock levels in real time and track every product movement across your business.",
    },
    {
      title: "Branch Control",
      description: "Manage multiple locations from one workspace with branch-specific stock and sales visibility.",
    },
    {
      title: "Sales + Reports",
      description: "Record sales quickly and review performance with clear daily, weekly, and monthly reporting.",
    },
    {
      title: "Loss Prevention",
      description: "Capture damages, returns, and adjustments with full history so reports stay accurate.",
    },
  ];

  const BENEFIT_ITEMS = [
    {
      title: "Fewer Stockouts",
      description: "Low-stock alerts help your team restock before products run out.",
    },
    {
      title: "Faster Team Work",
      description: "Clear workflows for admin and employees reduce mistakes and speed up daily operations.",
    },
    {
      title: "Better Decisions",
      description: "Get dependable numbers for stock, sales, and movement trends in one place.",
    },
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

  const addBranch = (raw: string) => {
    const value = raw.trim();
    if (!value) return;
    if (formData.branches.some((b) => b.toLowerCase() === value.toLowerCase())) return;
    setFormData({
      ...formData,
      branches: [...formData.branches, value],
    });
    setBranchInput("");
  };

  const requestResetCode = async (emailRaw: string): Promise<boolean> => {
    const email = emailRaw.trim();
    if (!email) {
      setError("Please enter your email");
      return false;
    }

    const res = await fetch(`${API_BASE}/auth/password-reset/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });

    const data = await safeJson(res);
    if (!res.ok) {
      const detail = isRecord(data) && typeof data.detail === "string" ? data.detail : null;
      setError(detail || "Could not request reset code");
      return false;
    }

    const message =
      isRecord(data) && typeof data.message === "string"
        ? data.message
        : "Check your email for the reset code.";

    setInfo(message);
    if (isRecord(data) && typeof data.reset_code === "string" && data.reset_code.trim()) {
      setResetCode(data.reset_code.trim());
      setInfo(`${message} (Debug code auto-filled)`);
    }
    setResetStep("confirm");
    return true;
  };

  const removeBranch = (value: string) => {
    setFormData({
      ...formData,
      branches: formData.branches.filter((b) => b !== value),
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

        if (resetStep === "request") {
          await requestResetCode(email);
          setLoading(false);
          return;
        }

        if (!resetCode.trim()) {
          setError("Enter the reset code sent to your email");
          setLoading(false);
          return;
        }

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
        setResetStep("request");
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

        // Validate branches if user said they have branches
        if (formData.hasBranches && formData.branches.length === 0) {
          setError("Please add at least one branch or uncheck 'I have multiple branches'");
          setLoading(false);
          return;
        }

        // Call signup API
        const signupResponse = await fetch(`${API_BASE}/auth/signup`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: formData.email,
            phone: formData.phone,
            name: formData.name,
            password: formData.password,
            business_name: formData.businessName,
            categories: formData.categories,
            branches: formData.hasBranches ? formData.branches : [],
          }),
        });

        if (!signupResponse.ok) {
          const errorData = await signupResponse.json();
          setError(errorData.detail || "Signup failed");
          setLoading(false);
          return;
        }

        setInfo("Account created successfully.");
        await performLogin(formData.email, formData.password);
      } else {
        // Sign in validation
        if (!formData.email.trim() || !formData.password.trim()) {
          setError("Please enter email/phone and password");
          setLoading(false);
          return;
        }

        await performLogin(formData.email, formData.password);
      }
      setLoading(false);
    } catch (err) {
      setError("Network error. Please try again.");
      setLoading(false);
    }
  };

  return (
    <div className="auth-page" style={{ ["--scroll-progress" as string]: scrollProgress } as React.CSSProperties}>
      <header className="auth-top-nav">
        <div className="auth-brand-wrap">
          <img
            src={appLogo}
            alt="Gel Invent"
            className="auth-brand-mark"
            style={{ objectFit: "cover", background: "#fff" }}
          />
          <div>
            <p className="auth-brand-title">Gel Invent</p>
            <p className="auth-brand-subtitle">Inventory Management System</p>
          </div>
        </div>
        <nav className="auth-top-links" aria-label="Marketing links">
          <a href="#features">Features</a>
          <a href="#benefits">Benefits</a>
          <a href="#pricing">Pricing</a>
        </nav>
      </header>

      <section className="auth-hero">
        <div className="auth-hero-copy">
          <p className="auth-kicker">Built for modern retail teams</p>
          <h1>
            Manage inventory and fulfill orders
            <span> the right way</span>
          </h1>
          <p>
            Track stock, prevent losses, monitor branch performance, and move faster with a clean dashboard built for everyday operations.
          </p>
          <div className="auth-hero-actions">
            <button
              type="button"
              className="auth-primary-cta"
              onClick={() => switchAuthMode(true)}
            >
              Start Free
            </button>
            <button
              type="button"
              className="auth-secondary-cta"
              onClick={() => switchAuthMode(false)}
            >
              Explore Sign In
            </button>
          </div>
        </div>
        <div className="auth-hero-visual" aria-hidden>
          <img className="auth-hero-photo" src={wareImage} alt="Warehouse operations" />
        </div>
      </section>

      <section className="auth-marketing-band" id="features">
        <div className="auth-marketing-head">
          <p className="auth-kicker">Features</p>
          <h2>Everything you need to run inventory with confidence</h2>
        </div>
        <div className="auth-marketing-grid">
          {FEATURE_ITEMS.map((item) => (
            <article key={item.title} className="auth-marketing-card">
              <h3>{item.title}</h3>
              <p>{item.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="auth-marketing-band auth-marketing-band-benefits" id="benefits">
        <div className="auth-marketing-head">
          <p className="auth-kicker">Benefits</p>
          <h2>Why teams choose Gel Invent every day</h2>
        </div>
        <div className="auth-marketing-grid auth-marketing-grid-benefits">
          {BENEFIT_ITEMS.map((item) => (
            <article key={item.title} className="auth-marketing-card auth-marketing-card-benefit">
              <h3>{item.title}</h3>
              <p>{item.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="auth-signin-zone">
        <div className="auth-signin-card">
          <div className="auth-signin-left">
            <div className="auth-signin-header">
              <img
                src={appLogo}
                alt="Gel Invent"
                className="auth-mini-brand"
                style={{ objectFit: "cover", background: "#fff" }}
              />
              <button type="button" className="auth-magic-btn">Smart Sign-in</button>
            </div>


              <div className="auth-mode-switch" role="tablist" aria-label="Authentication mode">
                <button
                  type="button"
                  role="tab"
                  aria-selected={!isSignUp}
                  className={`auth-mode-btn ${!isSignUp ? "active" : ""}`}
                  onClick={() => switchAuthMode(false)}
                >
                  Sign In
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={isSignUp}
                  className={`auth-mode-btn ${isSignUp ? "active" : ""}`}
                  onClick={() => switchAuthMode(true)}
                >
                  Sign Up
                </button>
              </div>
            <h2>{isSignUp ? "Create your account" : "Sign in"}</h2>
            <p>
              {isSignUp
                ? "Set up your business and start managing inventory in minutes"
                : "Access your Gel Invent workspace"}
            </p>

            <form onSubmit={handleSubmit}>

            <div className={`auth-form-shell ${formPanelAnimation}`}>
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
                    Phone Number
                  </span>
                  <input
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    placeholder="e.g., 0241234567"
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

                {/* Branches Section */}
                <div style={{ marginTop: 16, padding: 16, background: "#f9fafb", borderRadius: 8, border: "1px solid #e5e7eb" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={formData.hasBranches}
                      onChange={(e) => setFormData({ ...formData, hasBranches: e.target.checked, branches: e.target.checked ? formData.branches : [] })}
                      style={{ width: 18, height: 18 }}
                    />
                    <span style={{ fontSize: 14, fontWeight: 600, color: "#374151" }}>
                      I have multiple branches/locations
                    </span>
                  </label>
                  <p style={{ margin: "8px 0 0", fontSize: 12, color: "#6b7280" }}>
                    If you have multiple store locations, check this to add them now. You can also add branches later from Settings.
                  </p>
                </div>

                {formData.hasBranches && (
                  <label style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 16 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: "#374151" }}>
                      Branch Names *
                    </span>
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
                        style={{ padding: 12, flex: 1 }}
                      />
                      <button
                        type="button"
                        onClick={() => addBranch(branchInput)}
                        className="button"
                        style={{ padding: "12px 14px" }}
                      >
                        Add
                      </button>
                    </div>
                    <p style={{ margin: "4px 0 0", fontSize: 12, color: "#6b7280" }}>
                      Press Enter or click Add for each branch
                    </p>

                    {formData.branches.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
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
                              style={{
                                border: "none",
                                background: "transparent",
                                cursor: "pointer",
                                color: "#065f46",
                                fontWeight: 800,
                                lineHeight: 1,
                              }}
                              aria-label={`Remove ${b}`}
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </label>
                )}
              </>
            )}

            {!isSignUp && showReset && (
              <>
                <div
                  style={{
                    padding: 12,
                    borderRadius: 8,
                    border: "1px solid #dbeafe",
                    background: "#eff6ff",
                    color: "#1e3a8a",
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  {resetStep === "request"
                    ? "Step 1 of 2: Request a reset code"
                    : "Step 2 of 2: Enter code and create a new password"}
                </div>

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
                    readOnly={resetStep === "confirm"}
                  />
                </label>

                {resetStep === "confirm" && (
                  <>
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

                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <button
                        type="button"
                        onClick={() => {
                          setResetStep("request");
                          setResetCode("");
                          setResetPassword("");
                          setResetConfirmPassword("");
                          setError("");
                          setInfo("");
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
                        Use another email
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          setError("");
                          setInfo("");
                          setLoading(true);
                          try {
                            await requestResetCode((resetEmail || formData.email).trim());
                          } finally {
                            setLoading(false);
                          }
                        }}
                        disabled={loading}
                        style={{
                          background: "transparent",
                          border: "none",
                          color: "#1f7aff",
                          fontSize: 13,
                          fontWeight: 600,
                          cursor: loading ? "not-allowed" : "pointer",
                          textDecoration: "underline",
                          padding: 0,
                          opacity: loading ? 0.6 : 1,
                        }}
                      >
                        Resend code
                      </button>
                    </div>
                  </>
                )}
              </>
            )}

            {!showReset && (
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: "#374151" }}>
                {isSignUp ? "Email Address *" : "Email or Phone Number *"}
              </span>
              <input
                type={isSignUp ? "email" : "text"}
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder={isSignUp ? "you@example.com" : "you@example.com or 0241234567"}
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
                ? (resetStep === "request" ? "Send Reset Code" : "Reset Password")
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
                  setResetStep("request");
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
            <span style={{ color: "#6b7280", fontSize: 14 }}>
              {isSignUp
                ? "Already have an account? Sign In"
                : "Don't have an account? Sign Up"}
            </span>
          </div>
          )}
          </div>
            </form>
          </div>

          <div className="auth-signin-right" id="pricing">
            <div className="auth-signin-right-illustration" aria-hidden>
              <div className="dot dot-a" />
              <div className="dot dot-b" />
              <div className="dot dot-c" />
            </div>
            <h3>Run every branch from one place</h3>
            <p>
              Use one dashboard to track sales, monitor stock levels, and coordinate teams without switching tools.
            </p>
            <ul>
              <li>Live stock updates and reorder warnings</li>
              <li>Branch-aware sales and inventory reporting</li>
              <li>Fast checkout and movement history tracking</li>
            </ul>
          </div>
        </div>
      </section>

      <footer className="auth-page-footer">
        © 2026 Gel Invent. All rights reserved.
      </footer>
    </div>
  );
}
