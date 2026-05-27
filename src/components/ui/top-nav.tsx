"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { LogoutButton } from "./logout-button";
import { ALL_NAV, MORE_NAV, PRIMARY_NAV, type AppNavItem } from "./nav-config";

type MarketingNavItem = {
  href: string;
  label: string;
};


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
                  className="rounded-full px-3 py-1.5 text-[13.5px] transition-colors sm:px-3.5"
                  style={{
                    color: active ? "var(--gr-ink)" : "var(--gr-text-mid)",
                    background: active ? "var(--gr-surface-2)" : undefined,
                    fontWeight: active ? 500 : undefined,
                  }}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
          <span
            className="mx-1.5 h-4 w-px shrink-0"
            style={{ background: "var(--gr-border)" }}
            aria-hidden
          />
          <Link
            href="/login"
            className="whitespace-nowrap rounded-full px-2.5 py-1.5 text-[13.5px] transition-colors sm:px-3.5"
            style={{ color: "var(--gr-text-mid)" }}
          >
            Log in
          </Link>
          <Link
            href="/signup"
            className="whitespace-nowrap rounded-full px-3 py-1.5 text-[13.5px] font-medium text-white transition-opacity hover:opacity-90 sm:px-4"
            style={{ background: "var(--gr-ink)" }}
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
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition-colors"
            style={{ color: "var(--gr-text-mid)" }}
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
              className="absolute right-0 top-full z-50 mt-1 w-52 overflow-hidden rounded-[14px] border py-1 shadow-[0_12px_40px_-12px_rgba(28,25,23,0.20)]"
              style={{ background: "var(--gr-surface)", borderColor: "var(--gr-border)" }}
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
                    className="block px-4 py-2 text-[13.5px] transition-colors"
                    style={{
                      color: active ? "var(--gr-ink)" : "var(--gr-text-mid)",
                      background: active ? "var(--gr-surface-2)" : undefined,
                      fontWeight: active ? 600 : undefined,
                    }}
                  >
                    {item.label}
                  </Link>
                );
              })}
              <div className="mx-4 my-1 h-px" style={{ background: "var(--gr-border-sub)" }} />
              <Link
                href="/signup"
                role="menuitem"
                onClick={() => setMobileOpen(false)}
                className="block px-4 py-2.5 text-sm font-medium transition-colors"
                style={{ color: "var(--gr-ink)" }}
              >
                Start free week
              </Link>
              <Link
                href="/login"
                role="menuitem"
                onClick={() => setMobileOpen(false)}
                className="block px-4 py-2 text-sm transition-colors"
                style={{ color: "var(--gr-text-mid)" }}
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
      <nav className="flex items-center gap-2">
        <LogoutButton />
        <Link
          href="/dashboard"
          className="whitespace-nowrap rounded-full px-3 py-1.5 text-[13.5px] font-medium text-white transition-opacity hover:opacity-90 sm:px-4 sm:py-2"
          style={{ background: "var(--gr-ink)" }}
        >
          Go to dashboard
        </Link>
      </nav>
    );
  }

  const pillBase = "shrink-0 rounded-full px-3.5 py-1.5 text-[13.5px] transition-colors sm:px-4 sm:py-2";

  return (
    <div className="flex items-center">
      {/* ── Desktop nav (md+) ─────────────────────────────────────── */}
      <nav className="hidden items-center md:flex" aria-label="Primary">
        <div className="flex items-center gap-0.5 sm:gap-1">
          {PRIMARY_NAV.map((item) => {
            const active = isActive(pathname, item);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={pillBase}
                style={{
                  color: active ? "var(--gr-bg)" : "var(--gr-text-mid)",
                  background: active ? "var(--gr-ink)" : undefined,
                  fontWeight: active ? 500 : undefined,
                }}
              >
                {item.label}
              </Link>
            );
          })}
        </div>

        {/* More dropdown */}
        <div className="relative ml-0.5 shrink-0 sm:ml-1" ref={moreRef}>
          {(() => {
            const moreActive = MORE_NAV.some((item) => isActive(pathname, item));
            return (
              <button
                type="button"
                onClick={() => setMoreOpen((v) => !v)}
                aria-expanded={moreOpen}
                aria-haspopup="menu"
                className={`${pillBase} inline-flex items-center gap-1`}
                style={{
                  color: moreActive ? "var(--gr-bg)" : "var(--gr-text-mid)",
                  background: moreActive ? "var(--gr-ink)" : undefined,
                  fontWeight: moreActive ? 500 : undefined,
                }}
              >
                More
                <span
                  className={`text-[10px] transition-transform ${moreOpen ? "rotate-180" : ""}`}
                  aria-hidden
                >
                  ▾
                </span>
              </button>
            );
          })()}

          {moreOpen && (
            <div
              role="menu"
              className="absolute right-0 top-full z-50 mt-1 w-44 overflow-hidden rounded-[14px] border py-1 shadow-[0_12px_40px_-12px_rgba(28,25,23,0.18)]"
              style={{ background: "var(--gr-surface)", borderColor: "var(--gr-border)" }}
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
                    className="block px-4 py-2.5 text-[13.5px] transition-colors"
                    style={{
                      color: active ? "var(--gr-ink)" : "var(--gr-text-mid)",
                      background: active ? "var(--gr-surface-2)" : undefined,
                      fontWeight: active ? 600 : undefined,
                    }}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        <span
          className="mx-1 h-5 w-px shrink-0"
          style={{ background: "var(--gr-border)" }}
          aria-hidden
        />
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
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition-colors"
          style={{ color: "var(--gr-text-mid)" }}
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
            className="absolute right-0 top-full z-50 mt-1 w-52 overflow-hidden rounded-[14px] border py-1 shadow-[0_12px_40px_-12px_rgba(28,25,23,0.18)]"
            style={{ background: "var(--gr-surface)", borderColor: "var(--gr-border)" }}
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
                  className="block px-4 py-2 text-[13.5px] transition-colors"
                  style={{
                    color: active ? "var(--gr-ink)" : "var(--gr-text-mid)",
                    background: active ? "var(--gr-surface-2)" : undefined,
                    fontWeight: active ? 600 : undefined,
                  }}
                >
                  {item.label}
                </Link>
              );
            })}
            <div className="mx-4 my-1 h-px" style={{ background: "var(--gr-border-sub)" }} />
            <LogoutButton variant="menu" />
          </div>
        )}
      </div>
    </div>
  );
}
