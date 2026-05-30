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

function connStatusColor(s: string | null | undefined): string {
  if (!s) return "var(--gr-text-faint)";
  if (s.startsWith("connected")) return "var(--gr-ok)";
  if (s === "connection_error") return "var(--gr-bad)";
  return "var(--gr-text-faint)";
}

const RULE_TRIGGER_TYPES = new Set([
  "near_daily_loss_limit",
  "daily_loss_limit",
  "exceeded_trade_count",
  "max_loss_streak",
  "consecutive_losses_warning",
  "position_size_limit",
]);

const SYSTEM_TRIGGER_TYPES = new Set([
  "outside_session_hours",
]);

function triggerCategory(t: string): "rule" | "system" | "broker" {
  if (RULE_TRIGGER_TYPES.has(t)) return "rule";
  if (SYSTEM_TRIGGER_TYPES.has(t)) return "system";
  return "broker";
}

function triggerLabel(t: string): string {
  switch (t) {
    case "near_daily_loss_limit":      return "Daily loss limit warning";
    case "daily_loss_limit":           return "Daily loss limit reached";
    case "exceeded_trade_count":       return "Max trades exceeded";
    case "max_loss_streak":            return "Loss streak limit reached";
    case "consecutive_losses_warning": return "Approaching loss streak limit";
    case "position_size_limit":        return "Position size limit";
    case "outside_session_hours":      return "Outside trading session";
    default:                           return t.replace(/_/g, " ");
  }
}

function triggerSeverity(t: string): "warn" | "bad" | "ok" {
  switch (t) {
    case "near_daily_loss_limit":
    case "consecutive_losses_warning":
      return "warn";
    case "daily_loss_limit":
    case "exceeded_trade_count":
    case "max_loss_streak":
    case "position_size_limit":
      return "bad";
    default:
      return "ok";
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

function filterChipHref(key: string, todayOnly: boolean): string {
  if (key === "all") return todayOnly ? "/alerts?today=1" : "/alerts";
  return todayOnly ? `/alerts?filter=${key}&today=1` : `/alerts?filter=${key}`;
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

function SeverityIcon({ severity }: { severity: "warn" | "bad" | "ok" }) {
  const base: React.CSSProperties = {
    width: 32, height: 32, borderRadius: 8, flexShrink: 0,
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: 15, fontWeight: 700,
  };
  if (severity === "bad") return (
    <span style={{ ...base, background: "var(--gr-bad-bg)", color: "var(--gr-bad)" }}>!</span>
  );
  if (severity === "warn") return (
    <span style={{ ...base, background: "var(--gr-warn-bg)", color: "var(--gr-warn)" }}>▲</span>
  );
  return (
    <span style={{ ...base, background: "var(--gr-ok-bg)", color: "var(--gr-ok)" }}>i</span>
  );
}

// Note: no "Broker" chip — there is no broker-connection event source yet, so a
// Broker filter would only ever show an empty state. The chip stays hidden until
// a real broker-event source exists.
const FILTER_CHIPS = [
  { key: "all",    label: "All" },
  { key: "rule",   label: "Rule alerts" },
  { key: "system", label: "System" },
] as const;

export default async function AlertsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; today?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const activeFilter = params.filter ?? "all";
  const todayOnly = params.today === "1";

  const userInitials = user.email ? user.email.slice(0, 2).toUpperCase() : "??";

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  let triggerTypeFilter: string[] | undefined;
  if (activeFilter === "rule") {
    triggerTypeFilter = [...RULE_TRIGGER_TYPES];
  } else if (activeFilter === "system") {
    triggerTypeFilter = [...SYSTEM_TRIGGER_TYPES];
  } else if (activeFilter === "broker") {
    triggerTypeFilter = [];
  }

  const [feedEvents, sidebarAccounts] = await Promise.all([
    triggerTypeFilter?.length === 0
      ? Promise.resolve([] as Array<{ id: string; accountId: string | null; triggerType: string; outcome: string | null; message: string | null; createdAt: Date }>)
      : prisma.guardianIntervention.findMany({
          where: {
            userId: user.id,
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
          take: 100,
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

  const accountIdsInFeed = [
    ...new Set(feedEvents.map((e) => e.accountId).filter(Boolean) as string[]),
  ].filter((id) => !sidebarAccounts.find((a) => a.id === id));

  const extraAccounts =
    accountIdsInFeed.length > 0
      ? await prisma.connectedAccount.findMany({
          where: { id: { in: accountIdsInFeed }, userId: user.id },
          select: { id: true, label: true },
        })
      : [];

  const accountLabelMap = new Map<string, string>();
  for (const a of sidebarAccounts) accountLabelMap.set(a.id, a.label);
  for (const a of extraAccounts) accountLabelMap.set(a.id, a.label);

  const selectableAccounts = sidebarAccounts
    .filter((acc) => {
      const effectiveStatus =
        acc.brokerConnection?.connectionStatus ?? acc.connectionStatus;
      return effectiveStatus !== "expired" && effectiveStatus !== "connection_error";
    })
    .slice(0, 5);

  const SidebarAccountList =
    selectableAccounts.length > 0 ? (
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {selectableAccounts.map((acc) => (
          <div
            key={acc.id}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "7px 8px", borderRadius: 8,
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
          </div>
        ))}
      </div>
    ) : (
      <Link
        href="/accounts/connect/tradovate"
        style={{ fontSize: 12.5, color: "var(--gr-copper)", textDecoration: "none" }}
      >
        Connect first account →
      </Link>
    );

  const todayChipHref = todayOnly
    ? activeFilter === "all"
      ? "/alerts"
      : `/alerts?filter=${activeFilter}`
    : activeFilter === "all"
      ? "/alerts?today=1"
      : `/alerts?filter=${activeFilter}&today=1`;

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

        {/* ── Page heading ─────────────────────────────────────────────── */}
        <section style={{ padding: "28px 36px 16px" }}>
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
              <h1
                style={{
                  fontSize: 28, fontWeight: 600, letterSpacing: "-0.03em",
                  lineHeight: 1.2, color: "var(--gr-ink)", margin: "0 0 6px",
                }}
              >
                Alerts
              </h1>
              <p style={{ fontSize: 14, color: "var(--gr-text-mid)", margin: 0 }}>
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

        {/* ── Filter chips ─────────────────────────────────────────────── */}
        <section
          style={{ padding: "0 36px 16px", display: "flex", gap: 8, flexWrap: "wrap" }}
        >
          {FILTER_CHIPS.map((chip) => {
            const isActive = activeFilter === chip.key;
            return (
              <Link
                key={chip.key}
                href={filterChipHref(chip.key, todayOnly)}
                style={{
                  display: "inline-block",
                  padding: "5px 14px",
                  borderRadius: 999,
                  fontSize: 12.5,
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
          <Link
            href={todayChipHref}
            style={{
              display: "inline-block",
              padding: "5px 14px",
              borderRadius: 999,
              fontSize: 12.5,
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

        {/* ── Alert feed ───────────────────────────────────────────────── */}
        <section style={{ padding: "0 36px 36px" }}>
          {feedEvents.length === 0 ? (
            <div style={{ textAlign: "center", padding: "64px 24px", color: "var(--gr-text-mute)" }}>
              <p style={{ fontSize: 16, fontWeight: 500, margin: "0 0 8px" }}>
                No alerts yet
              </p>
              <p style={{ fontSize: 13.5, margin: 0, lineHeight: 1.5 }}>
                Guardrail will show rule breaches, session events, and broker sync events here.
              </p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {feedEvents.map((event, i) => {
                const severity = triggerSeverity(event.triggerType);
                const label = triggerLabel(event.triggerType);
                const accountLabel = event.accountId
                  ? accountLabelMap.get(event.accountId)
                  : null;
                const viewHref = triggerViewHref(event.triggerType, event.accountId ?? null);
                return (
                  <div
                    key={event.id}
                    style={{
                      display: "flex", alignItems: "flex-start", gap: 14,
                      padding: "14px 0",
                      borderTop: i > 0 ? "1px solid var(--gr-border-sub)" : undefined,
                    }}
                  >
                    <SeverityIcon severity={severity} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          display: "flex", alignItems: "center",
                          gap: 8, flexWrap: "wrap", marginBottom: 2,
                        }}
                      >
                        <span
                          style={{ fontSize: 13.5, fontWeight: 600, color: "var(--gr-ink)" }}
                        >
                          {label}
                        </span>
                        {accountLabel && (
                          <span
                            style={{
                              fontSize: 11, padding: "1px 7px", borderRadius: 999,
                              background: "var(--gr-bg-elev)",
                              color: "var(--gr-text-mute)",
                              border: "1px solid var(--gr-border-sub)",
                            }}
                          >
                            {accountLabel}
                          </span>
                        )}
                      </div>
                      {event.message && (
                        <p
                          style={{
                            fontSize: 12.5, color: "var(--gr-text-mid)",
                            margin: "0 0 4px", lineHeight: 1.4,
                          }}
                        >
                          {event.message}
                        </p>
                      )}
                      <span style={{ fontSize: 11.5, color: "var(--gr-text-faint)" }}>
                        {formatRelative(event.createdAt)}
                      </span>
                    </div>
                    <Link
                      href={viewHref}
                      style={{
                        flexShrink: 0,
                        fontSize: 12.5, fontWeight: 500,
                        color: "var(--gr-copper)",
                        textDecoration: "none",
                        padding: "5px 0",
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
    </GrShell>
  );
}
