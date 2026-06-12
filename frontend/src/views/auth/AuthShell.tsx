import { ReactNode } from "react";
import { Link } from "react-router-dom";

import appLogo from "../../asset/logo.png";
import { AUTH_PRIMARY } from "./authShared";

type AuthShellProps = {
  title: string;
  subtitle?: string;
  children: ReactNode;
  /** Optional footer row, e.g. "New here? Create an account". */
  footer?: ReactNode;
};

const DOT_PATTERN =
  "radial-gradient(circle, rgba(148, 163, 184, 0.28) 0.5px, transparent 0.5px)";

/**
 * Enterprise-style auth layout shared by Sign In / Sign Up / Reset:
 * centered brand + tagline above a clean white card, with a slim footer bar.
 */
export default function AuthShell({ title, subtitle, children, footer }: AuthShellProps) {
  return (
    <div
      className="auth-shell"
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "#f1f5f9",
        backgroundImage: DOT_PATTERN,
        backgroundSize: "22px 22px",
      }}
    >
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "40px 16px",
        }}
      >
        <div style={{ width: "100%", maxWidth: 430 }}>
          {/* Brand + tagline */}
          <div style={{ textAlign: "center", marginBottom: 22 }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 10, color: AUTH_PRIMARY }}>
              <img
                src={appLogo}
                alt="Gel Invent"
                style={{ width: 40, height: 40, borderRadius: 10, objectFit: "cover", background: "#ffffff" }}
              />
              <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: 0.2 }}>Gel Invent</span>
            </div>
          </div>

          {/* Card */}
          <div
            className="auth-card-pop"
            style={{
              background: "#ffffff",
              border: "1px solid #e6ebf3",
              borderRadius: 16,
              boxShadow: "0 18px 44px rgba(15, 23, 42, 0.10)",
              padding: "26px 26px 28px",
            }}
          >
            <h2 style={{ margin: "0 0 4px", fontSize: 22, fontWeight: 800, color: "#0f172a" }}>{title}</h2>
            {subtitle && <p style={{ margin: "0 0 22px", fontSize: 14, color: "#64748b" }}>{subtitle}</p>}

            {children}
          </div>

          {/* Footer link (e.g. New here? Create an account) */}
          {footer && (
            <div style={{ marginTop: 20, textAlign: "center", fontSize: 14, color: "#64748b" }}>{footer}</div>
          )}
        </div>
      </div>

      {/* Slim footer bar */}
      <footer
        style={{
          borderTop: "1px solid #e2e8f0",
          background: "rgba(255,255,255,0.7)",
          padding: "14px 20px",
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: 12.5,
          color: "#94a3b8",
        }}
      >
        <span>© 2026 Gel Invent. All rights reserved.</span>
        <Link to="/" style={{ color: "#94a3b8", textDecoration: "none" }}>
          Home
        </Link>
      </footer>
    </div>
  );
}
