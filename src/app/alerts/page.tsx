import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";

import { GrShell, type GrNavItem } from "@/components/ui/gr-shell";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const metadata: Metadata = {
  title: "Alerts — Guardrail",
};

const ALERTS_NAV: GrNavItem[] = [
  { id: "home",     label: "Dashboard",    icon: "home",     href: "/dashboard" },
  { id: "rules",    label: "Trading Plan", icon: "shield",   href: "/rules" },
  { id: "trades",   label: "Trades",       icon: "chart",    href: "/trades" },
  { id: "alerts",   label: "Alerts",       icon: "bell",     href: "/alerts",   active: true },
  { id: "settings", label: "Settings",     icon: "settings", href: "/settings" },
];

const TZ = "America/Chicago";

function connStatusColor(s: string | null | undefined): string {
  if (!s) return "var(--gr-text-faint)";
  if (s.startsWith("connected")) return "var(--gr-ok)";
  if (s === "connection_error") return "var(--gr-bad)";
  return "var(--gr-text-faint)";
}

// Trigger taxonomy. RULE covers rule/risk breaches; SYSTEM covers
// session/activity events. Broker-connection events have no persisted source
// yet, so there is no Broker filter chip (see FILTER_CHIPS below).
const RULE_TRIGGER_TYPES = new Set([
  "near_daily_loss_limit",
  "daily_loss_limit",
  "exceeded_trade_count",
  "trade_limit",
  "max_loss_streak",
  "consecutive_losses_warning",
  "position_size_limit",
  "max_position_size",
]);

const SYSTEM_TRIGGER_TYPES = new Set([
  "outside_session_hours",
]);

function triggerCategory(t: string): "rule" | "system" | "broker" {
  if (RULE_TRIGGER_TYPES.has(t)) return "rule";
  if (SYSTEM_TRIGGER_TYPES.has(t)) return "system";
  return "broker";
}

function titleCase(t: string): string {
  const s = t.replace(/_/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Convert a technical triggerType into a friendly, human alert title. */
function triggerLabel(t: string): string {
  switch (t) {
    case "near_daily_loss_limit":      return "Daily loss warning";
    case "daily_loss_limit":           return "Daily loss limit";
    case "exceeded_trade_count":       return "Max trades exceeded";
    case "trade_limit":                return "Trade limit";
    case "max_loss_streak":            return "Loss streak limit";
    case "consecutive_losses_warning": return "Loss streak warning";
    case "position_size_limit":        return "Position size limit";
    case "max_position_size":          return "Max position size";
    case "outside_session_hours":      return "Outside trading hours";
    default:                           return titleCase(t);
  }
}

// A concise, human one-liner per trigger type, used when the stored message is
// technical/noisy (raw broker endpoints, test-mode notes, snake_case tokens).
const TRIGGER_SUMMARY: Record<string, string> = {
  near_daily_loss_limit:      "You're approaching your daily loss limit.",
  daily_loss_limit:           "Your daily loss limit was reached.",
  exceeded_trade_count:       "You exceeded your max trades for the day.",
  trade_limit:                "You reached your max trades for the day.",
  max_loss_streak:            "You hit your loss-streak limit.",
  consecutive_losses_warning: "You're approaching your loss-streak limit.",
  position_size_limit:        "A position went over your size limit.",
  max_position_size:          "A position went over your size limit.",
  outside_session_hours:      "Activity outside your trading hours.",
};

// Markers that indicate a stored message is technical/log-flavoured rather than
// a clean human sentence. Such messages are softened to a friendly summary so
// the feed reads like an alert center, not a debug log.
const TECHNICAL_MARKERS =
  /(no applicable|Tradovate broker API|Test mode|simulated|AutoLiq|userAccount|connected_readonly|dry[_ ]?run|brokerEndpoint|liquidatepositions|\/update|\/cancel|broker-side lockout)/i;

function isTechnicalMessage(message: string | null): boolean {
  if (!message) return false;
  return message.length > 140 || TECHNICAL_MARKERS.test(message);
}

/** The short, human message shown in a feed row (never raw technical detail). */
function rowSummary(triggerType: string, message: string | null): string {
  if (message && !isTechnicalMessage(message)) return message;
  return TRIGGER_SUMMARY[triggerType] ?? "Guardrail recorded this event.";
}

type Severity = "critical" | "warning" | "system" | "info";

/**
 * Visual severity for a row. Stop/lock breaches read strongest; approaching-
 * limit warnings are amber; session events are neutral; technical no-ops
 * (e.g. "no applicable broker API") are quiet info.
 */
function rowSeverity(triggerType: string, message: string | null): Severity {
  if (isTechnicalMessage(message)) return "info";
  switch (triggerType) {
    case "daily_loss_limit":
    case "exceeded_trade_count":
    case "trade_limit":
    case "max_loss_streak":
    case "position_size_limit":
    case "max_position_size":
      return "critical";
    case "near_daily_loss_limit":
    case "consecutive_losses_warning":
      return "warning";
    case "outside_session_hours":
      return "system";
    default:
      return "info";
  }
}

function triggerViewHref(t: string, accountId: string | null): string {
  const cat = triggerCategory(t);
  if (cat === "rule") return accountId ? `/rules?scope=account&id=${accountId}` : "/rules";
  // Broker-connection events have no intervention source yet; the helper is
  // kept for when one exists, but no Broker filter chip is exposed today.
  if (cat === "broker") return "/settings#broker-connections";
  // System/session events (e.g. outside_session_hours) are trading-activity
  // events, so they route to the Dashboard — never to Settings.
  return accountId ? `/dashboard?accountId=${accountId}` : "/dashboard";
}

function formatRelative(date: Date): string {
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function dayKey(date: Date): string {
  return date.toLocaleDateString("en-CA", { timeZone: TZ });
}

const SEVERITY_STYLE: Record<Severity, { bg: string; fg: string; glyph: string }> = {
  critical: { bg: "var(--gr-bad-bg)",  fg: "var(--gr-bad)",       glyph: "!" },
  warning:  { bg: "var(--gr-warn-bg)", fg: "var(--gr-warn)",      glyph: "▲" },
  system:   { bg: "var(--gr-bg-elev)", fg: "var(--gr-text-mid)",  glyph: "◷" },
  info:     { bg: "var(--gr-bg-elev)", fg: "var(--gr-text-mute)", glyph: "i" },
};

function SeverityIcon({ severity }: { severity: Severity }) {
  const s = SEVERITY_STYLE[severity];
  return (
    <span
      style={{
        width: 26, height: 26, borderRadius: 7, flexShrink: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 12.5, fontWeight: 700,
        background: s.bg, color: s.fg,
      }}
    >
      {s.glyph}
    </span>
  );
}

// No "Broker" chip — there is no broker-connection event source yet, so a
// Broker filter would only ever show an empty state. The chip stays hidden
// until a real broker-event source exists.
const FILTER_CHIPS = [
  { key: "all",    label: "All" },
  { key: "rule",   label: "Rule alerts" },
  { key: "system", label: "System" },
] as const;

export default async function AlertsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; today?: string; accountId?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const activeFilter = params.filter ?? "all";
  const todayOnly = params.today === "1";
  const requestedAccountId = params.accountId ?? null;

  const userInitials = user.email ? user.email.slice(0, 2).toUpperCase() : "??";

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  let triggerTypeFilter: string[] | undefined;
  if (activeFilter === "rule") {
    triggerTypeFilter = [...RULE_TRIGGER_TYPES];
  } else if (activeFilter === "system") {
    triggerTypeFilter = [...SYSTEM_TRIGGER_TYPES];
  } else if (activeFilter === "broker") {
    // Not reachable from the UI, but a manually-typed ?filter=broker must show
    // the honest empty state rather than fall through to "all".
    triggerTypeFilter = [];
  }

  const [feedEvents, switcherAccounts] = await Promise.all([
    triggerTypeFilter?.length === 0
      ? Promise.resolve(
          [] as Array<{
            id: string; accountId: string; triggerType: string;
            outcome: string; message: string | null; createdAt: Date;
          }>,
        )
      : prisma.guardianIntervention.findMany({
          where: {
            userId: user.id,
            ...(requestedAccountId ? { accountId: requestedAccountId } : {}),
            ...(triggerTypeFilter ? { triggerType: { in: triggerTypeFilter } } : {}),
            ...(todayOnly ? { createdAt: { gte: todayStart } } : {}),
          },
          select: {
            id: true,
            accountId: true,
            triggerType: true,
            outcome: true,
            message: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
          take: 200,
        }),
    prisma.connectedAccount.findMany({
      where: {
        userId: user.id,
        isActive: true,
        protectionStatus: { in: ["protected", "monitor_only"] },
        missingFromBrokerSince: null,
      },
      select: {
        id: true,
        label: true,
        connectionStatus: true,
        brokerConnection: { select: { connectionStatus: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  // Resolve labels for any account that appears in the feed but is not in the
  // active switcher list (e.g. archived accounts with historical alerts).
  const accountIdsInFeed = [
    ...new Set(feedEvents.map((e) => e.accountId).filter(Boolean)),
  ].filter((id) => !switcherAccounts.find((a) => a.id === id));

  const extraAccounts =
    accountIdsInFeed.length > 0
      ? await prisma.connectedAccount.findMany({
          where: { id: { in: accountIdsInFeed }, userId: user.id },
          select: { id: true, label: true },
        })
      : [];

  const accountLabelMap = new Map<string, string>();
  for (const a of switcherAccounts) accountLabelMap.set(a.id, a.label);
  for (const a of extraAccounts) accountLabelMap.set(a.id, a.label);

  // Is the requested account one of the user's known accounts? (Query is already
  // scoped by userId, so this only affects pill highlight + empty-state copy.)
  const selectedAccountLabel = requestedAccountId
    ? accountLabelMap.get(requestedAccountId) ?? null
    : null;

  // ── Group consecutive repeated alerts (same type + account + day) ─────────
  type FeedRow = {
    key: string;
    triggerType: string;
    accountId: string;
    message: string | null;
    createdAt: Date;
    count: number;
  };
  const rows: FeedRow[] = [];
  for (const e of feedEvents) {
    const last = rows[rows.length - 1];
    if (
      last &&
      last.triggerType === e.triggerType &&
      last.accountId === e.accountId &&
      dayKey(last.createdAt) === dayKey(e.createdAt)
    ) {
      last.count += 1;
      continue;
    }
    rows.push({
      key: e.id,
      triggerType: e.triggerType,
      accountId: e.accountId,
      message: e.message,
      createdAt: e.createdAt, // newest in the group (events are desc)
      count: 1,
    });
  }

  // ── Account switcher (top of page) ────────────────────────────────────────
  const selectableAccounts = switcherAccounts
    .filter((acc) => {
      const effectiveStatus =
        acc.brokerConnection?.connectionStatus ?? acc.connectionStatus;
      return effectiveStatus !== "expired" && effectiveStatus !== "connection_error";
    });

  const buildHref = (overrides: {
    accountId?: string | null;
    filter?: string;
    today?: boolean;
  }): string => {
    const accId = overrides.accountId !== undefined ? overrides.accountId : requestedAccountId;
    const flt = overrides.filter ?? activeFilter;
    const td = overrides.today !== undefined ? overrides.today : todayOnly;
    const sp = new URLSearchParams();
    if (accId) sp.set("accountId", accId);
    if (flt && flt !== "all") sp.set("filter", flt);
    if (td) sp.set("today", "1");
    const q = sp.toString();
    return q ? `/alerts?${q}` : "/alerts";
  };

  // ── Sidebar account list (mirrors the top switcher) ───────────────────────
  const SidebarAccountList =
    selectableAccounts.length > 0 ? (
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {selectableAccounts.slice(0, 5).map((acc) => {
          const isSelected = acc.id === requestedAccountId;
          return (
            <Link
              key={acc.id}
              href={buildHref({ accountId: acc.id })}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "7px 8px", borderRadius: 8,
                background: isSelected ? "var(--gr-surface)" : "transparent",
                border: isSelected ? "1px solid var(--gr-border)" : "1px solid transparent",
                textDecoration: "none",
              }}
            >
              <span
                style={{
                  width: 7, height: 7, borderRadius: "50%",
                  background: connStatusColor(acc.connectionStatus), flexShrink: 0,
                }}
              />
              <span
                style={{
                  fontSize: 12.5, color: "var(--gr-ink)", flex: 1, minWidth: 0,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}
              >
                {acc.label}
              </span>
            </Link>
          );
        })}
      </div>
    ) : (
      <Link
        href="/accounts/connect/tradovate"
        style={{ fontSize: 12.5, color: "var(--gr-copper)", textDecoration: "none" }}
      >
        Connect first account →
      </Link>
    );

  // ── Empty-state copy varies by what the user is filtering on ──────────────
  const alertCount = feedEvents.length;
  const emptyState = (() => {
    if (todayOnly) {
      return { title: "No alerts today", body: "Nothing has triggered today. New alerts will appear here as they happen." };
    }
    if (activeFilter === "rule") {
      return { title: "No rule alerts yet", body: "Rule breaches like daily loss or trade limits will show up here." };
    }
    if (activeFilter === "system") {
      return { title: "No system alerts yet", body: "Session and activity events will show up here." };
    }
    if (selectedAccountLabel) {
      return {
        title: "No alerts for this account yet",
        body: "Guardrail will show rule breaches, session events, and broker sync events here.",
      };
    }
    return {
      title: "No alerts yet",
      body: "Guardrail will show rule breaches, session events, and broker sync events here.",
    };
  })();

  return (
    <GrShell
      breadcrumb={["Alerts"]}
      sidebarContent={SidebarAccountList}
      sidebarLabel="Accounts"
      navItems={ALERTS_NAV}
      userInitials={userInitials}
      hideApiStatus
    >
      <div style={{ overflowY: "auto", height: "100%" }}>
        <div style={{ maxWidth: 900, margin: "0 auto" }}>

          {/* ── Header ──────────────────────────────────────────────────── */}
          <section style={{ padding: "28px 36px 14px" }}>
            <span
              style={{
                fontSize: 11.5, fontWeight: 500, letterSpacing: "0.1em",
                textTransform: "uppercase", color: "var(--gr-text-mute)",
              }}
            >
              ALERTS
            </span>
            <div
              style={{
                display: "flex", alignItems: "flex-end",
                justifyContent: "space-between", gap: 12, marginTop: 6,
              }}
            >
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <h1
                    style={{
                      fontSize: 24, fontWeight: 600, letterSpacing: "-0.02em",
                      lineHeight: 1.2, color: "var(--gr-ink)", margin: 0,
                    }}
                  >
                    Alerts
                  </h1>
                  {alertCount > 0 && (
                    <span
                      style={{
                        fontSize: 12, fontWeight: 600,
                        padding: "2px 9px", borderRadius: 999,
                        background: "var(--gr-bg-elev)", color: "var(--gr-text-mid)",
                        border: "1px solid var(--gr-border-sub)",
                      }}
                    >
                      {alertCount}
                    </span>
                  )}
                </div>
                <p style={{ fontSize: 13.5, color: "var(--gr-text-mid)", margin: "5px 0 0" }}>
                  Everything Guardrail noticed about your trading plan and broker connections.
                </p>
              </div>
              <Link
                href="/settings#alerts-telegram"
                style={{
                  fontSize: 12.5, color: "var(--gr-text-mute)",
                  textDecoration: "none", flexShrink: 0, whiteSpace: "nowrap",
                }}
              >
                Notification settings →
              </Link>
            </div>
          </section>

          {/* ── Account switcher ────────────────────────────────────────── */}
          {selectableAccounts.length > 0 && (
            <section
              style={{ padding: "0 36px 14px", display: "flex", gap: 8, flexWrap: "wrap" }}
            >
              <Link
                href={buildHref({ accountId: null })}
                style={{
                  padding: "6px 13px", borderRadius: 9, fontSize: 12.5,
                  background: !requestedAccountId ? "var(--gr-copper-bg)" : "var(--gr-surface)",
                  border: !requestedAccountId ? "1px solid var(--gr-copper-bd)" : "1px solid var(--gr-border)",
                  color: !requestedAccountId ? "var(--gr-copper)" : "var(--gr-text-mid)",
                  fontWeight: !requestedAccountId ? 600 : 500,
                  textDecoration: "none",
                }}
              >
                All accounts
              </Link>
              {selectableAccounts.map((acc) => {
                const isSelected = acc.id === requestedAccountId;
                return (
                  <Link
                    key={acc.id}
                    href={buildHref({ accountId: acc.id })}
                    style={{
                      padding: "6px 13px", borderRadius: 9, fontSize: 12.5,
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
            </section>
          )}

          {/* ── Filter chips ────────────────────────────────────────────── */}
          <section
            style={{
              padding: "0 36px 16px", display: "flex", gap: 8, flexWrap: "wrap",
              alignItems: "center",
              borderBottom: "1px solid var(--gr-border-sub)", marginBottom: 4,
            }}
          >
            {FILTER_CHIPS.map((chip) => {
              const isActive = activeFilter === chip.key;
              return (
                <Link
                  key={chip.key}
                  href={buildHref({ filter: chip.key })}
                  style={{
                    padding: "5px 13px", borderRadius: 999, fontSize: 12.5,
                    fontWeight: isActive ? 600 : 400,
                    color: isActive ? "var(--gr-ink)" : "var(--gr-text-mute)",
                    background: isActive ? "var(--gr-surface)" : "transparent",
                    border: isActive ? "1px solid var(--gr-border)" : "1px solid transparent",
                    textDecoration: "none",
                  }}
                >
                  {chip.label}
                </Link>
              );
            })}
            <span style={{ width: 1, height: 16, background: "var(--gr-border-sub)", margin: "0 2px" }} />
            <Link
              href={buildHref({ today: !todayOnly })}
              style={{
                padding: "5px 13px", borderRadius: 999, fontSize: 12.5,
                fontWeight: todayOnly ? 600 : 400,
                color: todayOnly ? "var(--gr-ink)" : "var(--gr-text-mute)",
                background: todayOnly ? "var(--gr-surface)" : "transparent",
                border: todayOnly ? "1px solid var(--gr-border)" : "1px solid transparent",
                textDecoration: "none",
              }}
            >
              Today only
            </Link>
          </section>

          {/* ── Alert feed ──────────────────────────────────────────────── */}
          <section style={{ padding: "0 36px 36px" }}>
            {rows.length === 0 ? (
              <div style={{ textAlign: "center", padding: "56px 24px", color: "var(--gr-text-mute)" }}>
                <p style={{ fontSize: 15, fontWeight: 600, color: "var(--gr-text-mid)", margin: "0 0 6px" }}>
                  {emptyState.title}
                </p>
                <p style={{ fontSize: 13, margin: 0, lineHeight: 1.5, maxWidth: 380, marginInline: "auto" }}>
                  {emptyState.body}
                </p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column" }}>
                {rows.map((row, i) => {
                  const severity = rowSeverity(row.triggerType, row.message);
                  const label = triggerLabel(row.triggerType);
                  const summary = rowSummary(row.triggerType, row.message);
                  const accountLabel = accountLabelMap.get(row.accountId) ?? null;
                  const viewHref = triggerViewHref(row.triggerType, row.accountId);
                  return (
                    <div
                      key={row.key}
                      style={{
                        display: "flex", alignItems: "center", gap: 12,
                        padding: "11px 0",
                        borderTop: i > 0 ? "1px solid var(--gr-border-sub)" : undefined,
                      }}
                    >
                      <SeverityIcon severity={severity} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            display: "flex", alignItems: "center",
                            gap: 8, flexWrap: "wrap",
                          }}
                        >
                          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--gr-ink)" }}>
                            {label}
                          </span>
                          {accountLabel && (
                            <span
                              style={{
                                fontSize: 10.5, padding: "1px 7px", borderRadius: 999,
                                background: "var(--gr-bg-elev)", color: "var(--gr-text-mute)",
                                border: "1px solid var(--gr-border-sub)",
                                maxWidth: 160, overflow: "hidden",
                                textOverflow: "ellipsis", whiteSpace: "nowrap",
                              }}
                            >
                              {accountLabel}
                            </span>
                          )}
                          {row.count > 1 && (
                            <span
                              style={{
                                fontSize: 10.5, padding: "1px 7px", borderRadius: 999,
                                background: "var(--gr-surface)", color: "var(--gr-text-mute)",
                                border: "1px solid var(--gr-border-sub)",
                              }}
                            >
                              {row.count} similar
                            </span>
                          )}
                        </div>
                        <div
                          style={{
                            display: "flex", alignItems: "baseline", gap: 8,
                            marginTop: 2, minWidth: 0,
                          }}
                        >
                          <span
                            style={{
                              fontSize: 12, color: "var(--gr-text-mid)", lineHeight: 1.4,
                              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                              flex: 1, minWidth: 0,
                            }}
                          >
                            {summary}
                          </span>
                          <span style={{ fontSize: 11, color: "var(--gr-text-faint)", flexShrink: 0 }}>
                            {formatRelative(row.createdAt)}
                          </span>
                        </div>
                      </div>
                      <Link
                        href={viewHref}
                        style={{
                          flexShrink: 0, fontSize: 12.5, fontWeight: 500,
                          color: "var(--gr-copper)", textDecoration: "none",
                        }}
                      >
                        View →
                      </Link>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

        </div>
      </div>
    </GrShell>
  );
}
