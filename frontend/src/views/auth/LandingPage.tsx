import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import appLogo from "../../asset/logo.png";
import wareImage from "../../asset/Ware.webp";
import { BENEFIT_ITEMS, FEATURE_ITEMS, useWarmBackend } from "./authShared";

const I = ({ children }: { children: React.ReactNode }) => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);

const PharmacyIcon = () => (
  <I>
    <path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z" />
    <path d="m8.5 8.5 7 7" />
  </I>
);
const GroceryIcon = () => (
  <I>
    <circle cx="8" cy="21" r="1" />
    <circle cx="19" cy="21" r="1" />
    <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" />
  </I>
);
const CosmeticsIcon = () => (
  <I>
    <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z" />
  </I>
);
const FashionIcon = () => (
  <I>
    <path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z" />
  </I>
);
const HardwareIcon = () => (
  <I>
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
  </I>
);
const ConstructionIcon = () => (
  <I>
    <path d="M2 18a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1h20a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1Z" />
    <path d="M10 10V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v5" />
    <path d="M4 15v-3a6 6 0 0 1 6-6" />
    <path d="M14 6a6 6 0 0 1 6 6v3" />
  </I>
);
const AgroIcon = () => (
  <I>
    <path d="M7 20h10" />
    <path d="M10 20c5.5-2.5.8-6.4 3-10" />
    <path d="M9.5 9.4c1.1.8 1.8 2.2 2.3 3.7-2 .4-3.5.4-4.8-.3-1.2-.6-2.3-1.9-3-4.2 2.8-.5 4.4 0 5.5.8z" />
    <path d="M14.1 6a7 7 0 0 0-1.1 4c1.9-.1 3.3-.6 4.3-1.4 1-1 1.6-2.3 1.7-4.6-2.7.1-4 1-4.9 2z" />
  </I>
);
const ElectronicsIcon = () => (
  <I>
    <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
    <path d="M12 18h.01" />
  </I>
);

const BUSINESS_USE_CASES = [
  { Icon: PharmacyIcon, name: "Pharmacy", description: "Track medicines, batches & expiry dates with confidence." },
  { Icon: GroceryIcon, name: "Grocery", description: "Stay on top of fast-moving stock and perishables." },
  { Icon: CosmeticsIcon, name: "Cosmetics", description: "Organize brands, shades and product variants." },
  { Icon: FashionIcon, name: "Fashion", description: "Handle sizes, colors and seasonal collections." },
  { Icon: HardwareIcon, name: "Hardware", description: "Count tools, parts and bulk items accurately." },
  { Icon: ConstructionIcon, name: "Construction", description: "Track cement, rods and site supplies across jobs." },
  { Icon: AgroIcon, name: "Agro", description: "Manage seeds, feed and farm inputs with ease." },
  { Icon: ElectronicsIcon, name: "Electronics", description: "Track devices, serial numbers and accessories." },
];

export default function LandingPage() {
  const navigate = useNavigate();
  const [scrollProgress, setScrollProgress] = useState(0);
  useWarmBackend();

  useEffect(() => {
    const onScroll = () => {
      const next = Math.min(window.scrollY / 700, 1);
      setScrollProgress(next);
    };

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="auth-page" style={{ ["--scroll-progress" as string]: scrollProgress } as React.CSSProperties}>
      <header className="auth-top-nav">
        <div className="auth-brand-wrap">
          <img src={appLogo} alt="Gel Invent" className="auth-brand-mark" style={{ objectFit: "cover", background: "#fff" }} />
          <div>
            <p className="auth-brand-title">Gel Invent</p>
            <p className="auth-brand-subtitle">Inventory Management System</p>
          </div>
        </div>
        <nav className="auth-top-links" aria-label="Marketing links">
          <a href="#features">Features</a>
          <a href="#industries">Industries</a>
          <a href="#benefits">Benefits</a>
          <button
            type="button"
            onClick={() => navigate("/login")}
            style={{
              background: "transparent",
              border: "1px solid #c7d2fe",
              color: "#1d4ed8",
              borderRadius: 999,
              padding: "9px 18px",
              fontSize: 14,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Sign In
          </button>
          <button type="button" className="auth-magic-btn" onClick={() => navigate("/signup")} style={{ cursor: "pointer" }}>
            Get Started
          </button>
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
            <button type="button" className="auth-primary-cta" onClick={() => navigate("/signup")}>
              Get Started
            </button>
            <button type="button" className="auth-secondary-cta" onClick={() => navigate("/login")}>
              Sign In
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

      <section className="auth-marketing-band" id="industries">
        <div className="auth-marketing-head">
          <p className="auth-kicker">Industries</p>
          <h2>Built for your business</h2>
          <p style={{ margin: "8px auto 0", maxWidth: 560, color: "#64748b", fontSize: 15 }}>
            Whatever you sell, Gel Invent adapts to how your business works.
          </p>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 16,
            marginTop: 24,
          }}
        >
          {BUSINESS_USE_CASES.map((useCase) => (
            <article
              key={useCase.name}
              style={{
                background: "#ffffff",
                border: "1px solid #e2e8f0",
                borderRadius: 14,
                padding: 20,
                boxShadow: "0 8px 22px rgba(15, 23, 42, 0.05)",
              }}
            >
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 12,
                  background: "#eff6ff",
                  color: "#1d4ed8",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
                aria-hidden
              >
                <useCase.Icon />
              </div>
              <h3 style={{ margin: "14px 0 6px", fontSize: 17, fontWeight: 700, color: "#0f172a" }}>{useCase.name}</h3>
              <p style={{ margin: 0, fontSize: 14, color: "#64748b", lineHeight: 1.5 }}>{useCase.description}</p>
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

      <footer className="auth-page-footer">© 2026 Gel Invent. All rights reserved.</footer>
    </div>
  );
}
