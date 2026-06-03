import { Fragment } from "react";
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
import {
  loadAccountFillInputs,
  historicalFillsToFillInputs,
  reconstructMergedTrades,
} from "@/lib/trades/load";
import { computeTradeStats } from "@/lib/trades/stats";
import { TradovateClient } from "@/lib/brokers/tradovate-client";
import { withTimeout, timed } from "@/lib/perf";
import { formatDateMMDDYYYY } from "@/lib/brokers/tradovate-report-date";
import { brokerSourceLabel, type BrokerHistorySource } from "@/lib/trades/broker-account-performance";
import { resolveDayNet, resolveDayRowNets } from "./day-net";
import { TradeFilters } from "./_components/trade-filters";
import { resolveDisplayTimeZone, DISPLAY_TIME_ZONE_COOKIE } from "@/lib/timezone";
import { prisma } from "@/lib/db";

export const metadata: Metadata = {
  title: "Trades — Guardrail",
};

// Hard caps for slow broker/report calls during server render. Each is capped
// independently so one slow call can never block navigation for ~10s — the page
// renders DB rows + whatever broker data resolved in time.
const CLIENT_INIT_TIMEOUT_MS = 4000;
const BROKER_PERF_TIMEOUT_MS = 4000;
const ACCOUNT_NAME_TIMEOUT_MS = 3000;
const FILLS_REPORT_TIMEOUT_MS = 5000;

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

function fmtPrice(v: number): string {
  return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

function fmtHold(ms: number): string {
  if (ms < 0) return "—";
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  const rest = min % 60;
  return rest === 0 ? `${hr}h` : `${hr}h ${rest}m`;
}

function fmtTime(d: Date, tz: string): string {
  return d.toLocaleString("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function fmtDate(d: Date, tz: string): string {
  return d.toLocaleDateString("en-US", {
    timeZone: tz,
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function isoDateKey(d: Date, tz: string): string {
  return d.toLocaleDateString("en-CA", { timeZone: tz });
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

  // Load real trades for the selected account.
  //
  // The lookback window normally tracks the range toggle. But a date deep-link
  // may point at a day OLDER than 31 days (e.g. a calendar click on a day only
  // the broker Fills report knows about), so when a date filter is active we
  // extend `since` to cover that exact date (minus a small buffer for entries
  // that opened on a prior day). Then we narrow to the day client-side (tz-safe).
  const effectiveRangeDays = dateFilter ? 31 : rangeDays;
  let since = new Date(Date.now() - effectiveRangeDays * 24 * 60 * 60 * 1000);
  if (dateFilter) {
    const dateFilterStart = new Date(`${dateFilter}T00:00:00Z`);
    const buffered = new Date(dateFilterStart.getTime() - 3 * 24 * 60 * 60 * 1000);
    if (buffered < since) since = buffered;
  }

  // Imported fills from the local DB (fills synced after Guardrail connected).
  const dbFillInputs = selectedAccount
    ? await loadAccountFillInputs(selectedAccount.id, { since })
    : [];

  // Broker-authoritative day-level realized P&L. Prefers the Account Balance
  // History report (widest history) and falls back to cashBalanceLog/deps. This
  // is the real after-fees / realized result the trader sees in Tradovate, even
  // when per-fill fee allocation is unavailable at the trade-row level.
  // Read-only and best-effort: any failure yields {} and day totals fall back
  // to fill values.
  //
  // Same client also fetches the historical FILLS report — individual fill rows
  // for trades that closed BEFORE Guardrail connected. ABH stays the source of
  // truth for day net; the Fills report is the source for table rows only.
  let brokerDayNet: Record<string, number> = {};
  let brokerSource: BrokerHistorySource = "none";
  let earliestBrokerDay: string | null = null;
  let historicalFillInputs: typeof dbFillInputs = [];
  let usedReportFills = false;
  let fillsReportFailed = false;
  if (selectedAccount) {
    const client = new TradovateClient(selectedAccount.id, currentUser.id);
    // Client init is capped — a slow token refresh must not block navigation.
    let initOk = false;
    try {
      await timed("trades", "broker-init", selectedAccount.id, () =>
        withTimeout(client.initialize(), CLIENT_INIT_TIMEOUT_MS, "trades:initialize"),
      );
      initOk = true;
    } catch {
      initOk = false;
    }

    if (initOk) {
      // Broker performance (ABH day net) — capped independently so a slow
      // report host fails fast and the page still renders DB rows + day totals.
      try {
        const perf = await timed("trades", "broker-performance", selectedAccount.id, () =>
          withTimeout(
            client.getHistoricalAccountPerformance(),
            BROKER_PERF_TIMEOUT_MS,
            "trades:getHistoricalAccountPerformance",
          ),
        );
        brokerDayNet = perf.dayNet;
        brokerSource = perf.source;
        earliestBrokerDay = perf.earliestBrokerDay;
      } catch {
        brokerDayNet = {};
        brokerSource = "none";
        earliestBrokerDay = null;
      }

      // Historical fills — best-effort, read-only, capped independently. Account
      // NAME is required as the report's `account` param (numeric tvAccountId
      // returns 0 rows). fillsReportFailed is set on timeout/error so the empty
      // state can say "could not be loaded" rather than "no fills available".
      //
      // The Fills report endpoint returns 0 rows for large windows (e.g. 5
      // years), so the window is narrowed to what the page actually displays:
      // ±1 day around dateFilter, or the visible range for range views.
      try {
        const accountName = await timed("trades", "account-name", selectedAccount.id, () =>
          withTimeout(client.getAccountName(), ACCOUNT_NAME_TIMEOUT_MS, "trades:getAccountName"),
        );
        if (accountName) {
          let reportStart: Date;
          let reportEnd: Date;
          const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
          if (dateFilter) {
            const d = new Date(`${dateFilter}T00:00:00Z`);
            reportStart = new Date(d.getTime() - 24 * 60 * 60 * 1000);
            reportEnd = new Date(d.getTime() + 24 * 60 * 60 * 1000);
          } else {
            reportStart = since;
            reportEnd = tomorrow;
          }
          const startStr = formatDateMMDDYYYY(reportStart.toLocaleDateString("en-CA"));
          const endStr = formatDateMMDDYYYY(reportEnd.toLocaleDateString("en-CA"));
          // Hard timeout via the shared helper; null on timeout → honest empty state.
          const rows = await timed("trades", "fills-report", selectedAccount.id, () =>
            withTimeout(
              client.getHistoricalFillsReport(accountName, startStr, endStr),
              FILLS_REPORT_TIMEOUT_MS,
              "trades:getHistoricalFillsReport",
            ).catch(() => null),
          );
          if (rows === null) {
            fillsReportFailed = true;
            console.info("[trades/page] fills-report timed-out or null", {
              accountId: selectedAccount.id,
              accountName,
              dateFilter,
              rangeDays,
              startStr,
              endStr,
            });
          } else {
            const inWindow = historicalFillsToFillInputs(rows).filter(
              (f) => f.occurredAt >= since,
            );
            historicalFillInputs = inWindow;
            usedReportFills = inWindow.length > 0;
            console.info("[trades/page] fills-report", {
              accountId: selectedAccount.id,
              accountName,
              dateFilter,
              rangeDays,
              startStr,
              endStr,
              reportRowsCount: rows.length,
              mergedFillInputsCount: inWindow.length,
            });
          }
        }
      } catch {
        fillsReportFailed = true;
        historicalFillInputs = [];
        usedReportFills = false;
      }
    }
  }

  // Merge imported DB fills with broker historical Fills-report fills, deduping
  // by stable broker fill id, then reconstruct round trips over the union.
  const allTrades = reconstructMergedTrades(dbFillInputs, historicalFillInputs);
  if (selectedAccount) {
    console.info("[trades/page] reconstructed", {
      accountId: selectedAccount.id,
      dateFilter,
      rangeDays,
      dbFillInputsCount: dbFillInputs.length,
      historicalFillInputsCount: historicalFillInputs.length,
      reconstructedTradesCount: allTrades.length,
    });
  }

  // When a date filter is active, narrow to exactly that calendar day.
  const dateFilteredTrades = dateFilter
    ? allTrades.filter((t) => isoDateKey(t.closedAt, tz) === dateFilter)
    : allTrades;

  // Two-tier fee model: resolve fees + net for every trade, per day, so that
  // multi-trade historical days get Account-Balance-derived fees allocated
  // across their trades (not just single-trade-day inference). Build one
  // id → {fees, net, feeSource} map shared by the filter and the table.
  const rowNetById = new Map<string, ReturnType<typeof resolveDayRowNets> extends Map<string, infer V> ? V : never>();
  let anyDerivedFees = false;
  {
    const byDay = new Map<string, typeof dateFilteredTrades>();
    for (const t of dateFilteredTrades) {
      const key = isoDateKey(t.closedAt, tz);
      const arr = byDay.get(key);
      if (arr) arr.push(t);
      else byDay.set(key, [t]);
    }
    for (const [key, dayTrades] of byDay) {
      const resolved = resolveDayRowNets(
        dayTrades.map((t) => ({
          id: t.id, pnl: t.pnl, netPnl: t.netPnl, fees: t.fees,
          feesAvailable: t.feesAvailable, qty: t.qty,
        })),
        brokerDayNet[key],
      );
      for (const [id, rn] of resolved) {
        rowNetById.set(id, rn);
        if (rn.feeSource === "account-balance-derived") anyDerivedFees = true;
      }
    }
  }

  // Net-aware winning/losing classification using the resolved per-trade net
  // (falls back to gross when net is undeterminable).
  const classify = (t: (typeof dateFilteredTrades)[number]): "winning" | "losing" | "flat" => {
    const effective = rowNetById.get(t.id)?.net ?? t.pnl;
    if (effective > 0) return "winning";
    if (effective < 0) return "losing";
    return "flat";
  };
  const filteredTrades = dateFilteredTrades.filter((t) => {
    if (filter === "all") return true;
    const cls = classify(t);
    if (filter === "winning") return cls === "winning";
    if (filter === "losing") return cls === "losing";
    return true;
  });

  // Stats are computed across the date-filtered range (unfiltered by win/lose)
  // so users see the true picture for that context.
  const stats = computeTradeStats(dateFilteredTrades);

  // Broker-net totals for the KPI primary: sum ALL broker days in the date
  // window (not just fill-aligned days). For account-balance-history accounts,
  // broker days like May 4 with no imported fill must still contribute to the
  // window net, win/loss count, and win rate.
  const tradedDateKeys = [...new Set(dateFilteredTrades.map((t) => isoDateKey(t.closedAt, tz)))];
  // Day-range cutoff for the selected window (matches effectiveRangeDays).
  const brokerWindowSince = dateFilter
    ? dateFilter
    : new Date(Date.now() - effectiveRangeDays * 24 * 60 * 60 * 1000)
        .toLocaleDateString("en-CA", { timeZone: tz });
  const allBrokerWindowEntries = Object.entries(brokerDayNet)
    .filter(([k]) => dateFilter ? k === dateFilter : k >= brokerWindowSince);
  const brokerWindowNet = allBrokerWindowEntries.reduce((s, [, v]) => s + v, 0);
  const brokerCoversSome = allBrokerWindowEntries.length > 0;
  // brokerCoversAll: used only for partial-coverage labels — always true for ABH
  // since the broker window is the source of truth (fill alignment not required).
  const brokerCoversAll = brokerCoversSome;
  // Day-level win/loss/winRate from broker (fill-independent).
  const brokerWins = allBrokerWindowEntries.filter(([, v]) => v > 0).length;
  const brokerLosses = allBrokerWindowEntries.filter(([, v]) => v < 0).length;
  const brokerNetDaysCount = brokerWins + brokerLosses;
  const brokerWinRate = brokerNetDaysCount > 0 ? brokerWins / brokerNetDaysCount : null;

  // Coverage window + data-trust signals. earliestTradeDate is the oldest
  // imported round-trip so the header can say "imported history only" rather
  // than implying complete all-time performance. lowConfidence is true when any
  // trade's contract symbol could not be resolved (point value defaulted to
  // $1/pt → its P&L is approximate, not trusted).
  const earliestTradeDate = allTrades.length > 0
    ? new Date(Math.min(...allTrades.map((t) => t.closedAt.getTime())))
    : null;
  const lowConfidence = allTrades.some((t) => t.symbolResolved === false);

  // Group trades by date for the header rows in the table
  const groupedByDate = new Map<string, typeof filteredTrades>();
  for (const t of filteredTrades) {
    const key = isoDateKey(t.closedAt, tz);
    const existing = groupedByDate.get(key);
    if (existing) existing.push(t);
    else groupedByDate.set(key, [t]);
  }
  // Sort descending by date key
  const groupedDateKeys = [...groupedByDate.keys()].sort().reverse();

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
        {/* ── Hero ─────────────────────────────────────────────────────── */}
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
          {!dateFilter && (brokerSource !== "none" ? earliestBrokerDay != null : earliestTradeDate != null) && (
            <div style={{ fontSize: 11.5, color: "var(--gr-text-mute)", marginTop: 6 }}>
              {brokerSource !== "none" && earliestBrokerDay != null
                ? `${brokerSourceLabel(brokerSource)} from ${new Date(`${earliestBrokerDay}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
                : `Imported history only · data from ${earliestTradeDate!.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`}
            </div>
          )}
          {!dateFilter && brokerSource !== "none" && (
            <div style={{ fontSize: 11, color: "var(--gr-text-mute)", marginTop: 3 }}>
              {usedReportFills
                ? `Day totals from ${brokerSourceLabel(brokerSource)} · table rows from broker fills report`
                : `Day totals from ${brokerSourceLabel(brokerSource)} · table rows are imported fills`}
            </div>
          )}
          {anyDerivedFees && (
            <div style={{ fontSize: 11, color: "var(--gr-text-mute)", marginTop: 3 }}>
              Fees marked <span style={{ textTransform: "uppercase", letterSpacing: "0.04em" }}>est</span> are derived from {brokerSourceLabel(brokerSource)} day net and allocated across the day&apos;s trades — each day reconciles to the broker day net.
            </div>
          )}
          {lowConfidence && (
            <div style={{ fontSize: 11.5, color: "var(--gr-warn, #b45309)", marginTop: 4 }}>
              ⚠ Some trades have an unrecognized contract — their P&amp;L is approximate (point value defaulted to $1/pt).
            </div>
          )}
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
          <>
            {/* ── Account picker strip (active accounts only) ──────────── */}
            {activeAccounts.length > 1 && (
              <section style={{ padding: "0 36px 16px" }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {activeAccounts.map((acc) => {
                    const isSelected = acc.id === selectedAccount?.id;
                    return (
                      <Link
                        key={acc.id}
                        href={buildHref({ accountId: acc.id })}
                        style={{
                          padding: "8px 14px",
                          borderRadius: 9,
                          fontSize: 12.5,
                          background: isSelected ? "var(--gr-copper-bg)" : "var(--gr-surface)",
                          border: isSelected ? "1px solid var(--gr-copper-bd)" : "1px solid var(--gr-border)",
                          color: isSelected ? "var(--gr-copper)" : "var(--gr-text-mid)",
                          fontWeight: isSelected ? 600 : 500,
                          textDecoration: "none",
                        }}
                      >
                        {acc.primaryLabel}
                      </Link>
                    );
                  })}
                </div>
              </section>
            )}

            {/* ── Expired account notice (when deep-linked) ────────────── */}
            {selectedAccountIsExpired && (
              <section style={{ padding: "0 36px 16px" }}>
                <div
                  style={{
                    padding: "10px 14px",
                    background: "var(--gr-bg-elev)",
                    border: "1px solid var(--gr-border)",
                    borderRadius: 10,
                    fontSize: 12.5,
                    color: "var(--gr-text-mid)",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <span style={{
                    fontSize: 10,
                    padding: "1px 7px",
                    borderRadius: 999,
                    background: "var(--gr-surface)",
                    color: "var(--gr-text-mute)",
                    fontWeight: 600,
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                    flexShrink: 0,
                  }}>
                    {selectedAccount?.status === "unavailable" ? "unavailable" : "expired"}
                  </span>
                  <span style={{ flex: 1 }}>
                    Viewing historical trades for an expired or unavailable account.
                    {activeAccounts.length > 0 && " Switch to an active account from the sidebar to monitor live activity."}
                  </span>
                  <Link
                    href="/dashboard"
                    style={{
                      fontSize: 11.5,
                      color: "var(--gr-copper)",
                      textDecoration: "none",
                      flexShrink: 0,
                    }}
                  >
                    Manage on dashboard →
                  </Link>
                </div>
              </section>
            )}

            {/* ── KPI strip ────────────────────────────────────────────── */}
            <section style={{ padding: "0 36px 18px" }}>
              <div className="trades-kpi-grid" style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
                {[
                  // Priority for the headline P&L:
                  //   1. Broker Cash History day-net — authoritative after-fees
                  //      total, even when per-fill fees are "Not reported".
                  //   2. Per-fill net — only when every trade carried fee data.
                  //   3. Fill P&L before fees — never labelled "Net".
                  brokerCoversSome
                    ? {
                        label: "Net P&L",
                        value: fmt$(brokerWindowNet),
                        sub: `${brokerSourceLabel(brokerSource)} · after broker fees`,
                        tone: brokerWindowNet >= 0 ? "ok" : "bad",
                      }
                    : stats.feesAvailable
                    ? {
                        label: "Net P&L",
                        value: stats.count > 0 ? fmt$(stats.netPnl) : "—",
                        sub: `after ${fmt$(stats.fees)} fees`,
                        tone: stats.netPnl >= 0 ? "ok" : "bad",
                      }
                    : {
                        label: "Trade P&L (before fees)",
                        value: stats.count > 0 ? fmt$(stats.grossPnl) : "—",
                        sub: `fees not reported · see dashboard for net`,
                        tone: stats.grossPnl >= 0 ? "ok" : "bad",
                      },
                  {
                    label: "Trades",
                    value: String(stats.count),
                    // Fill round-trip count — clearly labeled as fills, not broker days
                    sub: stats.count > 0 ? `${stats.winners}W · ${stats.losers}L · imported fills` : "no fills yet",
                    tone: "mute",
                  },
                  // Win Rate: use broker day-level win rate when broker history is
                  // available (day wins / non-zero days), not fill trade win rate.
                  // This gives the account-level picture that matches the dashboard.
                  brokerCoversSome && brokerWinRate != null
                    ? {
                        label: "Win rate",
                        value: `${Math.round(brokerWinRate * 100)}%`,
                        sub: `${brokerWins}W · ${brokerLosses}L · ${brokerNetDaysCount} broker net days`,
                        tone: "mute" as const,
                      }
                    : {
                        label: "Win rate",
                        value: stats.winRate != null ? `${Math.round(stats.winRate * 100)}%` : "—",
                        sub: stats.count > 0 ? `${stats.winners} of ${stats.count}` : "no trades yet",
                        tone: "mute" as const,
                      },
                  {
                    label: "Largest loss",
                    value: stats.largestLoss != null ? fmt$(stats.largestLoss.pnl) : "—",
                    sub: stats.largestLoss != null ? fmtDate(stats.largestLoss.closedAt, tz) : "—",
                    tone: "bad",
                  },
                  {
                    label: "Largest win",
                    value: stats.largestWin != null ? fmt$(stats.largestWin.pnl) : "—",
                    sub: stats.largestWin != null ? fmtDate(stats.largestWin.closedAt, tz) : "—",
                    tone: "ok",
                  },
                ].map((k) => (
                  <div
                    key={k.label}
                    style={{
                      background: "var(--gr-surface)",
                      border: "1px solid var(--gr-border)",
                      borderRadius: 12,
                      padding: 16,
                    }}
                  >
                    <span style={{ fontSize: 10.5, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--gr-text-mute)" }}>
                      {k.label}
                    </span>
                    <div style={{
                      fontSize: 22, fontWeight: 600, marginTop: 6, lineHeight: 1,
                      fontFamily: "var(--font-ibm-plex-mono, monospace)",
                      color:
                        k.tone === "ok" ? "var(--gr-ok)"
                        : k.tone === "bad" ? "var(--gr-bad)"
                        : "var(--gr-ink)",
                    }}>
                      {k.value}
                    </div>
                    <span style={{ fontSize: 11, marginTop: 6, display: "inline-block", color: "var(--gr-text-mute)" }}>
                      {k.sub}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            {/* ── Filter & range bar (hidden in date-filter mode) ──────── */}
            {dateFilter ? (
              <section style={{ padding: "0 36px 16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 10, background: "var(--gr-bg-elev)", border: "1px solid var(--gr-border)", flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12.5, color: "var(--gr-ink)", fontWeight: 500 }}>
                    {fmtDateFromKey(dateFilter)}
                  </span>
                  <span style={{ fontSize: 11.5, color: "var(--gr-text-mute)" }}>
                    · {filteredTrades.length} trade{filteredTrades.length !== 1 ? "s" : ""}
                  </span>
                  {brokerDayNet[dateFilter] != null && (
                    <span style={{ fontSize: 12, fontFamily: "var(--font-ibm-plex-mono, monospace)", fontWeight: 600, color: brokerDayNet[dateFilter]! >= 0 ? "var(--gr-ok)" : "var(--gr-bad)" }}>
                      · Day Net P&amp;L {fmt$(brokerDayNet[dateFilter]!)}
                      <span style={{ fontWeight: 400, color: "var(--gr-text-mute)" }}> · after broker fees</span>
                    </span>
                  )}
                  <Link
                    href={buildHref({})}
                    style={{ marginLeft: "auto", fontSize: 12, color: "var(--gr-copper)", textDecoration: "none", flexShrink: 0 }}
                  >
                    ← All trades
                  </Link>
                </div>
              </section>
            ) : (
              <TradeFilters
                currentFilter={filter}
                currentRange={rangeDays}
                buildHref={{
                  all: buildHref({ filter: "all" }),
                  winning: buildHref({ filter: "winning" }),
                  losing: buildHref({ filter: "losing" }),
                  r7: buildHref({ range: "7" }),
                  r14: buildHref({ range: "14" }),
                  r30: buildHref({ range: "30" }),
                }}
              />
            )}

            {/* ── Trades table ─────────────────────────────────────────── */}
            <section style={{ padding: "0 36px 36px" }}>
              <div style={{ background: "var(--gr-surface)", border: "1px solid var(--gr-border)", borderRadius: 14, overflow: "hidden", overflowX: "auto" }}>
                {filteredTrades.length === 0 ? (
                  <div style={{ padding: "48px 24px", textAlign: "center" }}>
                    <div style={{ fontSize: 32, marginBottom: 8, opacity: 0.4 }}>—</div>
                    <p style={{ fontSize: 14, fontWeight: 500, color: "var(--gr-ink)", margin: 0 }}>
                      {dateFilter && brokerDayNet[dateFilter] != null
                        ? fillsReportFailed
                          ? "Broker fill rows could not be loaded for this date."
                          : "No imported fills for this date."
                        : dateFilter
                        ? `No closed round-trips on ${fmtDateFromKey(dateFilter)}.`
                        : allTrades.length === 0
                        ? "No closed round-trips for this account yet."
                        : `No ${filter} trades in the last ${rangeDays}d.`}
                    </p>
                    <p style={{ fontSize: 12, color: "var(--gr-text-mute)", marginTop: 6, lineHeight: 1.5 }}>
                      {dateFilter && brokerDayNet[dateFilter] != null
                        ? fillsReportFailed
                          ? `${brokerSourceLabel(brokerSource)} reports a net P&L for this day, but broker fill rows could not be loaded.`
                          : `${brokerSourceLabel(brokerSource)} reports a net P&L for this day, but no imported fill rows are available for this date.`
                        : allTrades.length === 0
                        ? "Fills are reconstructed into round-trip trades the moment your broker reports them — Guardrail does not invent activity."
                        : "Adjust the filter or extend the range to see more."}
                    </p>
                  </div>
                ) : (
                  <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
                    <thead>
                      <tr>
                        {["Time", "Symbol", "Side", "Qty", "Entry", "Exit", "Hold", "Trade P&L", "Fees", "Net P&L"].map((h) => (
                          <th
                            key={h}
                            style={{
                              textAlign: h === "Net P&L" || h === "Fees" || h === "Trade P&L" ? "right" : "left",
                              padding: "12px 16px",
                              borderBottom: "1px solid var(--gr-border)",
                              background: "var(--gr-bg-elev)",
                              fontSize: 10.5,
                              fontWeight: 600,
                              letterSpacing: "0.08em",
                              textTransform: "uppercase",
                              color: "var(--gr-text-mute)",
                            }}
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {groupedDateKeys.map((dateKey) => {
                        const rows = groupedByDate.get(dateKey)!;
                        // Day total truth order: broker Cash History net (after
                        // fees) → per-trade net (only if every trade has fees) →
                        // fill P&L before fees (labelled, never called net). This
                        // surfaces the real after-fees day net (e.g. −$0.40) even
                        // when row-level fees are "Not reported".
                        const day = resolveDayNet(rows, brokerDayNet[dateKey]);
                        return (
                          <Fragment key={dateKey}>
                            <tr>
                              <td colSpan={10} style={{ padding: "10px 16px 8px", background: "var(--gr-bg-elev)" }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                                  <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--gr-ink)", lineHeight: 1.4 }}>
                                    {fmtDate(rows[0]!.closedAt, tz)}
                                  </span>
                                  <div style={{ textAlign: "right" }}>
                                    <div style={{
                                      fontSize: 12.5,
                                      fontFamily: "var(--font-ibm-plex-mono, monospace)",
                                      fontWeight: 700,
                                      color: day.pnl >= 0 ? "var(--gr-ok)" : "var(--gr-bad)",
                                      lineHeight: 1.3,
                                    }}>
                                      {day.source === "broker_net"
                                        ? `Net P&L ${fmt$(day.pnl)}`
                                        : day.isNet
                                        ? `Net P&L ${fmt$(day.pnl)}`
                                        : `Fill P&L ${fmt$(day.pnl)}`}
                                    </div>
                                    <div style={{ fontSize: 10.5, color: "var(--gr-text-mute)", marginTop: 2, lineHeight: 1.3 }}>
                                      {day.source === "broker_net"
                                        ? `after broker fees · ${rows.length} trade${rows.length !== 1 ? "s" : ""}`
                                        : day.isNet
                                        ? `net · ${rows.length} trade${rows.length !== 1 ? "s" : ""}`
                                        : `before fees · ${rows.length} trade${rows.length !== 1 ? "s" : ""}`}
                                    </div>
                                  </div>
                                </div>
                              </td>
                            </tr>
                            {rows.map((t) => {
                              const sideOk = t.side === "LONG";
                              const rowRes = rowNetById.get(t.id) ?? { fees: null, net: null, feeSource: null };
                              const isDerived = rowRes.feeSource === "account-balance-derived";
                              const rowPnlColor = (rowRes.net ?? t.pnl) >= 0 ? "var(--gr-ok)" : "var(--gr-bad)";
                              return (
                                <tr key={t.id} style={{ borderBottom: "1px solid var(--gr-border-sub)" }}>
                                  <td style={{ padding: "14px 16px", fontFamily: "var(--font-ibm-plex-mono, monospace)", fontSize: 12, color: "var(--gr-text-mid)" }}>
                                    {fmtTime(t.closedAt, tz)}
                                  </td>
                                  <td style={{ padding: "14px 16px", fontFamily: "var(--font-ibm-plex-mono, monospace)", fontSize: 13, fontWeight: 500, color: "var(--gr-ink)" }}>
                                    {t.symbol}
                                  </td>
                                  <td style={{ padding: "14px 16px" }}>
                                    <span style={{
                                      fontSize: 10.5,
                                      padding: "2px 7px",
                                      borderRadius: 999,
                                      background: sideOk ? "var(--gr-ok-bg)" : "var(--gr-bad-bg)",
                                      color: sideOk ? "var(--gr-ok)" : "var(--gr-bad)",
                                      fontWeight: 600,
                                      letterSpacing: "0.05em",
                                      textTransform: "uppercase",
                                    }}>
                                      {t.side}
                                    </span>
                                  </td>
                                  <td style={{ padding: "14px 16px", fontFamily: "var(--font-ibm-plex-mono, monospace)", fontSize: 12.5, color: "var(--gr-ink)" }}>
                                    {t.qty}
                                  </td>
                                  <td style={{ padding: "14px 16px", fontFamily: "var(--font-ibm-plex-mono, monospace)", fontSize: 12.5, color: "var(--gr-text-mid)" }}>
                                    {fmtPrice(t.entryPrice)}
                                  </td>
                                  <td style={{ padding: "14px 16px", fontFamily: "var(--font-ibm-plex-mono, monospace)", fontSize: 12.5, color: "var(--gr-text-mid)" }}>
                                    {fmtPrice(t.exitPrice)}
                                  </td>
                                  <td style={{ padding: "14px 16px", fontFamily: "var(--font-ibm-plex-mono, monospace)", fontSize: 11.5, color: "var(--gr-text-mute)" }}>
                                    {fmtHold(t.holdMs)}
                                  </td>
                                  {/* Trade P&L — the fill/gross value, always shown. */}
                                  <td style={{ padding: "14px 16px", textAlign: "right", fontFamily: "var(--font-ibm-plex-mono, monospace)", fontSize: 13, fontWeight: 600, color: t.pnl >= 0 ? "var(--gr-ok)" : "var(--gr-bad)" }}>
                                    {fmt$(t.pnl)}
                                  </td>
                                  {/* Fees — exact (per-fill commission) or Account-Balance-derived
                                      (allocated from the ABH day net); "Not reported" only when neither. */}
                                  <td style={{ padding: "14px 16px", textAlign: "right", fontFamily: "var(--font-ibm-plex-mono, monospace)", fontSize: 12, color: "var(--gr-text-mute)" }}
                                    title={
                                      rowRes.fees == null
                                        ? undefined
                                        : isDerived
                                        ? "Derived from Broker Account Balance History day net, allocated across the day's trades by contract quantity."
                                        : "Exact broker per-fill commission."
                                    }>
                                    {rowRes.fees != null ? fmt$(rowRes.fees) : "Not reported"}
                                    {isDerived && (
                                      <span style={{ marginLeft: 4, fontSize: 9.5, color: "var(--gr-text-faint)", textTransform: "uppercase", letterSpacing: "0.04em" }}>est</span>
                                    )}
                                  </td>
                                  {/* Net P&L — real, exact-derived, or ABH-derived; "—" only when undeterminable. */}
                                  <td style={{ padding: "14px 16px", textAlign: "right", fontFamily: "var(--font-ibm-plex-mono, monospace)", fontSize: 13, fontWeight: 600, color: rowRes.net != null ? rowPnlColor : "var(--gr-text-faint)" }}
                                    title={
                                      rowRes.net == null
                                        ? "Net unavailable at trade level — fees not reported by broker. See Broker Session P&L on the dashboard."
                                        : isDerived
                                        ? "After Account-Balance-derived fees. The day's net reconciles to Broker Account Balance History."
                                        : undefined
                                    }>
                                    {rowRes.net != null ? fmt$(rowRes.net) : "—"}
                                  </td>
                                </tr>
                              );
                            })}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
              {allTrades.length > 0 && (
                <p style={{ marginTop: 10, fontSize: 11, color: ["var(--gr-text-mute)"].join("") }}>
                  {`Day totals use ${brokerSource === "none" ? "broker history" : brokerSourceLabel(brokerSource)} when available. Individual trade rows show fill P&L before fees unless per-trade fees are available.`}
                </p>
              )}
            </section>
          </>
        )}
        </div>
      </div>
    </GrShell>
  );
}
