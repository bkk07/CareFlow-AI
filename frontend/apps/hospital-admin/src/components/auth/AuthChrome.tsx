import { useState } from "react";
import { Menu, X } from "lucide-react";
import { Link } from "react-router-dom";
import { CareFlowLogo } from "../brand/CareFlowLogo";

/**
 * Shared auth chrome — mirrors the landing page navbar, surfaces,
 * and typography exactly (white, thin borders, navy headings).
 */

export function AuthNavbar() {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 bg-white border-b border-border">
      <div className="max-w-shell mx-auto px-4 sm:px-6 h-16 md:h-[68px] flex items-center gap-4">
        <Link to="/" aria-label="CareFlow AI home">
          <CareFlowLogo />
        </Link>
        <nav className="hidden lg:flex items-center gap-1 ml-8" aria-label="Primary">
          {[
            ["Platform", "/#platform"],
            ["Solutions", "/#showcase"],
            ["Features", "/#features"],
            ["Security", "/#security"],
            ["Resources", "/#onboarding"],
          ].map(([label, href]) => (
            <a
              key={href + label}
              href={href}
              className="px-3 py-2 rounded-lg text-[0.875rem] font-medium text-ink-secondary hover:text-navy hover:bg-background transition-colors duration-200"
            >
              {label}
            </a>
          ))}
        </nav>
        <div className="flex-1" />
        <Link
          to="/login"
          className="hidden sm:inline-block text-[0.875rem] font-semibold text-ink-secondary hover:text-navy px-3 py-2 transition-colors duration-200"
        >
          Sign In
        </Link>
        <Link
          to="/register"
          className="hidden sm:inline-flex items-center bg-healthcare hover:bg-healthcare-dark text-white text-[0.875rem] font-semibold rounded-control px-4 py-2.5 transition-colors duration-200"
        >
          Get Started
        </Link>
        <button
          className="lg:hidden w-10 h-10 inline-flex items-center justify-center rounded-lg border border-border text-ink"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
        >
          {open ? <X size={19} /> : <Menu size={19} />}
        </button>
      </div>
      {open && (
        <nav className="lg:hidden border-t border-border bg-white px-4 py-3 space-y-1" aria-label="Mobile">
          {[
            ["Platform", "/#platform"],
            ["Solutions", "/#showcase"],
            ["Features", "/#features"],
            ["Security", "/#security"],
            ["Resources", "/#onboarding"],
          ].map(([label, href]) => (
            <a
              key={href + label}
              href={href}
              onClick={() => setOpen(false)}
              className="block px-3 py-2.5 rounded-lg text-[0.95rem] font-medium text-ink hover:bg-background"
            >
              {label}
            </a>
          ))}
          <div className="flex gap-2 pt-2">
            <Link to="/login" className="flex-1 text-center border border-border rounded-control py-2.5 font-semibold text-[0.9rem]">
              Sign In
            </Link>
            <Link to="/register" className="flex-1 text-center bg-healthcare text-white rounded-control py-2.5 font-semibold text-[0.9rem]">
              Get Started
            </Link>
          </div>
        </nav>
      )}
    </header>
  );
}

export function AuthFooter() {
  return (
    <footer className="border-t border-border bg-white">
      <div className="max-w-shell mx-auto px-4 sm:px-6 py-4 flex flex-col sm:flex-row gap-2 items-center justify-between text-[0.78rem] text-ink-secondary">
        <p>© 2026 CareFlow AI. All rights reserved.</p>
        <p className="flex gap-4">
          <Link to="/login" className="hover:text-healthcare font-medium">Sign In</Link>
          <Link to="/register" className="hover:text-healthcare font-medium">Get Started</Link>
        </p>
      </div>
    </footer>
  );
}
