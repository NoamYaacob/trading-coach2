/**
 * GET /api/debug/daily-loss-enforcement-readiness?accountId=<ConnectedAccount.id>
 *
 * Read-only diagnostic endpoint. Returns a comprehensive assessment of whether
 * an account is ready for Daily Loss broker enforcement activation.
 *
 * Eight sections:
 *   1. account             — DB facts about the account and broker connection
 *   2. currentRules        — resolved daily loss rule + consent state
 *   3. envPosture          — env var flags governing all broker writes
 *   4. ruleSaveGates       — per-gate pass/fail for the rule-save (proactive) path
 *   5. listenerGates       — per-gate pass/fail for the listener (breach-time) path
 *   6. existingAutoLiq     — last known AutoLiq from DB audit preview rows (no live read)
 *   7. ownershipAndRecovery — Guardrail audit ownership evidence + D1 gate assessment
 *   8. activationVerdict   — phase + GO/NO-GO + per-blocker summary
 *
 * Safety:
 *   - Read-only — no DB writes, no broker calls, no TradovateClient import
 *   - Auth: authenticated session + x-cron-secret header
 *   - User-scoped: account must belong to current session user
 *   - No secret values returned (no tokens, no encrypted fields)
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseBrokerEnforcementAllowlist } from "@/lib/guardian-engine/broker-enforcement-gate";
import {
  hasValidConsent,
  resolveConsentForAccount,
  AUTOMATED_ACTIONS_CONSENT_VERSION,
} from "@/lib/brokers/automated-actions-consent";
import { parseTradovateMasterId } from "@/lib/brokers/tradovate-master-id";

const NON_LIVE_CONNECTION_STATUSES = new Set([
  "expired",
  "connection_error",
  "not_connected",
  "pending_webhook",
  "oauth_pending_storage",
]);

type GateCheck = {
  gate: string;
  pass: boolean;
  reason: string;
};

export async function GET(request: NextRequest) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const secret = request.headers.get("x-cron-secret");
  const expected = process.env.CRON_SECRET;
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const accountId = request.nextUrl.searchParams.get("accountId");
  if (!accountId) {
    return NextResponse.json({ error: "accountId query param required" }, { status: 400 });
  }

  // ── 1. Account lookup (user-scoped) ──────────────────────────────────────────
  const account = await prisma.connectedAccount.findFirst({
    where: { id: accountId, userId: currentUser.id },
    select: {
      id: true,
      label: true,
      externalAccountId: true,
      platform: true,
      isActive: true,
      missingFromBrokerSince: true,
      lastSyncAt: true,
      brokerConnection: {
        select: {
          id: true,
          env: true,
          connectionStatus: true,
          permissionLevel: true,
        },
      },
      riskRules: {
        select: {
          maxDailyLoss: true,
          automatedActionsConsentAt: true,
          automatedActionsConsentVersion: true,
        },
      },
    },
  });

  if (!account) {
    return NextResponse.json({ error: "account not found for this user" }, { status: 404 });
  }

  // ── Parallel DB fetches ───────────────────────────────────────────────────────
  const [defaultRules, guardianProfile, latestPreviewAudit, priorWriteRows, allAuditSummary] =
    await Promise.all([
      prisma.riskRules.findUnique({
        where: { userId: currentUser.id },
        select: {
          maxDailyLoss: true,
          automatedActionsConsentAt: true,
          automatedActionsConsentVersion: true,
        },
      }),
      prisma.guardianProfile.findUnique({
        where: { userId: currentUser.id },
        select: { guardianEnabled: true },
      }),
      prisma.brokerRiskSettingsSyncAudit.findFirst({
        where: {
          accountId,
          outcome: "preview",
          ruleType: "daily_loss_recovery_probe",
        },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          createdAt: true,
          payloadPreviewJson: true,
        },
      }),
      prisma.brokerRiskSettingsSyncAudit.findMany({
        where: {
          accountId,
          outcome: "success",
          ruleType: { in: ["daily_loss_limit", "daily_loss_recovery_probe"] },
        },
        select: { id: true, createdAt: true, ruleType: true, brokerResponseJson: true },
        take: 10,
      }),
      prisma.brokerRiskSettingsSyncAudit.groupBy({
        by: ["outcome"],
        where: { accountId },
        _count: { outcome: true },
      }),
    ]);

  // ── 2. Resolved rule + consent ────────────────────────────────────────────────
  const accountRuleConsent = account.riskRules
    ? {
        consentAt: account.riskRules.automatedActionsConsentAt,
        consentVersion: account.riskRules.automatedActionsConsentVersion,
      }
    : null;
  const defaultRuleConsent = defaultRules
    ? {
        consentAt: defaultRules.automatedActionsConsentAt,
        consentVersion: defaultRules.automatedActionsConsentVersion,
      }
    : null;
  const { state: resolvedConsent, source: consentSource } = resolveConsentForAccount({
    accountRiskRules: accountRuleConsent,
    defaultRiskRules: defaultRuleConsent,
  });
  const consentValid = hasValidConsent(resolvedConsent);

  const maxDailyLoss =
    account.riskRules?.maxDailyLoss != null
      ? Number(account.riskRules.maxDailyLoss)
      : defaultRules?.maxDailyLoss != null
        ? Number(defaultRules.maxDailyLoss)
        : null;
  const maxDailyLossSource: "account" | "default" | "none" =
    account.riskRules?.maxDailyLoss != null
      ? "account"
      : defaultRules?.maxDailyLoss != null
        ? "default"
        : "none";

  // ── 3. Env posture ────────────────────────────────────────────────────────────
  const brokerEnforcementEnabled = process.env.BROKER_ENFORCEMENT_ENABLED === "true";
  const enforcementDryRun = process.env.ENFORCEMENT_DRY_RUN === "true";
  const listenerLiveEnabled = process.env.TRADOVATE_LISTENER_ENABLE_LIVE === "true";
  const allowlistRaw = process.env.BROKER_ENFORCEMENT_DEMO_ACCOUNT_ALLOWLIST;
  const allowlistIds = parseBrokerEnforcementAllowlist(allowlistRaw);
  const accountAllowlisted = allowlistIds.includes(accountId);
  const guardrailInternalLockEnabled = process.env.GUARDRAIL_INTERNAL_LOCK_ENABLED === "true";

  // ── 4. Derived account facts ──────────────────────────────────────────────────
  const env = account.brokerConnection?.env ?? null;
  const connectionStatus = account.brokerConnection?.connectionStatus ?? null;
  const permissionLevel = account.brokerConnection?.permissionLevel ?? null;
  const guardianEnabled = guardianProfile?.guardianEnabled ?? true;
  const validMasterId = parseTradovateMasterId(account.externalAccountId) !== null;
  const connectionLive =
    connectionStatus != null && !NON_LIVE_CONNECTION_STATUSES.has(connectionStatus);

  // ── 5. Rule-save path gate evaluation (all evaluated, not short-circuit) ──────
  const ruleSaveGates: GateCheck[] = [
    {
      gate: "broker_enforcement_enabled",
      pass: brokerEnforcementEnabled,
      reason: brokerEnforcementEnabled
        ? "BROKER_ENFORCEMENT_ENABLED=true"
        : "BROKER_ENFORCEMENT_ENABLED is not 'true' — set it to enable broker writes",
    },
    {
      gate: "env_demo",
      pass: env === "demo",
      reason: env === "demo" ? "env=demo" : `env='${env ?? "null"}' — only demo is supported`,
    },
    {
      gate: "account_active",
      pass: account.isActive,
      reason: account.isActive ? "account.isActive=true" : "account is inactive",
    },
    {
      gate: "not_missing_from_broker",
      pass: account.missingFromBrokerSince == null,
      reason:
        account.missingFromBrokerSince == null
          ? "missingFromBrokerSince=null"
          : `missingFromBrokerSince set (${account.missingFromBrokerSince.toISOString()})`,
    },
    {
      gate: "connection_live",
      pass: connectionLive,
      reason: connectionLive
        ? `connectionStatus='${connectionStatus}' is live`
        : `connectionStatus='${connectionStatus ?? "null"}' is not live`,
    },
    {
      gate: "full_access",
      pass: permissionLevel === "full_access",
      reason:
        permissionLevel === "full_access"
          ? "permissionLevel=full_access"
          : `permissionLevel='${permissionLevel ?? "null"}' — full_access required`,
    },
    {
      gate: "allowlisted",
      pass: accountAllowlisted,
      reason: accountAllowlisted
        ? "account is in BROKER_ENFORCEMENT_DEMO_ACCOUNT_ALLOWLIST"
        : "account not in BROKER_ENFORCEMENT_DEMO_ACCOUNT_ALLOWLIST",
    },
    {
      gate: "guardian_active",
      pass: guardianEnabled,
      reason: guardianEnabled ? "guardianEnabled=true" : "guardianEnabled=false",
    },
    {
      gate: "consent_valid",
      pass: consentValid,
      reason: consentValid
        ? `consent valid (version matches '${AUTOMATED_ACTIONS_CONSENT_VERSION}')`
        : resolvedConsent.consentAt == null
          ? "no automated-actions consent on record"
          : `consent version mismatch: got '${resolvedConsent.consentVersion ?? "null"}', expected '${AUTOMATED_ACTIONS_CONSENT_VERSION}'`,
    },
    {
      gate: "valid_external_account_id",
      pass: validMasterId,
      reason: validMasterId
        ? `externalAccountId='${account.externalAccountId}' is a valid Tradovate masterid`
        : `externalAccountId='${account.externalAccountId ?? "null"}' is not a valid Tradovate masterid`,
    },
    {
      gate: "max_daily_loss_positive",
      pass: maxDailyLoss != null && maxDailyLoss > 0,
      reason:
        maxDailyLoss != null && maxDailyLoss > 0
          ? `maxDailyLoss=${maxDailyLoss} > 0`
          : `maxDailyLoss=${maxDailyLoss ?? "null"} — must be a positive number`,
    },
  ];

  // ── 6. Listener-path gate evaluation (all evaluated, not short-circuit) ───────
  const listenerGates: GateCheck[] = [
    {
      gate: "broker_enforcement_enabled",
      pass: brokerEnforcementEnabled,
      reason: brokerEnforcementEnabled
        ? "BROKER_ENFORCEMENT_ENABLED=true"
        : "BROKER_ENFORCEMENT_ENABLED is not 'true'",
    },
    {
      gate: "listener_not_live",
      pass: !listenerLiveEnabled,
      reason: !listenerLiveEnabled
        ? "TRADOVATE_LISTENER_ENABLE_LIVE is not 'true' (correct for Phase 2C)"
        : "TRADOVATE_LISTENER_ENABLE_LIVE=true — live listener not supported in Phase 2C",
    },
    {
      gate: "env_demo",
      pass: env === "demo",
      reason: env === "demo" ? "env=demo" : `env='${env ?? "null"}' — only demo supported`,
    },
    {
      gate: "allowlisted",
      pass: accountAllowlisted,
      reason: accountAllowlisted
        ? "account is in BROKER_ENFORCEMENT_DEMO_ACCOUNT_ALLOWLIST"
        : "account not in BROKER_ENFORCEMENT_DEMO_ACCOUNT_ALLOWLIST",
    },
    {
      gate: "rule_eligible",
      pass: true,
      reason:
        "daily_loss_limit is the only broker-eligible rule — always pass for this diagnostic",
    },
    {
      gate: "account_active",
      pass: account.isActive,
      reason: account.isActive ? "account.isActive=true" : "account is inactive",
    },
    {
      gate: "not_missing_from_broker",
      pass: account.missingFromBrokerSince == null,
      reason:
        account.missingFromBrokerSince == null
          ? "missingFromBrokerSince=null"
          : `missingFromBrokerSince set (${account.missingFromBrokerSince.toISOString()})`,
    },
    {
      gate: "connection_live",
      pass: connectionLive,
      reason: connectionLive
        ? `connectionStatus='${connectionStatus}' is live`
        : `connectionStatus='${connectionStatus ?? "null"}' is not live`,
    },
    {
      gate: "full_access",
      pass: permissionLevel === "full_access",
      reason:
        permissionLevel === "full_access"
          ? "permissionLevel=full_access"
          : `permissionLevel='${permissionLevel ?? "null"}' — full_access required`,
    },
    {
      gate: "active_internal_lock",
      pass: guardrailInternalLockEnabled,
      reason: guardrailInternalLockEnabled
        ? "GUARDRAIL_INTERNAL_LOCK_ENABLED=true (lock gate is operational)"
        : "GUARDRAIL_INTERNAL_LOCK_ENABLED is not true — internal lock gate not enabled (operational check, not static)",
    },
    {
      gate: "no_duplicate_intervention",
      pass: true,
      reason:
        "Operational gate — dedup check runs per trading day at enforcement time (not statically evaluable)",
    },
  ];

  // ── 7. existingAutoLiq (DB-only, from latest preview audit row) ───────────────
  type ExistingAutoLiqSnapshot = {
    fromLatestPreviewAudit: boolean;
    previewAuditId: string | null;
    previewAuditCreatedAt: string | null;
    exists: boolean | null;
    dailyLossAutoLiq: number | null;
    changesLocked: boolean | null;
    doNotUnlock: boolean | null;
    note: string;
  };

  let existingAutoLiq: ExistingAutoLiqSnapshot;

  if (latestPreviewAudit != null) {
    const payload = latestPreviewAudit.payloadPreviewJson as Record<string, unknown> | null;
    const existing = payload?.existing as Record<string, unknown> | null | undefined;
    existingAutoLiq = {
      fromLatestPreviewAudit: true,
      previewAuditId: latestPreviewAudit.id,
      previewAuditCreatedAt: latestPreviewAudit.createdAt.toISOString(),
      exists: existing != null,
      dailyLossAutoLiq:
        existing != null && typeof existing.dailyLossAutoLiq === "number"
          ? existing.dailyLossAutoLiq
          : null,
      changesLocked:
        existing != null && typeof existing.changesLocked === "boolean"
          ? existing.changesLocked
          : null,
      doNotUnlock:
        existing != null && typeof existing.doNotUnlock === "boolean"
          ? existing.doNotUnlock
          : null,
      note: "DB-only snapshot from latest preview audit row — not a live Tradovate read. Run recovery probe in read_only mode to refresh.",
    };
  } else {
    existingAutoLiq = {
      fromLatestPreviewAudit: false,
      previewAuditId: null,
      previewAuditCreatedAt: null,
      exists: null,
      dailyLossAutoLiq: null,
      changesLocked: null,
      doNotUnlock: null,
      note: "No preview audit row found — run daily-loss-recovery-probe in read_only mode to populate.",
    };
  }

  // ── 8. Ownership evidence + D1 assessment ────────────────────────────────────
  const hasGuardrailOwnedWrite = priorWriteRows.some((r) => r.brokerResponseJson != null);
  const d1Blocked = existingAutoLiq.changesLocked === true && !hasGuardrailOwnedWrite;

  const auditSummary: Record<string, number> = {};
  for (const row of allAuditSummary) {
    auditSummary[row.outcome] = row._count.outcome;
  }

  // ── 9. Activation verdict ─────────────────────────────────────────────────────
  const fundamentalFailures: string[] = [];
  if (!account.isActive) fundamentalFailures.push("account_inactive");
  if (account.missingFromBrokerSince != null) fundamentalFailures.push("account_missing_from_broker");
  if (!connectionLive) fundamentalFailures.push("connection_not_live");
  if (permissionLevel !== "full_access") fundamentalFailures.push("insufficient_permissions");
  if (!validMasterId) fundamentalFailures.push("invalid_external_account_id");
  if (maxDailyLoss == null || maxDailyLoss <= 0) fundamentalFailures.push("max_daily_loss_not_positive");

  const envBlockers: string[] = [];
  if (!brokerEnforcementEnabled) envBlockers.push("BROKER_ENFORCEMENT_ENABLED_not_true");
  if (!accountAllowlisted) envBlockers.push("account_not_in_allowlist");
  if (!consentValid) envBlockers.push("missing_or_stale_automated_actions_consent");
  if (!guardianEnabled) envBlockers.push("guardian_inactive");

  type Phase =
    | "not_ready"
    | "blocked_existing_locked_autoliq"
    | "ready_for_preview_only"
    | "ready_for_demo_activation";

  let phase: Phase;
  let goNoGo: "GO" | "NO_GO";
  let blockers: string[];
  let verdictNote: string;

  if (fundamentalFailures.length > 0) {
    phase = "not_ready";
    goNoGo = "NO_GO";
    blockers = fundamentalFailures;
    verdictNote =
      "Account has fundamental issues that must be resolved before broker enforcement can be considered.";
  } else if (d1Blocked) {
    phase = "blocked_existing_locked_autoliq";
    goNoGo = "NO_GO";
    blockers = [
      "preexisting_locked_autoliq_not_guardrail_owned",
      ...envBlockers,
    ];
    verdictNote =
      "Existing Tradovate AutoLiq record has changesLocked=true with no Guardrail ownership " +
      "evidence. The recovery probe (apply=true) is blocked by Gate D1. Investigate the " +
      "origin of the existing AutoLiq record before proceeding with any enforcement write.";
  } else if (envBlockers.length > 0) {
    phase = "ready_for_preview_only";
    goNoGo = "NO_GO";
    blockers = envBlockers;
    verdictNote =
      "Account is structurally ready. Operator actions needed to activate enforcement: " +
      "set BROKER_ENFORCEMENT_ENABLED=true, add account to BROKER_ENFORCEMENT_DEMO_ACCOUNT_ALLOWLIST, " +
      "ensure automated-actions consent is recorded.";
  } else {
    phase = "ready_for_demo_activation";
    goNoGo = "GO";
    blockers = [];
    verdictNote =
      "All static gates pass. Account is ready for Daily Loss demo enforcement activation. " +
      "Review ENFORCEMENT_DRY_RUN flag before enabling live writes.";
  }

  return NextResponse.json({
    ok: true,
    note: "Read-only diagnostic — no writes, no broker calls.",
    account: {
      id: account.id,
      label: account.label,
      externalAccountId: account.externalAccountId,
      platform: account.platform,
      env,
      connectionStatus,
      permissionLevel,
      isActive: account.isActive,
      missingFromBrokerSince: account.missingFromBrokerSince?.toISOString() ?? null,
      lastSyncAt: account.lastSyncAt?.toISOString() ?? null,
      brokerConnectionId: account.brokerConnection?.id ?? null,
      validMasterId,
    },
    currentRules: {
      maxDailyLoss,
      maxDailyLossSource,
      hasAccountRiskRules: account.riskRules != null,
      consentAt: resolvedConsent.consentAt?.toISOString() ?? null,
      consentVersion: resolvedConsent.consentVersion,
      consentValid,
      consentSource,
      expectedConsentVersion: AUTOMATED_ACTIONS_CONSENT_VERSION,
      guardianEnabled,
    },
    envPosture: {
      brokerEnforcementEnabled,
      enforcementDryRun,
      listenerLiveEnabled,
      allowlistSize: allowlistIds.length,
      accountAllowlisted,
      guardrailInternalLockEnabled,
    },
    ruleSaveGates,
    listenerGates,
    existingAutoLiq,
    ownershipAndRecovery: {
      priorWriteCount: priorWriteRows.length,
      hasGuardrailOwnedWrite,
      d1Blocked,
      d1BlockedReason: d1Blocked
        ? "existingAutoLiq.changesLocked=true with no prior Guardrail audit row having outcome=success + brokerResponseJson != null"
        : null,
      priorWriteRows: priorWriteRows.map((r) => ({
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        ruleType: r.ruleType,
        hasBrokerResponse: r.brokerResponseJson != null,
      })),
      auditSummary,
    },
    activationVerdict: {
      phase,
      goNoGo,
      blockers,
      note: verdictNote,
    },
  });
}
