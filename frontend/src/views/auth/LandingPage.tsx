import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import appLogo from "../../asset/logo.png";
import wareImage from "../../asset/Ware.png";
import { BENEFIT_ITEMS, FEATURE_ITEMS, useWarmBackend } from "./authShared";

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
          <a href="#benefits">Benefits</a>
          <a href="#pricing">Pricing</a>
          <button type="button" className="auth-magic-btn" onClick={() => navigate("/login")} style={{ cursor: "pointer" }}>
            Sign In
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

      <section className="auth-signin-zone">
        <div className="auth-signin-card">
          <div className="auth-signin-left">
            <div className="auth-signin-header">
              <img src={appLogo} alt="Gel Invent" className="auth-mini-brand" style={{ objectFit: "cover", background: "#fff" }} />
            </div>
            <h2>Ready to get organized?</h2>
            <p>Create your workspace in minutes, or sign in to pick up where you left off.</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 24 }}>
              <button
                type="button"
                className="button"
                onClick={() => navigate("/signup")}
                style={{
                  width: "100%",
                  padding: 14,
                  fontSize: 16,
                  fontWeight: 600,
                  background: "linear-gradient(135deg, #1f7aff, #8246ff)",
                  cursor: "pointer",
                }}
              >
                Get Started — Create account
              </button>
              <button
                type="button"
                onClick={() => navigate("/login")}
                style={{
                  width: "100%",
                  padding: 14,
                  fontSize: 16,
                  fontWeight: 600,
                  background: "#ffffff",
                  border: "1px solid #c7d2fe",
                  color: "#1d4ed8",
                  borderRadius: 8,
                  cursor: "pointer",
                }}
              >
                I already have an account
              </button>
            </div>
          </div>

          <div className="auth-signin-right" id="pricing">
            <div className="auth-signin-right-illustration" aria-hidden>
              <div className="dot dot-a" />
              <div className="dot dot-b" />
              <div className="dot dot-c" />
            </div>
            <h3>Run every branch from one place</h3>
            <p>Use one dashboard to track sales, monitor stock levels, and coordinate teams without switching tools.</p>
            <ul>
              <li>Live stock updates and reorder warnings</li>
              <li>Branch-aware sales and inventory reporting</li>
              <li>Fast checkout and movement history tracking</li>
            </ul>
          </div>
        </div>
      </section>

      <footer className="auth-page-footer">© 2026 Gel Invent. All rights reserved.</footer>
    </div>
  );
}
