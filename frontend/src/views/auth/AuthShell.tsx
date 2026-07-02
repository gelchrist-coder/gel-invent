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

const CheckIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

/** Small isometric parcel-cube cluster matching the landing page hero. */
function BrandScene() {
  const cube = (style: React.CSSProperties, delay: string) => (
    <div className="iso-cube" style={{ ...style, animationDelay: delay }}>
      <div className="f f-front" />
      <div className="f f-right" />
      <div className="f f-top" />
    </div>
  );

  return (
    <div className="auth-split-scene" aria-hidden>
      <div className="hero3d-glow" />
      <div className="hero3d-floor" style={{ bottom: "-6%", height: "80%" }} />
      {cube({ left: "30%", bottom: "22%" }, "0s")}
      {cube({ left: "12%", bottom: "36%", ["--s" as string]: "56px" } as React.CSSProperties, "0.9s")}
      {cube({ left: "56%", bottom: "40%", ["--s" as string]: "46px" } as React.CSSProperties, "1.7s")}
      <div className="hero3d-chip" style={{ top: "2%", right: "2%", animationDelay: "0.5s" }}>
        <span className="chip-dot" style={{ background: "#34d399" }} />
        Stock In <strong>+120</strong>
      </div>
      <div className="hero3d-chip" style={{ bottom: "12%", right: "4%", animationDelay: "1.6s" }}>
        <span className="chip-dot" style={{ background: "#60a5fa" }} />
        Today&apos;s Sales <strong>GHS 2,450</strong>
      </div>
    </div>
  );
}

/**
 * Split auth layout shared by Sign In / Sign Up / Reset: dark brand panel with
 * the 3D warehouse motif on the left, clean form card on the right. The brand
 * panel hides below 960px and a compact centered brand takes over.
 */
export default function AuthShell({ title, subtitle, children, footer }: AuthShellProps) {
  return (
    <div className="auth-shell auth-split">
      <aside className="auth-split-brand">
        <Link to="/" className="auth-split-brand-top" style={{ textDecoration: "none", color: "inherit" }}>
          <img src={appLogo} alt="Gel Invent" />
          <span>Gel Invent</span>
        </Link>

        <div>
          <BrandScene />
          <h2>
            Every item counted.
            <br />
            <span>Every sale on record.</span>
          </h2>
          <p>Stock, sales, receipts and branches — one clean workspace your whole team can use.</p>
          <ul className="auth-split-checklist">
            <li><CheckIcon /> Real-time stock across branches</li>
            <li><CheckIcon /> Fast POS with professional receipts</li>
            <li><CheckIcon /> Clear daily, weekly &amp; monthly reports</li>
          </ul>
        </div>

        <p className="auth-split-copy">© 2026 Gel Invent. All rights reserved.</p>
      </aside>

      <main className="auth-split-form">
        <div className="auth-split-form-inner">
          {/* Compact brand shown only when the left panel is hidden (mobile) */}
          <div className="auth-split-mobile-brand">
            <Link to="/" style={{ display: "inline-flex", alignItems: "center", gap: 10, color: AUTH_PRIMARY, textDecoration: "none" }}>
              <img
                src={appLogo}
                alt="Gel Invent"
                style={{ width: 40, height: 40, borderRadius: 10, objectFit: "cover", background: "#ffffff" }}
              />
              <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: 0.2 }}>Gel Invent</span>
            </Link>
          </div>

          <div className="auth-split-card auth-card-pop">
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}

            {children}
          </div>

          {footer && <div className="auth-split-footerlink">{footer}</div>}
        </div>
      </main>
    </div>
  );
}
