import { Suspense } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { cookies } from "next/headers";

import { GrShell, type GrNavItem } from "@/components/ui/gr-shell";
import { getCurrentUser } from "@/lib/auth";
import { loadCommandCenterData } from "@/app/dashboard/_components/command-center/data";
import {
  isAccountActive,
  partitionAccountsByActive,
} from "@/app/dashboard/_components/command-center/active-status";
import { resolveDisplayTimeZone, DISPLAY_TIME_ZONE_COOKIE } from "@/lib/timezone";
import { prisma } from "@/lib/db";
import { TradesContent, TradesContentLoading } from "./_components/trades-content";

export const metadata: Metadata = {
  title: "Trades — Guardrail",
};

const TRADES_NAV: GrNavItem[] = [
  { id: "home",     label: "Dashboard",    icon: "home",     href: "/dashboard" },
  { id: "rules",    label: "Trading Plan", icon: "shield",   href: "/rules" },
  { id: "trades",   label: "Trades",       icon: "chart",    href: "/trades",   active: true },
  { id: "alerts",   label: "Alerts",       icon: "bell",     href: "/alerts" },
  { id: "settings", label: "Settings",     icon: "settings", href: "/settings" },
];

type FilterKey = "all" | "winning" | "losing";

function statusColor(status: string): string {
  if (status === "warning") return "var(--gr-warn)";
  if (status === "locked") return "var(--gr-bad)";
  if (status === "allowed") return "var(--gr-ok)";
  return "var(--gr-text-faint)";
}

function pnlColor(v: number | null): string {
  if (v == null) return "var(--gr-text-mute)";
  if (v > 0) return "var(--gr-ok)";
  if (v < 0) return "var(--gr-bad)";
  return "var(--gr-text-mute)";
}

function fmt$(v: number): string {
  const abs = Math.abs(v);
  const sign = v >= 0 ? "+" : "−";
  return `${sign}$${abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDateFromKey(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y!, m! - 1, d!).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export default async function TradesPage({
  searchParams,
}: {
  searchParams: Promise<{ accountId?: string; filter?: string; range?: string; date?: string }>;
}) {
  const currentUser = await getCurrentUser();
  if (!currentUser) redirect("/login");

  const params = await searchParams;
  const filter: FilterKey =
    params.filter === "winning" || params.filter === "losing" ? params.filter : "all";
  const rangeDays = params.range === "30" ? 30 : params.range === "7" ? 7 : 14;
  // date deep-link from calendar: YYYY-MM-DD in the display timezone
  const dateFilter: string | null =
    params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : null;
  const userInitials = currentUser.email ? currentUser.email.slice(0, 2).toUpperCase() : "??";

  const cookieStore = await cookies();
  const [commandCenter, userProfile] = await Promise.all([
    loadCommandCenterData(currentUser.id, currentUser.email),
    prisma.user.findUnique({
      where: { id: currentUser.id },
      select: { traderProfile: { select: { timezone: true } } },
    }),
  ]);
  const accounts = commandCenter.accounts;
  const { active: activeAccounts } = partitionAccountsByActive(accounts);
  const hasAccounts = accounts.length > 0;
  const hasActiveAccount = activeAccounts.length > 0;

  // Pick selected account:
  //  - explicit ?accountId= deep link wins (active OR expired — lets users
  //    view historical trades for an expired account)
  //  - else auto-select first active account
  //  - never auto-select an expired account
  const selectedAccount = params.accountId
    ? accounts.find((a) => a.id === params.accountId) ?? activeAccounts[0] ?? null
    : activeAccounts[0] ?? null;
  const selectedAccountIsExpired =
    selectedAccount != null && !isAccountActive(selectedAccount);

  // Display timezone — must match the dashboard's calendar bucketing so that
  // clicking a calendar day deep-link shows exactly the trades in that cell.
  const tz = resolveDisplayTimeZone({
    onboardingTimeZone: userProfile?.traderProfile?.timezone,
    browserTimeZone: cookieStore.get(DISPLAY_TIME_ZONE_COOKIE)?.value,
  });

  // NOTE: all slow broker work (ABH day net + the historical Fills report) and
  // the KPI/table rendering that depends on it live in <TradesContent>, rendered
  // behind <Suspense> below. This page function performs only fast DB lookups so
  // the shell (GrShell nav, hero, account picker) paints instantly and broker
  // data streams in — navigation never blocks on ABH/reports.

  const buildHref = (overrides: Partial<{ accountId: string; filter: string; range: string }>) => {
    const sp = new URLSearchParams();
    const accId = overrides.accountId ?? selectedAccount?.id;
    const flt = overrides.filter ?? filter;
    const rng = overrides.range ?? String(rangeDays);
    if (accId) sp.set("accountId", accId);
    if (flt !== "all") sp.set("filter", flt);
    if (rng !== "14") sp.set("range", rng);
    const q = sp.toString();
    return q ? `/trades?${q}` : "/trades";
  };

  // ── Sidebar: compact account list (active accounts only) ─────────────────
  const SidebarAccountList = hasActiveAccount ? (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {activeAccounts.slice(0, 4).map((acc) => (
        <Link
          key={acc.id}
          href={buildHref({ accountId: acc.id })}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "7px 8px",
            borderRadius: 8,
            background: acc.id === selectedAccount?.id ? "var(--gr-surface)" : "transparent",
            border: acc.id === selectedAccount?.id ? "1px solid var(--gr-border)" : "1px solid transparent",
            textDecoration: "none",
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: statusColor(acc.status),
              flexShrink: 0,
            }}
          />
          <span style={{ fontSize: 12.5, color: "var(--gr-ink)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {acc.primaryLabel}
          </span>
          {acc.dailyPnl != null && (
            <span style={{ fontSize: 11, fontFamily: "var(--font-ibm-plex-mono, monospace)", color: pnlColor(acc.dailyPnl), flexShrink: 0 }}>
              {fmt$(acc.dailyPnl)}
            </span>
          )}
        </Link>
      ))}
      {activeAccounts.length > 4 && (
        <span style={{ fontSize: 11, color: "var(--gr-text-mute)", padding: "4px 8px" }}>
          +{activeAccounts.length - 4} more
        </span>
      )}
    </div>
  ) : (
    <Link
      href="/accounts/connect/tradovate"
      style={{ fontSize: 12.5, color: "var(--gr-copper)", textDecoration: "none" }}
    >
      {hasAccounts ? "Reconnect or add account →" : "Connect first account →"}
    </Link>
  );

  return (
    <GrShell
      breadcrumb={["Trades"]}
      sidebarContent={SidebarAccountList}
      sidebarLabel={hasActiveAccount ? "Accounts" : "Connect"}
      navItems={TRADES_NAV}
      userInitials={userInitials}
      hideApiStatus
    >
      <style>{`
        @media (max-width: 700px) {
          .trades-kpi-grid { grid-template-columns: repeat(3, 1fr) !important; }
        }
        @media (max-width: 460px) {
          .trades-kpi-grid { grid-template-columns: repeat(2, 1fr) !important; }
        }
      `}</style>
      <div style={{ overflowY: "auto", height: "100%" }}>
        <div style={{ maxWidth: 1400, margin: "0 auto" }}>
        {/* ── Hero (instant — no broker data) ──────────────────────────── */}
        <section style={{ padding: "28px 36px 16px" }}>
          <span style={{ fontSize: 11.5, fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--gr-text-mute)" }}>
            {dateFilter
              ? `${selectedAccount ? selectedAccount.primaryLabel + " · " : ""}Closed round-trips`
              : selectedAccount
              ? `${selectedAccount.primaryLabel} · Closed round-trips · last ${rangeDays}d`
              : `Closed round-trips · last ${rangeDays}d`}
          </span>
          <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em", lineHeight: 1.2, color: "var(--gr-ink)", margin: "6px 0 0" }}>
            {dateFilter ? `Trades · ${fmtDateFromKey(dateFilter)}` : "Trades"}
          </h1>
        </section>

        {!hasAccounts ? (
          /* ── No accounts state ───────────────────────────────────────── */
          <section style={{ padding: "4px 36px 36px" }}>
            <div style={{ background: "var(--gr-surface)", border: "1px solid var(--gr-border)", borderRadius: 14, padding: "32px 36px" }}>
              <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--gr-copper)", marginBottom: 12 }}>
                Getting started
              </p>
              <h2 style={{ fontSize: 22, fontWeight: 600, color: "var(--gr-ink)", marginBottom: 10 }}>
                Connect a broker to see your trades.
              </h2>
              <p style={{ fontSize: 13.5, color: "var(--gr-text-mid)", marginBottom: 18, lineHeight: 1.55 }}>
                Once a broker is connected, Guardrail records every fill and reconstructs round-trip trades from
                the broker&apos;s event stream — no manual entry required.
              </p>
              <Link
                href="/accounts/connect/tradovate"
                style={{ display: "inline-flex", padding: "8px 16px", borderRadius: 9, background: "var(--gr-ink)", color: "var(--gr-bg)", textDecoration: "none", fontSize: 13, fontWeight: 500 }}
              >
                Connect Tradovate
              </Link>
            </div>
          </section>
        ) : !selectedAccount ? (
          /* ── All accounts expired/unavailable, no deep link ──────────── */
          <section style={{ padding: "4px 36px 36px" }}>
            <div style={{ background: "var(--gr-surface)", border: "1px solid var(--gr-border)", borderRadius: 14, padding: "32px 36px" }}>
              <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--gr-copper)", marginBottom: 12 }}>
                All accounts expired or unavailable
              </p>
              <h2 style={{ fontSize: 22, fontWeight: 600, color: "var(--gr-ink)", marginBottom: 10 }}>
                No live accounts to show trades for.
              </h2>
              <p style={{ fontSize: 13.5, color: "var(--gr-text-mid)", marginBottom: 18, lineHeight: 1.55 }}>
                Historical trade data is preserved. View it from the dashboard, archive accounts you no longer need, or reconnect a broker.
              </p>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <Link
                  href="/dashboard"
                  style={{ display: "inline-flex", padding: "8px 16px", borderRadius: 9, background: "var(--gr-ink)", color: "var(--gr-bg)", textDecoration: "none", fontSize: 13, fontWeight: 500 }}
                >
                  Manage accounts
                </Link>
                <Link
                  href="/accounts/connect/tradovate"
                  style={{ display: "inline-flex", padding: "8px 16px", borderRadius: 9, border: "1px solid var(--gr-border)", color: "var(--gr-text-mid)", textDecoration: "none", fontSize: 13 }}
                >
                  Reconnect broker
                </Link>
              </div>
            </div>
          </section>
        ) : (
          /* ── Broker-data content — streamed so the shell paints first ── */
          <Suspense fallback={<TradesContentLoading />}>
            <TradesContent
              selectedAccount={selectedAccount}
              userId={currentUser.id}
              filter={filter}
              rangeDays={rangeDays}
              dateFilter={dateFilter}
              tz={tz}
              activeAccounts={activeAccounts}
              selectedAccountIsExpired={selectedAccountIsExpired}
            />
          </Suspense>
        )}
        </div>
      </div>
    </GrShell>
  );
}
