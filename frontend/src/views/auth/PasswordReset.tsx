import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { fetchWithSameOriginApiFallback } from "../../api";
import AuthShell from "./AuthShell";
import {
  ArrowRightIcon,
  AuthMessage,
  FieldLabel,
  IconInput,
  IconPasswordInput,
  KeyIcon,
  MailIcon,
  ShieldIcon,
  getPasswordRuleError,
  isRecord,
  linkButtonStyle,
  safeJson,
  submitButtonStyle,
  useWarmBackend,
} from "./authShared";

export default function PasswordReset() {
  const navigate = useNavigate();
  useWarmBackend();

  const [step, setStep] = useState<"request" | "confirm">("request");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);

  const requestResetCode = async (emailRaw: string): Promise<boolean> => {
    const value = emailRaw.trim();
    if (!value) {
      setError("Please enter your email");
      return false;
    }

    const res = await fetchWithSameOriginApiFallback("/auth/password-reset/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: value }),
    });

    const data = await safeJson(res);
    if (!res.ok) {
      const detail = isRecord(data) && typeof data.detail === "string" ? data.detail : null;
      setError(detail || "Could not request reset code");
      return false;
    }

    const message = isRecord(data) && typeof data.message === "string" ? data.message : "Check your email for the reset code.";
    setInfo(message);
    if (isRecord(data) && typeof data.reset_code === "string" && data.reset_code.trim()) {
      setCode(data.reset_code.trim());
      setInfo(`${message} (Debug code auto-filled)`);
    }
    setStep("confirm");
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setInfo("");
    setLoading(true);

    try {
      if (step === "request") {
        await requestResetCode(email);
        setLoading(false);
        return;
      }

      if (!code.trim()) {
        setError("Enter the reset code sent to your email");
        setLoading(false);
        return;
      }
      if (password !== confirmPassword) {
        setError("Passwords do not match");
        setLoading(false);
        return;
      }
      const ruleError = getPasswordRuleError(password);
      if (ruleError) {
        setError(ruleError);
        setLoading(false);
        return;
      }

      const confirmRes = await fetchWithSameOriginApiFallback("/auth/password-reset/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), code, new_password: password }),
      });

      const confirmData = await safeJson(confirmRes);
      if (!confirmRes.ok) {
        const detail = isRecord(confirmData) && typeof confirmData.detail === "string" ? confirmData.detail : null;
        setError(detail || "Reset failed. Check your code and try again.");
        setLoading(false);
        return;
      }

      navigate("/login", {
        replace: true,
        state: { info: "Password updated. Please sign in with your new password." },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[PasswordReset] Unhandled error:", err);
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
      title="Reset password"
      subtitle={step === "request" ? "We'll email you a reset code." : "Enter the code and choose a new password."}
      footer={
        <>
          Remembered it?{" "}
          <Link to="/login" style={linkButtonStyle}>
            Back to Sign In
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit}>
        <AuthMessage error={error} info={info} />

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div
            style={{
              padding: 12,
              borderRadius: 10,
              border: "1px solid #dbeafe",
              background: "#eff6ff",
              color: "#1e3a8a",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {step === "request" ? "Step 1 of 2: Request a reset code" : "Step 2 of 2: Enter code and create a new password"}
          </div>

          <div>
            <FieldLabel>Email Address</FieldLabel>
            <IconInput
              icon={<MailIcon />}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.com"
              required
              autoComplete="email"
              readOnly={step === "confirm"}
            />
          </div>

          {step === "confirm" && (
            <>
              <div>
                <FieldLabel>Reset Code</FieldLabel>
                <IconInput
                  icon={<KeyIcon />}
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="Enter the 6-digit code"
                  autoComplete="one-time-code"
                />
              </div>

              <div>
                <FieldLabel>New Password</FieldLabel>
                <IconPasswordInput
                  value={password}
                  onChange={setPassword}
                  placeholder="••••••••"
                  show={showPassword}
                  onToggle={() => setShowPassword(!showPassword)}
                  autoComplete="new-password"
                />
              </div>

              <div>
                <FieldLabel>Confirm New Password</FieldLabel>
                <IconPasswordInput
                  icon={<ShieldIcon />}
                  value={confirmPassword}
                  onChange={setConfirmPassword}
                  placeholder="••••••••"
                  show={showConfirmPassword}
                  onToggle={() => setShowConfirmPassword(!showConfirmPassword)}
                  autoComplete="new-password"
                />
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <button
                  type="button"
                  onClick={() => {
                    setStep("request");
                    setCode("");
                    setPassword("");
                    setConfirmPassword("");
                    setError("");
                    setInfo("");
                  }}
                  style={{ ...linkButtonStyle, fontSize: 13, color: "#1f7aff" }}
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
                      await requestResetCode(email);
                    } finally {
                      setLoading(false);
                    }
                  }}
                  disabled={loading}
                  style={{ ...linkButtonStyle, fontSize: 13, color: "#1f7aff", opacity: loading ? 0.6 : 1, cursor: loading ? "not-allowed" : "pointer" }}
                >
                  Resend code
                </button>
              </div>
            </>
          )}
        </div>

        <button type="submit" disabled={loading} style={submitButtonStyle(loading)}>
          {loading ? "Processing..." : <>{step === "request" ? "Send Reset Code" : "Reset Password"} <ArrowRightIcon size={17} /></>}
        </button>
      </form>
    </AuthShell>
  );
}
