import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";

import { GrShell, type GrNavItem } from "@/components/ui/gr-shell";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  deriveAccountPrimaryLabel,
  deriveAccountSecondaryMeta,
} from "@/lib/account-display";

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
// yet, so there is no Broker filter chip.
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

// Rich, human one-liner per trigger type: what happened, what Guardrail did,
// and what (if anything) the user should expect next. Used in place of any
// technical/log-flavoured stored message.
const TRIGGER_SUMMARY: Record<string, string> = {
  daily_loss_limit:           "Daily loss limit reached. Guardrail stopped this account for the session.",
  near_daily_loss_limit:      "You're approaching your daily loss limit. Guardrail is watching closely.",
  exceeded_trade_count:       "Trade limit reached. New trades are blocked for the rest of the session.",
  trade_limit:                "Trade limit reached. New trades are blocked for the rest of the session.",
  max_loss_streak:            "Loss-streak limit reached. Guardrail stopped this account for the session.",
  consecutive_losses_warning: "You're close to your loss-streak limit. One more loss may stop the account.",
  position_size_limit:        "Position size limit exceeded. Guardrail flagged the account and kept monitoring.",
  max_position_size:          "Position size limit exceeded. Guardrail flagged the account and kept monitoring.",
  outside_session_hours:      "Trade activity detected outside your selected session.",
};

// Markers that indicate a stored message is technical/log-flavoured rather than
// a clean human sentence (raw broker endpoints, test-mode notes, snake_case
// tokens). Such messages are never shown — a friendly summary is used instead.
const TECHNICAL_MARKERS =
  /(no applicable|Tradovate broker API|Test mode|simulated|AutoLiq|userAccount|connected_readonly|dry[_ ]?run|brokerEndpoint|liquidatepositions|\/update|\/cancel|broker-side lockout)/i;

function isTechnicalMessage(message: string | null): boolean {
  if (!message) return false;
  return message.length > 140 || TECHNICAL_MARKERS.test(message);
}

/**
 * The short, human message shown in a feed row. Known trigger types always use
 * their curated summary (what happened + what Guardrail did). For unknown
 * types we fall back to a clean stored message, then a generic line — but never
 * a raw technical/log string.
 */
function rowSummary(triggerType: string, message: string | null): string {
  const canned = TRIGGER_SUMMARY[triggerType];
  if (canned) return canned;
  if (message && !isTechnicalMessage(message)) return message;
  return "Guardrail recorded this event.";
}

type Severity = "critical" | "warning" | "system" | "info";

/**
 * Visual severity for a row. Stop/lock breaches read strongest; approaching-
 * limit warnings are amber; session events are neutral; anything unrecognised
 * is quiet info.
 */
function rowSeverity(triggerType: string): Severity {
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
  // kept for when one exists.
  if (cat === "broker") return "/settings#broker-connections";
  // System/session events are trading-activity events, so they route to the
  // Dashboard — never to Settings.
  return accountId ? `/dashboard?accountId=${accountId}` : "/dashboard";
}

/** Action-link label by category: rule → View rules, system → View dashboard,
 *  broker/settings → Open settings. */
function triggerActionLabel(t: string): string {
  const cat = triggerCategory(t);
  if (cat === "rule") return "View rules";
  if (cat === "broker") return "Open settings";
  return "View dashboard";
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
        width: 28, height: 28, borderRadius: 8, flexShrink: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 13, fontWeight: 700,
        background: s.bg, color: s.fg,
      }}
    >
      {s.glyph}
    </span>
  );
}

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

  const [feedEvents, switcherAccounts, systemAlertCount] = await Promise.all([
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
        displayName: true,
        propFirm: true,
        accountType: true,
        externalAccountId: true,
        connectionStatus: true,
        brokerConnection: { select: { connectionStatus: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    // Whether this user has *any* system alert at all — gates the System chip so
    // it isn't a dead filter. Manual ?filter=system still works regardless.
    prisma.guardianIntervention.count({
      where: { userId: user.id, triggerType: { in: [...SYSTEM_TRIGGER_TYPES] } },
    }),
  ]);

  // Resolve friendly labels for any account in the feed not in the active
  // switcher list (e.g. archived accounts with historical alerts).
  const accountIdsInFeed = [
    ...new Set(feedEvents.map((e) => e.accountId).filter(Boolean)),
  ].filter((id) => !switcherAccounts.find((a) => a.id === id));

  const extraAccounts =
    accountIdsInFeed.length > 0
      ? await prisma.connectedAccount.findMany({
          where: { id: { in: accountIdsInFeed }, userId: user.id },
          select: {
            id: true, label: true, displayName: true,
            propFirm: true, accountType: true, externalAccountId: true,
          },
        })
      : [];

  // id → { primary: best user-facing name, secondary: firm/type meta }.
  // `primary` follows displayName → exact broker label → externalAccountId →
  // firm/type, so accounts at the same firm stay distinguishable.
  const accountMeta = new Map<string, { primary: string; secondary: string | null }>();
  const addMeta = (a: {
    id: string; label: string | null; displayName?: string | null;
    propFirm?: string | null; accountType?: string | null; externalAccountId?: string | null;
  }) => {
    accountMeta.set(a.id, {
      primary: deriveAccountPrimaryLabel(a),
      secondary: deriveAccountSecondaryMeta(a),
    });
  };
  for (const a of switcherAccounts) addMeta(a);
  for (const a of extraAccounts) addMeta(a);

  const selectedAccountName = requestedAccountId
    ? accountMeta.get(requestedAccountId)?.primary ?? null
    : null;

  // Full untruncated title (primary + firm/type) for tooltips on truncated pills.
  const fullTitle = (m: { primary: string; secondary: string | null } | undefined): string | undefined =>
    m ? (m.secondary ? `${m.primary} · ${m.secondary}` : m.primary) : undefined;

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

  // ── Date grouping: Today / Last 7 days / Older ────────────────────────────
  // Rows are already newest-first, so each bucket is contiguous. Only groups
  // with rows are rendered.
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  function dateBucket(d: Date): "today" | "week" | "older" {
    if (d >= todayStart) return "today";
    if (d >= weekAgo) return "week";
    return "older";
  }
  const DATE_GROUPS: Array<{ key: "today" | "week" | "older"; label: string }> = [
    { key: "today", label: "Today" },
    { key: "week",  label: "Last 7 days" },
    { key: "older", label: "Older" },
  ];
  const groupedRows: Record<"today" | "week" | "older", FeedRow[]> = {
    today: [], week: [], older: [],
  };
  for (const r of rows) groupedRows[dateBucket(r.createdAt)].push(r);

  // ── Account switcher (top of page) ────────────────────────────────────────
  const selectableAccounts = switcherAccounts.filter((acc) => {
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

  // System chip is shown only when the user has at least one system alert, or
  // when they have manually navigated to ?filter=system (so the active chip is
  // still visible). This keeps a usually-empty filter from looking dead.
  const showSystemChip = systemAlertCount > 0 || activeFilter === "system";
  const filterChips: Array<{ key: string; label: string }> = [
    { key: "all",  label: "All" },
    { key: "rule", label: "Rule alerts" },
    ...(showSystemChip ? [{ key: "system", label: "System" }] : []),
  ];

  // ── Sidebar account list (mirrors the top switcher) ───────────────────────
  const SidebarAccountList =
    selectableAccounts.length > 0 ? (
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {selectableAccounts.slice(0, 5).map((acc) => {
          const isSelected = acc.id === requestedAccountId;
          const meta = accountMeta.get(acc.id);
          return (
            <Link
              key={acc.id}
              href={buildHref({ accountId: acc.id })}
              title={fullTitle(meta)}
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
                {meta?.primary ?? deriveAccountPrimaryLabel(acc)}
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

  // ── Empty-state copy + optional action, varying by what's filtered ────────
  // The title badge reflects the *currently filtered* result set (selected
  // account + filter + today), never a global total — feedEvents already has
  // those constraints applied in the query above.
  // Use the post-deduplication row count so the badge matches what the user
  // actually sees. feedEvents may contain many repeats collapsed into one row.
  const alertCount = rows.length;
  type EmptyState = { title: string; body: string; action?: { href: string; label: string } };
  const emptyState: EmptyState = (() => {
    if (todayOnly) {
      return {
        title: "No alerts today",
        body: "You're clear so far. New rule breaches and session events will appear here.",
      };
    }
    if (activeFilter === "rule") {
      return {
        title: "No rule alerts yet",
        body: "Rule breaches like daily loss or trade limits will show up here.",
        action: { href: "/rules", label: "View trading plan" },
      };
    }
    if (activeFilter === "system") {
      return {
        title: "No system alerts yet",
        body: "Session and activity events will show up here.",
      };
    }
    if (requestedAccountId && selectedAccountName) {
      return {
        title: "No alerts for this account",
        body: "Guardrail has not detected any rule breaches or session issues for this account yet.",
        action: {
          href: `/rules?scope=account&id=${requestedAccountId}`,
          label: "View trading plan",
        },
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
        <div style={{ maxWidth: 760, margin: "0 auto" }}>

          {/* ── Header ──────────────────────────────────────────────────── */}
          <section style={{ padding: "14px 32px 12px" }}>
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

          {/* ── Sticky filter bar: account switcher + chips ─────────────────
              Pinned to the top of the scroll area (top: 0 = directly under the
              56px shell header) with an opaque background, so rows scroll
              underneath without the controls being clipped or hidden. */}
          <div
            style={{
              position: "sticky", top: 0, zIndex: 5,
              background: "var(--gr-bg)",
              borderBottom: "1px solid var(--gr-border-sub)",
              paddingTop: 4, marginBottom: 8,
            }}
          >
          {/* ── Account switcher ────────────────────────────────────────── */}
          {selectableAccounts.length > 0 && (
            <section
              style={{ padding: "0 32px 12px", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}
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
              {selectableAccounts.length <= 4 ? (
                selectableAccounts.map((acc) => {
                  const isSelected = acc.id === requestedAccountId;
                  const meta = accountMeta.get(acc.id);
                  return (
                    <Link
                      key={acc.id}
                      href={buildHref({ accountId: acc.id })}
                      title={fullTitle(meta)}
                      style={{
                        padding: "6px 13px", borderRadius: 9, fontSize: 12.5,
                        background: isSelected ? "var(--gr-copper-bg)" : "var(--gr-surface)",
                        border: isSelected ? "1px solid var(--gr-copper-bd)" : "1px solid var(--gr-border)",
                        color: isSelected ? "var(--gr-copper)" : "var(--gr-text-mid)",
                        fontWeight: isSelected ? 600 : 500,
                        textDecoration: "none",
                        maxWidth: 220, overflow: "hidden",
                        textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}
                    >
                      {meta?.primary ?? deriveAccountPrimaryLabel(acc)}
                    </Link>
                  );
                })
              ) : (
                <details style={{ position: "relative" }}>
                  <summary
                    style={{
                      padding: "6px 13px", borderRadius: 9, fontSize: 12.5,
                      background: requestedAccountId ? "var(--gr-copper-bg)" : "var(--gr-surface)",
                      border: requestedAccountId ? "1px solid var(--gr-copper-bd)" : "1px solid var(--gr-border)",
                      color: requestedAccountId ? "var(--gr-copper)" : "var(--gr-text-mid)",
                      fontWeight: requestedAccountId ? 600 : 500,
                      cursor: "pointer", listStyle: "none", userSelect: "none",
                    }}
                  >
                    {requestedAccountId
                      ? (accountMeta.get(requestedAccountId)?.primary ?? "Account")
                      : "Select account"}{" ▾"}
                  </summary>
                  <div
                    style={{
                      position: "absolute", top: "calc(100% + 4px)", left: 0,
                      minWidth: 240, zIndex: 10,
                      background: "var(--gr-surface)", border: "1px solid var(--gr-border)",
                      borderRadius: 10, padding: "4px 0",
                      boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
                    }}
                  >
                    {selectableAccounts.map((acc) => {
                      const isSelected = acc.id === requestedAccountId;
                      const meta = accountMeta.get(acc.id);
                      return (
                        <Link
                          key={acc.id}
                          href={buildHref({ accountId: acc.id })}
                          title={fullTitle(meta)}
                          style={{
                            display: "block", padding: "8px 14px",
                            background: isSelected ? "var(--gr-copper-bg)" : "transparent",
                            textDecoration: "none",
                          }}
                        >
                          <div
                            style={{
                              fontSize: 12.5, fontWeight: isSelected ? 600 : 500,
                              color: isSelected ? "var(--gr-copper)" : "var(--gr-ink)",
                            }}
                          >
                            {meta?.primary ?? deriveAccountPrimaryLabel(acc)}
                          </div>
                          {meta?.secondary && (
                            <div style={{ fontSize: 11, color: "var(--gr-text-mute)", marginTop: 1 }}>
                              {meta.secondary}
                            </div>
                          )}
                        </Link>
                      );
                    })}
                  </div>
                </details>
              )}
            </section>
          )}

          {/* ── Filter chips ────────────────────────────────────────────── */}
          <section
            style={{
              padding: "0 32px 14px", display: "flex", gap: 8, flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            {filterChips.map((chip) => {
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
          </div>

          {/* ── Alert feed ──────────────────────────────────────────────── */}
          <section style={{ padding: "0 32px 36px" }}>
            {rows.length === 0 ? (
              <div
                style={{
                  border: "1px solid var(--gr-border)",
                  background: "var(--gr-surface)",
                  borderRadius: 14,
                  padding: "48px 28px",
                  textAlign: "center",
                  display: "flex", flexDirection: "column", alignItems: "center",
                }}
              >
                <span
                  style={{
                    width: 40, height: 40, borderRadius: 11, marginBottom: 14,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: "var(--gr-bg-elev)", color: "var(--gr-text-mute)",
                    fontSize: 18,
                  }}
                >
                  ✓
                </span>
                <p style={{ fontSize: 15.5, fontWeight: 600, color: "var(--gr-ink)", margin: "0 0 6px" }}>
                  {emptyState.title}
                </p>
                <p style={{ fontSize: 13, color: "var(--gr-text-mute)", margin: 0, lineHeight: 1.5, maxWidth: 360 }}>
                  {emptyState.body}
                </p>
                {emptyState.action && (
                  <Link
                    href={emptyState.action.href}
                    style={{
                      marginTop: 16, fontSize: 12.5, fontWeight: 500,
                      color: "var(--gr-copper)", textDecoration: "none",
                      padding: "7px 14px", borderRadius: 9,
                      border: "1px solid var(--gr-border)", background: "var(--gr-bg-elev)",
                    }}
                  >
                    {emptyState.action.label} →
                  </Link>
                )}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                {DATE_GROUPS.filter((g) => groupedRows[g.key].length > 0).map((g) => (
                  <div key={g.key}>
                    {/* Subtle date-group header */}
                    <div
                      style={{
                        fontSize: 11, fontWeight: 600, letterSpacing: "0.06em",
                        textTransform: "uppercase", color: "var(--gr-text-mute)",
                        padding: "0 4px 7px",
                      }}
                    >
                      {g.label}
                    </div>
                    <div
                      style={{
                        border: "1px solid var(--gr-border)",
                        background: "var(--gr-surface)",
                        borderRadius: 14,
                        padding: "4px 18px",
                      }}
                    >
                      {groupedRows[g.key].map((row, i) => {
                        const severity = rowSeverity(row.triggerType);
                        const label = triggerLabel(row.triggerType);
                        const summary = rowSummary(row.triggerType, row.message);
                        const meta = accountMeta.get(row.accountId);
                        const accountName = meta?.primary ?? null;
                        const viewHref = triggerViewHref(row.triggerType, row.accountId);
                        const actionLabel = triggerActionLabel(row.triggerType);
                        return (
                          <div
                            key={row.key}
                            style={{
                              display: "flex", alignItems: "center", gap: 13,
                              padding: "13px 0",
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
                                {accountName && (
                                  <span
                                    title={fullTitle(meta)}
                                    style={{
                                      fontSize: 10.5, padding: "1px 7px", borderRadius: 999,
                                      background: "var(--gr-bg-elev)", color: "var(--gr-text-mute)",
                                      border: "1px solid var(--gr-border-sub)",
                                      maxWidth: 180, overflow: "hidden",
                                      textOverflow: "ellipsis", whiteSpace: "nowrap",
                                    }}
                                  >
                                    {accountName}
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
                                  marginTop: 3, minWidth: 0,
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
                                flexShrink: 0, fontSize: 12, fontWeight: 500,
                                color: "var(--gr-copper)", textDecoration: "none",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {actionLabel} →
                            </Link>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

        </div>
      </div>
    </GrShell>
  );
}
