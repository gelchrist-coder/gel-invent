import { useState } from "react";

type LoginProps = {
  onLogin: (email: string, password: string) => void;
};

export default function Login({ onLogin }: LoginProps) {
  const [isSignUp, setIsSignUp] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
    businessName: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
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
        if (formData.password.length < 6) {
          setError("Password must be at least 6 characters");
          setLoading(false);
          return;
        }

        // Call signup API
        const signupResponse = await fetch("http://127.0.0.1:8000/auth/signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: formData.email,
            name: formData.name,
            password: formData.password,
            business_name: formData.businessName,
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

        const loginResponse = await fetch("http://127.0.0.1:8000/auth/login", {
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
        const userResponse = await fetch("http://127.0.0.1:8000/auth/me", {
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

        const loginResponse = await fetch("http://127.0.0.1:8000/auth/login", {
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
        const userResponse = await fetch("http://127.0.0.1:8000/auth/me", {
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

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {isSignUp && (
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
              </>
            )}

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

            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: "#374151" }}>
                Password *
              </span>
              <input
                type="password"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                placeholder="••••••••"
                required
                className="input"
                style={{ padding: 12 }}
              />
            </label>

            {isSignUp && (
              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: "#374151" }}>
                  Confirm Password *
                </span>
                <input
                  type="password"
                  value={formData.confirmPassword}
                  onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                  placeholder="••••••••"
                  required={isSignUp}
                  className="input"
                  style={{ padding: 12 }}
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
            {loading ? "Processing..." : isSignUp ? "Sign Up" : "Sign In"}
          </button>

          {/* Toggle Sign In/Sign Up */}
          <div style={{ marginTop: 24, textAlign: "center" }}>
            <button
              type="button"
              onClick={() => {
                setIsSignUp(!isSignUp);
                setError("");
                setFormData({
                  name: "",
                  email: "",
                  password: "",
                  confirmPassword: "",
                  businessName: "",
                });
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
