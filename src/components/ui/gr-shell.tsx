/**
 * GrShell — Guardrail 2 application shell.
 *
 * A PARALLEL shell — does NOT replace the existing AppShell.
 * Used only in the /debug/gr-shell design-system showcase.
 * Must NOT be imported by any production page.
 *
 * Source: /tmp/guardrail-2/project/gr-shell.jsx  GrShell component.
 *
 * Layout:
 *   ┌──────────────┬──────────────────────────────────────────┐
 *   │  240px side  │  56px header                             │
 *   │  ─────────── │  ────────────────────────────────────────│
 *   │  logo        │                                          │
 *   │  account sel │   {children}                             │
 *   │  nav         │                                          │
 *   │  API status  │                                          │
 *   └──────────────┴──────────────────────────────────────────┘
 *
 * All data rendered is mock/preview. No real account data flows through here.
 */

"use client";

import React from "react";
import { GrAccountSelector } from "./gr/gr-account-selector";
import { GrIcon } from "./gr/gr-icon";
import type { GrIconName } from "./gr/gr-icon";
import { GrBadge } from "./gr/gr-badge";

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

type NavItem = {
  id: string;
  label: string;
  icon: GrIconName;
  active?: boolean;
  badge?: number;
};

const NAV_ITEMS: NavItem[] = [
  { id: "home",     label: "Dashboard",    icon: "home" },
  { id: "rules",    label: "Trading Plan", icon: "shield", active: true },
  { id: "trades",   label: "Trades",       icon: "chart" },
  { id: "accounts", label: "Accounts",     icon: "user" },
  { id: "alerts",   label: "Alerts",       icon: "bell",  badge: 2 },
  { id: "settings", label: "Settings",     icon: "settings" },
];

function NavItemEl({ item }: { item: NavItem }) {
  return (
    <div
      role="menuitem"
      style={{
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
      }}
    >
      <GrIcon name={item.icon} />
      <span style={{ flex: 1 }}>{item.label}</span>
      {item.badge != null && (
        <GrBadge variant="warn" className="ml-auto px-1.5 py-px text-[10px]">
          {item.badge}
        </GrBadge>
      )}
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
};

export function GrShell({ children, breadcrumb = ["Trading Plan"] }: Props) {
  return (
    <div
      className="gr"
      style={{
        display: "flex",
        height: "100%",
        alignItems: "stretch",
        background: "var(--gr-bg)",
        color: "var(--gr-text)",
        fontFamily: "var(--font-manrope), sans-serif",
        letterSpacing: "-0.005em",
        WebkitFontSmoothing: "antialiased",
        position: "relative",
      }}
    >
      {/* Sidebar */}
      <aside
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

        {/* Account selector */}
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
            Account
          </div>
          <GrAccountSelector />
        </div>

        {/* Nav */}
        <nav
          role="menu"
          style={{ padding: 10, display: "flex", flexDirection: "column", gap: 2 }}
        >
          {NAV_ITEMS.map((n) => (
            <NavItemEl key={n.id} item={n} />
          ))}
        </nav>

        <div style={{ flex: 1 }} />

        {/* API status */}
        <div style={{ padding: 14, borderTop: "1px solid var(--gr-border)" }}>
          <ApiStatusCard />
        </div>
      </aside>

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
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              color: "var(--gr-text-mute)",
            }}
          >
            {/* Quick search */}
            <div
              role="button"
              tabIndex={0}
              aria-label="Quick action"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 12px",
                border: "1px solid var(--gr-border)",
                borderRadius: "var(--gr-r-md)",
                background: "var(--gr-surface)",
                fontSize: "12.5px",
                cursor: "pointer",
              }}
            >
              <GrIcon name="search" size="sm" />
              <span>Quick action…</span>
              <span
                style={{
                  marginLeft: 32,
                  fontFamily: "var(--font-ibm-plex-mono, monospace)",
                  fontSize: "10.5px",
                  padding: "1.5px 5px",
                  border: "1px solid var(--gr-border)",
                  borderRadius: 4,
                  background: "var(--gr-surface)",
                  color: "var(--gr-text-mid)",
                }}
              >
                ⌘K
              </span>
            </div>
            <button
              type="button"
              aria-label="Notifications"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 7,
                border: "none",
                background: "transparent",
                cursor: "pointer",
                color: "var(--gr-text-mute)",
                borderRadius: 8,
              }}
            >
              <GrIcon name="bell" />
            </button>
            <div
              aria-label="User avatar"
              style={{
                width: 30,
                height: 30,
                borderRadius: 999,
                background: "var(--gr-copper)",
                color: "white",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "11.5px",
                fontWeight: 600,
              }}
            >
              AN
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
