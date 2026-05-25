import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";

import { AppShell } from "@/components/ui/app-shell";
import { SectionCard } from "@/components/ui/section-card";
import { getCurrentUser } from "@/lib/auth";
import { isAdminEmail } from "@/lib/subscription";
import { prisma } from "@/lib/db";
import {
  deriveOverallSeverity,
  deriveRolloutReadiness,
  deriveSafetyAlerts,
  isAccountRolloutRelevant,
  isConnectionRolloutRelevant,
  readEnforcementFlagsFromEnv,
  resolveListenerFlags,
  type RolloutReadiness,
  type SafetyAlert,
  type SafetyAlertSeverity,
} from "@/lib/safety-console-helpers";
import { canApplyInternalLock, buildInternalLockDedupKey } from "@/lib/guardian-engine/internal-lock-evaluator";
import { evaluateDryRunRules } from "@/lib/guardian-engine/dry-run-rule-evaluator";
import { hasValidConsent, resolveConsentForAccount, AUTOMATED_ACTIONS_CONSENT_VERSION } from "@/lib/brokers/automated-actions-consent";
import { parseTradovateMasterId } from "@/lib/brokers/tradovate-master-id";
import { parseBrokerEnforcementAllowlist } from "@/lib/guardian-engine/broker-enforcement-gate";

export const metadata: Metadata = {
  title: "Safety Console",
  robots: { index: false, follow: false },
};

const LISTENER_STALE_THRESHOLD_MS = 60_000;
const LISTENER_FLAGS_STALE_THRESHOLD_MS = 5 * 60_000;

const DEMO7_ACCOUNT_ID = "cmottd1z200020do1knjxq582";
const DEMO7_EXTERNAL_ID = "DEMO7433035";
const EXPECTED_LISTENER_COMMIT = "dc11d46";

const NON_LIVE_CONNECTION_STATUSES_SET = new Set([
  "expired",
  "connection_error",
  "not_connected",
  "pending_webhook",
  "oauth_pending_storage",
]);

// ── Activation readiness types (mirrors daily-loss-activation-candidates route) ──

type ActivationReadinessStatus = "candidate" | "preview_required" | "blocked";

type ActivationReadinessPhase =
  | "blocked_not_demo"
  | "blocked_account_inactive"
  | "blocked_missing_from_broker"
  | "blocked_connection_not_live"
  | "blocked_not_full_access"
  | "blocked_invalid_external_account_id"
  | "blocked_no_daily_loss_rule"
  | "blocked_guardian_inactive"
  | "blocked_missing_consent"
  | "blocked_existing_locked_autoliq"
  | "preview_required"
  | "candidate_for_demo_activation";

type AccountActivationReadiness = {
  status: ActivationReadinessStatus;
  phase: ActivationReadinessPhase;
  blockers: string[];
  nextSafeAction: string;
};

function deriveActivationReadiness(params: {
  platform: string;
  env: string | null;
  isActive: boolean;
  missingFromBrokerSince: Date | null;
  connectionStatus: string | null;
  permissionLevel: string | null;
  validExternalAccountId: boolean;
  maxDailyLoss: number | null;
  guardianEnabled: boolean;
  consentValid: boolean;
  hasGuardrailOwnedWrite: boolean;
  previewExists: boolean;
  existingChangesLocked: boolean | null;
}): AccountActivationReadiness {
  if (params.platform !== "tradovate" || params.env !== "demo") {
    return {
      status: "blocked", phase: "blocked_not_demo",
      blockers: [params.platform !== "tradovate" ? "platform_not_tradovate" : "env_not_demo"],
      nextSafeAction: "Not a Tradovate demo account — not eligible for Daily Loss enforcement.",
    };
  }
  if (!params.isActive) {
    return { status: "blocked", phase: "blocked_account_inactive", blockers: ["account_inactive"], nextSafeAction: "Activate the account." };
  }
  if (params.missingFromBrokerSince != null) {
    return { status: "blocked", phase: "blocked_missing_from_broker", blockers: ["account_missing_from_broker"], nextSafeAction: "Reconnect or re-provision." };
  }
  const connStatus = params.connectionStatus ?? "not_connected";
  if (NON_LIVE_CONNECTION_STATUSES_SET.has(connStatus)) {
    return { status: "blocked", phase: "blocked_connection_not_live", blockers: [`connection_status_${connStatus}`], nextSafeAction: `Reconnect the broker connection (status: ${connStatus}).` };
  }
  if (params.permissionLevel !== "full_access") {
    return { status: "blocked", phase: "blocked_not_full_access", blockers: [`permission_level_${params.permissionLevel ?? "null"}`], nextSafeAction: "Re-authenticate with 'Account Risk Settings: Full Access'." };
  }
  if (!params.validExternalAccountId) {
    return { status: "blocked", phase: "blocked_invalid_external_account_id", blockers: ["invalid_external_account_id"], nextSafeAction: "Re-sync the account to populate a valid Tradovate masterid." };
  }
  if (params.maxDailyLoss == null || params.maxDailyLoss <= 0) {
    return { status: "blocked", phase: "blocked_no_daily_loss_rule", blockers: ["max_daily_loss_not_positive"], nextSafeAction: "Configure a positive maxDailyLoss rule." };
  }
  if (!params.guardianEnabled) {
    return { status: "blocked", phase: "blocked_guardian_inactive", blockers: ["guardian_inactive"], nextSafeAction: "Enable Guardian for this user." };
  }
  if (!params.consentValid) {
    return {
      status: "blocked", phase: "blocked_missing_consent", blockers: ["missing_or_stale_automated_actions_consent"],
      nextSafeAction: `User must confirm automated-actions consent (version '${AUTOMATED_ACTIONS_CONSENT_VERSION}').`,
    };
  }
  if (params.previewExists && params.existingChangesLocked === true && !params.hasGuardrailOwnedWrite) {
    return {
      status: "blocked", phase: "blocked_existing_locked_autoliq",
      blockers: ["preexisting_locked_autoliq_not_guardrail_owned"],
      nextSafeAction: "Do not run apply=true. Use a clean demo account or investigate the existing AutoLiq record.",
    };
  }
  if (!params.previewExists) {
    return {
      status: "preview_required", phase: "preview_required", blockers: [],
      nextSafeAction: "Run GET /api/debug/broker-enforcement/daily-loss-recovery-probe?mode=read_only to populate AutoLiq state.",
    };
  }
  return {
    status: "candidate", phase: "candidate_for_demo_activation", blockers: [],
    nextSafeAction: "Ready. Add to BROKER_ENFORCEMENT_DEMO_ACCOUNT_ALLOWLIST and set BROKER_ENFORCEMENT_ENABLED=true. Review ENFORCEMENT_DRY_RUN first.",
  };
}

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
  const today = now.toISOString().slice(0, 10);

  const [
    brokerConnections,
    accounts,
    activeLockRows,
    historicalEnforcements,
    listenerWorkerStatus,
    ruleChangeAuditRows,
    brokerSyncAuditRows,
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
      prisma.ruleChangeAudit.findMany({
        orderBy: [{ allowed: "asc" }, { createdAt: "desc" }],
        take: 20,
        select: {
          id: true,
          scope: true,
          allowed: true,
          reason: true,
          blockReason: true,
          sessionRiskState: true,
          hasOpenPosition: true,
          createdAt: true,
          user: { select: { email: true } },
          account: { select: { label: true } },
        },
      }).catch(() => [] as never[]),
      prisma.brokerRiskSettingsSyncAudit.findMany({
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          broker: true,
          ruleType: true,
          amount: true,
          environment: true,
          dryRun: true,
          brokerEnforcementEnabled: true,
          outcome: true,
          gateFailureReason: true,
          skipReason: true,
          payloadPreviewJson: true,
          brokerResponseJson: true,
          errorMessage: true,
          createdAt: true,
          account: { select: { label: true, externalAccountId: true } },
        },
      }).catch(() => [] as never[]),
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

  const accountsByConnection = new Map<string, typeof accounts>();
  for (const a of accounts) {
    if (!a.brokerConnectionId) continue;
    const list = accountsByConnection.get(a.brokerConnectionId) ?? [];
    list.push(a);
    accountsByConnection.set(a.brokerConnectionId, list);
  }

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

  accountSummaries.sort((a, b) => priorityRank(a) - priorityRank(b));

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

  const connectionByAccountId = new Map<
    string,
    { listenerStatus: string | null; lastReconciliationStatus: string | null }
  >();
  for (const a of accounts) {
    if (!a.brokerConnectionId) continue;
    const conn = brokerConnections.find((c) => c.id === a.brokerConnectionId);
    if (conn) {
      connectionByAccountId.set(a.id, {
        listenerStatus: conn.listenerStatus,
        lastReconciliationStatus: conn.lastReconciliationStatus,
      });
    }
  }

  const brokerLockFailedCountByAccount = new Map<string, number>();
  for (const h of historicalEnforcements) {
    if (h.brokerLockStatus === "broker_lock_failed") {
      brokerLockFailedCountByAccount.set(
        h.accountId,
        (brokerLockFailedCountByAccount.get(h.accountId) ?? 0) + 1,
      );
    }
  }

  const rolloutReadiness: RolloutReadiness[] = accountSummaries
    .filter((a) => a.isRolloutRelevant)
    .map((a) => {
      const connData = connectionByAccountId.get(a.accountId);
      return deriveRolloutReadiness({
        account: {
          accountId: a.accountId,
          label: a.label,
          connectionEnv: a.env,
          isInAllowlist: a.isInAllowlist,
          activeLockCount: a.activeLockCount,
          brokerLockFailedCount: brokerLockFailedCountByAccount.get(a.accountId) ?? 0,
          listenerStatus: connData?.listenerStatus ?? null,
          lastReconciliationStatus: connData?.lastReconciliationStatus ?? null,
        },
        listenerFlags,
      });
    });

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

  // ── Additional queries: DEMO7 diagnostic + activation candidates ──────────────
  const [demo7Account, demo7LockEvents, allAccountsFull, allPreviewAudits, allWriteAudits] =
    await Promise.all([
      prisma.connectedAccount.findFirst({
        where: { id: DEMO7_ACCOUNT_ID },
        select: {
          id: true,
          userId: true,
          label: true,
          externalAccountId: true,
          isActive: true,
          protectionStatus: true,
          brokerConnectionId: true,
          brokerConnection: {
            select: { env: true, connectionStatus: true, permissionLevel: true },
          },
          sessionState: {
            select: {
              riskState: true,
              dailyPnl: true,
              tradesCount: true,
              tradeCountSource: true,
              consecutiveLosses: true,
              sessionDate: true,
            },
          },
          riskRules: {
            select: { maxDailyLoss: true, maxTradesPerDay: true, stopAfterLosses: true },
          },
        },
      }),
      prisma.internalLockEvent.findMany({
        where: { accountId: DEMO7_ACCOUNT_ID },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          ruleType: true,
          tradingDay: true,
          activeDedupKey: true,
          clearedAt: true,
          createdAt: true,
          internalOnly: true,
          brokerActionTaken: true,
        },
      }).catch(() => [] as never[]),
      prisma.connectedAccount.findMany({
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          label: true,
          externalAccountId: true,
          platform: true,
          isActive: true,
          missingFromBrokerSince: true,
          userId: true,
          protectionStatus: true,
          accountType: true,
          brokerConnection: {
            select: { env: true, connectionStatus: true, permissionLevel: true },
          },
          sessionState: { select: { riskState: true } },
          riskRules: {
            select: {
              maxDailyLoss: true,
              automatedActionsConsentAt: true,
              automatedActionsConsentVersion: true,
            },
          },
          user: {
            select: {
              guardianProfile: { select: { guardianEnabled: true } },
              riskRules: {
                select: {
                  maxDailyLoss: true,
                  automatedActionsConsentAt: true,
                  automatedActionsConsentVersion: true,
                },
              },
            },
          },
        },
      }),
      prisma.brokerRiskSettingsSyncAudit.findMany({
        where: { outcome: "preview", ruleType: "daily_loss_recovery_probe" },
        orderBy: { createdAt: "desc" },
        take: 500,
        select: { id: true, accountId: true, createdAt: true, payloadPreviewJson: true },
      }).catch(() => [] as never[]),
      prisma.brokerRiskSettingsSyncAudit.findMany({
        where: { outcome: "success", ruleType: { in: ["daily_loss_limit", "daily_loss_recovery_probe"] } },
        orderBy: { createdAt: "desc" },
        take: 500,
        select: { id: true, accountId: true, ruleType: true, brokerResponseJson: true, createdAt: true },
      }).catch(() => [] as never[]),
    ]);

  // ── Index preview/write audits ────────────────────────────────────────────────
  const latestPreviewByAccount = new Map<string, (typeof allPreviewAudits)[number]>();
  for (const row of allPreviewAudits) {
    if (row.accountId && !latestPreviewByAccount.has(row.accountId)) {
      latestPreviewByAccount.set(row.accountId, row);
    }
  }
  const writesByAccount = new Map<string, typeof allWriteAudits>();
  for (const row of allWriteAudits) {
    if (!row.accountId) continue;
    const existing = writesByAccount.get(row.accountId) ?? [];
    existing.push(row);
    writesByAccount.set(row.accountId, existing);
  }

  // ── Build activation candidates ───────────────────────────────────────────────
  const allowlistIdsForCandidates = parseBrokerEnforcementAllowlist(
    process.env.BROKER_ENFORCEMENT_DEMO_ACCOUNT_ALLOWLIST,
  );

  const allAccountsWithReadiness = allAccountsFull.map((account) => {
    const accountRuleConsent = account.riskRules
      ? { consentAt: account.riskRules.automatedActionsConsentAt, consentVersion: account.riskRules.automatedActionsConsentVersion }
      : null;
    const defaultRuleConsent = account.user?.riskRules
      ? { consentAt: account.user.riskRules.automatedActionsConsentAt, consentVersion: account.user.riskRules.automatedActionsConsentVersion }
      : null;
    const { state: resolvedConsent } = resolveConsentForAccount({
      accountRiskRules: accountRuleConsent,
      defaultRiskRules: defaultRuleConsent,
    });
    const consentValid = hasValidConsent(resolvedConsent);
    const maxDailyLoss =
      account.riskRules?.maxDailyLoss != null ? Number(account.riskRules.maxDailyLoss)
      : account.user?.riskRules?.maxDailyLoss != null ? Number(account.user.riskRules.maxDailyLoss)
      : null;
    const env = account.brokerConnection?.env ?? null;
    const connectionStatus = account.brokerConnection?.connectionStatus ?? null;
    const permissionLevel = account.brokerConnection?.permissionLevel ?? null;
    const validExternalAccountId = parseTradovateMasterId(account.externalAccountId) !== null;
    const previewRow = latestPreviewByAccount.get(account.id) ?? null;
    const writeRows = writesByAccount.get(account.id) ?? [];
    const hasGuardrailOwnedWrite = writeRows.some((r) => r.brokerResponseJson != null);
    let existingChangesLocked: boolean | null = null;
    if (previewRow) {
      const payload = previewRow.payloadPreviewJson as Record<string, unknown> | null;
      const existing = payload?.existing as Record<string, unknown> | null | undefined;
      existingChangesLocked = existing != null && typeof existing.changesLocked === "boolean" ? existing.changesLocked : null;
    }
    const guardianEnabled = account.user?.guardianProfile?.guardianEnabled ?? true;
    const readiness = deriveActivationReadiness({
      platform: account.platform,
      env,
      isActive: account.isActive,
      missingFromBrokerSince: account.missingFromBrokerSince,
      connectionStatus,
      permissionLevel,
      validExternalAccountId,
      maxDailyLoss,
      guardianEnabled,
      consentValid,
      hasGuardrailOwnedWrite,
      previewExists: previewRow != null,
      existingChangesLocked,
    });
    const canUseForRecoveryProbePreview =
      env === "demo" &&
      connectionStatus !== null &&
      !NON_LIVE_CONNECTION_STATUSES_SET.has(connectionStatus) &&
      permissionLevel === "full_access" &&
      validExternalAccountId &&
      account.missingFromBrokerSince == null;
    return {
      id: account.id,
      label: account.label,
      externalAccountId: account.externalAccountId,
      platform: account.platform as string,
      env,
      connectionStatus,
      permissionLevel,
      isActive: account.isActive,
      protectionStatus: account.protectionStatus,
      accountType: account.accountType as string,
      riskState: account.sessionState?.riskState ?? null,
      allowlisted: allowlistIdsForCandidates.includes(account.id),
      maxDailyLoss,
      guardianEnabled,
      consentValid,
      validExternalAccountId,
      canUseForRecoveryProbePreview,
      readiness,
    };
  });

  const demoCandidates = allAccountsWithReadiness.filter((a) => a.env === "demo");
  const candidateCount = demoCandidates.filter((a) => a.readiness.status === "candidate").length;
  const previewRequiredCount = demoCandidates.filter((a) => a.readiness.status === "preview_required").length;
  const blockedCount = demoCandidates.filter((a) => a.readiness.status === "blocked").length;

  // ── DEMO7 internal-lock diagnostic ────────────────────────────────────────────
  type Demo7Diagnosis = {
    canLock: boolean;
    skipReasons: string[];
    violations: ReturnType<typeof evaluateDryRunRules>["violations"];
    wouldCreateLock: boolean;
    computedDedupKey: string | null;
    riskState: string | null;
    dailyPnl: number | null;
    maxDailyLoss: number | null;
    tradingDay: string;
    env: string;
    activeLockCount: number;
    totalLockCount: number;
  };

  let demo7Diagnosis: Demo7Diagnosis | null = null;

  if (demo7Account) {
    const session7 = demo7Account.sessionState;
    const rules7 = demo7Account.riskRules;
    const env7 = demo7Account.brokerConnection?.env ?? "live";
    const skipReasons7: string[] = [];
    if (!demo7Account.isActive) skipReasons7.push("isActive=false");
    if (demo7Account.protectionStatus !== "protected") skipReasons7.push(`protectionStatus="${demo7Account.protectionStatus}"`);
    if (!session7) skipReasons7.push("no LiveSessionState row");
    if (!rules7) skipReasons7.push("no AccountRiskRules row");
    const canLock7 = session7 != null && rules7 != null
      ? canApplyInternalLock({ env: env7, riskState: session7.riskState, flagEnabled: true })
      : false;
    if (session7 && rules7 && !canLock7) {
      if (env7 !== "demo") skipReasons7.push(`env="${env7}" (must be "demo")`);
      if (session7.riskState === "STOPPED") skipReasons7.push('riskState="STOPPED" (already locked — idempotent skip)');
    }
    const tradingDay7 = session7?.sessionDate ?? today;
    let violations7: ReturnType<typeof evaluateDryRunRules>["violations"] = [];
    if (session7 && rules7) {
      violations7 = evaluateDryRunRules({
        accountId: demo7Account.id,
        userId: demo7Account.userId,
        externalAccountId: demo7Account.externalAccountId ?? null,
        env: env7,
        tradingDay: tradingDay7,
        dailyPnl: Number(session7.dailyPnl),
        tradesCount: session7.tradesCount,
        tradeCountSource: session7.tradeCountSource,
        consecutiveLosses: session7.consecutiveLosses,
        maxDailyLoss: rules7.maxDailyLoss != null ? Number(rules7.maxDailyLoss) : null,
        maxTradesPerDay: rules7.maxTradesPerDay ?? null,
        stopAfterLosses: rules7.stopAfterLosses ?? null,
        dailyProfitTarget: null,
      }).violations;
    }
    const primaryViolation7 = violations7[0] ?? null;
    const computedDedupKey7 = primaryViolation7
      ? buildInternalLockDedupKey(demo7Account.id, primaryViolation7.ruleType, tradingDay7)
      : null;
    const wouldCreateLock7 =
      demo7Account.isActive &&
      demo7Account.protectionStatus === "protected" &&
      session7 != null &&
      rules7 != null &&
      canLock7 &&
      violations7.length > 0;
    const activeLockCount7 = demo7LockEvents.filter((e) => e.clearedAt == null).length;
    demo7Diagnosis = {
      canLock: canLock7,
      skipReasons: skipReasons7,
      violations: violations7,
      wouldCreateLock: wouldCreateLock7,
      computedDedupKey: computedDedupKey7,
      riskState: session7?.riskState ?? null,
      dailyPnl: session7 != null ? Number(session7.dailyPnl) : null,
      maxDailyLoss: rules7?.maxDailyLoss != null ? Number(rules7.maxDailyLoss) : null,
      tradingDay: tradingDay7,
      env: env7,
      activeLockCount: activeLockCount7,
      totalLockCount: demo7LockEvents.length,
    };
  }

  // ── DEMO7 connection lookup ───────────────────────────────────────────────────
  const demo7ConnectionId = demo7Account?.brokerConnectionId ?? null;
  const demo7ListenerStatus = demo7ConnectionId
    ? (brokerConnections.find((c) => c.id === demo7ConnectionId)?.listenerStatus ?? null)
    : null;

  // ── Sort broker sync rows: DEMO7 first, then newest ──────────────────────────
  const sortedBrokerSyncRows = [...brokerSyncAuditRows].sort((a, b) => {
    const aIsDemo7 = a.account?.externalAccountId === DEMO7_EXTERNAL_ID ? 0 : 1;
    const bIsDemo7 = b.account?.externalAccountId === DEMO7_EXTERNAL_ID ? 0 : 1;
    if (aIsDemo7 !== bIsDemo7) return aIsDemo7 - bIsDemo7;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });

  return (
    <AppShell
      eyebrow="Admin · Internal"
      title="Safety Console"
      description="Read-only operational view of listener health, enforcement flags, and per-account safety state. No writes, no broker calls."
      note="Admin-only. Audit IDs are visible here intentionally."
    >
      <div className="grid gap-6">
        <SafetyCopyBanner />
        <QaTargetFocusCard
          demo7Diagnosis={demo7Diagnosis}
          demo7ConnectionId={demo7ConnectionId}
          demo7ListenerStatus={demo7ListenerStatus}
        />
        <div id="qa-status">
          <QaStatusCard
            demo7Diagnosis={demo7Diagnosis}
            demo7LockEvents={demo7LockEvents}
          />
        </div>
        <OverallStatusBanner severity={overallSeverity} alertCount={alerts.length} />
        <AlertsCard alerts={alerts} />
        <div id="internal-lock">
          <InternalLockDiagnosticSection
            demo7Account={demo7Account ?? null}
            diagnosis={demo7Diagnosis}
            lockEvents={demo7LockEvents}
          />
        </div>
        <div id="rollout-readiness">
          <RolloutReadinessSection items={rolloutReadiness} />
        </div>
        <DailyLossActivationCandidatesSection
          demoCandidates={demoCandidates}
          candidateCount={candidateCount}
          previewRequiredCount={previewRequiredCount}
          blockedCount={blockedCount}
        />
        <SectionCard
          title="Enforcement safety flags"
          description="Web/app env values (informational) and listener-worker env (authoritative). These are separate Railway services with independent env vars."
        >
          <div className="grid gap-4">
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500">
                Web/app runtime env
                <span className="ml-2 font-normal normal-case tracking-normal text-stone-400">
                  — read from this Next.js process only. Does NOT control listener-worker behavior.
                </span>
              </p>
              <p className="mb-2 rounded border border-stone-200 bg-stone-50 px-2 py-1 text-[10px] text-stone-500">
                GUARDRAIL_INTERNAL_LOCK_ENABLED shown here reflects the web/app process only.
                The listener-worker controls C1 internal-lock behavior independently via its own env.
                If listener reports true below while this shows false, the listener value is authoritative.
              </p>
              <FlagsGrid flags={flags} source="web" />
            </div>
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500">
                Listener-worker env
                <span className="ml-2 font-normal normal-case tracking-normal text-stone-400">
                  — authoritative for C1 internal-lock, C2/C3 broker-write behavior.
                </span>
              </p>
              {listenerFlags === null ? (
                <p className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-500">
                  Not exposed by listener status row. The listener-worker is a separate Railway
                  service; its env is not visible to the web/app runtime. Verify
                  <span className="mx-1 font-mono">TRADOVATE_LISTENER_ENABLE_LIVE</span>,
                  <span className="mx-1 font-mono">BROKER_ENFORCEMENT_ENABLED</span>, and
                  <span className="mx-1 font-mono">GUARDRAIL_INTERNAL_LOCK_ENABLED</span>
                  directly in the listener-worker Railway service before any rollout decision.
                </p>
              ) : (
                <div className="grid gap-2">
                  <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                    <span className="font-semibold">Listener-worker env verified (authoritative).</span>{" "}
                    These flags were reported by the listener-worker itself
                    {listenerFlagsReportedAt
                      ? ` at ${listenerFlagsReportedAt.toISOString()}`
                      : ""}
                    . They control C1 internal-lock (GUARDRAIL_INTERNAL_LOCK_ENABLED) and C2/C3 broker
                    writes (BROKER_ENFORCEMENT_ENABLED). Ignore the web-process values above for rollout decisions.
                  </p>
                  <FlagsGrid flags={listenerFlags} source="listener" />
                </div>
              )}
            </div>
          </div>
        </SectionCard>
        <SectionCard
          title="Listener health — rollout-relevant connections"
          description="Connections with at least one allowlisted, locked, or broker-enforced account. Only these affect overall severity."
        >
          {rolloutListeners.length === 0 ? (
            <p className="text-sm text-stone-500">No rollout-relevant connections.</p>
          ) : (
            <ListenerTable rows={rolloutListeners} enableLive={flags.listenerLiveEnabled} />
          )}
        </SectionCard>
        <SectionCard
          title="Other connections (ignored for severity)"
          description="Expired, archived, or unused broker connections. Shown for reference only."
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
        <FullAccountTable rows={allAccountsWithReadiness} />
        <RuleChangeAuditSection rows={ruleChangeAuditRows} />
        <div id="broker-sync">
          <BrokerSyncAuditSection rows={sortedBrokerSyncRows} />
        </div>
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

function SafetyCopyBanner() {
  return (
    <div className="rounded-2xl border border-stone-300 bg-stone-100 px-5 py-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-stone-500">Operator safety notice</p>
      <p className="mt-1 text-sm font-semibold text-stone-800">
        Read-only console. This page does not write to Tradovate.
      </p>
      <ul className="mt-2 grid gap-0.5 text-xs text-stone-600">
        <li>• Broker write buttons are intentionally absent.</li>
        <li>• Do not enable C2/C3 until C1 rerun passes.</li>
        <li>• All enforcement changes must go through env vars on the listener-worker Railway service.</li>
        <li>• This page reads DB state only — listener-worker state is shown only when explicitly exposed via ListenerWorkerStatus.</li>
      </ul>
    </div>
  );
}

type Demo7LockEvent = {
  id: string;
  ruleType: string;
  tradingDay: string;
  activeDedupKey: string | null;
  clearedAt: Date | null;
  createdAt: Date;
  internalOnly: boolean;
  brokerActionTaken: boolean;
};

type Demo7DiagnosisType = {
  canLock: boolean;
  skipReasons: string[];
  violations: ReturnType<typeof evaluateDryRunRules>["violations"];
  wouldCreateLock: boolean;
  computedDedupKey: string | null;
  riskState: string | null;
  dailyPnl: number | null;
  maxDailyLoss: number | null;
  tradingDay: string;
  env: string;
  activeLockCount: number;
  totalLockCount: number;
} | null;

function QaTargetFocusCard({
  demo7Diagnosis,
  demo7ConnectionId,
  demo7ListenerStatus,
}: {
  demo7Diagnosis: Demo7DiagnosisType;
  demo7ConnectionId: string | null;
  demo7ListenerStatus: string | null;
}) {
  const c1Label = demo7Diagnosis
    ? demo7Diagnosis.activeLockCount > 0
      ? "C1: PASS"
      : "C1: PENDING"
    : "C1: UNKNOWN";
  const c1Color = c1Label.includes("PASS") ? "text-emerald-700" : c1Label.includes("PENDING") ? "text-amber-700" : "text-red-700";

  return (
    <div className="rounded-2xl border border-sky-200 bg-sky-50 px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-sky-600">Current QA target</p>
          <p className="mt-0.5 text-base font-semibold text-sky-900">{DEMO7_EXTERNAL_ID}</p>
          <dl className="mt-2 grid gap-x-4 gap-y-0.5 text-[11px] text-sky-800 sm:grid-cols-2">
            <div className="flex gap-1.5">
              <dt className="font-mono text-sky-600">accountId:</dt>
              <dd className="font-mono">{DEMO7_ACCOUNT_ID}</dd>
            </div>
            {demo7ConnectionId && (
              <div className="flex gap-1.5">
                <dt className="font-mono text-sky-600">connectionId:</dt>
                <dd className="font-mono">…{demo7ConnectionId.slice(-10)}</dd>
              </div>
            )}
            {demo7ListenerStatus && (
              <div className="flex gap-1.5">
                <dt className="font-mono text-sky-600">listenerStatus:</dt>
                <dd className="font-mono">{demo7ListenerStatus}</dd>
              </div>
            )}
          </dl>
          <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-800">rule-save: PASS</span>
            <span className={`rounded-full px-2 py-0.5 font-semibold ${c1Label.includes("PASS") ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"}`}>{c1Label}</span>
            <span className="rounded-full bg-red-100 px-2 py-0.5 font-semibold text-red-800">C2: NO-GO</span>
            <span className="rounded-full bg-red-100 px-2 py-0.5 font-semibold text-red-800">C3: NO-GO</span>
          </div>
          <p className="mt-2 text-[11px] text-sky-700">
            <span className="font-semibold">Next action:</span> Wait for next session reset, then rerun C1 with TRADOVATE_LISTENER_ENABLE_LIVE=true on the listener-worker.
          </p>
        </div>
        <div className="flex flex-col gap-1 text-[11px]">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-sky-600">Quick links</p>
          <a href="#qa-status" className="text-sky-700 underline hover:text-sky-900">→ QA status card</a>
          <a href="#internal-lock" className="text-sky-700 underline hover:text-sky-900">→ Internal-lock diagnostic</a>
          <a href="#rollout-readiness" className="text-sky-700 underline hover:text-sky-900">→ Rollout readiness</a>
          <a href="#broker-sync" className="text-sky-700 underline hover:text-sky-900">→ Broker risk settings sync</a>
        </div>
      </div>
    </div>
  );
}

function QaStatusCard({
  demo7Diagnosis,
  demo7LockEvents,
}: {
  demo7Diagnosis: Demo7DiagnosisType;
  demo7LockEvents: Demo7LockEvent[];
}) {
  const c1Status = demo7Diagnosis
    ? demo7Diagnosis.riskState === "STOPPED" && demo7Diagnosis.activeLockCount === 0
      ? "PENDING — riskState=STOPPED but no InternalLockEvent (rerun needed)"
      : demo7Diagnosis.activeLockCount > 0
        ? `PASS — ${demo7Diagnosis.activeLockCount} active InternalLockEvent(s)`
        : "PENDING next session reset"
    : "UNKNOWN — account not found";

  const c1StatusColor = c1Status.startsWith("PASS")
    ? "text-emerald-700"
    : c1Status.startsWith("PENDING")
      ? "text-amber-700"
      : "text-red-700";

  return (
    <SectionCard
      title={`QA status — ${DEMO7_EXTERNAL_ID}`}
      description={`accountId: ${DEMO7_ACCOUNT_ID}`}
    >
      <div className="grid gap-2 text-xs">
        <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2">
          <dl className="grid gap-1 sm:grid-cols-2">
            <div className="flex items-baseline gap-2">
              <dt className="font-mono text-stone-500">rule-save write (rule-save gate):</dt>
              <dd className="font-semibold text-emerald-700">PASS</dd>
            </div>
            <div className="flex items-baseline gap-2">
              <dt className="font-mono text-stone-500">C1 internal lock (listener path):</dt>
              <dd className={`font-semibold ${c1StatusColor}`}>{c1Status}</dd>
            </div>
            <div className="flex items-baseline gap-2">
              <dt className="font-mono text-stone-500">C2 broker enforcement:</dt>
              <dd className="font-semibold text-red-700">NO-GO — do not enable</dd>
            </div>
            <div className="flex items-baseline gap-2">
              <dt className="font-mono text-stone-500">C3 broker enforcement (live):</dt>
              <dd className="font-semibold text-red-700">NO-GO — do not enable</dd>
            </div>
            <div className="flex items-baseline gap-2">
              <dt className="font-mono text-stone-500">Expected listener-worker commit:</dt>
              <dd className="font-mono text-stone-700">{EXPECTED_LISTENER_COMMIT} or newer</dd>
            </div>
          </dl>
        </div>
        {demo7Diagnosis && (
          <div className="rounded-lg border border-stone-100 bg-stone-50 px-3 py-2 text-[11px] text-stone-500">
            <span className="font-semibold text-stone-700">Live state: </span>
            env={demo7Diagnosis.env} · riskState={demo7Diagnosis.riskState ?? "—"} · dailyPnl={demo7Diagnosis.dailyPnl ?? "—"} · maxDailyLoss={demo7Diagnosis.maxDailyLoss ?? "—"} · activeLocks={demo7Diagnosis.activeLockCount} · totalLockRows={demo7Diagnosis.totalLockCount}
          </div>
        )}
        <div className="grid gap-1 text-[11px] text-stone-500">
          <p className="font-semibold">C1 rerun checklist:</p>
          <ul className="grid gap-0.5 pl-2">
            <li>1. Reset session: riskState→NORMAL, dailyPnl reset (via debug reset endpoint or new session).</li>
            <li>2. Set <span className="font-mono">GUARDRAIL_INTERNAL_LOCK_ENABLED=true</span> on listener-worker (controls C1 internal-lock path).</li>
            <li>3. Set <span className="font-mono">TRADOVATE_LISTENER_ENABLE_LIVE=true</span> on listener-worker — required because C1 tests the WebSocket props path. Without it, the listener receives no live events and <span className="font-mono">applyInternalLockForConnection</span> never runs, even if Guardian sees the loss.</li>
            <li>4. Make a losing trade exceeding maxDailyLoss=$40000 on {DEMO7_EXTERNAL_ID}.</li>
            <li>5. Verify: InternalLockEvent row created, riskState=STOPPED, activeLocks=1.</li>
          </ul>
          <p className="mt-1 italic text-stone-400">
            Note: C1 does NOT need BROKER_ENFORCEMENT_ENABLED=true — that flag gates C2/C3 broker writes only.
            C1 only creates an app-internal lock row with no Tradovate calls.
          </p>
        </div>
      </div>
    </SectionCard>
  );
}

function InternalLockDiagnosticSection({
  demo7Account,
  diagnosis,
  lockEvents,
}: {
  demo7Account: { id: string; label: string; externalAccountId: string | null; isActive: boolean; protectionStatus: string } | null;
  diagnosis: Demo7DiagnosisType;
  lockEvents: Demo7LockEvent[];
}) {
  return (
    <SectionCard
      title={`Internal-lock diagnostic — ${DEMO7_EXTERNAL_ID}`}
      description="Live DB state for the C1 QA test account. No writes. Mirrors applyInternalLockForConnection gate logic."
    >
      {!demo7Account ? (
        <p className="text-sm text-amber-700">Account {DEMO7_ACCOUNT_ID} not found in DB.</p>
      ) : !diagnosis ? (
        <p className="text-sm text-stone-500">Diagnosis unavailable.</p>
      ) : (
        <div className="grid gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                diagnosis.wouldCreateLock
                  ? "bg-emerald-100 text-emerald-800"
                  : diagnosis.riskState === "STOPPED" && diagnosis.activeLockCount === 0
                    ? "bg-amber-100 text-amber-900"
                    : "bg-stone-100 text-stone-700"
              }`}
            >
              {diagnosis.wouldCreateLock
                ? "Would create lock"
                : diagnosis.riskState === "STOPPED"
                  ? diagnosis.activeLockCount > 0
                    ? "Already locked"
                    : "STOPPED — no lock event (backfill path)"
                  : "No lock would fire"}
            </span>
            <span className="font-mono text-stone-600">
              {demo7Account.label} · {demo7Account.externalAccountId ?? "—"}
            </span>
          </div>

          <dl className="grid gap-x-4 gap-y-0.5 text-[11px] text-stone-600 sm:grid-cols-2">
            <Row label="env" value={diagnosis.env} danger={diagnosis.env !== "demo"} />
            <Row label="riskState" value={diagnosis.riskState ?? "—"} danger={diagnosis.riskState === "STOPPED"} />
            <Row label="dailyPnl" value={String(diagnosis.dailyPnl ?? "—")} />
            <Row label="maxDailyLoss" value={String(diagnosis.maxDailyLoss ?? "—")} />
            <Row label="tradingDay" value={diagnosis.tradingDay} />
            <Row label="canLock" value={String(diagnosis.canLock)} />
            <Row label="activeLocks" value={String(diagnosis.activeLockCount)} danger={diagnosis.activeLockCount > 0} />
            <Row label="totalLockRows" value={String(diagnosis.totalLockCount)} />
          </dl>

          {diagnosis.skipReasons.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-800 mb-1">Gate skip reasons</p>
              {diagnosis.skipReasons.map((r, i) => (
                <p key={i} className="font-mono text-amber-700">{r}</p>
              ))}
            </div>
          )}

          {diagnosis.violations.length > 0 && (
            <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-sky-800 mb-1">Rule violations detected</p>
              {diagnosis.violations.map((v, i) => (
                <p key={i} className="font-mono text-sky-700">
                  {v.ruleType}: observed={v.observedAmount ?? v.observedCount} threshold={v.thresholdAmount ?? v.thresholdCount}
                </p>
              ))}
              {diagnosis.computedDedupKey && (
                <p className="mt-1 font-mono text-[10px] text-sky-600">dedupKey: {diagnosis.computedDedupKey}</p>
              )}
            </div>
          )}

          {lockEvents.length > 0 && (
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-stone-500">InternalLockEvent history (newest first)</p>
              <div className="grid gap-1">
                {lockEvents.map((e) => (
                  <div
                    key={e.id}
                    className={`rounded border px-2 py-1 text-[11px] font-mono ${
                      e.clearedAt == null ? "border-amber-200 bg-amber-50 text-amber-800" : "border-stone-100 bg-stone-50 text-stone-500"
                    }`}
                  >
                    {e.ruleType} · day={e.tradingDay} · cleared={e.clearedAt ? e.clearedAt.toISOString().slice(0, 10) : "no"} · brokerAction={String(e.brokerActionTaken)} · {e.createdAt.toISOString()}
                  </div>
                ))}
              </div>
            </div>
          )}
          {lockEvents.length === 0 && (
            <p className="text-stone-400 italic">No InternalLockEvent rows for this account.</p>
          )}
        </div>
      )}
    </SectionCard>
  );
}

const READINESS_STATUS_CLS: Record<ActivationReadinessStatus, string> = {
  candidate: "bg-emerald-100 text-emerald-800",
  preview_required: "bg-sky-100 text-sky-800",
  blocked: "bg-stone-200 text-stone-700",
};

function DailyLossActivationCandidatesSection({
  demoCandidates,
  candidateCount,
  previewRequiredCount,
  blockedCount,
}: {
  demoCandidates: Array<{
    id: string;
    label: string;
    externalAccountId: string | null;
    env: string | null;
    isActive: boolean;
    allowlisted: boolean;
    maxDailyLoss: number | null;
    readiness: AccountActivationReadiness;
  }>;
  candidateCount: number;
  previewRequiredCount: number;
  blockedCount: number;
}) {
  return (
    <SectionCard
      title="Daily Loss activation candidates"
      description="Demo accounts evaluated for broker enforcement activation. Read-only — no env changes here."
    >
      <div className="grid gap-3">
        <div className="flex flex-wrap gap-3 text-xs">
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-800">
            {candidateCount} candidate{candidateCount !== 1 ? "s" : ""}
          </span>
          <span className="rounded-full bg-sky-100 px-2 py-0.5 font-semibold text-sky-800">
            {previewRequiredCount} preview required
          </span>
          <span className="rounded-full bg-stone-200 px-2 py-0.5 font-semibold text-stone-700">
            {blockedCount} blocked
          </span>
        </div>
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <span className="font-semibold">C2/C3 status: NO-GO.</span> Do not set BROKER_ENFORCEMENT_ENABLED=true until C1 rerun passes with TRADOVATE_LISTENER_ENABLE_LIVE=true.
        </p>
        {demoCandidates.length === 0 ? (
          <p className="text-sm text-stone-500">No demo accounts found.</p>
        ) : (() => {
          // Sort: DEMO7433035 first, then by status (candidate → preview_required → blocked)
          const sorted = [...demoCandidates].sort((a, b) => {
            const aIsTarget = a.externalAccountId === DEMO7_EXTERNAL_ID ? 0 : 1;
            const bIsTarget = b.externalAccountId === DEMO7_EXTERNAL_ID ? 0 : 1;
            if (aIsTarget !== bIsTarget) return aIsTarget - bIsTarget;
            const statusOrder: Record<string, number> = { candidate: 0, preview_required: 1, blocked: 2 };
            return (statusOrder[a.readiness.status] ?? 3) - (statusOrder[b.readiness.status] ?? 3);
          });
          const candidates = sorted.filter((a) => a.readiness.status === "candidate");
          const previewRequired = sorted.filter((a) => a.readiness.status === "preview_required");
          const blocked = sorted.filter((a) => a.readiness.status === "blocked");

          const AccountRow = (a: typeof sorted[number]) => (
            <div
              key={a.id}
              className={`rounded-lg border px-3 py-2 text-xs ${
                a.readiness.status === "candidate"
                  ? "border-emerald-200 bg-emerald-50"
                  : a.readiness.status === "preview_required"
                    ? "border-sky-100 bg-sky-50"
                    : "border-stone-100 bg-stone-50"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-stone-800">
                  {a.label}
                  {a.externalAccountId ? (
                    <span className="ml-2 font-mono text-[10px] text-stone-500">{a.externalAccountId}</span>
                  ) : null}
                </span>
                <div className="flex flex-wrap gap-1.5 items-center">
                  {a.allowlisted && (
                    <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-700">Allowlisted</span>
                  )}
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${READINESS_STATUS_CLS[a.readiness.status]}`}>
                    {a.readiness.phase.replace(/_/g, " ")}
                  </span>
                </div>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-stone-500">
                {a.maxDailyLoss != null && <span>maxDailyLoss: ${a.maxDailyLoss}</span>}
                {a.readiness.blockers.length > 0 && (
                  <span className="text-amber-700">blockers: {a.readiness.blockers.join(", ")}</span>
                )}
              </div>
              <p className="mt-1 text-[10px] text-stone-500 italic">{a.readiness.nextSafeAction}</p>
            </div>
          );

          return (
            <div className="grid gap-3">
              {candidates.length > 0 && (
                <div className="grid gap-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-stone-500">Candidates ({candidates.length})</p>
                  {candidates.map(AccountRow)}
                </div>
              )}
              {previewRequired.length > 0 && (
                <details className="group">
                  <summary className="cursor-pointer list-none rounded-lg border border-sky-100 bg-sky-50 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-sky-700 hover:bg-sky-100">
                    Preview required ({previewRequired.length}) — click to expand
                  </summary>
                  <div className="mt-2 grid gap-2">{previewRequired.map(AccountRow)}</div>
                </details>
              )}
              {blocked.length > 0 && (
                <details>
                  <summary className="cursor-pointer list-none rounded-lg border border-stone-200 bg-stone-100 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-stone-500 hover:bg-stone-200">
                    Blocked ({blocked.length}) — click to expand
                  </summary>
                  <div className="mt-2 grid gap-2">{blocked.map(AccountRow)}</div>
                </details>
              )}
            </div>
          );
        })()}
      </div>
    </SectionCard>
  );
}

type FullAccountRow = {
  id: string;
  label: string;
  externalAccountId: string | null;
  platform: string;
  env: string | null;
  isActive: boolean;
  protectionStatus: string;
  accountType: string;
  connectionStatus: string | null;
  permissionLevel: string | null;
  riskState: string | null;
  maxDailyLoss: number | null;
  canUseForRecoveryProbePreview: boolean;
  readiness: AccountActivationReadiness;
};

function FullAccountTable({ rows }: { rows: FullAccountRow[] }) {
  const sorted = [...rows].sort((a, b) => {
    const aIsTarget = a.externalAccountId === DEMO7_EXTERNAL_ID ? 0 : 1;
    const bIsTarget = b.externalAccountId === DEMO7_EXTERNAL_ID ? 0 : 1;
    if (aIsTarget !== bIsTarget) return aIsTarget - bIsTarget;
    const aIsDemo = a.env === "demo" ? 0 : 1;
    const bIsDemo = b.env === "demo" ? 0 : 1;
    if (aIsDemo !== bIsDemo) return aIsDemo - bIsDemo;
    const statusOrder: Record<string, number> = { candidate: 0, preview_required: 1, blocked: 2 };
    return (statusOrder[a.readiness.status] ?? 3) - (statusOrder[b.readiness.status] ?? 3);
  });
  const demoRows = sorted.filter((r) => r.env === "demo");
  const nonDemoRows = sorted.filter((r) => r.env !== "demo");

  const AccountRow = (r: FullAccountRow) => (
    <div
      key={r.id}
      className={`rounded-lg border px-3 py-2 ${
        r.protectionStatus !== "protected"
          ? "border-stone-100 bg-stone-50 opacity-70"
          : r.readiness.status === "candidate"
            ? "border-emerald-100 bg-emerald-50"
            : "border-stone-100 bg-stone-50"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-stone-800">
          {r.label}
          {r.externalAccountId ? (
            <span className="ml-2 font-mono text-[10px] text-stone-500">{r.externalAccountId}</span>
          ) : null}
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${READINESS_STATUS_CLS[r.readiness.status]}`}>
            {r.readiness.status}
          </span>
          {!r.isActive && (
            <span className="rounded-full bg-stone-200 px-2 py-0.5 text-[10px] text-stone-500">inactive</span>
          )}
          {r.canUseForRecoveryProbePreview && (
            <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-700">probe-ready</span>
          )}
        </div>
      </div>
      <dl className="mt-1 grid gap-x-4 gap-y-0.5 text-[11px] text-stone-600 sm:grid-cols-3">
        <Row label="platform/env" value={`${r.platform}/${r.env ?? "—"}`} />
        <Row label="protection" value={r.protectionStatus} />
        <Row label="connectionStatus" value={r.connectionStatus ?? "—"} />
        <Row label="permissionLevel" value={r.permissionLevel ?? "—"} />
        <Row label="riskState" value={r.riskState ?? "—"} danger={r.riskState === "STOPPED"} />
        {r.maxDailyLoss != null && <Row label="maxDailyLoss" value={`$${r.maxDailyLoss}`} />}
      </dl>
    </div>
  );

  return (
    <SectionCard
      title="All connected accounts"
      description="Every account in DB — env, protection status, connection details, Daily Loss readiness. Demo first, then non-demo collapsed. Read-only."
    >
      {rows.length === 0 ? (
        <p className="text-sm text-stone-500">No accounts found.</p>
      ) : (
        <div className="grid gap-3 text-xs">
          {demoRows.length > 0 && (
            <div className="grid gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-stone-500">Demo accounts ({demoRows.length})</p>
              {demoRows.map(AccountRow)}
            </div>
          )}
          {nonDemoRows.length > 0 && (
            <details>
              <summary className="cursor-pointer list-none rounded-lg border border-stone-200 bg-stone-100 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-stone-500 hover:bg-stone-200">
                Non-demo accounts ({nonDemoRows.length}) — click to expand
              </summary>
              <div className="mt-2 grid gap-2">{nonDemoRows.map(AccountRow)}</div>
            </details>
          )}
        </div>
      )}
    </SectionCard>
  );
}

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
      label: "Safe mode active — broker enforcement disabled",
      detail: "No dangerous flags detected. This means the system is inert, not rollout-ready.",
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

// ── Rollout readiness section ─────────────────────────────────────────────────

const READINESS_BADGE: Record<
  RolloutReadiness["status"],
  { cls: string; label: string }
> = {
  ready: { cls: "bg-emerald-100 text-emerald-800", label: "Ready" },
  needs_review: { cls: "bg-amber-100 text-amber-900", label: "Needs review" },
  blocked: { cls: "bg-red-100 text-red-900", label: "Blocked" },
};

function RolloutReadinessSection({ items }: { items: RolloutReadiness[] }) {
  return (
    <SectionCard
      title="Rollout readiness"
      description="Per-account pre-flight checklist for future demo rollouts. Advisory only — does not enable enforcement or send broker actions."
    >
      <p className="mb-3 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-600">
        <span className="font-semibold">Advisory only.</span> Readiness is a read-only
        pre-flight view. It does not enable enforcement, change any env flag, or send
        any broker action.
      </p>
      {items.length === 0 ? (
        <p className="text-sm text-stone-500">No rollout-relevant accounts.</p>
      ) : (
        <div className="grid gap-3">
          {items.map((item) => {
            const badge = READINESS_BADGE[item.status];
            return (
              <div
                key={item.accountId}
                className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-xs font-semibold text-stone-800">
                    {item.accountLabel}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${badge.cls}`}
                  >
                    {badge.label}
                  </span>
                </div>
                <ul className="mt-2 grid gap-0.5 text-[11px] sm:grid-cols-2">
                  {item.checks.map((c) => (
                    <li key={c.label} className="flex items-start gap-1.5">
                      <span
                        className={
                          c.pass
                            ? "text-emerald-600"
                            : c.blocking
                              ? "font-bold text-red-700"
                              : "text-amber-700"
                        }
                      >
                        {c.pass ? "✓" : "✗"}
                      </span>
                      <span className={c.pass ? "text-stone-600" : c.blocking ? "font-semibold text-red-800" : "text-amber-900"}>
                        {c.label}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </SectionCard>
  );
}

// ── Rule edit audit ────────────────────────────────────────────────────────────

type RuleAuditRow = {
  id: string;
  scope: string;
  allowed: boolean;
  reason: string;
  blockReason: string | null;
  sessionRiskState: string | null;
  hasOpenPosition: boolean | null;
  createdAt: Date;
  user: { email: string } | null;
  account: { label: string } | null;
};

function RuleChangeAuditSection({ rows }: { rows: RuleAuditRow[] }) {
  const blocked = rows.filter((r) => !r.allowed);
  const allowed = rows.filter((r) => r.allowed);
  const orderedRows = [...blocked, ...allowed];

  return (
    <SectionCard
      title="Rule edit audit"
      description="Recent rule-change attempts — blocked first. Read-only."
    >
      {orderedRows.length === 0 ? (
        <p className="text-sm text-stone-500">No blocked rule-edit attempts.</p>
      ) : (
        <div className="grid gap-2">
          {orderedRows.map((row) => (
            <div
              key={row.id}
              className={`rounded-lg border px-3 py-2 text-xs ${
                row.allowed
                  ? "border-stone-200 bg-stone-50"
                  : "border-red-200 bg-red-50"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-stone-700">
                  {row.user?.email ?? row.id}
                  {row.account ? ` · ${row.account.label}` : ""}
                  {` · ${row.scope}`}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    row.allowed
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-red-100 text-red-800"
                  }`}
                >
                  {row.allowed ? "allowed" : "blocked"}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-stone-500">
                <span>{row.createdAt.toISOString()}</span>
                <span>reason: {row.reason}</span>
                {row.blockReason && <span>block: {row.blockReason}</span>}
                {row.sessionRiskState && <span>riskState: {row.sessionRiskState}</span>}
                {row.hasOpenPosition != null && (
                  <span>openPos: {row.hasOpenPosition ? "yes" : "no"}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

// ── Broker risk settings sync audit ───────────────────────────────────────────

type BrokerSyncAuditRow = {
  id: string;
  broker: string;
  ruleType: string;
  amount: number | null;
  environment: string | null;
  dryRun: boolean;
  brokerEnforcementEnabled: boolean;
  outcome: string;
  gateFailureReason: string | null;
  skipReason: string | null;
  payloadPreviewJson: unknown;
  brokerResponseJson: unknown;
  errorMessage: string | null;
  createdAt: Date;
  account: { label: string; externalAccountId: string | null } | null;
};

const OUTCOME_CLS: Record<string, string> = {
  success: "bg-emerald-100 text-emerald-800",
  dry_run: "bg-sky-100 text-sky-800",
  gate_blocked: "bg-amber-100 text-amber-900",
  skipped: "bg-stone-200 text-stone-700",
  failed: "bg-red-100 text-red-900",
};

function BrokerSyncAuditSection({ rows }: { rows: BrokerSyncAuditRow[] }) {
  const TOP_N = 10;
  const topRows = rows.slice(0, TOP_N);
  const extraRows = rows.slice(TOP_N);

  const SyncRow = (row: BrokerSyncAuditRow) => {
    const outcomeCls = OUTCOME_CLS[row.outcome] ?? "bg-stone-200 text-stone-700";
    const accountLabel = row.account?.label ?? null;
    const externalId = row.account?.externalAccountId ?? null;
    return (
      <div
        key={row.id}
        className={`rounded-lg border px-3 py-2 text-xs ${
          row.outcome === "success"
            ? "border-emerald-200 bg-emerald-50"
            : row.outcome === "failed"
              ? "border-red-200 bg-red-50"
              : row.outcome === "gate_blocked"
                ? "border-amber-200 bg-amber-50"
                : "border-stone-100 bg-stone-50"
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-mono text-stone-700">
            {accountLabel ?? "—"}
            {externalId ? ` · ${externalId}` : ""}
            {` · ${row.ruleType}`}
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${outcomeCls}`}
            >
              {row.outcome}
            </span>
            {row.dryRun && (
              <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-700">
                dry-run
              </span>
            )}
            {!row.brokerEnforcementEnabled && (
              <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] text-stone-500">
                enforcement off
              </span>
            )}
          </div>
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-stone-500">
          <span>{row.createdAt.toISOString()}</span>
          <span>broker: {row.broker}</span>
          {row.environment && <span>env: {row.environment}</span>}
          {row.amount != null && <span>amount: ${row.amount}</span>}
          {row.gateFailureReason && (
            <span className="font-semibold text-amber-700">
              gate: {row.gateFailureReason}
            </span>
          )}
          {row.skipReason && <span>skip: {row.skipReason.slice(0, 80)}</span>}
          {row.errorMessage && (
            <span className="font-semibold text-red-700">
              error: {row.errorMessage.slice(0, 120)}
            </span>
          )}
          {row.payloadPreviewJson != null && (
            <span>
              payload: {JSON.stringify(row.payloadPreviewJson).slice(0, 80)}
            </span>
          )}
          {row.brokerResponseJson != null && (
            <span>
              response: {JSON.stringify(row.brokerResponseJson).slice(0, 80)}
            </span>
          )}
        </div>
      </div>
    );
  };

  return (
    <SectionCard
      title="Broker risk settings sync"
      description="Recent daily-loss rule-save sync attempts — DEMO7433035 first, then newest. Admin only. Shows gate outcomes, dry-run previews, and broker responses."
    >
      {rows.length === 0 ? (
        <p className="text-sm text-stone-500">No broker risk-settings sync attempts yet.</p>
      ) : (
        <div className="grid gap-2">
          {topRows.map(SyncRow)}
          {extraRows.length > 0 && (
            <details>
              <summary className="cursor-pointer list-none rounded-lg border border-stone-200 bg-stone-100 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-stone-500 hover:bg-stone-200">
                Older entries ({extraRows.length}) — click to expand
              </summary>
              <div className="mt-2 grid gap-2">{extraRows.map(SyncRow)}</div>
            </details>
          )}
        </div>
      )}
    </SectionCard>
  );
}
