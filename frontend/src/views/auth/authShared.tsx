import { useCallback, useEffect, useRef, useState } from "react";

import { fetchWithSameOriginApiFallback, warmBackend } from "../../api";
import { readStoredBusinessInfo, readStoredUser } from "../../user-storage";

// Brand palette — declared first so module-level style objects below can use it.
export const AUTH_PRIMARY = "#1d4ed8";

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
  padding: "13px 16px",
  fontSize: 15,
  fontWeight: 700,
  color: "#ffffff",
  background: AUTH_PRIMARY,
  border: "none",
  borderRadius: 10,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  opacity: loading ? 0.7 : 1,
  cursor: loading ? "not-allowed" : "pointer",
});

export const linkButtonStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  color: AUTH_PRIMARY,
  fontSize: 14,
  fontWeight: 700,
  cursor: "pointer",
  padding: 0,
  textDecoration: "none",
};

// ---------------------------------------------------------------------------
// Inline SVG icons (enterprise look)
// ---------------------------------------------------------------------------

type IconProps = { size?: number; color?: string };

const svgBase = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
});

export const MailIcon = ({ size = 18 }: IconProps) => (
  <svg {...svgBase(size)}>
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <path d="m22 7-10 6L2 7" />
  </svg>
);

export const LockIcon = ({ size = 18 }: IconProps) => (
  <svg {...svgBase(size)}>
    <rect x="3" y="11" width="18" height="11" rx="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

export const UserIcon = ({ size = 18 }: IconProps) => (
  <svg {...svgBase(size)}>
    <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

export const ShieldIcon = ({ size = 18 }: IconProps) => (
  <svg {...svgBase(size)}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);

export const BuildingIcon = ({ size = 18 }: IconProps) => (
  <svg {...svgBase(size)}>
    <rect x="4" y="2" width="16" height="20" rx="2" />
    <path d="M9 22v-4h6v4M9 6h.01M15 6h.01M9 10h.01M15 10h.01M9 14h.01M15 14h.01" />
  </svg>
);

export const PinIcon = ({ size = 18 }: IconProps) => (
  <svg {...svgBase(size)}>
    <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" />
    <circle cx="12" cy="10" r="3" />
  </svg>
);

export const PhoneIcon = ({ size = 18 }: IconProps) => (
  <svg {...svgBase(size)}>
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
  </svg>
);

export const KeyIcon = ({ size = 18 }: IconProps) => (
  <svg {...svgBase(size)}>
    <circle cx="7.5" cy="15.5" r="5.5" />
    <path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3" />
  </svg>
);

export const EyeIcon = ({ size = 18 }: IconProps) => (
  <svg {...svgBase(size)}>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

export const EyeOffIcon = ({ size = 18 }: IconProps) => (
  <svg {...svgBase(size)}>
    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c6.5 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
    <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3.5 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
    <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24M1 1l22 22" />
  </svg>
);

export const ArrowRightIcon = ({ size = 18 }: IconProps) => (
  <svg {...svgBase(size)}>
    <path d="M5 12h14M12 5l7 7-7 7" />
  </svg>
);

export const BoxIcon = ({ size = 20 }: IconProps) => (
  <svg {...svgBase(size)}>
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    <path d="m3.27 6.96 8.73 5.05 8.73-5.05M12 22.08V12" />
  </svg>
);

// ---------------------------------------------------------------------------
// Uppercase field label (with optional right-side slot, e.g. "Forgot?")
// ---------------------------------------------------------------------------

export function FieldLabel({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 7 }}>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#64748b" }}>
        {children}
      </span>
      {right}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Input with a leading icon (and optional trailing slot)
// ---------------------------------------------------------------------------

type IconInputProps = {
  icon: React.ReactNode;
  trailing?: React.ReactNode;
} & React.InputHTMLAttributes<HTMLInputElement>;

export function IconInput({ icon, trailing, style, ...props }: IconInputProps) {
  return (
    <div style={{ position: "relative" }}>
      <span
        style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#94a3b8", display: "flex", pointerEvents: "none" }}
      >
        {icon}
      </span>
      <input
        {...props}
        className="input"
        style={{ paddingLeft: 40, paddingRight: trailing ? 44 : 12, paddingTop: 12, paddingBottom: 12, width: "100%", background: "#ffffff", ...style }}
      />
      {trailing && (
        <span style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", display: "flex" }}>{trailing}</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Password input with lock icon + show/hide eye toggle
// ---------------------------------------------------------------------------

type IconPasswordInputProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  required?: boolean;
  show: boolean;
  onToggle: () => void;
  autoComplete?: string;
  icon?: React.ReactNode;
};

export function IconPasswordInput({
  value,
  onChange,
  placeholder,
  required,
  show,
  onToggle,
  autoComplete,
  icon,
}: IconPasswordInputProps) {
  return (
    <IconInput
      icon={icon ?? <LockIcon />}
      type={show ? "text" : "password"}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      required={required}
      autoComplete={autoComplete}
      trailing={
        <button
          type="button"
          onClick={onToggle}
          aria-label={show ? "Hide password" : "Show password"}
          style={{ border: "none", background: "transparent", cursor: "pointer", color: "#94a3b8", display: "flex", padding: 6 }}
        >
          {show ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      }
    />
  );
}
