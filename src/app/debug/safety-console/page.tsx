import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";

import { AppShell } from "@/components/ui/app-shell";
import { SectionCard } from "@/components/ui/section-card";
import { getCurrentUser } from "@/lib/auth";
import { isAdminEmail } from "@/lib/subscription";
import { prisma } from "@/lib/db";
import {
  deriveOverallSeverity,
  deriveSafetyAlerts,
  readEnforcementFlagsFromEnv,
  type SafetyAlert,
  type SafetyAlertSeverity,
} from "@/lib/safety-console-helpers";

export const metadata: Metadata = {
  title: "Safety Console",
  robots: { index: false, follow: false },
};

const LISTENER_STALE_THRESHOLD_MS = 60_000;

export default async function SafetyConsolePage() {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    redirect("/login");
  }
  if (!isAdminEmail(currentUser.email)) {
    notFound();
  }

  const flags = readEnforcementFlagsFromEnv(process.env);
  const now = new Date();

  const [brokerConnections, accounts, activeLockRows, historicalEnforcements] =
    await Promise.all([
      prisma.brokerConnection.findMany({
        select: {
          id: true,
          env: true,
          connectionStatus: true,
          permissionLevel: true,
          listenerStatus: true,
          listenerLastEventAt: true,
          listenerLastHeartbeatAt: true,
          listenerLastCloseCode: true,
          listenerLastCloseReason: true,
          listenerErrorMessage: true,
          tokenExpiresAt: true,
          lastRenewError: true,
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.connectedAccount.findMany({
        where: { protectionStatus: "protected" },
        select: {
          id: true,
          label: true,
          accountType: true,
          isActive: true,
          sessionState: { select: { riskState: true } },
          brokerConnection: { select: { env: true } },
        },
        orderBy: { label: "asc" },
      }),
      prisma.internalLockEvent.findMany({
        where: { clearedAt: null },
        select: {
          id: true,
          accountId: true,
          ruleType: true,
          tradingDay: true,
          createdAt: true,
          account: {
            select: {
              label: true,
              brokerConnection: { select: { env: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.guardianIntervention.findMany({
        where: { listenerBrokerDedupKey: { not: null } },
        select: {
          id: true,
          accountId: true,
          brokerLockStatus: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      }),
    ]);

  const activeLockCountByAccount = new Map<string, number>();
  const latestActiveLockByAccount = new Map<string, (typeof activeLockRows)[number]>();
  for (const lock of activeLockRows) {
    activeLockCountByAccount.set(
      lock.accountId,
      (activeLockCountByAccount.get(lock.accountId) ?? 0) + 1,
    );
    if (!latestActiveLockByAccount.has(lock.accountId)) {
      latestActiveLockByAccount.set(lock.accountId, lock);
    }
  }

  const historicalCountByAccount = new Map<string, number>();
  const latestHistoricalByAccount = new Map<
    string,
    (typeof historicalEnforcements)[number]
  >();
  for (const h of historicalEnforcements) {
    historicalCountByAccount.set(
      h.accountId,
      (historicalCountByAccount.get(h.accountId) ?? 0) + 1,
    );
    if (!latestHistoricalByAccount.has(h.accountId)) {
      latestHistoricalByAccount.set(h.accountId, h);
    }
  }

  const accountSummaries = accounts.map((a) => {
    const latestHist = latestHistoricalByAccount.get(a.id);
    const histCount = historicalCountByAccount.get(a.id) ?? 0;
    const activeCount = activeLockCountByAccount.get(a.id) ?? 0;
    const hasActiveInternalLock = activeCount > 0;
    return {
      accountId: a.id,
      label: a.label,
      env: a.brokerConnection?.env ?? null,
      accountType: a.accountType,
      riskState: a.sessionState?.riskState ?? null,
      hasActiveInternalLock,
      activeLockCount: activeCount,
      historicalBrokerEnforcementCount: histCount,
      latestBrokerLockStatus: latestHist?.brokerLockStatus ?? null,
      hasHistoricalBrokerLockOnly:
        histCount > 0 &&
        !hasActiveInternalLock &&
        latestHist?.brokerLockStatus === "broker_locked",
    };
  });

  const alerts = deriveSafetyAlerts({
    flags,
    activeLocks: activeLockRows.map((l) => ({
      accountId: l.accountId,
      env: l.account.brokerConnection?.env ?? null,
    })),
    historicalBrokerEnforcements: historicalEnforcements.map((h) => ({
      brokerLockStatus: h.brokerLockStatus,
    })),
    listeners: brokerConnections.map((c) => ({
      connectionId: c.id,
      env: c.env,
      status: c.listenerStatus,
      lastHeartbeatAt: c.listenerLastHeartbeatAt?.toISOString() ?? null,
    })),
    listenerStaleThresholdMs: LISTENER_STALE_THRESHOLD_MS,
    now,
  });

  const overallSeverity = deriveOverallSeverity(alerts);

  return (
    <AppShell
      eyebrow="Admin · Internal"
      title="Safety Console"
      description="Read-only operational view of listener health, enforcement flags, and per-account safety state. No writes, no broker calls."
      note="Admin-only. Audit IDs are visible here intentionally."
    >
      <div className="grid gap-6">
        <OverallStatusBanner severity={overallSeverity} alertCount={alerts.length} />
        <AlertsCard alerts={alerts} />
        <SectionCard
          title="Enforcement safety flags"
          description="Current process env state across services."
        >
          <FlagsGrid flags={flags} />
        </SectionCard>
        <SectionCard
          title="Listener health"
          description="Per-broker-connection listener status and recent activity."
        >
          <ListenerTable
            rows={brokerConnections.map((c) => ({
              connectionId: c.id,
              env: c.env,
              connectionStatus: c.connectionStatus,
              listenerStatus: c.listenerStatus,
              lastEventAt: c.listenerLastEventAt?.toISOString() ?? null,
              lastHeartbeatAt: c.listenerLastHeartbeatAt?.toISOString() ?? null,
              lastCloseCode: c.listenerLastCloseCode,
              lastCloseReason: c.listenerLastCloseReason,
              tokenExpired:
                c.tokenExpiresAt !== null && c.tokenExpiresAt.getTime() < now.getTime(),
              lastRenewError: c.lastRenewError,
            }))}
            enableLive={flags.listenerLiveEnabled}
          />
        </SectionCard>
        <SectionCard
          title="Account safety summary"
          description="Per protected account: env, risk state, active locks, broker enforcement history."
        >
          <AccountTable rows={accountSummaries} />
        </SectionCard>
      </div>
    </AppShell>
  );
}

// ── Components ────────────────────────────────────────────────────────────────

function OverallStatusBanner({
  severity,
  alertCount,
}: {
  severity: SafetyAlertSeverity | "safe";
  alertCount: number;
}) {
  const cfg = {
    safe: {
      cls: "border-emerald-200 bg-emerald-50 text-emerald-900",
      label: "All safety checks passing",
      detail: "No active alerts. System is in safe mode.",
    },
    info: {
      cls: "border-sky-200 bg-sky-50 text-sky-900",
      label: "Informational",
      detail: `${alertCount} informational notice(s).`,
    },
    warning: {
      cls: "border-amber-200 bg-amber-50 text-amber-900",
      label: "Warnings present",
      detail: `${alertCount} warning(s) — review before any rollout.`,
    },
    critical: {
      cls: "border-red-300 bg-red-50 text-red-900",
      label: "CRITICAL",
      detail: `${alertCount} alert(s) — system is NOT in safe mode.`,
    },
  }[severity];
  return (
    <div className={`rounded-2xl border px-5 py-4 ${cfg.cls}`}>
      <p className="text-xs font-semibold uppercase tracking-[0.22em]">Overall</p>
      <p className="mt-1 text-lg font-semibold">{cfg.label}</p>
      <p className="mt-1 text-sm">{cfg.detail}</p>
    </div>
  );
}

function AlertsCard({ alerts }: { alerts: SafetyAlert[] }) {
  if (alerts.length === 0) {
    return (
      <SectionCard title="Alerts" description="No alerts.">
        <p className="text-sm text-stone-500">All clear.</p>
      </SectionCard>
    );
  }
  return (
    <SectionCard
      title="Alerts"
      description={`${alerts.length} alert(s) — newest critical first.`}
    >
      <ul className="grid gap-2">
        {alerts
          .slice()
          .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
          .map((a, i) => (
            <li
              key={`${a.code}-${i}`}
              className={`rounded-lg border px-3 py-2 text-sm ${SEVERITY_CLS[a.severity]}`}
            >
              <span className="font-semibold uppercase tracking-wider text-[10px]">
                {a.severity}
              </span>
              <span className="ml-2 font-mono text-[11px] opacity-70">{a.code}</span>
              <p className="mt-0.5">{a.message}</p>
            </li>
          ))}
      </ul>
    </SectionCard>
  );
}

const SEVERITY_RANK: Record<SafetyAlertSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

const SEVERITY_CLS: Record<SafetyAlertSeverity, string> = {
  critical: "border-red-300 bg-red-50 text-red-900",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
  info: "border-sky-200 bg-sky-50 text-sky-900",
};

function FlagsGrid({
  flags,
}: {
  flags: ReturnType<typeof readEnforcementFlagsFromEnv>;
}) {
  const items: Array<{ label: string; value: string; danger: boolean }> = [
    {
      label: "BROKER_ENFORCEMENT_ENABLED",
      value: String(flags.brokerEnforcementEnabled),
      danger: flags.brokerEnforcementEnabled,
    },
    {
      label: "TRADOVATE_LISTENER_ENABLE_LIVE",
      value: String(flags.listenerLiveEnabled),
      danger: flags.listenerLiveEnabled,
    },
    {
      label: "ENFORCEMENT_DRY_RUN",
      value: String(flags.dryRunEnabled),
      danger: !flags.dryRunEnabled && flags.brokerEnforcementEnabled,
    },
    {
      label: "GUARDRAIL_INTERNAL_LOCK_ENABLED",
      value: String(flags.internalLockEnabled),
      danger: false,
    },
    {
      label: "BROKER_ENFORCEMENT_SIMULATION_ENABLED",
      value: String(flags.simulationEnabled),
      danger: false,
    },
    {
      label: "BROKER_ENFORCEMENT_DEMO_ACCOUNT_ALLOWLIST",
      value: flags.allowlist.length > 0 ? flags.allowlist.join(", ") : "(empty)",
      danger: false,
    },
  ];
  return (
    <dl className="grid gap-2 sm:grid-cols-2">
      {items.map((item) => (
        <div
          key={item.label}
          className={`flex items-baseline justify-between gap-3 rounded-lg border px-3 py-2 text-xs ${
            item.danger
              ? "border-red-200 bg-red-50"
              : "border-stone-100 bg-stone-50"
          }`}
        >
          <dt className="font-mono font-medium text-stone-600">{item.label}</dt>
          <dd
            className={`font-mono ${item.danger ? "font-bold text-red-700" : "text-stone-900"}`}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function ListenerTable({
  rows,
  enableLive,
}: {
  rows: Array<{
    connectionId: string;
    env: string;
    connectionStatus: string;
    listenerStatus: string | null;
    lastEventAt: string | null;
    lastHeartbeatAt: string | null;
    lastCloseCode: number | null;
    lastCloseReason: string | null;
    tokenExpired: boolean;
    lastRenewError: string | null;
  }>;
  enableLive: boolean;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-stone-500">No broker connections.</p>;
  }
  return (
    <div className="grid gap-2 text-xs">
      {rows.map((r) => {
        const isLiveDanger = r.env === "live" && enableLive;
        return (
          <div
            key={r.connectionId}
            className={`rounded-lg border px-3 py-2 ${
              isLiveDanger
                ? "border-red-200 bg-red-50"
                : r.listenerStatus === "error" || r.listenerStatus === "closed"
                  ? "border-amber-200 bg-amber-50"
                  : "border-stone-100 bg-stone-50"
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="font-mono text-stone-700">
                …{r.connectionId.slice(-10)} · {r.env}
              </span>
              <span className="font-semibold">
                listener.status = {r.listenerStatus ?? "(null)"}
              </span>
            </div>
            <dl className="mt-1 grid gap-x-4 gap-y-0.5 text-[11px] text-stone-600 sm:grid-cols-2">
              <Row label="connection" value={r.connectionStatus} />
              <Row label="lastEventAt" value={r.lastEventAt ?? "—"} />
              <Row label="lastHeartbeatAt" value={r.lastHeartbeatAt ?? "—"} />
              <Row
                label="closeCode/Reason"
                value={`${r.lastCloseCode ?? "—"} / ${r.lastCloseReason ?? "—"}`}
              />
              <Row
                label="tokenExpired"
                value={r.tokenExpired ? "yes" : "no"}
                danger={r.tokenExpired}
              />
              <Row label="lastRenewError" value={r.lastRenewError ?? "—"} />
              <Row label="enableLive" value={String(enableLive)} danger={enableLive} />
            </dl>
          </div>
        );
      })}
    </div>
  );
}

function AccountTable({
  rows,
}: {
  rows: Array<{
    accountId: string;
    label: string;
    env: string | null;
    accountType: string;
    riskState: string | null;
    hasActiveInternalLock: boolean;
    activeLockCount: number;
    historicalBrokerEnforcementCount: number;
    latestBrokerLockStatus: string | null;
    hasHistoricalBrokerLockOnly: boolean;
  }>;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-stone-500">No protected accounts.</p>;
  }
  return (
    <div className="grid gap-2 text-xs">
      {rows.map((r) => {
        const cls = r.hasActiveInternalLock
          ? "border-amber-200 bg-amber-50"
          : r.hasHistoricalBrokerLockOnly
            ? "border-emerald-100 bg-emerald-50"
            : "border-stone-100 bg-stone-50";
        return (
          <div key={r.accountId} className={`rounded-lg border px-3 py-2 ${cls}`}>
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium text-stone-900">
                {r.label}{" "}
                <span className="font-mono text-[10px] text-stone-500">
                  …{r.accountId.slice(-10)}
                </span>
              </span>
              <span className="text-stone-700">
                env={r.env ?? "—"} · risk={r.riskState ?? "—"}
              </span>
            </div>
            <dl className="mt-1 grid gap-x-4 gap-y-0.5 text-[11px] text-stone-600 sm:grid-cols-2">
              <Row label="accountType" value={r.accountType} />
              <Row
                label="activeLockCount"
                value={String(r.activeLockCount)}
                danger={r.activeLockCount > 0}
              />
              <Row
                label="historicalEnforcements"
                value={String(r.historicalBrokerEnforcementCount)}
              />
              <Row
                label="latestBrokerLockStatus"
                value={r.latestBrokerLockStatus ?? "—"}
                danger={r.latestBrokerLockStatus === "broker_lock_failed"}
              />
              <Row
                label="hasHistoricalBrokerLockOnly"
                value={String(r.hasHistoricalBrokerLockOnly)}
              />
            </dl>
          </div>
        );
      })}
    </div>
  );
}

function Row({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="font-mono text-stone-500">{label}:</dt>
      <dd className={`font-mono ${danger ? "font-bold text-red-700" : "text-stone-700"}`}>
        {value}
      </dd>
    </div>
  );
}
