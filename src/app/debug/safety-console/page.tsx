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
  isAccountRolloutRelevant,
  isConnectionRolloutRelevant,
  readEnforcementFlagsFromEnv,
  resolveListenerFlags,
  type SafetyAlert,
  type SafetyAlertSeverity,
} from "@/lib/safety-console-helpers";

export const metadata: Metadata = {
  title: "Safety Console",
  robots: { index: false, follow: false },
};

const LISTENER_STALE_THRESHOLD_MS = 60_000;

// The listener-worker writes ListenerWorkerStatus once per reconcile loop
// (~every 60s). Allow a few missed cycles before treating the row as stale —
// a stale row is treated as "not exposed" so old flag values are never trusted.
const LISTENER_FLAGS_STALE_THRESHOLD_MS = 5 * 60_000;

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

  const [
    brokerConnections,
    accounts,
    activeLockRows,
    historicalEnforcements,
    listenerWorkerStatus,
  ] = await Promise.all([
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
          lastReconciliationAt: true,
          lastReconciliationTrigger: true,
          lastReconciliationStatus: true,
          lastReconciliationError: true,
          lastReconciledAccountCount: true,
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
          brokerConnectionId: true,
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
      prisma.listenerWorkerStatus.findUnique({ where: { id: "singleton" } }),
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

  const allowlistSet = new Set(flags.allowlist);

  // Map BrokerConnection.id → list of its protected accounts (for rollout-relevance).
  const accountsByConnection = new Map<string, typeof accounts>();
  for (const a of accounts) {
    if (!a.brokerConnectionId) continue;
    const list = accountsByConnection.get(a.brokerConnectionId) ?? [];
    list.push(a);
    accountsByConnection.set(a.brokerConnectionId, list);
  }

  // Per-connection rollout relevance — derived from account-level relevance.
  // A connection is only rollout-relevant when at least one of its accounts is
  // explicitly in scope: allowlisted, has active locks, or has enforcement history.
  const rolloutRelevantByConnection = new Map<string, boolean>();
  for (const c of brokerConnections) {
    const conAccounts = accountsByConnection.get(c.id) ?? [];
    const relevant = isConnectionRolloutRelevant({
      connectionStatus: c.connectionStatus,
      hasRolloutRelevantAccount: conAccounts.some((a) =>
        isAccountRolloutRelevant({
          isInAllowlist: allowlistSet.has(a.id),
          activeLockCount: activeLockCountByAccount.get(a.id) ?? 0,
          historicalEnforcementCount: historicalCountByAccount.get(a.id) ?? 0,
        }),
      ),
    });
    rolloutRelevantByConnection.set(c.id, relevant);
  }

  const accountSummaries = accounts.map((a) => {
    const latestHist = latestHistoricalByAccount.get(a.id);
    const histCount = historicalCountByAccount.get(a.id) ?? 0;
    const activeCount = activeLockCountByAccount.get(a.id) ?? 0;
    const hasActiveInternalLock = activeCount > 0;
    const isInAllowlist = allowlistSet.has(a.id);
    return {
      accountId: a.id,
      label: a.label,
      env: a.brokerConnection?.env ?? null,
      accountType: a.accountType,
      isActive: a.isActive,
      isInAllowlist,
      isRolloutRelevant: isAccountRolloutRelevant({
        isInAllowlist,
        activeLockCount: activeCount,
        historicalEnforcementCount: histCount,
      }),
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

  // Sort: active locks → broker_lock_failed → broker history (any) → allowlisted →
  // active protected → everything else.
  accountSummaries.sort((a, b) => priorityRank(a) - priorityRank(b));

  // Listener-worker env flags. The listener-worker runs as a separate Railway
  // service and mirrors its own enforcement env into the ListenerWorkerStatus
  // singleton row on every reconcile loop. resolveListenerFlags returns null
  // (→ "not exposed") when the row is missing or stale, so we never present a
  // stopped worker's old flag values as authoritative. These values — not the
  // web/app process.env — gate the critical broker-write safety alerts.
  const listenerFlags = resolveListenerFlags({
    record: listenerWorkerStatus
      ? {
          brokerEnforcementEnabled: listenerWorkerStatus.brokerEnforcementEnabled,
          listenerLiveEnabled: listenerWorkerStatus.listenerLiveEnabled,
          internalLockEnabled: listenerWorkerStatus.internalLockEnabled,
          dryRunEnabled: listenerWorkerStatus.dryRunEnabled,
          simulationEnabled: listenerWorkerStatus.simulationEnabled,
          allowlist: listenerWorkerStatus.demoAccountAllowlist,
          reportedAt: listenerWorkerStatus.reportedAt.toISOString(),
        }
      : null,
    now,
    staleThresholdMs: LISTENER_FLAGS_STALE_THRESHOLD_MS,
  });
  const listenerFlagsReportedAt = listenerWorkerStatus?.reportedAt ?? null;

  const alerts = deriveSafetyAlerts({
    webFlags: flags,
    listenerFlags,
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
      isRolloutRelevant: rolloutRelevantByConnection.get(c.id) ?? false,
    })),
    listenerStaleThresholdMs: LISTENER_STALE_THRESHOLD_MS,
    now,
  });

  const overallSeverity = deriveOverallSeverity(alerts);

  const listenerRows = brokerConnections.map((c) => ({
    connectionId: c.id,
    env: c.env,
    connectionStatus: c.connectionStatus,
    listenerStatus: c.listenerStatus,
    lastEventAt: c.listenerLastEventAt?.toISOString() ?? null,
    lastHeartbeatAt: c.listenerLastHeartbeatAt?.toISOString() ?? null,
    lastCloseCode: c.listenerLastCloseCode,
    lastCloseReason: c.listenerLastCloseReason,
    tokenExpired: c.tokenExpiresAt !== null && c.tokenExpiresAt.getTime() < now.getTime(),
    lastRenewError: c.lastRenewError,
    isRolloutRelevant: rolloutRelevantByConnection.get(c.id) ?? false,
    lastReconciliationAt: c.lastReconciliationAt?.toISOString() ?? null,
    lastReconciliationTrigger: c.lastReconciliationTrigger,
    lastReconciliationStatus: c.lastReconciliationStatus,
    lastReconciliationError: c.lastReconciliationError,
    lastReconciledAccountCount: c.lastReconciledAccountCount,
    reconciliationStale:
      c.listenerStatus === "connected" &&
      c.lastReconciliationAt !== null &&
      now.getTime() - c.lastReconciliationAt.getTime() > 10 * 60_000,
  }));
  const rolloutListeners = listenerRows.filter((r) => r.isRolloutRelevant);
  const otherListeners = listenerRows.filter((r) => !r.isRolloutRelevant);

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
          description="Web/app env values plus listener status. Listener-worker env values are shown only when explicitly exposed."
        >
          <div className="grid gap-4">
            <div>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500">
                Web/app runtime env
                <span className="ml-2 font-normal normal-case tracking-normal text-stone-400">
                  — read from this Next.js process. Does NOT reflect listener-worker.
                </span>
              </p>
              <FlagsGrid flags={flags} source="web" />
            </div>
            <div>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500">
                Listener-worker env (exposed by listener diagnostics)
                <span className="ml-2 font-normal normal-case tracking-normal text-stone-400">
                  — authoritative for broker write behaviour.
                </span>
              </p>
              {listenerFlags === null ? (
                <p className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-500">
                  Not exposed by listener status. The listener-worker is a separate Railway
                  service; its env state is not visible to the web/app runtime. Verify
                  <span className="mx-1 font-mono">TRADOVATE_LISTENER_ENABLE_LIVE</span>,
                  <span className="mx-1 font-mono">BROKER_ENFORCEMENT_ENABLED</span>, and
                  <span className="mx-1 font-mono">ENFORCEMENT_DRY_RUN</span>
                  directly in the listener-worker service before any rollout decision.
                </p>
              ) : (
                <div className="grid gap-2">
                  <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                    <span className="font-semibold">Listener-worker env verified.</span>{" "}
                    Flags below were reported by the listener-worker itself
                    {listenerFlagsReportedAt
                      ? ` at ${listenerFlagsReportedAt.toISOString()}`
                      : ""}
                    . These values — not the web/app env above — gate broker-write
                    safety alerts.
                  </p>
                  <FlagsGrid flags={listenerFlags} source="listener" />
                </div>
              )}
            </div>
          </div>
        </SectionCard>
        <SectionCard
          title="Listener health — rollout-relevant connections"
          description="Connections with at least one allowlisted, locked, or broker-enforced account. Only these affect overall severity. lastCloseCode/Reason is historical — current status is shown in the row header."
        >
          {rolloutListeners.length === 0 ? (
            <p className="text-sm text-stone-500">No rollout-relevant connections.</p>
          ) : (
            <ListenerTable rows={rolloutListeners} enableLive={flags.listenerLiveEnabled} />
          )}
        </SectionCard>
        <SectionCard
          title="Other connections (ignored for severity)"
          description="Expired, archived, or unused broker connections. Shown for reference only; status changes here do not affect overall safety."
        >
          {otherListeners.length === 0 ? (
            <p className="text-sm text-stone-500">No other connections.</p>
          ) : (
            <ListenerTable rows={otherListeners} enableLive={flags.listenerLiveEnabled} />
          )}
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

// ── Sort priority for account summary ─────────────────────────────────────────

type AccountSummary = {
  hasActiveInternalLock: boolean;
  latestBrokerLockStatus: string | null;
  historicalBrokerEnforcementCount: number;
  isInAllowlist: boolean;
  isActive: boolean;
};

function priorityRank(a: AccountSummary): number {
  if (a.hasActiveInternalLock) return 0;
  if (a.latestBrokerLockStatus === "broker_lock_failed") return 1;
  if (a.historicalBrokerEnforcementCount > 0) return 2;
  if (a.isInAllowlist) return 3;
  if (a.isActive) return 4;
  return 5;
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
  source,
}: {
  flags: ReturnType<typeof readEnforcementFlagsFromEnv>;
  /**
   * "web" — values from the web/app process.env. Informational only; these
   *   never imply listener-worker safety state, so dangerous values are not
   *   styled as critical.
   * "listener" — values explicitly exposed by listener-worker diagnostics.
   *   Dangerous values are highlighted because they reflect what gates the
   *   real broker writes.
   */
  source: "web" | "listener";
}) {
  const isListener = source === "listener";
  const items: Array<{ label: string; value: string; danger: boolean }> = [
    {
      label: "BROKER_ENFORCEMENT_ENABLED",
      value: String(flags.brokerEnforcementEnabled),
      danger: isListener && flags.brokerEnforcementEnabled,
    },
    {
      label: "TRADOVATE_LISTENER_ENABLE_LIVE",
      value: String(flags.listenerLiveEnabled),
      danger: isListener && flags.listenerLiveEnabled,
    },
    {
      label: "ENFORCEMENT_DRY_RUN",
      value: String(flags.dryRunEnabled),
      danger: isListener && !flags.dryRunEnabled && flags.brokerEnforcementEnabled,
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
    isRolloutRelevant: boolean;
    lastReconciliationAt: string | null;
    lastReconciliationTrigger: string | null;
    lastReconciliationStatus: string | null;
    lastReconciliationError: string | null;
    lastReconciledAccountCount: number | null;
    reconciliationStale: boolean;
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
        const isUnhealthy =
          r.listenerStatus === "error" || r.listenerStatus === "closed";
        const cls = !r.isRolloutRelevant
          ? "border-stone-100 bg-stone-50 opacity-70"
          : isLiveDanger
            ? "border-red-200 bg-red-50"
            : isUnhealthy
              ? "border-amber-200 bg-amber-50"
              : "border-stone-100 bg-stone-50";
        return (
          <div key={r.connectionId} className={`rounded-lg border px-3 py-2 ${cls}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono text-stone-700">
                …{r.connectionId.slice(-10)} · {r.env}
              </span>
              <div className="flex flex-wrap items-center gap-2">
                {r.isRolloutRelevant ? (
                  <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-700">
                    Rollout target
                  </span>
                ) : (
                  <span className="rounded-full bg-stone-200 px-2 py-0.5 text-[10px] font-semibold text-stone-600">
                    Not in rollout scope
                  </span>
                )}
                <span className="font-semibold">
                  listener.status = {r.listenerStatus ?? "(null)"}
                </span>
              </div>
            </div>
            <dl className="mt-1 grid gap-x-4 gap-y-0.5 text-[11px] text-stone-600 sm:grid-cols-2">
              <Row label="connection" value={r.connectionStatus} />
              <Row label="lastEventAt" value={r.lastEventAt ?? "—"} />
              <Row label="lastHeartbeatAt" value={r.lastHeartbeatAt ?? "—"} />
              <Row
                label="lastCloseCode/Reason"
                value={`${r.lastCloseCode ?? "—"} / ${r.lastCloseReason ?? "—"}`}
              />
              <Row
                label="tokenExpired"
                value={r.tokenExpired ? "yes" : "no"}
                danger={r.tokenExpired}
              />
              <Row label="lastRenewError" value={r.lastRenewError ?? "—"} />
              <Row label="enableLive" value={String(enableLive)} danger={enableLive} />
              <Row
                label="reconciledAt"
                value={r.lastReconciliationAt ?? "—"}
                danger={r.reconciliationStale}
              />
              <Row
                label="reconcileTrigger"
                value={r.lastReconciliationTrigger ?? "—"}
              />
              <Row
                label="reconcileStatus"
                value={r.lastReconciliationStatus ?? "—"}
                danger={r.lastReconciliationStatus === "failed"}
              />
              <Row
                label="reconcileAccounts"
                value={
                  r.lastReconciledAccountCount !== null
                    ? String(r.lastReconciledAccountCount)
                    : "—"
                }
              />
              {r.lastReconciliationError && (
                <Row
                  label="reconcileError"
                  value={r.lastReconciliationError}
                  danger
                />
              )}
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
    isActive: boolean;
    isInAllowlist: boolean;
    isRolloutRelevant: boolean;
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
  // Only show accounts that are explicitly in rollout scope: allowlisted,
  // active lock, or enforcement history. Generic active-protected accounts
  // are hidden to avoid noise.
  const visibleRows = rows.filter((r) => r.isRolloutRelevant);
  const hiddenCount = rows.length - visibleRows.length;
  return (
    <div className="grid gap-2 text-xs">
      {visibleRows.map((r) => {
        const cls = r.hasActiveInternalLock
          ? "border-amber-200 bg-amber-50"
          : r.latestBrokerLockStatus === "broker_lock_failed"
            ? "border-red-200 bg-red-50"
            : r.hasHistoricalBrokerLockOnly
              ? "border-emerald-100 bg-emerald-50"
              : !r.isActive
                ? "border-stone-100 bg-stone-50 opacity-70"
                : "border-stone-100 bg-stone-50";
        const labels: string[] = [];
        if (r.isInAllowlist) labels.push("Rollout target");
        if (r.hasActiveInternalLock) labels.push("Active lock");
        else if (r.hasHistoricalBrokerLockOnly) labels.push("Historical broker audit only");
        if (!r.isActive) labels.push("Inactive");
        if (r.isInAllowlist && !r.hasActiveInternalLock) labels.push("No active lock");
        return (
          <div key={r.accountId} className={`rounded-lg border px-3 py-2 ${cls}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium text-stone-900">
                {r.label}{" "}
                <span className="font-mono text-[10px] text-stone-500">
                  …{r.accountId.slice(-10)}
                </span>
              </span>
              <div className="flex flex-wrap items-center gap-2">
                {labels.map((label) => (
                  <span
                    key={label}
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${LABEL_CLS[label] ?? "bg-stone-200 text-stone-700"}`}
                  >
                    {label}
                  </span>
                ))}
                <span className="text-stone-700">
                  env={r.env ?? "—"} · risk={r.riskState ?? "—"}
                </span>
              </div>
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
      {hiddenCount > 0 && (
        <p className="text-[11px] italic text-stone-400">
          + {hiddenCount} account(s) hidden — active protected but no allowlist, lock, or enforcement history.
        </p>
      )}
    </div>
  );
}

const LABEL_CLS: Record<string, string> = {
  "Rollout target": "bg-sky-100 text-sky-700",
  "Active lock": "bg-amber-200 text-amber-900",
  "Historical broker audit only": "bg-emerald-100 text-emerald-700",
  "Inactive": "bg-stone-200 text-stone-600",
  "No active lock": "bg-emerald-100 text-emerald-700",
};

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
