/**
 * GrShell — Guardrail 2 application shell.
 *
 * Phase 1: debug-only showcase (all mock data, no real props).
 * Phase 2: production shell for /rules (Trading Plan page).
 *
 * The shell accepts optional real-data props. When these props are omitted
 * (undefined), the component falls back to mock/preview data so the
 * /debug/gr-shell showcase continues to work unchanged.
 *
 * Layout:
 *   ┌──────────────┬──────────────────────────────────────────┐
 *   │  240px side  │  56px header                             │
 *   │  ─────────── │  ────────────────────────────────────────│
 *   │  logo        │                                          │
 *   │  sidebar slot│   {children}                             │
 *   │  nav         │                                          │
 *   │  API status  │                                          │
 *   └──────────────┴──────────────────────────────────────────┘
 *
 * Real-data props (Phase 2):
 *   sidebarContent  ReactNode | null | undefined
 *                   undefined = show mock GrAccountSelector (debug path)
 *                   null      = empty slot (e.g. editor mode, no sidebar content)
 *                   ReactNode = real content
 *   sidebarLabel    Label above the sidebar slot (default "Account")
 *   navItems        Real nav items with hrefs; undefined = show mock nav
 *   userInitials    2-char header avatar; undefined = "AN" (mock)
 *   hideSidebar     When true the 240px sidebar is hidden (rule editor mode)
 *   hideApiStatus   When true the mock API status card is hidden (production)
 */

"use client";

import React from "react";
import Link from "next/link";
import { GrAccountSelector } from "./gr/gr-account-selector";
import { GrIcon } from "./gr/gr-icon";
import type { GrIconName } from "./gr/gr-icon";
import { GrBadge } from "./gr/gr-badge";
import { LogoutButton } from "./logout-button";

// ── Public nav-item type (exported for page.tsx RULES_NAV) ────

export type GrNavItem = {
  id: string;
  label: string;
  icon: GrIconName;
  href?: string;
  active?: boolean;
  badge?: number;
};

// ── Logo ──────────────────────────────────────────────────────

function GrLogo({ size = 28 }: { size?: number }) {
  return (
    <div
      aria-label="Guardrail"
      style={{
        width: size,
        height: size,
        borderRadius: 8,
        background: "var(--gr-copper)",
        color: "white",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'Instrument Serif', Georgia, serif",
        fontWeight: 400,
        fontSize: size * 0.65,
        letterSpacing: "-0.04em",
        transform: "rotate(-2deg)",
        flexShrink: 0,
      }}
    >
      g
    </div>
  );
}

// ── Nav item ─────────────────────────────────────────────────

const MOCK_NAV_ITEMS: GrNavItem[] = [
  { id: "home",     label: "Dashboard",    icon: "home" },
  { id: "rules",    label: "Trading Plan", icon: "shield", active: true },
  { id: "trades",   label: "Trades",       icon: "chart" },
  { id: "accounts", label: "Accounts",     icon: "user" },
  { id: "alerts",   label: "Alerts",       icon: "bell",  badge: 2 },
  { id: "settings", label: "Settings",     icon: "settings" },
];

function NavItemEl({ item }: { item: GrNavItem }) {
  const inner = (
    <>
      <GrIcon name={item.icon} />
      <span style={{ flex: 1 }}>{item.label}</span>
      {item.badge != null && (
        <GrBadge variant="warn" className="ml-auto px-1.5 py-px text-[10px]">
          {item.badge}
        </GrBadge>
      )}
    </>
  );

  const sharedStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 11px",
    borderRadius: 8,
    fontSize: "13.5px",
    color: item.active ? "var(--gr-bg)" : "var(--gr-text-mid)",
    cursor: "pointer",
    background: item.active ? "var(--gr-ink)" : "transparent",
    transition: "background .1s, color .1s",
    fontWeight: item.active ? 500 : 400,
    textDecoration: "none",
  };

  if (item.href) {
    return (
      <Link href={item.href} style={sharedStyle}>
        {inner}
      </Link>
    );
  }

  return (
    <div role="menuitem" style={sharedStyle}>
      {inner}
    </div>
  );
}

// ── API status card ───────────────────────────────────────────

function ApiStatusCard() {
  return (
    <div
      style={{
        background: "var(--gr-surface-warm)",
        border: "1px solid var(--gr-border)",
        borderRadius: "var(--gr-r-lg)",
        padding: 12,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontSize: "11.5px", color: "var(--gr-text-mute)" }}>Tradovate API</span>
        <GrBadge variant="ok">
          <span
            aria-hidden
            style={{
              display: "inline-block",
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "var(--gr-ok)",
            }}
          />
          live
        </GrBadge>
      </div>
      <div
        style={{
          fontFamily: "var(--font-ibm-plex-mono, monospace)",
          fontSize: "11.5px",
          color: "var(--gr-text-mute)",
        }}
      >
        ping 42ms · sync 3s ago
      </div>
      <p
        style={{
          marginTop: 6,
          fontSize: "10px",
          color: "var(--gr-text-faint)",
          fontStyle: "italic",
        }}
      >
        Preview — not real connection status
      </p>
    </div>
  );
}

// ── Shell ─────────────────────────────────────────────────────

type Props = {
  children?: React.ReactNode;
  breadcrumb?: string[];
  /** Sidebar slot content.
   *  undefined = show mock GrAccountSelector (debug/showcase path)
   *  null      = show empty slot (editor mode — no content needed)
   *  ReactNode = real production content (e.g. ScopeSelector) */
  sidebarContent?: React.ReactNode | null;
  /** Label above the sidebar slot. Default: "Account" */
  sidebarLabel?: string;
  /** Real nav items with hrefs. Omit to use mock MOCK_NAV_ITEMS. */
  navItems?: GrNavItem[];
  /** Header avatar initials. Default: "AN" (mock). */
  userInitials?: string;
  /** When true, hides the 240px sidebar (rule editor mode). */
  hideSidebar?: boolean;
  /** When true, hides the mock API status card (production use). */
  hideApiStatus?: boolean;
};

export function GrShell({
  children,
  breadcrumb = ["Trading Plan"],
  sidebarContent,
  sidebarLabel,
  navItems,
  userInitials,
  hideSidebar = false,
  hideApiStatus = false,
}: Props) {
  // undefined = show mock account selector; null/ReactNode = use slot
  const showMockAccountSelector = sidebarContent === undefined;
  const resolvedNav = navItems ?? MOCK_NAV_ITEMS;
  const resolvedInitials = userInitials ?? "AN";
  const resolvedSidebarLabel = sidebarLabel ?? "Account";

  // Mobile drawer state — sidebar collapses below 1024px into an overlay drawer.
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);
  React.useEffect(() => {
    if (!mobileNavOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileNavOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mobileNavOpen]);

  const [userMenuOpen, setUserMenuOpen] = React.useState(false);
  const [quickOpen, setQuickOpen] = React.useState(false);
  const userMenuRef = React.useRef<HTMLDivElement>(null);
  const quickRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!userMenuOpen && !quickOpen) return;
    function handleDown(e: MouseEvent) {
      if (userMenuOpen && userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
      if (quickOpen && quickRef.current && !quickRef.current.contains(e.target as Node)) {
        setQuickOpen(false);
      }
    }
    document.addEventListener("mousedown", handleDown);
    return () => document.removeEventListener("mousedown", handleDown);
  }, [userMenuOpen, quickOpen]);

  return (
    <div
      className="gr"
      style={{
        display: "flex",
        height: "100dvh",
        alignItems: "stretch",
        background: "var(--gr-bg)",
        color: "var(--gr-text)",
        fontFamily: "var(--font-manrope), sans-serif",
        letterSpacing: "-0.005em",
        WebkitFontSmoothing: "antialiased",
        position: "relative",
      }}
    >
      {/* Mobile drawer backdrop */}
      {!hideSidebar && mobileNavOpen && (
        <div
          aria-hidden
          onClick={() => setMobileNavOpen(false)}
          className="gr-shell-backdrop"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(27, 24, 18, 0.45)",
            zIndex: 40,
          }}
        />
      )}

      {/* Sidebar — hidden in rule-editor mode; collapses to drawer on mobile */}
      {!hideSidebar && (
        <aside
          className={`gr-shell-aside${mobileNavOpen ? " is-open" : ""}`}
          style={{
            width: 240,
            flexShrink: 0,
            borderRight: "1px solid var(--gr-border)",
            background: "var(--gr-bg-elev)",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* Logo row */}
          <div
            style={{
              padding: "20px 18px",
              borderBottom: "1px solid var(--gr-border)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <GrLogo />
              <div style={{ display: "flex", flexDirection: "column" }}>
                <span
                  style={{
                    fontSize: "15.5px",
                    fontWeight: 600,
                    color: "var(--gr-ink)",
                    letterSpacing: "-0.01em",
                  }}
                >
                  Guardrail
                </span>
                <span style={{ fontSize: "11.5px", color: "var(--gr-text-mute)" }}>
                  v2 preview
                </span>
              </div>
            </div>
          </div>

          {/* Sidebar content slot */}
          <div
            style={{ padding: 14, borderBottom: "1px solid var(--gr-border)" }}
          >
            <div
              style={{
                fontSize: "11px",
                fontWeight: 500,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "var(--gr-text-mute)",
                padding: "0 4px 8px",
              }}
            >
              {resolvedSidebarLabel}
            </div>
            {showMockAccountSelector ? (
              <GrAccountSelector />
            ) : sidebarContent != null ? (
              sidebarContent
            ) : null}
          </div>

          {/* Nav */}
          <nav
            role="menu"
            style={{ padding: 10, display: "flex", flexDirection: "column", gap: 2 }}
          >
            {resolvedNav.map((n) => (
              <NavItemEl key={n.id} item={n} />
            ))}
          </nav>

          <div style={{ flex: 1 }} />

          {/* API status — hidden in production */}
          {!hideApiStatus && (
            <div style={{ padding: 14, borderTop: "1px solid var(--gr-border)" }}>
              <ApiStatusCard />
            </div>
          )}
        </aside>
      )}

      {/* Main */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Top bar */}
        <header
          className="gr-shell-header"
          style={{
            height: 56,
            padding: "0 28px",
            borderBottom: "1px solid var(--gr-border)",
            background: "var(--gr-bg)",
            display: "flex",
            alignItems: "center",
            gap: 16,
            flexShrink: 0,
          }}
        >
          {/* Mobile nav toggle — visible only on small screens */}
          {!hideSidebar && (
            <button
              type="button"
              aria-label={mobileNavOpen ? "Close navigation" : "Open navigation"}
              aria-expanded={mobileNavOpen}
              onClick={() => setMobileNavOpen((v) => !v)}
              className="gr-shell-nav-toggle btn-compact"
              style={{
                display: "none",
                alignItems: "center",
                justifyContent: "center",
                width: 36,
                height: 36,
                marginRight: 4,
                marginLeft: -8,
                padding: 0,
                border: "1px solid var(--gr-border)",
                borderRadius: 8,
                background: "var(--gr-surface)",
                color: "var(--gr-text-mid)",
                cursor: "pointer",
              }}
            >
              <GrIcon name={mobileNavOpen ? "x" : "menu"} />
            </button>
          )}

          {/* Breadcrumb */}
          <nav
            aria-label="breadcrumb"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              color: "var(--gr-text-mute)",
              fontSize: 13,
            }}
          >
            {breadcrumb.map((b, i) => (
              <React.Fragment key={i}>
                {i > 0 && <span style={{ opacity: 0.4 }}>/</span>}
                <span
                  style={{
                    color:
                      i === breadcrumb.length - 1
                        ? "var(--gr-ink)"
                        : "var(--gr-text-mute)",
                    fontWeight: i === breadcrumb.length - 1 ? 500 : 400,
                  }}
                >
                  {b}
                </span>
              </React.Fragment>
            ))}
          </nav>

          <div style={{ flex: 1 }} />

          {/* Header actions */}
<div style={{ display: "flex", alignItems: "center", gap: 12, color: "var(--gr-text-mute)" }}>
  {/* Quick nav palette */}
  <div ref={quickRef} style={{ position: "relative" }}>
    <button
      type="button"
      onClick={() => setQuickOpen((v) => !v)}
      aria-label="Quick navigation"
      aria-expanded={quickOpen}
      style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "6px 12px",
        border: "1px solid var(--gr-border)", borderRadius: "var(--gr-r-md)",
        background: "var(--gr-surface)", fontSize: "12.5px",
        cursor: "pointer", color: "var(--gr-text-mute)",
      }}
    >
      <GrIcon name="search" size="sm" />
      <span>Quick nav…</span>
      <span style={{
        marginLeft: 32, fontFamily: "var(--font-ibm-plex-mono, monospace)",
        fontSize: "10.5px", padding: "1.5px 5px",
        border: "1px solid var(--gr-border)", borderRadius: 4,
        background: "var(--gr-surface)", color: "var(--gr-text-mid)",
      }}>⌘K</span>
    </button>
    {quickOpen && (
      <div style={{
        position: "absolute", right: 0, top: "calc(100% + 6px)",
        minWidth: 220, background: "var(--gr-surface)",
        border: "1px solid var(--gr-border)", borderRadius: 10,
        boxShadow: "0 8px 24px rgba(27,24,18,0.14)", overflow: "hidden", zIndex: 200,
      }}>
        {resolvedNav.filter((n) => n.href).map((n, i, arr) => (
          <Link
            key={n.id}
            href={n.href!}
            onClick={() => setQuickOpen(false)}
            style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "10px 14px", fontSize: "13.5px",
              color: n.active ? "var(--gr-ink)" : "var(--gr-text-mid)",
              textDecoration: "none",
              fontWeight: n.active ? 500 : 400,
              borderBottom: i < arr.length - 1 ? "1px solid var(--gr-border)" : "none",
              background: n.active ? "var(--gr-bg-elev)" : "transparent",
            }}
          >
            <GrIcon name={n.icon} size="sm" />
            {n.label}
          </Link>
        ))}
      </div>
    )}
  </div>

  {/* Bell — links to /alerts */}
  <Link
    href="/alerts"
    aria-label="Notifications"
    style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      padding: 7, border: "none", background: "transparent",
      color: "var(--gr-text-mute)", borderRadius: 8, textDecoration: "none",
    }}
  >
    <GrIcon name="bell" />
  </Link>

  {/* User avatar — opens settings/logout dropdown */}
  <div ref={userMenuRef} style={{ position: "relative" }}>
    <button
      type="button"
      onClick={() => setUserMenuOpen((v) => !v)}
      aria-label="User menu"
      aria-expanded={userMenuOpen}
      style={{
        width: 30, height: 30, borderRadius: 999,
        background: "var(--gr-copper)", color: "white",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        fontSize: "11.5px", fontWeight: 600,
        border: "none", cursor: "pointer", padding: 0,
      }}
    >
      {resolvedInitials}
    </button>
    {userMenuOpen && (
      <div style={{
        position: "absolute", right: 0, top: "calc(100% + 6px)",
        minWidth: 160, background: "var(--gr-surface)",
        border: "1px solid var(--gr-border)", borderRadius: 10,
        boxShadow: "0 8px 24px rgba(27,24,18,0.14)", overflow: "hidden", zIndex: 200,
      }}>
        <Link
          href="/settings"
          onClick={() => setUserMenuOpen(false)}
          style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "10px 14px", fontSize: "13.5px",
            color: "var(--gr-text-mid)", textDecoration: "none",
            borderBottom: "1px solid var(--gr-border)",
          }}
        >
          <GrIcon name="settings" size="sm" />
          Settings
        </Link>
        <LogoutButton variant="menu" />
      </div>
    )}
  </div>
</div>
        </header>

        {/* Page content */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            position: "relative",
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
