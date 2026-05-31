import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";

import { GrShell, type GrNavItem, type GrRecentAlert } from "@/components/ui/gr-shell";
import { CommandCenter } from "@/app/dashboard/_components/command-center/command-center";
import { loadCommandCenterData } from "@/app/dashboard/_components/command-center/data";
import { DEMO_COMMAND_CENTER_DATA } from "@/app/dashboard/_components/command-center/sample-data";
import { AutoSync } from "@/app/dashboard/_components/auto-sync";
import { SyncAllButton } from "@/app/dashboard/_components/command-center/sync-all-button";
import { DashboardAutoRefresh } from "@/app/dashboard/_components/dashboard-auto-refresh";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  derivePremarketReadiness,
  deriveTodaySessionState,
  getGuardianSnapshot,
  getTodayGuardianSessionStart,
} from "@/lib/guardian";
import { getTradingDayWindow } from "@/lib/trading-day";
import { evaluateTelegramAccess } from "@/lib/telegram-access";
import { buildPostSessionReview } from "@/lib/post-session-review";
import {
  buildRuleEngineInputFromGuardianSnapshot,
  buildViolationFeed,
} from "@/lib/rule-engine";
import { getTodaySessionEvents, getTodaySessionSummary } from "@/lib/session-log";
import {
  buildTodayActivityTimeline,
  buildViolationActivityItems,
} from "@/lib/today-activity";
import {
  getSelectedEconomicCalendarSnapshot,
  getCurrentPreNewsPolicy,
  getNextHighImpactEconomicEvent,
  buildEconomicCalendarVisibility,
  getEconomicCalendarSelection,
  formatEconomicEventTimeNoTz,
} from "@/lib/economic-calendar";
import {
  DISPLAY_TIME_ZONE_COOKIE,
  resolveDisplayTimeZone,
} from "@/lib/timezone";
import { needsSync } from "@/lib/sync-freshness";
import { loadAccountTrades } from "@/lib/trades/load";
import {
  isAccountActive,
  partitionAccountsByActive,
} from "@/app/dashboard/_components/command-center/active-status";
import { NewAccountsPanel } from "@/app/dashboard/_components/command-center/new-accounts-panel";
import { ArchiveAccountButton } from "@/app/dashboard/_components/archive-account-button";
import { EquityCurve } from "@/app/dashboard/_components/equity-curve";
import { PnlCalendar } from "@/app/dashboard/_components/pnl-calendar";
import { TraderInsights } from "@/app/dashboard/_components/trader-insights";
import { profitFactor } from "@/app/dashboard/_components/insights";

export const metadata: Metadata = {
  title: "Dashboard — Guardrail",
};

// ── Rule label map ─────────────────────────────────────────────────────────────

const RULE_LABELS: Record<string, string> = {
  max_trades_per_day:           "Max trades per day",
  max_daily_loss:               "Daily loss limit",
  daily_profit_target:          "Daily profit target",
  stop_after_consecutive_losses: "Tilt protection",
  trading_day_disabled:         "Trading day disabled",
  no_trade_before_major_news:   "Pre-news blackout",
  session_not_started:          "Session not started",
  session_closed:               "Session closed",
  guardian_disabled:            "Guardian disabled",
  manual_rule_breach:           "Manual rule breach",
  max_position_size:            "Max position size",
};

function ruleLabel(ruleId: string): string {
  return RULE_LABELS[ruleId] ?? ruleId.replace(/_/g, " ");
}

// ── Honest enforcement classification ──────────────────────────────────────
// Guardrail today is read-only — we observe broker fills and surface state
// to the trader, we do not block orders.  Daily-loss + max-position can be
// broker-enforced once the broker exposes the limit (we surface the broker
// value verbatim in that case).  Everything else is monitor-only until the
// app-lock implementation lands.
type Enforcement = "broker" | "lock" | "monitor" | "utility";

function ruleEnforcement(ruleId: string, hasBrokerLimit: boolean): Enforcement {
  if (ruleId === "max_daily_loss" && hasBrokerLimit) return "broker";
  if (ruleId === "max_position_size" && hasBrokerLimit) return "broker";
  if (
    ruleId === "session_not_started" ||
    ruleId === "session_closed" ||
    ruleId === "guardian_disabled" ||
    ruleId === "trading_day_disabled"
  ) {
    return "utility";
  }
  return "monitor";
}

// ── Status helpers ─────────────────────────────────────────────────────────────

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

function timeGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ accountId?: string }>;
}) {
  const currentUser = await getCurrentUser();
  if (!currentUser) redirect("/login");

  const { accountId: selectedAccountId } = await searchParams;

  const user = await prisma.user.findUnique({
    where: { id: currentUser.id },
    select: {
      subscriptionStatus: true,
      trialEndsAt: true,
      traderProfile: { select: { id: true, timezone: true } },
      telegramConnection: { select: { id: true, telegramUsername: true, connectedAt: true } },
      coachingPreferences: true,
    },
  });
  if (!user) redirect("/login");

  const onboardingComplete = Boolean(user.traderProfile);
  const cookieStore = await cookies();
  const displayTimeZone = resolveDisplayTimeZone({
    onboardingTimeZone: user.traderProfile?.timezone,
    browserTimeZone: cookieStore.get(DISPLAY_TIME_ZONE_COOKIE)?.value,
  });
  const telegramConnected = Boolean(user.telegramConnection);
  const economicCalendarSelection = getEconomicCalendarSelection(user.coachingPreferences);

  const riskRules = await prisma.riskRules.findUnique({ where: { userId: currentUser.id } });
  const tradingDay = getTradingDayWindow({
    timezone: displayTimeZone,
    sessionStartHour: riskRules?.sessionStartHour ?? null,
    sessionEndHour: riskRules?.sessionEndHour ?? null,
  });

  const [
    todaySessionSummary,
    todaySessionEvents,
    guardian,
    todayGuardianSessionStart,
    commandCenter,
    economicCalendarSnapshot,
  ] = await Promise.all([
    getTodaySessionSummary(currentUser.id),
    getTodaySessionEvents(currentUser.id, undefined, "asc"),
    getGuardianSnapshot(currentUser.id),
    getTodayGuardianSessionStart(currentUser.id),
    loadCommandCenterData(currentUser.id, currentUser.email),
    getSelectedEconomicCalendarSnapshot(user.coachingPreferences),
  ]);

  const hasBrokerAccount = commandCenter.accounts.length > 0;
  const economicCalendarPolicy = getCurrentPreNewsPolicy(economicCalendarSnapshot);
  const nextHighImpactEvent = getNextHighImpactEconomicEvent(economicCalendarSnapshot);

  const todaySessionState = deriveTodaySessionState(guardian, {
    onboardingComplete,
    sessionStart: todayGuardianSessionStart,
    preNewsPolicyStatus: economicCalendarPolicy,
  });

  const premarketReadiness = derivePremarketReadiness(todaySessionState);

  const telegramAccess = evaluateTelegramAccess({
    subscriptionStatus: user.subscriptionStatus,
    trialEndsAt: user.trialEndsAt,
    onboardingComplete,
    telegramConnected,
    email: currentUser.email,
  });

  const violationFeed = buildViolationFeed(
    buildRuleEngineInputFromGuardianSnapshot(guardian, {
      sessionStarted: todaySessionState.sessionStarted,
      sessionEnded: todaySessionState.sessionEnded,
      todaySessionStateKind: todaySessionState.kind,
      preNewsPolicy: economicCalendarPolicy.isActive
        ? {
            isActive: economicCalendarPolicy.isActive,
            mode: economicCalendarPolicy.policy.mode,
            message: economicCalendarPolicy.message,
          }
        : null,
    }),
  );

  const todayActivityTimeline = buildTodayActivityTimeline({
    sessionStart: todayGuardianSessionStart,
    guardian,
    sessionEvents: todaySessionEvents,
  });

  const violationActivityItems = buildViolationActivityItems(violationFeed);
  const mergedActivityTimeline = [
    ...todayActivityTimeline,
    ...violationActivityItems,
  ].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

  const postSessionReview = buildPostSessionReview({
    session: todayGuardianSessionStart,
    summary: todaySessionSummary,
    activityItems: mergedActivityTimeline,
    guardian,
    violationFeed,
  });

  // ── Derived display values ─────────────────────────────────────────────────
  const userInitials = currentUser.email
    ? currentUser.email.slice(0, 2).toUpperCase()
    : "??";

  // Partition into active (selectable for trading) and expired (kept for
  // historical data but hidden from primary selectors). Expired = broker
  // /account/list no longer returns it, or the broker token has expired.
  const { active: activeAccounts, expired: expiredAccounts } =
    partitionAccountsByActive(commandCenter.accounts);
  const hasActiveAccount = activeAccounts.length > 0;
  const hasExpiredAccount = expiredAccounts.length > 0;

  const liveAccounts = activeAccounts.length;

  // "Selected" account = URL ?accountId= if valid (active or expired allowed
  // via deep link), else first active with warning/locked, else first active
  // with data, else first active. Auto-select never lands on an expired
  // account — that would confuse users into thinking it's live.
  const autoSelectedAccount =
    activeAccounts.find((a) => a.status === "warning" || a.status === "locked") ??
    activeAccounts.find((a) => a.balance != null) ??
    activeAccounts[0] ??
    null;
  const selectedAccount = selectedAccountId
    ? (commandCenter.accounts.find((a) => a.id === selectedAccountId) ?? autoSelectedAccount)
    : autoSelectedAccount;

  // Active (non-ok) rule results for the alerts panel
  const activeAlerts = violationFeed.activeViolations.slice(0, 5);

  // Bell-dropdown payload — shared with the shell. Maps the violation feed
  // into the small alert shape the shell expects.
  const bellAlerts: GrRecentAlert[] = activeAlerts.map((a) => ({
    id: a.ruleId,
    label: ruleLabel(a.ruleId),
    message: a.message,
    severity: a.status === "blocked" || a.status === "triggered"
      ? a.status
      : a.status === "warning" ? "warning" : "ok",
  }));

  // Real trade history for the selected account — used by Today's trades and
  // Equity curve panels. Loaded only when we have a selection; empty array
  // otherwise drives the honest empty state.
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const recentTrades = selectedAccount
    ? await loadAccountTrades(selectedAccount.id, { since: thirtyDaysAgo })
    : [];
  const todayTrades = recentTrades.filter((t) => t.closedAt >= todayStart);

  // Win rate and profit factor for KPI strip (honest 30d stats)
  const wins30d = recentTrades.filter((t) => t.pnl > 0).length;
  const winRate30d = recentTrades.length > 0 ? wins30d / recentTrades.length : null;
  const pf30d = profitFactor(recentTrades);

  // Nav items — same as /rules, but home is active
  const DASHBOARD_NAV: GrNavItem[] = [
    { id: "home",     label: "Dashboard",    icon: "home",     href: "/dashboard", active: true },
    { id: "rules",    label: "Trading Plan", icon: "shield",   href: "/rules" },
    { id: "trades",   label: "Trades",       icon: "chart",    href: "/trades" },
    { id: "alerts",   label: "Alerts",       icon: "bell",     href: "/alerts" },
    { id: "settings", label: "Settings",     icon: "settings", href: "/settings" },
  ];

  // ── Sidebar: compact account list (active accounts only) ─────────────────
  const SidebarAccountList = hasActiveAccount ? (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {activeAccounts.slice(0, 4).map((acc) => (
        <div
          key={acc.id}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "7px 8px",
            borderRadius: 8,
            background: acc.id === selectedAccount?.id ? "var(--gr-surface)" : "transparent",
            border: acc.id === selectedAccount?.id ? "1px solid var(--gr-border)" : "1px solid transparent",
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
          <span title={acc.rawLabel ?? acc.primaryLabel} style={{ fontSize: 12.5, color: "var(--gr-ink)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {acc.primaryLabel}
          </span>
          {acc.dailyPnl != null && (
            <span style={{ fontSize: 11, fontFamily: "var(--font-ibm-plex-mono, monospace)", color: pnlColor(acc.dailyPnl), flexShrink: 0 }}>
              {fmt$(acc.dailyPnl)}
            </span>
          )}
        </div>
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
      {hasExpiredAccount ? "Reconnect or add account →" : "Connect first account →"}
    </Link>
  );

  return (
    <GrShell
      breadcrumb={["Dashboard"]}
      sidebarContent={SidebarAccountList}
      sidebarLabel={hasActiveAccount ? "Accounts" : "Connect"}
      navItems={DASHBOARD_NAV}
      userInitials={userInitials}
      hideApiStatus
      recentAlerts={bellAlerts}
    >
      <style>{`
        @media (max-width: 900px) {
          .dash-row-2col { grid-template-columns: 1fr !important; }
          .dash-kpi-grid { grid-template-columns: repeat(2, 1fr) !important; }
          .dash-insights-grid { grid-template-columns: repeat(2, 1fr) !important; }
          .dash-section { padding-left: 16px !important; padding-right: 16px !important; }
        }
        @media (max-width: 540px) {
          .dash-kpi-grid { grid-template-columns: 1fr !important; }
          .dash-insights-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
      <div style={{ overflowY: "auto", height: "100%" }}>
        <div style={{ maxWidth: 1400, margin: "0 auto" }}>
        {/* ── Auto-refresh for live data ─────────────────────────────────── */}
        {hasBrokerAccount && <DashboardAutoRefresh />}

        {/* ── Hero ──────────────────────────────────────────────────────── */}
        <section className="dash-section" style={{ padding: "22px 36px 14px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, maxWidth: 620 }}>
              <span style={{ fontSize: 11.5, fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--gr-text-mute)" }}>
                {timeGreeting()}
              </span>
              <h1 style={{ fontSize: 32, fontWeight: 600, letterSpacing: "-0.03em", lineHeight: 1.15, color: "var(--gr-ink)", margin: 0 }}>
                {!hasBrokerAccount ? (
                  <>No accounts connected yet.</>
                ) : hasActiveAccount ? (
                  <>Watching{" "}
                    <span style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontStyle: "italic", color: "var(--gr-ink)" }}>
                      {liveAccounts}
                    </span>
                    {" "}live account{liveAccounts !== 1 ? "s" : ""}.
                  </>
                ) : (
                  <>No live accounts — all connected accounts are expired or unavailable.</>
                )}
              </h1>
            </div>
            <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
              {hasBrokerAccount && <SyncAllButton />}
              <Link
                href="/accounts/connect/tradovate"
                className="btn-compact"
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  padding: "7px 14px", borderRadius: 9, fontSize: 13,
                  background: "var(--gr-ink)", color: "var(--gr-bg)", textDecoration: "none",
                  fontWeight: 500,
                }}
              >
                + Connect account
              </Link>
            </div>
          </div>
        </section>

        {/* ── No-accounts state ─────────────────────────────────────────── */}
        {!hasBrokerAccount && (
          <section className="dash-section" style={{ padding: "4px 36px 36px" }}>
            <div style={{
              background: "var(--gr-surface)", border: "1px solid var(--gr-border)",
              borderRadius: 14, padding: "32px 36px",
            }}>
              <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--gr-copper)", marginBottom: 12 }}>
                Getting started
              </p>
              <h2 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.03em", color: "var(--gr-ink)", marginBottom: 10 }}>
                Connect your first trading account.
              </h2>
              <p style={{ fontSize: 13.5, lineHeight: 1.6, color: "var(--gr-text-mid)", maxWidth: 560, marginBottom: 20 }}>
                Guardrail starts working once it can read account activity. Connect Tradovate to
                monitor daily loss, trades used, account status, and rule breaches.
              </p>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <Link
                  href="/accounts/connect/tradovate"
                  style={{
                    display: "inline-flex", alignItems: "center", padding: "9px 20px",
                    borderRadius: 999, fontSize: 13.5, fontWeight: 500,
                    background: "var(--gr-ink)", color: "var(--gr-bg)", textDecoration: "none",
                  }}
                >
                  Connect Tradovate
                </Link>
                <Link
                  href="/rules"
                  style={{
                    display: "inline-flex", alignItems: "center", padding: "9px 20px",
                    borderRadius: 999, fontSize: 13.5,
                    border: "1px solid var(--gr-border)", color: "var(--gr-text-mid)", textDecoration: "none",
                  }}
                >
                  Set up rules first
                </Link>
              </div>
            </div>

            {/* Demo preview banner */}
            <div style={{
              marginTop: 16, borderRadius: 10, padding: "10px 16px",
              background: "rgba(100,160,240,0.07)", border: "1px solid rgba(100,160,240,0.2)",
              fontSize: 12, color: "var(--gr-text-mid)", display: "flex", gap: 8, alignItems: "flex-start",
            }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#60a5fa", marginTop: 3, flexShrink: 0 }} />
              <span>
                <strong>Dashboard preview · </strong>
                Sample accounts only — balances are not real. Connect a broker to replace this with live account data.
              </span>
            </div>

            {/* Demo command center */}
            <div style={{ marginTop: 24 }}>
              <CommandCenter data={DEMO_COMMAND_CENTER_DATA} />
            </div>
          </section>
        )}

        {/* ── Connected accounts view ───────────────────────────────────── */}
        {hasBrokerAccount && (
          <>
            {/* ── Account strip ─────────────────────────────────────────── */}
            <section className="dash-section" style={{ padding: "4px 36px 16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10, alignItems: "center" }}>
                <span style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--gr-text-mute)" }}>
                  Your accounts · {activeAccounts.length}
                </span>
                <span style={{ fontSize: 11, color: "var(--gr-text-mute)" }}>
                  Each card is one account — numbers are never combined
                </span>
              </div>
              {/*
                * Responsive grid — cards have a min of 190px and a max of 260px
                * so they stay card-sized on wide screens (2 accounts won't expand
                * to fill 1400px each). auto-fill still wraps to new rows on narrow
                * viewports, and justify-content:start prevents the last partial row
                * from stretching to fill the container.
                */}
              <div style={{
                display: "flex",
                gap: 10,
                overflowX: "auto",
                paddingBottom: 6,
              }}>
                {/* Auto-sync for stale accounts (active only — no point
                  * trying to sync accounts the broker no longer returns). */}
                {(() => {
                  const staleAccounts = activeAccounts.filter(
                    (a) => a.platform === "tradovate" && needsSync(a.lastSyncAt),
                  );
                  const staleConnectionIds = [
                    ...new Set(
                      staleAccounts
                        .filter((a) => a.brokerConnectionId != null)
                        .map((a) => a.brokerConnectionId!),
                    ),
                  ];
                  const staleAccountIds = staleAccounts
                    .filter((a) => a.brokerConnectionId == null)
                    .map((a) => a.id);
                  return staleConnectionIds.length > 0 || staleAccountIds.length > 0 ? (
                    <AutoSync staleConnectionIds={staleConnectionIds} staleAccountIds={staleAccountIds} />
                  ) : null;
                })()}

                {activeAccounts.map((acc) => {
                  const isSelected = acc.id === selectedAccount?.id;
                  // Defensive — all entries here are active, but keep the
                  // expired-card visual fallback intact in case isAccountActive
                  // ever loosens its definition.
                  const isExpired = !isAccountActive(acc);
                  return (
                    <div
                      key={acc.id}
                      style={{
                        position: "relative",
                        flex: "0 0 260px",
                        padding: 16,
                        background: "var(--gr-surface)",
                        border: isSelected ? "1px solid var(--gr-copper)" : "1px solid var(--gr-border)",
                        boxShadow: isSelected ? "0 0 0 3px var(--gr-copper-bg)" : "none",
                        borderRadius: 12,
                        opacity: isExpired ? 0.72 : 1,
                      }}
                    >
                      {/* Broker badge + state */}
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10, alignItems: "center" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                          <div style={{
                            width: 22, height: 22, borderRadius: 6,
                            background: "var(--gr-bg-elev)", color: "var(--gr-text-mid)",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: 9, fontWeight: 700, letterSpacing: "0.04em",
                          }}>
                            {(acc.propFirm ?? acc.platformLabel ?? "??").slice(0, 2).toUpperCase()}
                          </div>
                          <span style={{ fontSize: 11.5, fontWeight: 500, color: "var(--gr-text-mid)" }}>
                            {acc.platformLabel ?? acc.propFirm ?? "Broker"}
                          </span>
                        </div>
                        {/* State indicator */}
                        {acc.status === "warning" && (
                          <span style={{ fontSize: 10, padding: "1px 7px", borderRadius: 999, background: "var(--gr-warn-bg)", color: "var(--gr-warn)", fontWeight: 600 }}>
                            warning
                          </span>
                        )}
                        {acc.status === "locked" && (
                          <span style={{ fontSize: 10, padding: "1px 7px", borderRadius: 999, background: "var(--gr-bad-bg)", color: "var(--gr-bad)", fontWeight: 600 }}>
                            locked
                          </span>
                        )}
                        {(acc.status === "not_connected" || acc.status === "unavailable") && (
                          <span style={{ fontSize: 10, padding: "1px 7px", borderRadius: 999, background: "var(--gr-bg-elev)", color: "var(--gr-text-mute)", fontWeight: 500 }}>
                            reconnect
                          </span>
                        )}
                        {acc.status === "allowed" && isSelected && (
                          <span style={{ fontSize: 10, padding: "1px 7px", borderRadius: 999, background: "var(--gr-copper-bg)", color: "var(--gr-copper)", fontWeight: 600 }}>
                            viewing
                          </span>
                        )}
                        {acc.status === "allowed" && !isSelected && (
                          <span style={{
                            width: 7, height: 7, borderRadius: "50%",
                            background: "var(--gr-ok)", display: "inline-block",
                          }} />
                        )}
                      </div>

                      {/* Account name + ref */}
                      <div style={{ display: "flex", flexDirection: "column", gap: 2, marginBottom: 12 }}>
                        {acc.secondaryMeta && (
                          <span style={{ fontSize: 10.5, fontWeight: 500, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--gr-text-mute)" }}>{acc.secondaryMeta}</span>
                        )}
                        <span title={acc.rawLabel ?? acc.primaryLabel} style={{ fontSize: 14, fontWeight: 600, color: "var(--gr-ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{acc.primaryLabel}</span>
                        {acc.connectionStatus && acc.connectionStatus !== "connected_live" && (
                          <span style={{ fontSize: 11, color: "var(--gr-text-mute)" }}>
                            {({
                              connected_readonly: "Read-only",
                              pending_webhook: "Connecting…",
                              oauth_pending_storage: "Connecting…",
                              expired: "Needs reconnect",
                              connection_error: "Connection error",
                              not_connected: "Not connected",
                            } as Record<string, string>)[acc.connectionStatus] ?? null}
                          </span>
                        )}
                      </div>

                      {/* Numbers */}
                      {!isExpired ? (
                        <>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                              <span style={{ fontSize: 10.5, color: "var(--gr-text-mute)" }}>Balance</span>
                              <span style={{ fontSize: 17, fontWeight: 600, fontFamily: "var(--font-ibm-plex-mono, monospace)", color: "var(--gr-ink)", letterSpacing: "-0.01em" }}>
                                {acc.balance != null ? `$${acc.balance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}
                              </span>
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 2, textAlign: "right" }}>
                              <span style={{ fontSize: 10.5, color: "var(--gr-text-mute)" }}>Today</span>
                              <span style={{ fontSize: 13, fontWeight: 600, fontFamily: "var(--font-ibm-plex-mono, monospace)", color: pnlColor(acc.dailyPnl) }}>
                                {acc.dailyPnl != null ? fmt$(acc.dailyPnl) : "—"}
                              </span>
                            </div>
                          </div>
                          {/* Status pulse */}
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10, paddingTop: 8, borderTop: "1px solid var(--gr-border-sub, var(--gr-border))" }}>
                            <span style={{ width: 6, height: 6, borderRadius: "50%", background: statusColor(acc.status), flexShrink: 0 }} />
                            <span style={{ fontSize: 11, color: "var(--gr-text-mid)" }}>
                              {acc.status === "warning" && acc.dailyLossUsedPct != null
                                ? `Daily loss at ${Math.round(acc.dailyLossUsedPct * 100)}%`
                                : acc.status === "locked"
                                ? "Session locked"
                                : acc.tradesCount != null
                                ? `${acc.tradesCount} trade${acc.tradesCount !== 1 ? "s" : ""} today`
                                : "Monitoring"}
                            </span>
                          </div>
                        </>
                      ) : (
                        <Link
                          href="/accounts/connect/tradovate"
                          className="btn-compact"
                          style={{
                            display: "inline-flex", alignItems: "center", justifyContent: "center",
                            width: "100%", padding: "6px 10px", borderRadius: 8,
                            border: "1px solid var(--gr-border)", background: "var(--gr-bg-elev)",
                            color: "var(--gr-text-mid)", fontSize: 12, textDecoration: "none",
                          }}
                        >
                          Reconnect →
                        </Link>
                      )}
                      {/* Full-card selection overlay — covers non-expired cards so clicking
                        * anywhere navigates to ?accountId=... without nested-link issues.
                        * Rendered last so it stacks above normal-flow card content. */}
                      {!isExpired && (
                        <Link
                          href={`/dashboard?accountId=${acc.id}`}
                          aria-label={`Select ${acc.label}`}
                          style={{ position: "absolute", inset: 0, borderRadius: 12 }}
                        />
                      )}
                    </div>
                  );
                })}

              </div>
            </section>

            {/* ── New accounts — pending setup ────────────────────────── */}
            {commandCenter.pendingAccounts.length > 0 && (
              <section className="dash-section" style={{ padding: "0 36px 16px" }}>
                <NewAccountsPanel accounts={commandCenter.pendingAccounts} />
              </section>
            )}

            {/* ── Selected account context bar ──────────────────────────── */}
            {selectedAccount && (
              <section className="dash-section" style={{ padding: "0 36px 14px" }}>
                <div style={{
                  background: "var(--gr-bg-elev)", border: "1px solid var(--gr-border)",
                  borderRadius: 12, padding: "12px 18px",
                  display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--gr-text-mute)" }}>
                      Now viewing
                    </span>
                    <span title={selectedAccount.rawLabel ?? selectedAccount.primaryLabel} style={{ fontSize: 13.5, fontWeight: 600, color: "var(--gr-ink)" }}>
                      {selectedAccount.primaryLabel}
                    </span>
                    {selectedAccount.secondaryMeta && (
                      <span style={{ fontSize: 11, color: "var(--gr-text-mute)" }}>
                        {selectedAccount.secondaryMeta}
                      </span>
                    )}
                    {selectedAccount.status === "warning" && selectedAccount.dailyLossUsedPct != null && (
                      <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, background: "var(--gr-warn-bg)", color: "var(--gr-warn)", fontWeight: 600 }}>
                        Daily loss at {Math.round(selectedAccount.dailyLossUsedPct * 100)}%
                      </span>
                    )}
                    {selectedAccount.status === "locked" && (
                      <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, background: "var(--gr-bad-bg)", color: "var(--gr-bad)", fontWeight: 600 }}>
                        Locked
                      </span>
                    )}
                  </div>
                  <div style={{ flex: 1 }} />
                  <Link
                    href={`/rules?scope=account&id=${selectedAccount.id}`}
                    className="btn-compact"
                    style={{ fontSize: 12, padding: "5px 12px", borderRadius: 8, border: "1px solid var(--gr-border)", background: "var(--gr-surface)", color: "var(--gr-text-mid)", textDecoration: "none" }}
                  >
                    View rules
                  </Link>
                </div>
              </section>
            )}

            {/* ── KPI strip ─────────────────────────────────────────────── */}
            {selectedAccount && (
              <section className="dash-section" style={{ padding: "0 36px 16px" }}>
                <div className="dash-kpi-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
                  {[
                    {
                      label: "Balance",
                      value: selectedAccount.balance != null ? `$${selectedAccount.balance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—",
                      sub: selectedAccount.dailyPnl != null ? `${fmt$(selectedAccount.dailyPnl)} today` : "No sync yet",
                      tone: (selectedAccount.dailyPnl ?? 0) < 0 ? "warn" : "ok",
                    },
                    {
                      label: "Today P&L",
                      value: selectedAccount.dailyPnl != null ? fmt$(selectedAccount.dailyPnl) : "—",
                      sub: selectedAccount.tradesCount != null ? `${selectedAccount.tradesCount} trade${selectedAccount.tradesCount !== 1 ? "s" : ""}` : "No data",
                      tone: (selectedAccount.dailyPnl ?? 0) < 0 ? "warn" : "ok",
                      highlight: true,
                    },
                    {
                      label: "Win rate · 30D",
                      value: winRate30d != null ? `${Math.round(winRate30d * 100)}%` : "—",
                      sub: winRate30d != null
                        ? `${wins30d}W · ${recentTrades.length - wins30d}L · ${recentTrades.length} trades`
                        : "No round-trips in last 30 days",
                      tone: winRate30d != null && winRate30d >= 0.5 ? "ok" : "warn",
                    },
                    {
                      label: "Profit factor · 30D",
                      value: pf30d != null ? pf30d.toFixed(2) : "—",
                      sub: pf30d != null
                        ? pf30d >= 1 ? "Gross wins exceed losses" : "Gross losses exceed wins"
                        : recentTrades.length === 0 ? "No round-trips in window" : "No losing trades yet",
                      tone: pf30d != null && pf30d >= 1 ? "ok" : pf30d != null ? "warn" : "ok",
                    },
                  ].map((k) => (
                    <div
                      key={k.label}
                      style={{
                        background: "var(--gr-surface)", border: "1px solid var(--gr-border)",
                        borderRadius: 12, padding: "14px 16px",
                      }}
                    >
                      <span style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--gr-text-mute)" }}>
                        {k.label}
                      </span>
                      <div style={{
                        fontSize: 24, fontWeight: 600, lineHeight: 1, letterSpacing: "-0.02em",
                        marginTop: 7, fontFamily: "var(--font-ibm-plex-mono, monospace)",
                        color: k.highlight && k.tone === "warn"
                          ? "var(--gr-warn)"
                          : k.tone === "warn" && !k.highlight ? "var(--gr-warn)"
                          : "var(--gr-ink)",
                      }}>
                        {k.value}
                      </div>
                      <span style={{
                        fontSize: 11, marginTop: 6, display: "inline-block",
                        color: k.tone === "warn" ? "var(--gr-warn)" : "var(--gr-text-mute)",
                      }}>
                        {k.sub}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* ── Row 1: Active rules + Equity curve ────────────────────── */}
            <section className="dash-section dash-row-2col" style={{ padding: "0 36px 16px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, alignItems: "start" }}>
              {/* Active rules panel */}
              <div style={{ background: "var(--gr-surface)", border: "1px solid var(--gr-border)", borderRadius: 14, padding: "18px 20px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14, alignItems: "center" }}>
                  <div>
                    <span style={{ fontSize: 15, fontWeight: 600, color: "var(--gr-ink)" }}>Active rules</span>
                    {selectedAccount && (
                      <div title={selectedAccount.rawLabel ?? selectedAccount.primaryLabel} style={{ fontSize: 11.5, color: "var(--gr-text-mute)", marginTop: 2 }}>
                        {selectedAccount.primaryLabel}
                      </div>
                    )}
                  </div>
                  <Link
                    href={selectedAccount ? `/rules?scope=account&id=${selectedAccount.id}` : "/rules"}
                    className="btn-compact"
                    style={{ fontSize: 12, padding: "4px 10px", borderRadius: 7, border: "none", background: "transparent", color: "var(--gr-copper)", textDecoration: "none" }}
                  >
                    View all →
                  </Link>
                </div>
                {(() => {
                  // Build a pct map for rules that have quantitative limits
                  const rulePct: Record<string, number | null> = {};
                  const ruleValueLabel: Record<string, string> = {};
                  const ruleHasBrokerLimit: Record<string, boolean> = {};
                  if (selectedAccount) {
                    if (selectedAccount.dailyLossUsedPct != null) {
                      rulePct["max_daily_loss"] = selectedAccount.dailyLossUsedPct;
                      const used = selectedAccount.maxDailyLoss != null && selectedAccount.remainingDailyLoss != null
                        ? selectedAccount.maxDailyLoss - selectedAccount.remainingDailyLoss
                        : null;
                      ruleValueLabel["max_daily_loss"] = used != null && selectedAccount.maxDailyLoss != null
                        ? `$${Math.abs(used).toFixed(0)} / $${selectedAccount.maxDailyLoss.toFixed(0)}`
                        : `${Math.round(selectedAccount.dailyLossUsedPct * 100)}%`;
                      ruleHasBrokerLimit["max_daily_loss"] = selectedAccount.maxDailyLoss != null;
                    }
                    if (selectedAccount.tradesUsedPct != null) {
                      rulePct["max_trades_per_day"] = selectedAccount.tradesUsedPct;
                      ruleValueLabel["max_trades_per_day"] = selectedAccount.tradesCount != null && selectedAccount.maxTradesPerDay != null
                        ? `${selectedAccount.tradesCount} / ${selectedAccount.maxTradesPerDay}`
                        : `${Math.round(selectedAccount.tradesUsedPct * 100)}%`;
                    }
                    if (riskRules?.stopAfterLosses != null && riskRules.stopAfterLosses > 0) {
                      const losses = guardian.evaluation.consecutiveLosses;
                      const pct = losses / riskRules.stopAfterLosses;
                      rulePct["stop_after_consecutive_losses"] = pct;
                      ruleValueLabel["stop_after_consecutive_losses"] = `${losses} / ${riskRules.stopAfterLosses} losses`;
                    }
                  }

                  // Show the violation feed's first 5 entries — prioritises warning/blocked,
                  // falls back to OK rules so the panel is never empty when rules exist.
                  const displayRules = violationFeed.results.slice(0, 5);

                  if (displayRules.length === 0) {
                    return (
                      <div style={{ padding: "20px 0 8px", textAlign: "center" }}>
                        <p style={{ fontSize: 13, color: "var(--gr-text-mute)", margin: 0 }}>No rules configured yet.</p>
                        <Link href="/rules" style={{ fontSize: 12.5, color: "var(--gr-copper)", textDecoration: "none", marginTop: 6, display: "inline-block" }}>
                          Set up your Trading Plan →
                        </Link>
                      </div>
                    );
                  }

                  function EnforcementBadge({ type }: { type: Enforcement }) {
                    const meta = type === "broker"
                      ? { label: "Broker", bg: "var(--gr-copper-bg)", fg: "var(--gr-copper)", title: "Broker-backed limit — surfaced verbatim from the broker." }
                      : type === "lock"
                      ? { label: "Lock", bg: "var(--gr-bad-bg)", fg: "var(--gr-bad)", title: "App-layer lock — Guardrail blocks order submission." }
                      : type === "utility"
                      ? { label: "Session", bg: "var(--gr-bg-elev)", fg: "var(--gr-text-mute)", title: "Session/state gate." }
                      : { label: "Monitor", bg: "var(--gr-bg-elev)", fg: "var(--gr-text-mid)", title: "Monitor only — Guardrail tracks and notifies, it does not block trades." };
                    return (
                      <span
                        title={meta.title}
                        style={{
                          fontSize: 9.5, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase",
                          padding: "1px 6px", borderRadius: 999,
                          background: meta.bg, color: meta.fg,
                          border: "1px solid var(--gr-border)",
                          lineHeight: 1.4,
                        }}
                      >
                        {meta.label}
                      </span>
                    );
                  }

                  return (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {displayRules.map((rule) => {
                        const isHard = rule.status === "blocked" || rule.status === "triggered";
                        const isWarn = rule.status === "warning";
                        const dot = isHard ? "var(--gr-bad)" : isWarn ? "var(--gr-warn)" : "var(--gr-ok)";
                        const pct = rulePct[rule.ruleId] ?? null;
                        const valLabel = ruleValueLabel[rule.ruleId] ?? null;
                        const barColor = pct != null
                          ? pct >= 0.8 ? "var(--gr-bad)" : pct >= 0.5 ? "var(--gr-warn)" : "var(--gr-ok)"
                          : "var(--gr-text-faint)";
                        const enforcement = ruleEnforcement(
                          rule.ruleId,
                          ruleHasBrokerLimit[rule.ruleId] ?? false,
                        );
                        // Only show a state pill when there's actually a state to announce.
                        // Combining "Not configured" with "ACTIVE" is incoherent.
                        const stateLabel = isHard
                          ? rule.status
                          : isWarn ? "warning"
                          : null;
                        return (
                          <div key={rule.ruleId} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0, flex: 1 }}>
                                <span style={{ width: 7, height: 7, borderRadius: "50%", background: dot, flexShrink: 0 }} />
                                <span style={{
                                  fontSize: 12.5, fontWeight: 600, color: "var(--gr-ink)",
                                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                }}>
                                  {ruleLabel(rule.ruleId)}
                                </span>
                                <EnforcementBadge type={enforcement} />
                              </div>
                              <div style={{ display: "flex", alignItems: "center", gap: 7, flexShrink: 0 }}>
                                {valLabel ? (
                                  <span style={{
                                    fontSize: 11.5, fontFamily: "var(--font-ibm-plex-mono, monospace)",
                                    color: "var(--gr-ink)", fontWeight: 600,
                                  }}>
                                    {valLabel}
                                  </span>
                                ) : (
                                  <span style={{ fontSize: 11, color: "var(--gr-text-faint)" }}>
                                    Not configured
                                  </span>
                                )}
                                {stateLabel && (
                                  <span style={{
                                    fontSize: 9, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase",
                                    padding: "1px 6px", borderRadius: 999,
                                    background: isHard ? "var(--gr-bad-bg)" : isWarn ? "var(--gr-warn-bg)" : "var(--gr-ok-bg)",
                                    color: isHard ? "var(--gr-bad)" : isWarn ? "var(--gr-warn)" : "var(--gr-ok)",
                                  }}>
                                    {stateLabel}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div style={{ height: 4, borderRadius: 99, background: "var(--gr-bg-elev)", overflow: "hidden" }}>
                              <div style={{
                                height: "100%", borderRadius: 99,
                                width: pct != null ? `${Math.min(100, Math.max(2, Math.round(pct * 100)))}%` : "100%",
                                background: pct != null ? barColor : "repeating-linear-gradient(45deg, var(--gr-border) 0 4px, transparent 4px 8px)",
                                opacity: pct != null ? 1 : 0.45,
                              }} />
                            </div>
                            {rule.message && isHard && (
                              <span style={{ fontSize: 11, color: "var(--gr-bad)", marginTop: 1 }}>{rule.message}</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>

              {/* Equity curve — client island, cumulative realized P&L w/ timeframe toggles */}
              <EquityCurve
                trades={recentTrades}
                tradesHref={selectedAccount ? `/trades?accountId=${selectedAccount.id}` : "/trades"}
                dataSourceLabel="From broker fills"
              />
            </section>

            {/* ── Trader insights — 2×3 compact stat-card grid ──────────── */}
            {selectedAccount && (
              <TraderInsights
                selectedAccount={selectedAccount}
                guardian={guardian}
                riskRules={riskRules}
                recentTrades={recentTrades}
                timezone={displayTimeZone}
              />
            )}

            {/* ── Row 2: Today's trades + Recent alerts ─────────────────── */}
            <section className="dash-section dash-row-2col" style={{ padding: "0 36px 16px", display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 16 }}>
              {/* Today's trades — real round-trips for the selected account */}
              <div style={{
                background: "var(--gr-surface)", border: "1px solid var(--gr-border)",
                borderRadius: 14, padding: "18px 20px",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14, alignItems: "center" }}>
                  <div>
                    <span style={{ fontSize: 15, fontWeight: 600, color: "var(--gr-ink)" }}>Today&apos;s trades</span>
                    {selectedAccount && (
                      <div title={selectedAccount.rawLabel ?? selectedAccount.primaryLabel} style={{ fontSize: 11.5, color: "var(--gr-text-mute)", marginTop: 2 }}>
                        {selectedAccount.primaryLabel}
                      </div>
                    )}
                  </div>
                  <Link
                    href={selectedAccount ? `/trades?accountId=${selectedAccount.id}` : "/trades"}
                    className="btn-compact"
                    style={{ fontSize: 12, padding: "4px 10px", borderRadius: 7, border: "none", background: "transparent", color: "var(--gr-copper)", textDecoration: "none" }}
                  >
                    All trades →
                  </Link>
                </div>
                {todayTrades.length === 0 ? (
                  <div style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "10px 12px", borderRadius: 10,
                    border: "1px dashed var(--gr-border)",
                    background: "var(--gr-bg-elev)",
                  }}>
                    <span style={{
                      width: 24, height: 24, borderRadius: 6,
                      background: "var(--gr-surface)", color: "var(--gr-text-mute)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 13, flexShrink: 0,
                    }}>—</span>
                    <span style={{ fontSize: 12, color: "var(--gr-text-mute)", lineHeight: 1.5 }}>
                      <span style={{ color: "var(--gr-text-mid)", fontWeight: 500 }}>No closed round-trips yet today.</span>
                      {" "}Round-trips appear as your broker reports fills — Guardrail does not invent activity.
                    </span>
                  </div>
                ) : (
                  <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
                    <thead>
                      <tr>
                        {["Time", "Symbol", "Side", "Qty", "Entry", "Exit", "P&L"].map((h) => (
                          <th
                            key={h}
                            style={{
                              textAlign: h === "P&L" ? "right" : "left",
                              padding: "8px 4px",
                              borderBottom: "1px solid var(--gr-border)",
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
                      {todayTrades.slice(0, 6).map((t) => {
                        const sideOk = t.side === "LONG";
                        const pnlCol = t.pnl >= 0 ? "var(--gr-ok)" : "var(--gr-bad)";
                        const sign = t.pnl >= 0 ? "+" : "−";
                        return (
                          <tr key={t.id} style={{ borderBottom: "1px solid var(--gr-border-sub)" }}>
                            <td style={{ padding: "10px 4px", fontSize: 12, fontFamily: "var(--font-ibm-plex-mono, monospace)", color: "var(--gr-text-mid)" }}>
                              {t.closedAt.toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit", hour12: true })}
                            </td>
                            <td style={{ padding: "10px 4px", fontSize: 13, fontFamily: "var(--font-ibm-plex-mono, monospace)", fontWeight: 500, color: "var(--gr-ink)" }}>{t.symbol}</td>
                            <td style={{ padding: "10px 4px" }}>
                              <span style={{
                                fontSize: 10,
                                padding: "1px 6px",
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
                            <td style={{ padding: "10px 4px", fontSize: 12.5, fontFamily: "var(--font-ibm-plex-mono, monospace)", color: "var(--gr-ink)" }}>{t.qty}</td>
                            <td style={{ padding: "10px 4px", fontSize: 12, fontFamily: "var(--font-ibm-plex-mono, monospace)", color: "var(--gr-text-mid)" }}>
                              {t.entryPrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                            </td>
                            <td style={{ padding: "10px 4px", fontSize: 12, fontFamily: "var(--font-ibm-plex-mono, monospace)", color: "var(--gr-text-mid)" }}>
                              {t.exitPrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                            </td>
                            <td style={{ padding: "10px 4px", textAlign: "right", fontSize: 13, fontWeight: 600, fontFamily: "var(--font-ibm-plex-mono, monospace)", color: pnlCol }}>
                              {sign}${Math.abs(t.pnl).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Recent alerts */}
              <div style={{ background: "var(--gr-bg-elev)", border: "1px solid var(--gr-border)", borderRadius: 14, padding: "18px 20px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14, alignItems: "center" }}>
                  <span style={{ fontSize: 15, fontWeight: 600, color: "var(--gr-ink)" }}>Recent alerts</span>
                  <Link
                    href="/alerts"
                    className="btn-compact"
                    style={{ fontSize: 12, padding: "4px 10px", borderRadius: 7, border: "none", background: "transparent", color: "var(--gr-copper)", textDecoration: "none" }}
                  >
                    All →
                  </Link>
                </div>
                {activeAlerts.length > 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    {activeAlerts.map((alert) => {
                      const isHard = alert.status === "blocked" || alert.status === "triggered";
                      const isWarn = alert.status === "warning";
                      const iconBg = isHard ? "var(--gr-bad-bg)" : isWarn ? "var(--gr-warn-bg)" : "var(--gr-surface)";
                      const iconFg = isHard ? "var(--gr-bad)" : isWarn ? "var(--gr-warn)" : "var(--gr-text-mid)";
                      const iconBd = isHard ? "var(--gr-bad-bg)" : isWarn ? "var(--gr-warn-bg)" : "var(--gr-border)";
                      const icon = isHard ? "⚑" : isWarn ? "△" : "●";
                      return (
                        <div key={alert.ruleId} style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                          <div style={{
                            width: 32, height: 32, borderRadius: 9, flexShrink: 0,
                            background: iconBg, color: iconFg,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            border: `1px solid ${iconBd}`,
                            fontSize: 14, lineHeight: 1,
                          }}>
                            {icon}
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--gr-ink)" }}>{ruleLabel(alert.ruleId)}</span>
                            {alert.message && (
                              <span style={{ fontSize: 11.5, color: "var(--gr-text-mute)", lineHeight: 1.4 }}>{alert.message}</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ padding: "24px 0", textAlign: "center" }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: 9, background: "var(--gr-ok-bg)", color: "var(--gr-ok)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 18, margin: "0 auto 10px",
                    }}>✓</div>
                    <p style={{ fontSize: 13, fontWeight: 500, color: "var(--gr-ink)", margin: 0 }}>All clear</p>
                    <p style={{ fontSize: 11.5, color: "var(--gr-text-mute)", marginTop: 4 }}>
                      All monitored rules are within limits.
                    </p>
                  </div>
                )}
              </div>
            </section>

            {/* ── P&L Calendar — full month grid, client island ────────── */}
            {selectedAccount && (
              <section className="dash-section" style={{ padding: "0 36px 16px" }}>
                <PnlCalendar
                  trades={recentTrades}
                  timezone={displayTimeZone}
                  accountLabel={selectedAccount.primaryLabel}
                  tradesHref={`/trades?accountId=${selectedAccount.id}`}
                  accountId={selectedAccount.id}
                />
              </section>
            )}

            {/* ── Accounts detail (collapsible) — expired accounts + management only ── */}
            {hasExpiredAccount && ( /* Expired / unavailable accounts */
              <section className="dash-section" style={{ padding: "0 36px 36px" }}>
                <details
                  className="group"
                  style={{
                    borderRadius: 14, border: "1px solid var(--gr-border)",
                    background: "var(--gr-bg-elev)", overflow: "hidden",
                  }}
                >
                  <summary
                    className="btn-compact"
                    style={{
                      cursor: "pointer", listStyle: "none",
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "14px 20px", userSelect: "none",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--gr-ink)" }}>
                        Expired / unavailable accounts
                      </span>
                      <span style={{ fontSize: 11, color: "var(--gr-warn)" }}>
                        · {expiredAccounts.length} account{expiredAccounts.length !== 1 ? "s" : ""}
                      </span>
                    </div>
                    <span
                      style={{ fontSize: 18, lineHeight: 1, color: "var(--gr-text-mute)", transition: "transform 0.2s", display: "inline-block" }}
                      className="group-open:rotate-45"
                    >
                      +
                    </span>
                  </summary>
                  <div style={{ borderTop: "1px solid var(--gr-border)", padding: "16px 20px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10, alignItems: "center" }}>
                      <span style={{ fontSize: 11, color: "var(--gr-text-mute)" }}>
                        Historical data preserved — Archive to hide permanently
                      </span>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {expiredAccounts.map((acc) => {
                        const isUnavailable = acc.status === "unavailable";
                        return (
                          <div
                            key={acc.id}
                            style={{
                              display: "flex", alignItems: "center", gap: 12,
                              padding: "9px 12px",
                              background: "var(--gr-surface)", border: "1px solid var(--gr-border)",
                              borderRadius: 10,
                            }}
                          >
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <span title={acc.rawLabel ?? acc.primaryLabel} style={{ fontSize: 13, fontWeight: 600, color: "var(--gr-ink)" }}>{acc.primaryLabel}</span>
                              <span style={{
                                marginLeft: 8, fontSize: 10, padding: "1px 6px", borderRadius: 999,
                                background: "var(--gr-bg-elev)", color: "var(--gr-text-mute)",
                                fontWeight: 500, letterSpacing: "0.04em", textTransform: "uppercase",
                              }}>
                                {isUnavailable ? "unavailable" : "expired"}
                              </span>
                              {(acc.platformLabel ?? acc.propFirm) && (
                                <span style={{ marginLeft: 6, fontSize: 11, color: "var(--gr-text-mute)" }}>
                                  · {acc.platformLabel ?? acc.propFirm}
                                </span>
                              )}
                            </div>
                            <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
                              <Link
                                href={`/trades?accountId=${acc.id}`}
                                style={{ padding: "4px 9px", fontSize: 11, border: "1px solid var(--gr-border)", background: "transparent", color: "var(--gr-text-mid)", borderRadius: 6, textDecoration: "none" }}
                              >
                                History
                              </Link>
                              {!isUnavailable && (
                                <Link
                                  href="/accounts/connect/tradovate"
                                  style={{ padding: "4px 9px", fontSize: 11, border: "1px solid var(--gr-border)", background: "var(--gr-bg-elev)", color: "var(--gr-text-mid)", borderRadius: 6, textDecoration: "none" }}
                                >
                                  Reconnect
                                </Link>
                              )}
                              <ArchiveAccountButton accountId={acc.id} accountLabel={acc.label} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </details>
              </section>
            )}
          </>
        )}
        </div>
      </div>
    </GrShell>
  );
}
