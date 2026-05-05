"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { LogoutButton } from "./logout-button";

type AppNavItem = {
  href: string;
  label: string;
  match: "exact" | "startsWith";
};

type MarketingNavItem = {
  href: string;
  label: string;
};

const PRIMARY_NAV: AppNavItem[] = [
  { href: "/dashboard", label: "Dashboard", match: "exact" },
  { href: "/rules", label: "Trading Plan", match: "exact" },
  { href: "/accounts", label: "Broker Connections", match: "startsWith" },
];

const MORE_NAV: AppNavItem[] = [
  { href: "/guardian", label: "Status details", match: "exact" },
  { href: "/journal", label: "Trade Review", match: "exact" },
  { href: "/alerts", label: "Alerts", match: "exact" },
  { href: "/settings", label: "Settings", match: "exact" },
  { href: "/onboarding", label: "Setup guide", match: "exact" },
];

const ALL_NAV: AppNavItem[] = [...PRIMARY_NAV, ...MORE_NAV];

// Desktop: 5 items (Security lives in footer + mobile)
const MARKETING_NAV_DESKTOP: MarketingNavItem[] = [
  { href: "/features", label: "Features" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/prop-firms", label: "Prop firms" },
  { href: "/pricing", label: "Pricing" },
  { href: "/faq", label: "FAQ" },
];

// Mobile dropdown: all 6 marketing pages
const MARKETING_NAV_MOBILE: MarketingNavItem[] = [
  { href: "/features", label: "Features" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/prop-firms", label: "Prop firms" },
  { href: "/security", label: "Security" },
  { href: "/pricing", label: "Pricing" },
  { href: "/faq", label: "FAQ" },
];

const MARKETING_ROUTES = new Set<string>([
  "/",
  "/features",
  "/how-it-works",
  "/security",
  "/prop-firms",
  "/pricing",
  "/faq",
]);

function isActive(pathname: string, item: AppNavItem): boolean {
  if (item.match === "exact") return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function useDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return { open, setOpen, ref };
}

export function TopNav({ authenticated }: { authenticated: boolean }) {
  const pathname = usePathname() ?? "/";
  const onMarketingRoute = MARKETING_ROUTES.has(pathname);
  const { open: moreOpen, setOpen: setMoreOpen, ref: moreRef } = useDropdown();
  const { open: mobileOpen, setOpen: setMobileOpen, ref: mobileRef } = useDropdown();

  if (!authenticated) {
    return (
      <div className="flex items-center gap-1">
        {/* ── Desktop marketing nav (md+) ─────────────────────────── */}
        <nav className="hidden items-center md:flex" aria-label="Marketing">
          <div className="flex items-center gap-0.5">
            {MARKETING_NAV_DESKTOP.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`rounded-full px-3 py-1.5 text-sm transition-colors sm:px-3.5 ${
                    active
                      ? "bg-stone-100 font-medium text-stone-950"
                      : "text-stone-600 hover:bg-stone-900/5 hover:text-stone-950"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
          <span className="mx-1.5 h-4 w-px shrink-0 bg-stone-200/80" aria-hidden />
          <Link
            href="/login"
            className="whitespace-nowrap rounded-full px-2.5 py-1.5 text-sm text-stone-600 transition-colors hover:text-stone-950 sm:px-3.5"
          >
            Log in
          </Link>
          <Link
            href="/signup"
            className="whitespace-nowrap rounded-full bg-stone-950 px-3 py-1.5 text-sm font-medium text-stone-50 shadow-[0_2px_8px_-2px_rgba(28,25,23,0.35)] transition-colors hover:bg-stone-800 sm:px-4"
          >
            Sign up
          </Link>
        </nav>

        {/* ── Mobile backdrop ──────────────────────────────────────── */}
        {mobileOpen && (
          <div
            className="fixed inset-0 z-40 md:hidden"
            style={{ background: "rgba(28,25,23,0.07)" }}
            aria-hidden
            onClick={() => setMobileOpen(false)}
          />
        )}

        {/* ── Mobile menu button + dropdown (below md) ─────────────── */}
        <div className="relative md:hidden" ref={mobileRef}>
          <button
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            aria-expanded={mobileOpen}
            aria-haspopup="menu"
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-stone-600 transition-colors hover:bg-stone-900/5 hover:text-stone-950"
          >
            Menu
            <span
              className={`text-[10px] transition-transform ${mobileOpen ? "rotate-180" : ""}`}
              aria-hidden
            >
              ▾
            </span>
          </button>

          {mobileOpen && (
            <div
              role="menu"
              className="absolute right-0 top-full z-50 mt-1 w-52 overflow-hidden rounded-2xl border border-stone-200 bg-white py-1 shadow-[0_12px_40px_-12px_rgba(28,25,23,0.28)]"
            >
              {MARKETING_NAV_MOBILE.map((item) => {
                const active = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    role="menuitem"
                    aria-current={active ? "page" : undefined}
                    onClick={() => setMobileOpen(false)}
                    className={
                      active
                        ? "block bg-stone-100 px-4 py-2 text-sm font-semibold text-stone-950"
                        : "block px-4 py-2 text-sm text-stone-700 hover:bg-stone-50 hover:text-stone-950"
                    }
                  >
                    {item.label}
                  </Link>
                );
              })}
              <div className="mx-4 my-1 h-px bg-stone-100" />
              <Link
                href="/signup"
                role="menuitem"
                onClick={() => setMobileOpen(false)}
                className="block px-4 py-2.5 text-sm font-medium text-stone-950 hover:bg-stone-50"
              >
                Start free week
              </Link>
              <Link
                href="/login"
                role="menuitem"
                onClick={() => setMobileOpen(false)}
                className="block px-4 py-2 text-sm text-stone-600 hover:bg-stone-50 hover:text-stone-950"
              >
                Log in
              </Link>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (onMarketingRoute) {
    return (
      <nav className="flex items-center gap-1">
        <LogoutButton />
        <Link
          href="/dashboard"
          className="whitespace-nowrap rounded-full bg-stone-950 px-3 py-1.5 text-xs font-medium text-stone-50 shadow-[0_2px_8px_-2px_rgba(28,25,23,0.35)] transition-colors hover:bg-stone-800 sm:px-4 sm:py-2 sm:text-sm"
        >
          Go to dashboard
        </Link>
      </nav>
    );
  }

  const pillBase = "shrink-0 rounded-full px-3.5 py-1.5 transition-colors sm:px-4 sm:py-2";
  const pillActive = "bg-stone-950 font-medium text-stone-50 shadow-[0_2px_8px_-2px_rgba(28,25,23,0.35)]";
  const pillIdle = "text-stone-600 hover:bg-stone-900/5 hover:text-stone-950";
  const moreActive = MORE_NAV.some((item) => isActive(pathname, item));

  return (
    <div className="flex items-center">
      {/* ── Desktop nav (md+) ─────────────────────────────────────── */}
      <nav className="hidden items-center text-sm md:flex" aria-label="Primary">
        <div className="flex items-center gap-0.5 sm:gap-1">
          {PRIMARY_NAV.map((item) => {
            const active = isActive(pathname, item);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`${pillBase} ${active ? pillActive : pillIdle}`}
              >
                {item.label}
              </Link>
            );
          })}
        </div>

        {/* More dropdown */}
        <div className="relative ml-0.5 shrink-0 sm:ml-1" ref={moreRef}>
          <button
            type="button"
            onClick={() => setMoreOpen((v) => !v)}
            aria-expanded={moreOpen}
            aria-haspopup="menu"
            className={`${pillBase} ${moreActive ? pillActive : pillIdle} inline-flex items-center gap-1`}
          >
            More
            <span
              className={`text-[10px] transition-transform ${moreOpen ? "rotate-180" : ""}`}
              aria-hidden
            >
              ▾
            </span>
          </button>

          {moreOpen && (
            <div
              role="menu"
              className="absolute right-0 top-full z-50 mt-1 w-44 overflow-hidden rounded-2xl border border-stone-200 bg-white py-1 shadow-[0_12px_40px_-12px_rgba(28,25,23,0.28)]"
            >
              {MORE_NAV.map((item) => {
                const active = isActive(pathname, item);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    role="menuitem"
                    aria-current={active ? "page" : undefined}
                    onClick={() => setMoreOpen(false)}
                    className={
                      active
                        ? "block bg-stone-100 px-4 py-2.5 text-sm font-semibold text-stone-950"
                        : "block px-4 py-2.5 text-sm text-stone-700 hover:bg-stone-50 hover:text-stone-950"
                    }
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        <span className="mx-1 h-5 w-px shrink-0 bg-stone-200/80" aria-hidden />
        <LogoutButton />
      </nav>

      {/* ── Mobile backdrop (below md, when menu open) ───────────── */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 md:hidden"
          style={{ background: "rgba(28,25,23,0.07)" }}
          aria-hidden
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* ── Mobile menu button + dropdown (below md) ──────────────── */}
      <div className="relative md:hidden" ref={mobileRef}>
        <button
          type="button"
          onClick={() => setMobileOpen((v) => !v)}
          aria-expanded={mobileOpen}
          aria-haspopup="menu"
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-stone-600 transition-colors hover:bg-stone-900/5 hover:text-stone-950"
        >
          Menu
          <span
            className={`text-[10px] transition-transform ${mobileOpen ? "rotate-180" : ""}`}
            aria-hidden
          >
            ▾
          </span>
        </button>

        {mobileOpen && (
          <div
            role="menu"
            className="absolute right-0 top-full z-50 mt-1 w-52 overflow-hidden rounded-2xl border border-stone-200 bg-white py-1 shadow-[0_12px_40px_-12px_rgba(28,25,23,0.28)]"
          >
            {ALL_NAV.map((item) => {
              const active = isActive(pathname, item);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  role="menuitem"
                  aria-current={active ? "page" : undefined}
                  onClick={() => setMobileOpen(false)}
                  className={
                    active
                      ? "block bg-stone-100 px-4 py-2 text-sm font-semibold text-stone-950"
                      : "block px-4 py-2 text-sm text-stone-700 hover:bg-stone-50 hover:text-stone-950"
                  }
                >
                  {item.label}
                </Link>
              );
            })}
            <div className="mx-4 my-1 h-px bg-stone-100" />
            <LogoutButton variant="menu" />
          </div>
        )}
      </div>
    </div>
  );
}
