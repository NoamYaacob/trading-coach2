"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { LogoutButton } from "./logout-button";

/**
 * Top navigation.
 *
 * Three modes, picked from `authenticated` + the current pathname:
 *
 *  - Anonymous, anywhere       → "Log in" + "Sign up" (marketing).
 *  - Authenticated, on `/`     → "Go to dashboard" + "Log out" (marketing,
 *                                 no app pills — landing should not look
 *                                 like the user is already inside an app
 *                                 page).
 *  - Authenticated, in the app → 3 primary pills (Dashboard, Rules,
 *                                 Accounts) + "More" dropdown that holds
 *                                 the secondary pages.
 */

type AppNavItem = {
  href: string;
  label: string;
  /** Match the route exactly OR any nested route under it. */
  match: "exact" | "startsWith";
};

const PRIMARY_NAV: AppNavItem[] = [
  { href: "/dashboard", label: "Dashboard", match: "exact" },
  { href: "/rules", label: "Rules", match: "exact" },
  { href: "/accounts", label: "Accounts", match: "startsWith" },
];

const MORE_NAV: AppNavItem[] = [
  { href: "/guardian", label: "Status details", match: "exact" },
  { href: "/journal", label: "Manual log", match: "exact" },
  { href: "/alerts", label: "Alerts", match: "exact" },
  { href: "/settings", label: "Settings", match: "exact" },
];

/**
 * Routes where we show marketing-style nav even when authenticated.
 * Adding more routes here (e.g. /about, /pricing) will treat them the
 * same as the landing page.
 */
const MARKETING_ROUTES = new Set<string>(["/"]);

function isActive(pathname: string, item: AppNavItem): boolean {
  if (item.match === "exact") return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export function TopNav({ authenticated }: { authenticated: boolean }) {
  const pathname = usePathname() ?? "/";
  const onMarketingRoute = MARKETING_ROUTES.has(pathname);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!moreOpen) return;
    function onDocPointer(event: MouseEvent) {
      if (moreRef.current && !moreRef.current.contains(event.target as Node)) {
        setMoreOpen(false);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setMoreOpen(false);
    }
    document.addEventListener("mousedown", onDocPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [moreOpen]);

  // Anonymous → marketing nav, on every route.
  if (!authenticated) {
    return (
      <nav className="flex items-center gap-1 text-sm">
        <Link
          href="/login"
          className="rounded-full px-3.5 py-2 text-stone-600 transition-colors hover:text-stone-950 sm:px-4"
        >
          Log in
        </Link>
        <Link
          href="/signup"
          className="rounded-full bg-stone-950 px-4 py-2 font-medium text-stone-50 shadow-[0_2px_8px_-2px_rgba(28,25,23,0.35)] transition-colors hover:bg-stone-800 sm:px-5"
        >
          Sign up
        </Link>
      </nav>
    );
  }

  // Authenticated but on the landing page → marketing-style nav, no app
  // pills. Otherwise the landing page looks like the user is already inside
  // an app page and the active state misleads.
  if (onMarketingRoute) {
    return (
      <nav className="flex items-center gap-1 text-sm">
        <LogoutButton />
        <Link
          href="/dashboard"
          className="rounded-full bg-stone-950 px-4 py-2 font-medium text-stone-50 shadow-[0_2px_8px_-2px_rgba(28,25,23,0.35)] transition-colors hover:bg-stone-800 sm:px-5"
        >
          Go to dashboard
        </Link>
      </nav>
    );
  }

  // Authenticated, in the app.
  const pillBase =
    "shrink-0 rounded-full px-3.5 py-1.5 transition-colors sm:px-4 sm:py-2";
  const pillActive =
    "bg-stone-950 font-medium text-stone-50 shadow-[0_2px_8px_-2px_rgba(28,25,23,0.35)]";
  const pillIdle = "text-stone-600 hover:bg-stone-900/5 hover:text-stone-950";
  const moreActive = MORE_NAV.some((item) => isActive(pathname, item));

  return (
    <nav
      className="-mx-2 flex max-w-full items-center gap-0.5 overflow-x-auto px-2 text-sm scrollbar-none sm:gap-1"
      aria-label="Primary"
    >
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

      <div className="relative" ref={moreRef}>
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
            className="absolute right-0 z-20 mt-2 w-44 overflow-hidden rounded-2xl border border-stone-200 bg-white py-1 shadow-[0_12px_40px_-12px_rgba(28,25,23,0.22)]"
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
                      ? "block bg-stone-100 px-4 py-2 text-sm font-semibold text-stone-950"
                      : "block px-4 py-2 text-sm text-stone-700 hover:bg-stone-50 hover:text-stone-950"
                  }
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        )}
      </div>

      <span className="mx-1 h-5 w-px bg-stone-200/80" aria-hidden />
      <LogoutButton />
    </nav>
  );
}
