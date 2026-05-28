import { Fragment } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";

import { GrShell, type GrNavItem } from "@/components/ui/gr-shell";
import { getCurrentUser } from "@/lib/auth";
import { loadCommandCenterData } from "@/app/dashboard/_components/command-center/data";
import {
  isAccountActive,
  partitionAccountsByActive,
} from "@/app/dashboard/_components/command-center/active-status";
import { loadAccountTrades } from "@/lib/trades/load";
import { computeTradeStats } from "@/lib/trades/stats";
import { TradeFilters } from "./_components/trade-filters";

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

export default async function TradesPage({
  searchParams,
}: {
  searchParams: Promise<{ accountId?: string; filter?: string; range?: string }>;
}) {
  const currentUser = await getCurrentUser();
  if (!currentUser) redirect("/login");

  const params = await searchParams;
  const filter: FilterKey =
    params.filter === "winning" || params.filter === "losing" ? params.filter : "all";
  const rangeDays = params.range === "30" ? 30 : params.range === "7" ? 7 : 14;
  const userInitials = currentUser.email ? currentUser.email.slice(0, 2).toUpperCase() : "??";

  const commandCenter = await loadCommandCenterData(currentUser.id, currentUser.email);
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

  // Load real trades for the selected account
  const since = new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000);
  const allTrades = selectedAccount
    ? await loadAccountTrades(selectedAccount.id, { since })
    : [];

  const filteredTrades = allTrades.filter((t) => {
    if (filter === "winning") return t.pnl > 0;
    if (filter === "losing") return t.pnl < 0;
    return true;
  });

  // Stats are computed across the full range (unfiltered) so users see the
  // true picture of their trading, not just the filtered subset.
  const stats = computeTradeStats(allTrades);

  const tz = "America/Chicago";

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
            {acc.label}
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
      <div style={{ overflowY: "auto", height: "100%" }}>
        <div style={{ maxWidth: 1400, margin: "0 auto" }}>
        {/* ── Hero ─────────────────────────────────────────────────────── */}
        <section style={{ padding: "28px 36px 16px" }}>
          <span style={{ fontSize: 11.5, fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--gr-text-mute)" }}>
            Closed round-trips · last {rangeDays}d
          </span>
          <h1 style={{ fontSize: 32, fontWeight: 600, letterSpacing: "-0.03em", lineHeight: 1.15, color: "var(--gr-ink)", margin: "6px 0 0" }}>
            {!hasAccounts ? (
              <>No accounts connected yet.</>
            ) : selectedAccount ? (
              <>
                Trades for{" "}
                <span style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontStyle: "italic" }}>
                  {selectedAccount.label}
                </span>
              </>
            ) : (
              <>No active accounts.</>
            )}
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
                        {acc.label}
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
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
                {[
                  {
                    label: "Net P&L",
                    value: stats.count > 0 ? fmt$(stats.netPnl) : "—",
                    sub: `last ${rangeDays}d`,
                    tone: stats.netPnl >= 0 ? "ok" : "bad",
                  },
                  {
                    label: "Trades",
                    value: String(stats.count),
                    sub: stats.count > 0 ? `${stats.winners}W · ${stats.losers}L` : "no trades yet",
                    tone: "mute",
                  },
                  {
                    label: "Win rate",
                    value: stats.winRate != null ? `${Math.round(stats.winRate * 100)}%` : "—",
                    sub: stats.count > 0 ? `${stats.winners} of ${stats.count}` : "no trades yet",
                    tone: "mute",
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

            {/* ── Filter & range bar ───────────────────────────────────── */}
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

            {/* ── Trades table ─────────────────────────────────────────── */}
            <section style={{ padding: "0 36px 36px" }}>
              <div style={{ background: "var(--gr-surface)", border: "1px solid var(--gr-border)", borderRadius: 14, overflow: "hidden", overflowX: "auto" }}>
                {filteredTrades.length === 0 ? (
                  <div style={{ padding: "48px 24px", textAlign: "center" }}>
                    <div style={{ fontSize: 32, marginBottom: 8, opacity: 0.4 }}>—</div>
                    <p style={{ fontSize: 14, fontWeight: 500, color: "var(--gr-ink)", margin: 0 }}>
                      {allTrades.length === 0
                        ? "No closed round-trips for this account yet."
                        : `No ${filter} trades in the last ${rangeDays}d.`}
                    </p>
                    <p style={{ fontSize: 12, color: "var(--gr-text-mute)", marginTop: 6, lineHeight: 1.5 }}>
                      {allTrades.length === 0
                        ? "Fills are reconstructed into round-trip trades the moment your broker reports them — Guardrail does not invent activity."
                        : "Adjust the filter or extend the range to see more."}
                    </p>
                  </div>
                ) : (
                  <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
                    <thead>
                      <tr>
                        {["Time", "Symbol", "Side", "Qty", "Entry", "Exit", "Hold", "P&L"].map((h) => (
                          <th
                            key={h}
                            style={{
                              textAlign: h === "P&L" ? "right" : "left",
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
                        const dayPnl = rows.reduce((s, t) => s + t.pnl, 0);
                        return (
                          <Fragment key={dateKey}>
                            <tr>
                              <td colSpan={8} style={{ padding: "14px 16px 6px", background: "var(--gr-bg-elev)" }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                                  <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--gr-ink)" }}>
                                    {fmtDate(rows[0]!.closedAt, tz)}
                                  </span>
                                  <span style={{ fontSize: 11, fontFamily: "var(--font-ibm-plex-mono, monospace)", color: "var(--gr-text-mute)" }}>
                                    {fmt$(dayPnl)} · {rows.length} trade{rows.length !== 1 ? "s" : ""}
                                  </span>
                                </div>
                              </td>
                            </tr>
                            {rows.map((t) => {
                              const sideOk = t.side === "LONG";
                              const rowPnlColor = t.pnl >= 0 ? "var(--gr-ok)" : "var(--gr-bad)";
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
                                  <td style={{ padding: "14px 16px", textAlign: "right", fontFamily: "var(--font-ibm-plex-mono, monospace)", fontSize: 13, fontWeight: 600, color: rowPnlColor }}>
                                    {fmt$(t.pnl)}
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
                <p style={{ marginTop: 10, fontSize: 11, color: "var(--gr-text-mute)" }}>
                  Round-trip trades reconstructed from broker fills (FIFO matching per contract). P&L uses
                  broker-reported values when present, otherwise computed from entry/exit prices.
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
