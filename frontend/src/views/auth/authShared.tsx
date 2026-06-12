import { useCallback, useEffect, useRef, useState } from "react";

import { fetchWithSameOriginApiFallback, warmBackend } from "../../api";
import { readStoredBusinessInfo, readStoredUser } from "../../user-storage";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AuthResponse = {
  access_token: string;
  token_type: string;
  user?: {
    id?: number;
    email?: string;
    name?: string;
    role?: string;
    permissions?: string[] | null;
    business_name?: string | null;
    business_types?: string[] | null;
    product_categories?: string[] | null;
    categories?: string[] | null;
    branch_id?: number | null;
  } | null;
};

// ---------------------------------------------------------------------------
// Marketing copy / option constants (shared by landing + signup)
// ---------------------------------------------------------------------------

export const BUSINESS_TYPE_OPTIONS = [
  "Pharmacy",
  "Grocery",
  "Cosmetics",
  "Fashion",
  "Hardware",
  "Construction Materials",
  "Agro",
  "Electronics",
];

export const FEATURE_ITEMS = [
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

export const BENEFIT_ITEMS = [
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

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const safeJson = async (res: Response): Promise<unknown> => {
  try {
    return await res.json();
  } catch {
    return null;
  }
};

export const getPasswordRuleError = (password: string): string | null => {
  if (password.length < 8) return "Password must be at least 8 characters";
  if (!/[a-z]/.test(password)) return "Password must include a lowercase letter";
  if (!/[A-Z]/.test(password)) return "Password must include an uppercase letter";
  if (!/\d/.test(password)) return "Password must include a number";
  if (!/[^A-Za-z0-9]/.test(password)) return "Password must include a special character";
  return null;
};

// ---------------------------------------------------------------------------
// reCAPTCHA
// ---------------------------------------------------------------------------

export function loadRecaptchaScript(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.resolve();
  }

  if (window.grecaptcha) {
    return Promise.resolve();
  }

  if (window.__gelInventRecaptchaScriptPromise) {
    return window.__gelInventRecaptchaScriptPromise;
  }

  window.__gelInventRecaptchaScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://www.google.com/recaptcha/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Could not load reCAPTCHA"));
    document.head.appendChild(script);
  });

  return window.__gelInventRecaptchaScriptPromise;
}

const RECAPTCHA_LOAD_ERROR = "reCAPTCHA could not load. Use a reCAPTCHA v2 checkbox site key, not a v3 key.";

export type RecaptchaController = {
  enabled: boolean;
  token: string;
  loadError: string;
  reset: () => void;
  containerRef: React.RefObject<HTMLDivElement>;
};

/**
 * Renders and manages a reCAPTCHA v2 checkbox widget. Pass `active=false`
 * (e.g. while a different sub-flow is showing) to clear the token.
 */
export function useRecaptcha(active: boolean = true): RecaptchaController {
  const siteKey =
    import.meta.env.VITE_RECAPTCHA_SITE_KEY?.trim() || import.meta.env.Site_key?.trim() || "";
  const enabled = siteKey.length > 0;

  const [token, setToken] = useState("");
  const [loadError, setLoadError] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<number | null>(null);

  const reset = useCallback(() => {
    setToken("");
    if (window.grecaptcha && widgetIdRef.current !== null) {
      window.grecaptcha.reset(widgetIdRef.current);
    }
  }, []);

  useEffect(() => {
    if (!enabled || !active) {
      setToken("");
      return;
    }

    let cancelled = false;

    loadRecaptchaScript()
      .then(() => {
        if (cancelled || !window.grecaptcha || !containerRef.current) {
          return;
        }

        window.grecaptcha.ready(() => {
          if (cancelled || !window.grecaptcha || !containerRef.current) {
            return;
          }

          setLoadError("");

          if (widgetIdRef.current === null) {
            widgetIdRef.current = window.grecaptcha.render(containerRef.current, {
              sitekey: siteKey,
              callback: (t: string) => {
                setToken(t);
                setLoadError("");
              },
              "expired-callback": () => setToken(""),
              "error-callback": () => {
                setToken("");
                setLoadError(RECAPTCHA_LOAD_ERROR);
              },
            });
            return;
          }

          window.grecaptcha.reset(widgetIdRef.current);
          setToken("");
        });
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError(RECAPTCHA_LOAD_ERROR);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, active, siteKey]);

  return { enabled, token, loadError, reset, containerRef };
}

/** Warm the backend process on mount so the first auth request is faster. */
export function useWarmBackend(): void {
  useEffect(() => {
    void warmBackend("/health");
  }, []);
}

// ---------------------------------------------------------------------------
// Session completion + network helpers
// ---------------------------------------------------------------------------

/**
 * Persists the authenticated session to localStorage, broadcasts the user
 * change events, then calls `onLogin` to flip the app into its signed-in state.
 */
export async function completeAuthenticatedSession(
  authData: AuthResponse,
  identifier: string,
  password: string,
  businessNameFallback: string,
  onLogin: (email: string, password: string) => void,
): Promise<void> {
  const previousUser = readStoredUser();
  const existingBusinessInfo = readStoredBusinessInfo();
  localStorage.setItem("token", authData.access_token);
  localStorage.setItem("lastSuccessfulLoginAt", String(Date.now()));

  const userData = authData.user ?? null;
  if (userData) {
    localStorage.setItem("user", JSON.stringify(userData));

    if (userData?.business_name || userData?.name || userData?.email) {
      const isSameUser = previousUser?.id != null && userData?.id != null && previousUser.id === userData.id;
      const nextBusinessInfo = {
        name: userData.business_name || businessNameFallback,
        owner: userData.name,
        phone: isSameUser ? existingBusinessInfo?.phone || "" : "",
        email: userData.email,
        address: isSameUser ? existingBusinessInfo?.address || "" : "",
        taxId: isSameUser ? existingBusinessInfo?.taxId || "" : "",
        currency: isSameUser ? existingBusinessInfo?.currency || "GHS" : "GHS",
      };
      localStorage.setItem("businessInfo", JSON.stringify(nextBusinessInfo));
      window.dispatchEvent(new CustomEvent("businessInfoChanged", { detail: nextBusinessInfo }));
    }

    window.dispatchEvent(new CustomEvent("userChanged", { detail: userData }));
  } else {
    // Fallback: fetch user data separately if not included in auth response
    const userResponse = await fetchWithSameOriginApiFallback("/auth/me", {
      headers: { Authorization: `Bearer ${authData.access_token}` },
    });
    if (userResponse.ok) {
      const meData = await userResponse.json();
      localStorage.setItem("user", JSON.stringify(meData));
      window.dispatchEvent(new CustomEvent("userChanged", { detail: meData }));
    }
  }

  onLogin(identifier, password);
}

/**
 * Performs the OAuth2 password-grant login request with an abort timeout.
 * Throws Error("__timeout__") when the request is aborted.
 */
export async function attemptLoginRequest(
  identifier: string,
  password: string,
  timeoutMs: number,
  captchaToken?: string,
): Promise<Response> {
  const loginFormData = new URLSearchParams();
  loginFormData.append("username", identifier);
  loginFormData.append("password", password);
  if (captchaToken) {
    loginFormData.append("recaptcha_token", captchaToken);
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetchWithSameOriginApiFallback("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: loginFormData,
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("__timeout__");
    }
    throw err;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

// ---------------------------------------------------------------------------
// Shared password input with show/hide toggle
// ---------------------------------------------------------------------------

type PasswordInputProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  required?: boolean;
  show: boolean;
  onToggle: () => void;
  autoComplete?: string;
};

export function PasswordInput({
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

// ---------------------------------------------------------------------------
// Shared layout for the standalone auth pages (sign in / sign up / reset)
// ---------------------------------------------------------------------------

export function AuthMessage({ error, info }: { error?: string; info?: string }) {
  return (
    <>
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
    </>
  );
}

export const fieldLabelStyle: React.CSSProperties = { fontSize: 14, fontWeight: 600, color: "#374151" };

export const submitButtonStyle = (loading: boolean): React.CSSProperties => ({
  width: "100%",
  marginTop: 24,
  padding: 14,
  fontSize: 16,
  fontWeight: 600,
  background: "linear-gradient(135deg, #1f7aff, #8246ff)",
  opacity: loading ? 0.7 : 1,
  cursor: loading ? "not-allowed" : "pointer",
});

export const linkButtonStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "#4f46e5",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
  padding: 0,
  textDecoration: "underline",
};
