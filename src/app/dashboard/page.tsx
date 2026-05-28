import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";

import { GrShell, type GrNavItem } from "@/components/ui/gr-shell";
import { CommandCenter } from "@/app/dashboard/_components/command-center/command-center";
import { loadCommandCenterData } from "@/app/dashboard/_components/command-center/data";
import { DEMO_COMMAND_CENTER_DATA } from "@/app/dashboard/_components/command-center/sample-data";
import { AutoSync } from "@/app/dashboard/_components/auto-sync";
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
  if (v < 0) return "var(--gr-warn)";
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

export default async function DashboardPage() {
  const currentUser = await getCurrentUser();
  if (!currentUser) redirect("/login");

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
  const emailName = currentUser.email?.split("@")[0] ?? "";
  const displayName = emailName.charAt(0).toUpperCase() + emailName.slice(1);
  const userInitials = currentUser.email
    ? currentUser.email.slice(0, 2).toUpperCase()
    : "??";

  const liveAccounts = hasBrokerAccount
    ? commandCenter.accounts.filter((a) => a.connectionStatus !== "error").length
    : 0;

  // "Selected" account = first with warning, else first with data, else first
  const selectedAccount =
    commandCenter.accounts.find((a) => a.status === "warning" || a.status === "locked") ??
    commandCenter.accounts.find((a) => a.balance != null) ??
    commandCenter.accounts[0] ??
    null;

  // Active (non-ok) rule results for the alerts panel
  const activeAlerts = violationFeed.activeViolations.slice(0, 5);

  // Nav items — same as /rules, but home is active
  const DASHBOARD_NAV: GrNavItem[] = [
    { id: "home",     label: "Dashboard",    icon: "home",     href: "/dashboard", active: true },
    { id: "rules",    label: "Trading Plan", icon: "shield",   href: "/rules" },
    { id: "accounts", label: "Accounts",     icon: "user",     href: "/accounts" },
    { id: "alerts",   label: "Alerts",       icon: "bell",     href: "/alerts" },
    { id: "settings", label: "Settings",     icon: "settings", href: "/settings" },
  ];

  // ── Sidebar: compact account list (real data, no mock) ────────────────────
  const SidebarAccountList = hasBrokerAccount ? (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {commandCenter.accounts.slice(0, 4).map((acc) => (
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
          <span style={{ fontSize: 12.5, color: "var(--gr-ink)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {acc.label}
          </span>
          {acc.dailyPnl != null && (
            <span style={{ fontSize: 11, fontFamily: "var(--font-ibm-plex-mono, monospace)", color: pnlColor(acc.dailyPnl), flexShrink: 0 }}>
              {fmt$(acc.dailyPnl)}
            </span>
          )}
        </div>
      ))}
      {commandCenter.accounts.length > 4 && (
        <span style={{ fontSize: 11, color: "var(--gr-text-mute)", padding: "4px 8px" }}>
          +{commandCenter.accounts.length - 4} more
        </span>
      )}
    </div>
  ) : (
    <Link
      href="/accounts/connect/tradovate"
      style={{ fontSize: 12.5, color: "var(--gr-copper)", textDecoration: "none" }}
    >
      Connect first account →
    </Link>
  );

  return (
    <GrShell
      breadcrumb={["Dashboard"]}
      sidebarContent={SidebarAccountList}
      sidebarLabel={hasBrokerAccount ? "Accounts" : "Connect"}
      navItems={DASHBOARD_NAV}
      userInitials={userInitials}
      hideApiStatus
    >
      <div style={{ overflowY: "auto", height: "100%" }}>
        {/* ── Auto-refresh for live data ─────────────────────────────────── */}
        {hasBrokerAccount && <DashboardAutoRefresh />}

        {/* ── Hero ──────────────────────────────────────────────────────── */}
        <section style={{ padding: "28px 36px 18px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, maxWidth: 620 }}>
              <span style={{ fontSize: 11.5, fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--gr-text-mute)" }}>
                {timeGreeting()}, {displayName}
              </span>
              <h1 style={{ fontSize: 32, fontWeight: 600, letterSpacing: "-0.03em", lineHeight: 1.15, color: "var(--gr-ink)", margin: 0 }}>
                {hasBrokerAccount ? (
                  <>Watching{" "}
                    <span style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontStyle: "italic", color: "var(--gr-ink)" }}>
                      {liveAccounts}
                    </span>
                    {" "}live account{liveAccounts !== 1 ? "s" : ""}.
                  </>
                ) : (
                  <>No accounts connected yet.</>
                )}
              </h1>
            </div>
            <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
              {hasBrokerAccount && (
                <Link
                  href="/dashboard"
                  className="btn-compact"
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    padding: "7px 14px", borderRadius: 9, fontSize: 13,
                    border: "1px solid var(--gr-border)", background: "var(--gr-surface)",
                    color: "var(--gr-text-mid)", textDecoration: "none",
                  }}
                >
                  ↻ Sync all
                </Link>
              )}
              <Link
                href="/accounts"
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
          <section style={{ padding: "4px 36px 36px" }}>
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
            <section style={{ padding: "4px 36px 20px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10, alignItems: "center" }}>
                <span style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--gr-text-mute)" }}>
                  Your accounts · {commandCenter.accounts.length}
                </span>
                <span style={{ fontSize: 11, color: "var(--gr-text-mute)" }}>
                  Each card is one account — numbers are never combined
                </span>
              </div>
              {/*
                * Responsive grid — no horizontal overflow, so the browser has no
                * scroll position to restore on reload.  Cards wrap to the next row
                * once the viewport is too narrow to fit them all.
                * auto-fill + minmax(190px, 1fr) means:
                *   1440px viewport → 240px sidebar → ~72px padding → ~1128px usable
                *   → 5 columns at 190px min, cards grow to fill remaining space.
                */}
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))",
                gap: 10,
              }}>
                {/* Auto-sync for stale accounts */}
                {(() => {
                  const staleAccounts = commandCenter.accounts.filter(
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

                {commandCenter.accounts.map((acc) => {
                  const isSelected = acc.id === selectedAccount?.id;
                  const isExpired = acc.status === "not_connected" || acc.status === "unavailable";
                  return (
                    <div
                      key={acc.id}
                      style={{
                        padding: 14,
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
                        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--gr-ink)" }}>{acc.label}</span>
                        {acc.connectionStatus && (
                          <span style={{ fontSize: 11, fontFamily: "var(--font-ibm-plex-mono, monospace)", color: "var(--gr-text-mute)" }}>
                            {acc.connectionStatus}
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
                          href="/accounts"
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
                    </div>
                  );
                })}

                {/* Add account tile — occupies one grid cell */}
                <Link
                  href="/accounts"
                  className="btn-compact"
                  style={{
                    background: "transparent",
                    border: "1px dashed var(--gr-border)",
                    borderRadius: 12,
                    color: "var(--gr-text-mute)",
                    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                    gap: 6, textDecoration: "none",
                    minHeight: 130,
                  }}
                >
                  <span style={{ fontSize: 20, lineHeight: 1 }}>+</span>
                  <span style={{ fontSize: 12, fontWeight: 500 }}>Connect another</span>
                </Link>
              </div>
            </section>

            {/* ── Selected account context bar ──────────────────────────── */}
            {selectedAccount && (
              <section style={{ padding: "0 36px 18px" }}>
                <div style={{
                  background: "var(--gr-bg-elev)", border: "1px solid var(--gr-border)",
                  borderRadius: 12, padding: "12px 18px",
                  display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--gr-text-mute)" }}>
                      Now viewing
                    </span>
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--gr-ink)" }}>
                      {selectedAccount.label}
                    </span>
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
                    href="/rules"
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
              <section style={{ padding: "0 36px 20px" }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
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
                      label: "Loss budget left",
                      value: selectedAccount.remainingDailyLoss != null
                        ? `$${selectedAccount.remainingDailyLoss.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                        : selectedAccount.maxDailyLoss != null ? `$${selectedAccount.maxDailyLoss.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} limit` : "No limit set",
                      sub: selectedAccount.dailyLossUsedPct != null
                        ? `${Math.round(selectedAccount.dailyLossUsedPct * 100)}% used`
                        : "Set a daily loss rule",
                      tone: (selectedAccount.dailyLossUsedPct ?? 0) > 0.8 ? "warn" : "ok",
                    },
                    {
                      label: "Trades today",
                      value: selectedAccount.tradesCount != null ? String(selectedAccount.tradesCount) : "—",
                      sub: selectedAccount.maxTradesPerDay != null
                        ? `of ${selectedAccount.maxTradesPerDay} limit`
                        : "No trade limit set",
                      tone: selectedAccount.tradesUsedPct != null && selectedAccount.tradesUsedPct > 0.8 ? "warn" : "ok",
                    },
                  ].map((k) => (
                    <div
                      key={k.label}
                      style={{
                        background: "var(--gr-surface)", border: "1px solid var(--gr-border)",
                        borderRadius: 12, padding: 18,
                      }}
                    >
                      <span style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--gr-text-mute)" }}>
                        {k.label}
                      </span>
                      <div style={{
                        fontSize: 26, fontWeight: 600, lineHeight: 1, letterSpacing: "-0.02em",
                        marginTop: 8, fontFamily: "var(--font-ibm-plex-mono, monospace)",
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
            <section style={{ padding: "0 36px 20px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              {/* Active rules panel */}
              <div style={{ background: "var(--gr-surface)", border: "1px solid var(--gr-border)", borderRadius: 14, padding: 22 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16, alignItems: "center" }}>
                  <div>
                    <span style={{ fontSize: 15, fontWeight: 600, color: "var(--gr-ink)" }}>Active rules</span>
                    {selectedAccount && (
                      <div style={{ fontSize: 11.5, color: "var(--gr-text-mute)", marginTop: 2 }}>
                        {selectedAccount.label}
                      </div>
                    )}
                  </div>
                  <Link
                    href="/rules"
                    className="btn-compact"
                    style={{ fontSize: 12, padding: "4px 10px", borderRadius: 7, border: "none", background: "transparent", color: "var(--gr-copper)", textDecoration: "none" }}
                  >
                    View all →
                  </Link>
                </div>
                {violationFeed.results.length > 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    {violationFeed.results.filter(r => r.status !== "ok" || violationFeed.results.indexOf(r) < 5).slice(0, 6).map((rule, idx, arr) => {
                      const dot = rule.status === "blocked" ? "var(--gr-bad)"
                        : rule.status === "triggered" ? "var(--gr-bad)"
                        : rule.status === "warning" ? "var(--gr-warn)"
                        : "var(--gr-ok)";
                      return (
                        <div key={rule.ruleId} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                              <span style={{ width: 7, height: 7, borderRadius: "50%", background: dot, flexShrink: 0 }} />
                              <span style={{ fontSize: 13, fontWeight: 500, color: "var(--gr-ink)" }}>{ruleLabel(rule.ruleId)}</span>
                            </div>
                            {rule.status !== "ok" && (
                              <span style={{ fontSize: 10.5, fontWeight: 600, color: rule.status === "warning" ? "var(--gr-warn)" : "var(--gr-bad)" }}>
                                {rule.status}
                              </span>
                            )}
                          </div>
                          {idx < arr.length - 1 && (
                            <div style={{ height: 1, background: "var(--gr-border-sub, var(--gr-border))", marginTop: 4 }} />
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ padding: "24px 0", textAlign: "center" }}>
                    <p style={{ fontSize: 13, color: "var(--gr-text-mute)" }}>
                      No rules configured yet.
                    </p>
                    <Link href="/rules" style={{ fontSize: 12.5, color: "var(--gr-copper)", textDecoration: "none", marginTop: 6, display: "inline-block" }}>
                      Set up your Trading Plan →
                    </Link>
                  </div>
                )}
              </div>

              {/* Equity curve — placeholder until historical trade sync is available */}
              <div style={{
                background: "var(--gr-bg-elev)", border: "1px solid var(--gr-border)",
                borderRadius: 14, padding: 22,
                display: "flex", flexDirection: "column",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12, alignItems: "center" }}>
                  <span style={{ fontSize: 15, fontWeight: 600, color: "var(--gr-ink)" }}>Equity curve</span>
                  <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 999, background: "var(--gr-surface)", border: "1px solid var(--gr-border)", color: "var(--gr-text-mute)", fontWeight: 500 }}>
                    Coming soon
                  </span>
                </div>
                {/* Empty state chart placeholder */}
                <div style={{
                  flex: 1, minHeight: 100,
                  borderRadius: 8, border: "1px dashed var(--gr-border)",
                  background: "var(--gr-surface)",
                  display: "flex", flexDirection: "column",
                  alignItems: "center", justifyContent: "center",
                  gap: 8, padding: 24,
                }}>
                  {/* Decorative mini chart silhouette */}
                  <svg width="64" height="28" viewBox="0 0 64 28" fill="none" aria-hidden="true">
                    <polyline
                      points="0,22 10,18 20,20 30,12 38,14 50,6 64,10"
                      stroke="var(--gr-border)"
                      strokeWidth="1.5"
                      strokeLinejoin="round"
                      fill="none"
                    />
                  </svg>
                  <p style={{ fontSize: 12.5, color: "var(--gr-text-mute)", textAlign: "center", lineHeight: 1.5, margin: 0 }}>
                    Balance history will appear here once broker trade sync is available.
                  </p>
                </div>
              </div>
            </section>

            {/* ── Row 2: Today's trades + Recent alerts ─────────────────── */}
            <section style={{ padding: "0 36px 20px", display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 16 }}>
              {/* Today's trades — placeholder until broker trade history is connected */}
              <div style={{
                background: "var(--gr-surface)", border: "1px solid var(--gr-border)",
                borderRadius: 14, padding: 22,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16, alignItems: "center" }}>
                  <div>
                    <span style={{ fontSize: 15, fontWeight: 600, color: "var(--gr-ink)" }}>Today&apos;s trades</span>
                    {selectedAccount && (
                      <div style={{ fontSize: 11.5, color: "var(--gr-text-mute)", marginTop: 2 }}>
                        {selectedAccount.label}
                      </div>
                    )}
                  </div>
                  <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 999, background: "var(--gr-bg-elev)", border: "1px solid var(--gr-border)", color: "var(--gr-text-mute)", fontWeight: 500 }}>
                    Coming soon
                  </span>
                </div>
                {/* Table header placeholder */}
                <div style={{ display: "flex", gap: 0, paddingBottom: 8, borderBottom: "1px solid var(--gr-border)", marginBottom: 12 }}>
                  {["Time", "Symbol", "Side", "Qty", "Entry", "Exit", "P&L"].map((col) => (
                    <span key={col} style={{ flex: col === "Symbol" ? 1.2 : 1, fontSize: 10.5, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--gr-text-mute)" }}>
                      {col}
                    </span>
                  ))}
                </div>
                {/* Empty state */}
                <div style={{ padding: "24px 0", textAlign: "center" }}>
                  <p style={{ fontSize: 13, color: "var(--gr-text-mute)", margin: 0 }}>
                    Synced fills will appear here once broker trade history is connected.
                  </p>
                  <Link
                    href="/accounts"
                    style={{ fontSize: 12.5, color: "var(--gr-copper)", textDecoration: "none", marginTop: 8, display: "inline-block" }}
                  >
                    Connect broker →
                  </Link>
                </div>
              </div>

              {/* Recent alerts */}
              <div style={{ background: "var(--gr-bg-elev)", border: "1px solid var(--gr-border)", borderRadius: 14, padding: 22 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16, alignItems: "center" }}>
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
                      const bg = alert.status === "blocked" || alert.status === "triggered"
                        ? "var(--gr-bad-bg)"
                        : alert.status === "warning"
                        ? "var(--gr-warn-bg)"
                        : "var(--gr-surface)";
                      const fg = alert.status === "blocked" || alert.status === "triggered"
                        ? "var(--gr-bad)"
                        : alert.status === "warning"
                        ? "var(--gr-warn)"
                        : "var(--gr-text-mid)";
                      return (
                        <div key={alert.ruleId} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                          <div style={{
                            width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                            background: bg, color: fg,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            border: "1px solid var(--gr-border)",
                            fontSize: 13,
                          }}>
                            {alert.status === "blocked" || alert.status === "triggered" ? "⚠" : "!"}
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                            <span style={{ fontSize: 13, fontWeight: 500, color: "var(--gr-ink)" }}>{ruleLabel(alert.ruleId)}</span>
                            {alert.message && (
                              <span style={{ fontSize: 11.5, color: "var(--gr-text-mute)" }}>{alert.message}</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ padding: "24px 0", textAlign: "center" }}>
                    <div style={{ fontSize: 22, marginBottom: 8 }}>✓</div>
                    <p style={{ fontSize: 13, color: "var(--gr-text-mute)" }}>No active alerts.</p>
                    <p style={{ fontSize: 11.5, color: "var(--gr-text-mute)", marginTop: 4 }}>
                      All monitored rules are within limits.
                    </p>
                  </div>
                )}
              </div>
            </section>

            {/* ── Accounts detail (collapsible) ─────────────────────────── */}
            <section style={{ padding: "0 36px 36px" }}>
              <details
                className="group"
                style={{
                  borderRadius: 14,
                  border: "1px solid var(--gr-border)",
                  background: "var(--gr-bg-elev)",
                  overflow: "hidden",
                }}
              >
                <summary
                  className="btn-compact"
                  style={{
                    cursor: "pointer",
                    listStyle: "none",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "14px 20px",
                    userSelect: "none",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--gr-ink)" }}>
                      Accounts detail
                    </span>
                    <span style={{ fontSize: 11, color: "var(--gr-text-mute)" }}>
                      {commandCenter.accounts.length} account{commandCenter.accounts.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                  <span
                    style={{
                      fontSize: 18, lineHeight: 1, color: "var(--gr-text-mute)",
                      transition: "transform 0.2s",
                      display: "inline-block",
                    }}
                    className="group-open:rotate-45"
                  >
                    +
                  </span>
                </summary>
                <div style={{ borderTop: "1px solid var(--gr-border)", padding: "0" }}>
                  <CommandCenter data={commandCenter} />
                </div>
              </details>
            </section>
          </>
        )}
      </div>
    </GrShell>
  );
}
