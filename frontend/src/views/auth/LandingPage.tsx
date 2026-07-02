import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import appLogo from "../../asset/logo.png";
import { BENEFIT_ITEMS, FEATURE_ITEMS, useWarmBackend } from "./authShared";

const I = ({ children, size = 26 }: { children: React.ReactNode; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);

const CheckIcon = () => (
  <I size={16}>
    <path d="M20 6 9 17l-5-5" />
  </I>
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

// Feature icons (order matches FEATURE_ITEMS: tracking, branches, sales, loss prevention)
const BoxIcon = () => (
  <I size={22}>
    <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
    <path d="m3.3 7 8.7 5 8.7-5" />
    <path d="M12 22V12" />
  </I>
);
const BranchesIcon = () => (
  <I size={22}>
    <circle cx="6" cy="6" r="3" />
    <circle cx="18" cy="18" r="3" />
    <path d="M6 9v3a3 3 0 0 0 3 3h6" />
  </I>
);
const ChartIcon = () => (
  <I size={22}>
    <path d="M3 3v16a2 2 0 0 0 2 2h16" />
    <path d="m7 14 4-4 4 4 5-6" />
  </I>
);
const ShieldIcon = () => (
  <I size={22}>
    <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
    <path d="m9 12 2 2 4-4" />
  </I>
);
const FEATURE_ICONS = [BoxIcon, BranchesIcon, ChartIcon, ShieldIcon];

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

/**
 * Pure-CSS isometric warehouse scene: a grid floor, floating parcel cubes and
 * glass KPI chips. No 3D library — just transforms — so it costs nothing on
 * load and animates smoothly on phones.
 */
function Hero3DScene() {
  return (
    <div className="hero3d" aria-hidden>
      <div className="hero3d-glow" />
      <div className="hero3d-floor" />

      {/* Parcel cubes, arranged as a small warehouse stack */}
      <div className="iso-cube" style={{ left: "34%", bottom: "20%", animationDelay: "0s" }}>
        <div className="f f-front" /><div className="f f-right" /><div className="f f-top" />
      </div>
      <div className="iso-cube" style={{ left: "16%", bottom: "34%", ["--s" as string]: "62px", animationDelay: "0.8s" } as React.CSSProperties}>
        <div className="f f-front" /><div className="f f-right" /><div className="f f-top" />
      </div>
      <div className="iso-cube" style={{ left: "57%", bottom: "38%", ["--s" as string]: "52px", animationDelay: "1.6s" } as React.CSSProperties}>
        <div className="f f-front" /><div className="f f-right" /><div className="f f-top" />
      </div>
      <div className="iso-cube" style={{ left: "66%", bottom: "12%", ["--s" as string]: "68px", animationDelay: "2.4s" } as React.CSSProperties}>
        <div className="f f-front" /><div className="f f-right" /><div className="f f-top" />
      </div>

      {/* Floating KPI chips */}
      <div className="hero3d-chip" style={{ top: "6%", left: "4%", animationDelay: "0.4s" }}>
        <span className="chip-dot" style={{ background: "#34d399" }} />
        Stock In <strong>+120</strong> <span className="chip-up">▲ today</span>
      </div>
      <div className="hero3d-chip" style={{ top: "26%", right: "0%", animationDelay: "1.4s" }}>
        <span className="chip-dot" style={{ background: "#fbbf24" }} />
        Low stock <strong>3 items</strong> <span className="chip-warn">restock</span>
      </div>
      <div className="hero3d-chip" style={{ bottom: "4%", left: "18%", animationDelay: "2.2s" }}>
        <span className="chip-dot" style={{ background: "#60a5fa" }} />
        Today&apos;s Sales <strong>GHS 2,450</strong>
      </div>
    </div>
  );
}

/**
 * Scrollytelling: elements with .reveal fade/slide in the first time they
 * scroll into view. Falls back to always-visible when the browser lacks
 * IntersectionObserver or the user prefers reduced motion.
 */
function useScrollReveal() {
  useEffect(() => {
    const elements = Array.from(document.querySelectorAll<HTMLElement>(".reveal"));
    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (prefersReduced || typeof IntersectionObserver === "undefined") {
      elements.forEach((el) => el.classList.add("is-visible"));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: "0px 0px -40px 0px" },
    );

    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);
}

const revealDelay = (index: number): React.CSSProperties =>
  ({ ["--reveal-delay" as string]: `${(index % 8) * 70}ms` }) as React.CSSProperties;

export default function LandingPage() {
  const navigate = useNavigate();
  const [scrollProgress, setScrollProgress] = useState(0);
  useWarmBackend();
  useScrollReveal();

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
      {/* Ambient background: drifting glow orbs + dotted grid behind everything */}
      <div className="auth-ambient" aria-hidden>
        <span className="orb orb-1" />
        <span className="orb orb-2" />
        <span className="orb orb-3" />
        <span className="orb orb-4" />
      </div>

      <header className="auth-top-nav">
        <div className="auth-brand-wrap">
          <img src={appLogo} alt="Gel Invent" className="auth-brand-mark" style={{ objectFit: "cover", background: "#fff" }} />
          <div>
            <p className="auth-brand-title">Gel Invent</p>
            <p className="auth-brand-subtitle">Inventory Management System</p>
          </div>
        </div>
        <nav className="auth-top-links" aria-label="Marketing links">
          <div className="auth-top-anchors">
            <a href="#features">Features</a>
            <a href="#industries">Industries</a>
            <a href="#benefits">Benefits</a>
          </div>
          <button type="button" className="auth-nav-ghost" onClick={() => navigate("/login")}>
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
            Every item counted.
            <br />
            <span>Every sale on record.</span>
          </h1>
          <p>
            Track stock in real time, sell from a fast POS, print professional receipts,
            and watch every branch from one clean dashboard.
          </p>
          <div className="auth-hero-actions">
            <button type="button" className="auth-primary-cta" onClick={() => navigate("/signup")}>
              Get Started — It&apos;s Fast
            </button>
            <button type="button" className="auth-secondary-cta" onClick={() => navigate("/login")}>
              Sign In
            </button>
          </div>
          <div className="auth-hero-trust">
            <span><CheckIcon /> Works on phone &amp; desktop</span>
            <span><CheckIcon /> Multi-branch ready</span>
            <span><CheckIcon /> Receipts, taxes &amp; credit sales</span>
          </div>
        </div>
        <Hero3DScene />
      </section>

      <section className="auth-marketing-band" id="features">
        <div className="auth-marketing-head reveal">
          <p className="auth-kicker">Features</p>
          <h2>Everything you need to run inventory with confidence</h2>
        </div>
        <div className="auth-marketing-grid">
          {FEATURE_ITEMS.map((item, index) => {
            const FeatureIcon = FEATURE_ICONS[index % FEATURE_ICONS.length];
            const tint = ["tint-blue", "tint-violet", "tint-green", "tint-amber"][index % 4];
            return (
              <article
                key={item.title}
                className={`auth-marketing-card auth-feature-card ${tint} reveal`}
                style={revealDelay(index)}
                data-index={String(index + 1).padStart(2, "0")}
              >
                <div className="auth-feature-chip" aria-hidden>
                  <FeatureIcon />
                </div>
                <h3>{item.title}</h3>
                <p>{item.description}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="auth-marketing-band" id="industries">
        <div className="auth-marketing-head reveal">
          <p className="auth-kicker">Industries</p>
          <h2>Built for your business</h2>
          <p style={{ margin: "10px auto 0", maxWidth: 560, color: "#64748b", fontSize: 15 }}>
            Whatever you sell, Gel Invent adapts to how your business works.
          </p>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 14,
            marginTop: 28,
          }}
        >
          {BUSINESS_USE_CASES.map((useCase, index) => (
            <article
              key={useCase.name}
              className={`auth-marketing-card reveal ${index % 2 === 0 ? "reveal-left" : "reveal-right"}`}
              style={revealDelay(index)}
            >
              <div className="auth-feature-chip" aria-hidden>
                <useCase.Icon />
              </div>
              <h3>{useCase.name}</h3>
              <p>{useCase.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="auth-marketing-band auth-marketing-band-benefits" id="benefits">
        <div className="auth-marketing-head reveal">
          <p className="auth-kicker">Benefits</p>
          <h2>Why teams choose Gel Invent every day</h2>
        </div>
        <div className="auth-marketing-grid auth-marketing-grid-benefits">
          {BENEFIT_ITEMS.map((item, index) => (
            <article
              key={item.title}
              className="auth-marketing-card auth-marketing-card-benefit reveal"
              style={revealDelay(index)}
            >
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
