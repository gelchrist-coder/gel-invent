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

/**
 * Centered card layout used by the standalone Sign In / Sign Up / Reset pages.
 * Keeps a consistent brand header and a link back to the marketing home page.
 */
export default function AuthShell({ title, subtitle, children, footer }: AuthShellProps) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        background: "linear-gradient(160deg, #eef2ff 0%, #f8fafc 45%, #ffffff 100%)",
        padding: "32px 16px",
      }}
    >
      <Link
        to="/"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          textDecoration: "none",
          marginBottom: 24,
        }}
      >
        <img
          src={appLogo}
          alt="Gel Invent"
          style={{ width: 44, height: 44, borderRadius: 10, objectFit: "cover", background: "#fff" }}
        />
        <div>
          <p style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "#0f172a" }}>Gel Invent</p>
          <p style={{ margin: 0, fontSize: 12, color: "#64748b" }}>Inventory Management System</p>
        </div>
      </Link>

      <div
        style={{
          width: "100%",
          maxWidth: 460,
          background: "#ffffff",
          border: "1px solid #e2e8f0",
          borderRadius: 16,
          boxShadow: "0 18px 48px rgba(15, 23, 42, 0.10)",
          padding: "28px 26px",
        }}
      >
        <h2 style={{ margin: "0 0 6px", fontSize: 24, fontWeight: 800, color: "#0f172a" }}>{title}</h2>
        {subtitle && <p style={{ margin: "0 0 22px", fontSize: 14, color: "#64748b" }}>{subtitle}</p>}

        {children}
      </div>

      {footer && (
        <div style={{ marginTop: 22, textAlign: "center", fontSize: 14, color: "#64748b" }}>{footer}</div>
      )}

      <Link to="/" style={{ marginTop: 18, fontSize: 13, color: "#64748b", textDecoration: "none" }}>
        ← Back to home
      </Link>
    </div>
  );
}
