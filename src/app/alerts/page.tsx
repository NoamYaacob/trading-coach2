import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";

import { GrShell, type GrNavItem } from "@/components/ui/gr-shell";
import { SectionCard } from "@/components/ui/section-card";
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

/** Map broker connectionStatus string to a simple traffic-light colour */
function connStatusColor(s: string | null | undefined): string {
  if (!s) return "var(--gr-text-faint)";
  if (s.startsWith("connected")) return "var(--gr-ok)";
  if (s === "connection_error") return "var(--gr-bad)";
  return "var(--gr-text-faint)";
}

export default async function AlertsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const userInitials = user.email
    ? user.email.slice(0, 2).toUpperCase()
    : "??";

  const [telegramConnection, riskRules, sidebarAccounts] = await Promise.all([
    prisma.telegramConnection.findUnique({
      where: { userId: user.id },
      select: { telegramUsername: true, telegramChatId: true },
    }),
    prisma.riskRules.findUnique({
      where: { userId: user.id },
      select: {
        maxDailyLoss: true,
        maxTradesPerDay: true,
        stopAfterLosses: true,
        sessionStartHour: true,
        sessionEndHour: true,
      },
    }),
    prisma.connectedAccount.findMany({
      where: {
        userId: user.id,
        isActive: true,
        protectionStatus: { in: ["protected", "monitor_only"] },
        missingFromBrokerSince: null,
      },
      select: { id: true, label: true, connectionStatus: true },
      orderBy: { createdAt: "asc" },
      take: 5,
    }),
  ]);

  const telegramReady = Boolean(telegramConnection?.telegramChatId);

  // ── Sidebar account list (matches dashboard sidebar) ──────────────────────
  const SidebarAccountList = sidebarAccounts.length > 0 ? (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {sidebarAccounts.map((acc) => (
        <div
          key={acc.id}
          style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "7px 8px", borderRadius: 8,
          }}
        >
          <span style={{
            width: 7, height: 7, borderRadius: "50%",
            background: connStatusColor(acc.connectionStatus), flexShrink: 0,
          }} />
          <span style={{
            fontSize: 12.5, color: "var(--gr-ink)", flex: 1, minWidth: 0,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
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

  const channels = [
    {
      label: "In-app",
      status: "Available",
      statusColor: "var(--gr-ok)",
      statusBg: "var(--gr-ok-bg)",
      detail: "Alert banners on the Dashboard and Guardian pages. Always active — no configuration needed.",
      future: null as string | null,
      enabled: true,
      action: null as { href: string; label: string } | null,
    },
    {
      label: "Telegram",
      status: telegramReady ? "Connected" : "Not connected",
      statusColor: telegramReady ? "var(--gr-ok)" : "var(--gr-text-mute)",
      statusBg: telegramReady ? "var(--gr-ok-bg)" : "var(--gr-bg-elev)",
      detail: telegramReady
        ? `Connected as @${telegramConnection?.telegramUsername ?? "unknown"}. Sends alerts for rule breaches (daily loss, loss streak) and behavioral patterns (revenge entry, rapid trading, size increase after a loss).`
        : "Telegram alerts are not connected yet. Once connected, Guardrail sends rule-breach and behavioral alerts straight to your chat.",
      future: "Planned: per-alert preferences and a daily digest summary.",
      enabled: telegramReady,
      action: telegramReady ? null : ({ href: "/settings", label: "Set up Telegram" } as { href: string; label: string }),
    },
    {
      label: "Email",
      status: "Coming soon",
      statusColor: "var(--gr-warn)",
      statusBg: "var(--gr-warn-bg)",
      detail: "Email alerts for lockout events and daily summaries. Not yet available.",
      future: null as string | null,
      enabled: false,
      action: null as { href: string; label: string } | null,
    },
  ];

  const ruleTriggers = [
    {
      label: "Daily loss limit reached",
      description: "An in-app notice when your daily P&L hits the loss limit, plus a Telegram early warning at 80% of the limit.",
      active: riskRules?.maxDailyLoss != null,
      requires: "Daily loss limit",
    },
    {
      label: "Max trades exceeded",
      description: "An in-app notice when you exceed your maximum trades-per-day limit.",
      active: riskRules?.maxTradesPerDay != null,
      requires: "Max trades per day",
    },
    {
      label: "Consecutive losses",
      description: "An in-app notice at your loss-streak limit, plus a Telegram warning one loss before it.",
      active: riskRules?.stopAfterLosses != null,
      requires: "Stop after losses",
    },
    {
      label: "Outside trading hours",
      description: "An in-app notice when the market is closed or your session window has ended.",
      active: riskRules?.sessionStartHour != null && riskRules?.sessionEndHour != null,
      requires: "Session hours",
    },
  ];

  const behavioralTriggers = [
    { label: "Revenge entry",          description: "Fires when you re-enter a position within 2 minutes of a loss." },
    { label: "Rapid trading",          description: "Fires when 3 or more trades are placed within a 5-minute window." },
    { label: "Size increase after loss", description: "Fires when a position is more than 25% larger than your previous losing trade." },
  ];

  const comingSoon = [
    { label: "Daily profit target hit",     description: "Alert when session P&L reaches your profit target." },
    { label: "Unrealized drawdown",         description: "Alert when an open position's unrealized loss exceeds your per-trade risk limit." },
    { label: "Pre-news window",             description: "Alert before high-impact economic events." },
    { label: "News lockout",                description: "Warns on trades placed around scheduled news releases." },
    { label: "Session start & end reminders", description: "Reminders when your trading session opens and closes." },
    { label: "In-app notification center", description: "A central feed to browse and revisit past alerts." },
  ];

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
        {/* ── Page heading ──────────────────────────────────────── */}
        <section style={{ padding: "28px 36px 20px" }}>
          <span style={{ fontSize: 11.5, fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--gr-text-mute)" }}>
            Alerts
          </span>
          <h1 style={{ fontSize: 28, fontWeight: 600, letterSpacing: "-0.03em", lineHeight: 1.2, color: "var(--gr-ink)", margin: "6px 0 6px" }}>
            How will I be notified?
          </h1>
          <p style={{ fontSize: 14, color: "var(--gr-text-mid)", margin: 0 }}>
            Where Guardrail sends alerts when rules trigger.
          </p>
        </section>

        {/* ── Content ───────────────────────────────────────────── */}
        <section style={{ padding: "0 36px 36px" }}>
          <div className="grid gap-6">

            {/* ── Channels ──────────────────────────────────────── */}
            <SectionCard title="Channels">
              <div className="grid gap-3 sm:grid-cols-3">
                {channels.map((ch) => (
                  <div
                    key={ch.label}
                    style={{
                      borderRadius: 12,
                      border: "1px solid var(--gr-border)",
                      background: ch.enabled ? "var(--gr-surface)" : "var(--gr-bg-elev)",
                      padding: "14px 16px",
                      opacity: ch.enabled ? 1 : 0.75,
                      display: "flex", flexDirection: "column", gap: 8,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                      <p style={{ fontSize: 13.5, fontWeight: 600, color: "var(--gr-ink)", margin: 0 }}>{ch.label}</p>
                      <span style={{
                        flexShrink: 0, borderRadius: 999,
                        padding: "2px 8px",
                        fontSize: 11, fontWeight: 600,
                        color: ch.statusColor,
                        background: ch.statusBg,
                        border: `1px solid ${ch.statusColor}26`,
                      }}>
                        {ch.status}
                      </span>
                    </div>
                    <p style={{ fontSize: 12.5, color: "var(--gr-text-mid)", lineHeight: 1.5, margin: 0 }}>{ch.detail}</p>
                    {ch.future && (
                      <p style={{ fontSize: 11.5, color: "var(--gr-text-mute)", fontStyle: "italic", margin: 0 }}>{ch.future}</p>
                    )}
                    {ch.action && (
                      <a
                        href={ch.action.href}
                        style={{ fontSize: 12.5, fontWeight: 500, color: "var(--gr-copper)", textDecoration: "none", marginTop: 2 }}
                      >
                        {ch.action.label} →
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </SectionCard>

            {/* ── Rule-based triggers ───────────────────────────── */}
            <SectionCard
              title="Rule-based alerts — active today"
              description="Active when the matching rule is configured."
              actions={
                <a
                  href="/rules"
                  style={{ fontSize: 12, fontWeight: 500, color: "var(--gr-text-mute)", textDecoration: "none" }}
                >
                  Set rules →
                </a>
              }
            >
              <div style={{ display: "flex", flexDirection: "column" }}>
                {ruleTriggers.map((t, i) => (
                  <div
                    key={t.label}
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16,
                      padding: "10px 0",
                      borderTop: i > 0 ? "1px solid var(--gr-border-sub)" : undefined,
                    }}
                  >
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <p style={{ fontSize: 13, fontWeight: 500, color: "var(--gr-ink)", margin: 0 }}>{t.label}</p>
                      <p style={{ fontSize: 12, color: "var(--gr-text-mute)", margin: 0, lineHeight: 1.4 }}>{t.description}</p>
                    </div>
                    <span style={{
                      flexShrink: 0, borderRadius: 999,
                      padding: "2px 9px", fontSize: 11, fontWeight: 600,
                      color: t.active ? "var(--gr-ok)" : "var(--gr-text-mute)",
                      background: t.active ? "var(--gr-ok-bg)" : "var(--gr-bg-elev)",
                      border: t.active ? "1px solid rgba(0,0,0,0.06)" : "1px solid var(--gr-border-sub)",
                    }}>
                      {t.active ? "Active" : "Off"}
                    </span>
                  </div>
                ))}
              </div>
              {ruleTriggers.some((t) => !t.active) && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--gr-border-sub)", display: "flex", flexDirection: "column", gap: 4 }}>
                  {ruleTriggers.filter((t) => !t.active).map((t) => (
                    <p key={t.label} style={{ fontSize: 12, color: "var(--gr-text-mute)", margin: 0 }}>
                      Set <span style={{ fontWeight: 500, color: "var(--gr-text-mid)" }}>{t.requires}</span> in{" "}
                      <a href="/rules" style={{ fontWeight: 500, color: "var(--gr-copper)", textDecoration: "none" }}>Rules</a>{" "}
                      to enable <span style={{ fontWeight: 500 }}>{t.label}</span>.
                    </p>
                  ))}
                </div>
              )}
            </SectionCard>

            {/* ── Behavioral triggers ───────────────────────────── */}
            <SectionCard
              title="Behavioral alerts — active today"
              description="Always active when Telegram is connected — no rule configuration needed."
            >
              <div style={{ display: "flex", flexDirection: "column" }}>
                {behavioralTriggers.map((t, i) => (
                  <div
                    key={t.label}
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16,
                      padding: "10px 0",
                      borderTop: i > 0 ? "1px solid var(--gr-border-sub)" : undefined,
                    }}
                  >
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <p style={{ fontSize: 13, fontWeight: 500, color: "var(--gr-ink)", margin: 0 }}>{t.label}</p>
                      <p style={{ fontSize: 12, color: "var(--gr-text-mute)", margin: 0, lineHeight: 1.4 }}>{t.description}</p>
                    </div>
                    <span style={{
                      flexShrink: 0, borderRadius: 999,
                      padding: "2px 9px", fontSize: 11, fontWeight: 600,
                      color: telegramReady ? "var(--gr-ok)" : "var(--gr-text-mute)",
                      background: telegramReady ? "var(--gr-ok-bg)" : "var(--gr-bg-elev)",
                      border: telegramReady ? "1px solid rgba(0,0,0,0.06)" : "1px solid var(--gr-border-sub)",
                    }}>
                      {telegramReady ? "Active" : "Needs Telegram"}
                    </span>
                  </div>
                ))}
              </div>
              {!telegramReady && (
                <p style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--gr-border-sub)", fontSize: 12, color: "var(--gr-text-mute)" }}>
                  <a href="/settings" style={{ fontWeight: 500, color: "var(--gr-copper)", textDecoration: "none" }}>Set up Telegram</a>{" "}
                  to receive behavioral alerts.
                </p>
              )}
            </SectionCard>

            {/* ── Coming soon ───────────────────────────────────── */}
            <SectionCard
              title="Coming soon / Planned"
              description="On the roadmap — not sending alerts yet."
            >
              <div style={{ display: "flex", flexDirection: "column" }}>
                {comingSoon.map((t, i) => (
                  <div
                    key={t.label}
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16,
                      padding: "10px 0",
                      borderTop: i > 0 ? "1px solid var(--gr-border-sub)" : undefined,
                    }}
                  >
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <p style={{ fontSize: 13, fontWeight: 500, color: "var(--gr-text-mute)", margin: 0 }}>{t.label}</p>
                      <p style={{ fontSize: 12, color: "var(--gr-text-faint)", margin: 0, lineHeight: 1.4 }}>{t.description}</p>
                    </div>
                    <span style={{
                      flexShrink: 0, borderRadius: 999,
                      padding: "2px 9px", fontSize: 11, fontWeight: 600,
                      color: "var(--gr-warn)", background: "var(--gr-warn-bg)",
                      border: "1px solid rgba(0,0,0,0.06)",
                    }}>
                      Planned
                    </span>
                  </div>
                ))}
              </div>
            </SectionCard>

            {/* ── Alert preferences (planned) ───────────────────── */}
            <SectionCard title="Alert preferences">
              <div style={{
                borderRadius: 10,
                border: "1px solid var(--gr-warn-bd, var(--gr-border))",
                background: "var(--gr-warn-bg)",
                padding: "14px 16px",
                display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12,
              }}>
                <div>
                  <p style={{ fontSize: 13.5, fontWeight: 600, color: "var(--gr-ink)", margin: "0 0 4px" }}>Per-alert preferences</p>
                  <p style={{ fontSize: 12.5, color: "var(--gr-text-mid)", margin: 0, lineHeight: 1.5 }}>
                    Alert preferences are planned. Today, Guardrail sends core safety alerts based on your active rules.
                  </p>
                </div>
                <span style={{
                  flexShrink: 0, borderRadius: 999, padding: "2px 9px",
                  fontSize: 11, fontWeight: 600,
                  color: "var(--gr-warn)", background: "var(--gr-warn-bg)",
                  border: "1px solid rgba(0,0,0,0.06)",
                }}>
                  Planned
                </span>
              </div>
            </SectionCard>

          </div>
        </section>
      </div>
    </GrShell>
  );
}
