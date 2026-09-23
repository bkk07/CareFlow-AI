import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowRight, Menu, Phone, ShieldCheck, X } from "lucide-react";
import { Logo } from "./PatientShell";

/** Single source of truth for the public navbar (landing + auth pages). */
export const PUBLIC_NAV_LINKS = [
  { label: "Find Care", href: "#find-care" },
  { label: "Doctors", href: "#doctors" },
  { label: "Hospitals", href: "#hospitals" },
  { label: "How It Works", href: "#how-it-works" },
  { label: "About", href: "#about" },
];

export default function PublicNav() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Section anchors live on the landing page: prefix with "/" elsewhere.
  const href = (hash: string) => (pathname === "/" ? hash : `/${hash}`);

  return (
    <>
      {/* Top utility bar — real-hospital feel */}
      <div className="bg-navy-deep text-white">
        <div className="mx-auto flex h-9 max-w-[1280px] items-center gap-3 px-4 text-[0.74rem] font-medium sm:px-6">
          <span className="inline-flex items-center gap-1.5 text-white/85">
            <ShieldCheck size={13} className="text-teal-soft" /> Secure patient scheduling · Private by design
          </span>
          <span className="flex-1" />
          <a href="tel:911" className="hidden items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 font-bold text-white hover:bg-white/20 sm:inline-flex">
            <Phone size={12} /> Emergency: 911
          </a>
          <Link to="/login" className="hidden text-white/85 hover:text-white md:inline">
            For hospitals →
          </Link>
        </div>
      </div>

      {/* Navbar */}
      <header className={`sticky top-0 z-40 border-b bg-white/90 backdrop-blur-md transition-shadow ${scrolled ? "border-slate-200 shadow-[0_8px_30px_-12px_rgba(14,46,74,0.25)]" : "border-slate-200/80"}`}>
        <nav aria-label="Primary" className="mx-auto flex h-[72px] max-w-[1280px] items-center gap-3 px-4 sm:px-6">
          <Logo />
          <div className="ml-8 hidden items-center gap-1 lg:flex">
            {PUBLIC_NAV_LINKS.map((l) => (
              <a
                key={l.label}
                href={href(l.href)}
                className="rounded-full px-4 py-2 text-[0.9rem] font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-navy"
              >
                {l.label}
              </a>
            ))}
          </div>
          <div className="flex-1" />
          <Link
            to="/login"
            className="hidden min-h-[2.6rem] items-center rounded-xl px-4 text-[0.9rem] font-semibold text-navy transition hover:bg-slate-100 sm:inline-flex"
          >
            Sign In
          </Link>
          <Link
            to="/register"
            className="hidden min-h-[2.6rem] items-center gap-1.5 rounded-xl bg-navy px-5 text-[0.9rem] font-bold text-white shadow-[0_8px_20px_-8px_rgba(14,46,74,0.5)] transition hover:bg-navy-deep sm:inline-flex"
          >
            Get Started <ArrowRight size={16} />
          </Link>
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-navy lg:hidden"
          >
            {menuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </nav>
        {menuOpen && (
          <div className="border-t border-slate-200 bg-white px-4 py-3 lg:hidden">
            {PUBLIC_NAV_LINKS.map((l) => (
              <a
                key={l.label}
                href={href(l.href)}
                onClick={() => setMenuOpen(false)}
                className="block rounded-xl px-3 py-2.5 text-[0.95rem] font-semibold text-ink hover:bg-slate-50"
              >
                {l.label}
              </a>
            ))}
            <div className="mt-2 flex gap-2 pb-1">
              <Link to="/login" onClick={() => setMenuOpen(false)} className="flex-1 rounded-xl border border-slate-200 py-3 text-center text-[0.9rem] font-bold text-navy">
                Sign In
              </Link>
              <Link to="/register" onClick={() => setMenuOpen(false)} className="flex-1 rounded-xl bg-navy py-3 text-center text-[0.9rem] font-bold text-white">
                Get Started
              </Link>
            </div>
          </div>
        )}
      </header>
    </>
  );
}
