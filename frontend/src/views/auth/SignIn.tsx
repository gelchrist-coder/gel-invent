import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { warmBackend } from "../../api";
import AuthShell from "./AuthShell";
import {
  ArrowRightIcon,
  AuthMessage,
  AuthResponse,
  FieldLabel,
  IconInput,
  IconPasswordInput,
  MailIcon,
  attemptLoginRequest,
  completeAuthenticatedSession,
  isRecord,
  linkButtonStyle,
  safeJson,
  submitButtonStyle,
  useRecaptcha,
  useWarmBackend,
} from "./authShared";

type SignInProps = {
  onLogin: (email: string, password: string) => void;
};

export default function SignIn({ onLogin }: SignInProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const recaptcha = useRecaptcha(true);
  useWarmBackend();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState(() => {
    const state = location.state as { info?: string } | null;
    return state?.info ?? "";
  });
  const [loading, setLoading] = useState(false);

  const performLogin = async (identifier: string, pwd: string, captchaToken?: string) => {
    let loginResponse: Response;

    const retryAfterWarmup = async (): Promise<Response> => {
      setInfo("Server is warming up — retrying…");
      const isReady = await warmBackend("/health/db", true, {
        timeoutMs: 90000,
        probeTimeoutMs: 35000,
        retryIntervalMs: 2000,
      });

      if (!isReady) {
        setInfo("");
        throw new Error("Login timed out. The server is still starting up — please try again in a moment.");
      }

      try {
        return await attemptLoginRequest(identifier, pwd, 90000, captchaToken);
      } catch (retryErr) {
        if (retryErr instanceof Error && retryErr.message === "__timeout__") {
          throw new Error("Login timed out. The server is still starting up — please try again in a moment.");
        }
        throw retryErr;
      } finally {
        setInfo("");
      }
    };

    try {
      loginResponse = await attemptLoginRequest(identifier, pwd, 45000, captchaToken);
      if (loginResponse.status >= 500) {
        loginResponse = await retryAfterWarmup();
      }
    } catch (err) {
      if (err instanceof Error && err.message === "__timeout__") {
        loginResponse = await retryAfterWarmup();
      } else {
        throw err;
      }
    }

    if (loginResponse.status >= 500) {
      throw new Error("Login is temporarily unavailable while the server finishes starting up. Please try again in a moment.");
    }

    if (!loginResponse.ok) {
      if (recaptcha.enabled) recaptcha.reset();
      const errorData = await safeJson(loginResponse);
      const detail = isRecord(errorData) && typeof errorData.detail === "string" ? errorData.detail : null;
      setError(detail || "Invalid email/phone or password");
      return;
    }

    const loginData = (await loginResponse.json().catch(() => {
      throw new Error(`Server returned non-JSON response (status ${loginResponse.status}). The backend URL may be misconfigured.`);
    })) as AuthResponse;

    await completeAuthenticatedSession(loginData, identifier, pwd, "", onLogin);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setInfo("");
    setLoading(true);

    try {
      if (!email.trim() || !password.trim()) {
        setError("Please enter email/phone and password");
        setLoading(false);
        return;
      }
      if (recaptcha.enabled && !recaptcha.token) {
        setError("Please complete the reCAPTCHA checkbox");
        setLoading(false);
        return;
      }

      await performLogin(email, password, recaptcha.token);
      setLoading(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[SignIn] Unhandled error:", err);
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
      title="Welcome back"
      subtitle="Please enter your details to sign in."
      footer={
        <>
          New to Gel Invent?{" "}
          <Link to="/signup" style={linkButtonStyle}>
            Create an Account
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit}>
        <AuthMessage error={error} info={info} />

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div>
            <FieldLabel>Email or Phone</FieldLabel>
            <IconInput
              icon={<MailIcon />}
              type="text"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.com"
              required
              autoComplete="username"
            />
          </div>

          <div>
            <FieldLabel
              right={
                <button type="button" onClick={() => navigate("/reset")} style={{ ...linkButtonStyle, fontSize: 12.5 }}>
                  Forgot Password?
                </button>
              }
            >
              Password
            </FieldLabel>
            <IconPasswordInput
              value={password}
              onChange={setPassword}
              placeholder="••••••••"
              required
              show={showPassword}
              onToggle={() => setShowPassword(!showPassword)}
              autoComplete="current-password"
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
          {loading ? "Processing..." : <>Sign In <ArrowRightIcon size={17} /></>}
        </button>
      </form>
    </AuthShell>
  );
}
