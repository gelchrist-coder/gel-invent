import { ReactNode } from "react";
import { Link } from "react-router-dom";

import appLogo from "../../asset/logo.png";

type AuthShellProps = {
  title: string;
  subtitle?: string;
  children: ReactNode;
  /** Optional footer row, e.g. "Don't have an account? Sign up". */
  footer?: ReactNode;
};

const BRAND_GRADIENT = "linear-gradient(135deg, #1f7aff 0%, #6a3df0 55%, #8246ff 100%)";

/**
 * Polished centered-card layout shared by the standalone Sign In / Sign Up /
 * Reset pages: soft patterned page background, a brand gradient header with a
 * floating logo badge, and a clean white body for the form.
 */
export default function AuthShell({ title, subtitle, children, footer }: AuthShellProps) {
  return (
    <div
      className="auth-shell"
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 16px",
        background: `
          radial-gradient(circle at 18% 12%, rgba(31, 122, 255, 0.12), transparent 42%),
          radial-gradient(circle at 84% 4%, rgba(130, 70, 255, 0.12), transparent 38%),
          radial-gradient(circle at 50% 100%, rgba(31, 122, 255, 0.08), transparent 45%),
          linear-gradient(180deg, #eef3ff 0%, #f6f8fc 55%, #ffffff 100%)
        `,
      }}
    >
      <div
        className="auth-card-pop"
        style={{
          width: "100%",
          maxWidth: 460,
          background: "#ffffff",
          border: "1px solid #e6ebf3",
          borderRadius: 20,
          boxShadow: "0 24px 60px rgba(15, 23, 42, 0.14)",
          overflow: "hidden",
        }}
      >
        {/* Brand gradient header */}
        <div
          style={{
            background: BRAND_GRADIENT,
            padding: "26px 26px 22px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
          }}
        >
          <div
            style={{
              width: 60,
              height: 60,
              borderRadius: 16,
              background: "#ffffff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 10px 24px rgba(15, 23, 42, 0.22)",
              marginBottom: 12,
            }}
          >
            <img
              src={appLogo}
              alt="Gel Invent"
              style={{ width: 42, height: 42, borderRadius: 10, objectFit: "cover" }}
            />
          </div>
          <p style={{ margin: 0, fontSize: 19, fontWeight: 800, color: "#ffffff", letterSpacing: 0.2 }}>Gel Invent</p>
          <p style={{ margin: "2px 0 0", fontSize: 12.5, color: "rgba(255,255,255,0.85)" }}>
            Inventory Management System
          </p>
        </div>

        {/* Body */}
        <div style={{ padding: "26px 26px 28px" }}>
          <div style={{ textAlign: "center", marginBottom: 22 }}>
            <h2 style={{ margin: "0 0 4px", fontSize: 23, fontWeight: 800, color: "#0f172a" }}>{title}</h2>
            {subtitle && <p style={{ margin: 0, fontSize: 14, color: "#64748b" }}>{subtitle}</p>}
          </div>

          {children}

          {footer && (
            <div
              style={{
                marginTop: 22,
                paddingTop: 18,
                borderTop: "1px solid #eef2f7",
                textAlign: "center",
                fontSize: 14,
                color: "#64748b",
              }}
            >
              {footer}
            </div>
          )}
        </div>
      </div>

      <Link
        to="/"
        style={{ marginTop: 20, fontSize: 13, color: "#64748b", textDecoration: "none", fontWeight: 600 }}
      >
        ← Back to home
      </Link>
    </div>
  );
}
