/**
 * GET /api/debug/daily-loss-activation-candidates
 *
 * Read-only diagnostic endpoint. Scans all connected accounts for the current
 * user and identifies which demo accounts are candidates for Daily Loss broker
 * enforcement activation.
 *
 * Per-account readiness phases:
 *   candidate_for_demo_activation   — all gates pass, AutoLiq known and clean
 *   preview_required                — account gates pass but no AutoLiq preview yet
 *   blocked_existing_locked_autoliq — changesLocked=true without Guardrail ownership
 *   blocked_not_demo                — platform is not tradovate or env is not demo
 *   blocked_account_inactive        — account.isActive=false
 *   blocked_missing_from_broker     — missingFromBrokerSince is set
 *   blocked_connection_not_live     — connectionStatus is in the non-live set
 *   blocked_not_full_access         — permissionLevel is not full_access
 *   blocked_invalid_external_account_id — externalAccountId cannot parse to a masterid
 *   blocked_no_daily_loss_rule      — maxDailyLoss is null or ≤ 0
 *   blocked_guardian_inactive       — guardianEnabled=false
 *   blocked_missing_consent         — automated-actions consent absent or stale
 *
 * Safety:
 *   - Read-only — no DB writes, no broker calls, no TradovateClient import
 *   - Auth: authenticated session + x-cron-secret header
 *   - User-scoped: only returns accounts owned by the current session user
 *   - No Tradovate API calls — uses DB + audit preview rows only
 *   - No secret values returned (no tokens, no encrypted fields, no raw allowlist)
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

type ReadinessStatus = "candidate" | "preview_required" | "blocked";

type ReadinessPhase =
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

type AccountReadiness = {
  status: ReadinessStatus;
  phase: ReadinessPhase;
  blockers: string[];
  warnings: string[];
  nextSafeAction: string;
};

function deriveReadiness(params: {
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
}): AccountReadiness {
  // Gate 1: must be a Tradovate demo account
  if (params.platform !== "tradovate" || params.env !== "demo") {
    return {
      status: "blocked",
      phase: "blocked_not_demo",
      blockers: [
        params.platform !== "tradovate" ? "platform_not_tradovate" : "env_not_demo",
      ],
      warnings: [],
      nextSafeAction:
        "This account is not a Tradovate demo account — not eligible for Daily Loss enforcement.",
    };
  }

  // Gate 2: account must be active
  if (!params.isActive) {
    return {
      status: "blocked",
      phase: "blocked_account_inactive",
      blockers: ["account_inactive"],
      warnings: [],
      nextSafeAction: "Activate the account before attempting enforcement.",
    };
  }

  // Gate 3: account must be present at broker
  if (params.missingFromBrokerSince != null) {
    return {
      status: "blocked",
      phase: "blocked_missing_from_broker",
      blockers: ["account_missing_from_broker"],
      warnings: [],
      nextSafeAction:
        "Account is no longer visible in Tradovate — reconnect or re-provision.",
    };
  }

  // Gate 4: connection must be live
  const connStatus = params.connectionStatus ?? "not_connected";
  if (NON_LIVE_CONNECTION_STATUSES.has(connStatus)) {
    return {
      status: "blocked",
      phase: "blocked_connection_not_live",
      blockers: [`connection_status_${connStatus}`],
      warnings: [],
      nextSafeAction: `Reconnect the Tradovate broker connection (current status: ${connStatus}).`,
    };
  }

  // Gate 5: must have full_access permission
  if (params.permissionLevel !== "full_access") {
    return {
      status: "blocked",
      phase: "blocked_not_full_access",
      blockers: [`permission_level_${params.permissionLevel ?? "null"}`],
      warnings: [],
      nextSafeAction:
        "Re-authenticate with 'Account Risk Settings: Full Access' to enable enforcement writes.",
    };
  }

  // Gate 6: externalAccountId must be a valid Tradovate masterid
  if (!params.validExternalAccountId) {
    return {
      status: "blocked",
      phase: "blocked_invalid_external_account_id",
      blockers: ["invalid_external_account_id"],
      warnings: [],
      nextSafeAction:
        "Re-sync the account to populate a valid Tradovate masterid.",
    };
  }

  // Gate 7: maxDailyLoss rule must be positive
  if (params.maxDailyLoss == null || params.maxDailyLoss <= 0) {
    return {
      status: "blocked",
      phase: "blocked_no_daily_loss_rule",
      blockers: ["max_daily_loss_not_positive"],
      warnings: [],
      nextSafeAction:
        "Configure a positive maxDailyLoss rule for this account before enabling enforcement.",
    };
  }

  // Gate 8: Guardian must be enabled
  if (!params.guardianEnabled) {
    return {
      status: "blocked",
      phase: "blocked_guardian_inactive",
      blockers: ["guardian_inactive"],
      warnings: [],
      nextSafeAction:
        "Enable Guardian for this user before activating broker enforcement.",
    };
  }

  // Gate 9: automated-actions consent must be present and version-matched
  if (!params.consentValid) {
    return {
      status: "blocked",
      phase: "blocked_missing_consent",
      blockers: ["missing_or_stale_automated_actions_consent"],
      warnings: [],
      nextSafeAction: `User must confirm automated-actions consent (version '${AUTOMATED_ACTIONS_CONSENT_VERSION}') on the rule record.`,
    };
  }

  // Gate D1: if preview exists and existing AutoLiq is locked without Guardrail ownership
  if (params.previewExists && params.existingChangesLocked === true && !params.hasGuardrailOwnedWrite) {
    return {
      status: "blocked",
      phase: "blocked_existing_locked_autoliq",
      blockers: ["preexisting_locked_autoliq_not_guardrail_owned"],
      warnings: [
        "Existing Tradovate AutoLiq has changesLocked=true but no prior Guardrail write is on record.",
        "This may be a prop-firm or Tradovate-managed risk setting.",
      ],
      nextSafeAction:
        "Do not run apply=true on this account. Use a clean demo account or investigate the origin of the existing AutoLiq record.",
    };
  }

  // No preview available — cannot assess AutoLiq state
  if (!params.previewExists) {
    return {
      status: "preview_required",
      phase: "preview_required",
      blockers: [],
      warnings: ["No recovery probe preview exists — AutoLiq state unknown."],
      nextSafeAction:
        "Run GET /api/debug/broker-enforcement/daily-loss-recovery-probe?mode=read_only to populate the AutoLiq state before proceeding.",
    };
  }

  return {
    status: "candidate",
    phase: "candidate_for_demo_activation",
    blockers: [],
    warnings: [],
    nextSafeAction:
      "Account is structurally ready. Activate by: (1) adding to BROKER_ENFORCEMENT_DEMO_ACCOUNT_ALLOWLIST, (2) setting BROKER_ENFORCEMENT_ENABLED=true. Review ENFORCEMENT_DRY_RUN flag first.",
  };
}

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

  // ── Fetch all user accounts ───────────────────────────────────────────────────
  const accounts = await prisma.connectedAccount.findMany({
    where: { userId: currentUser.id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      label: true,
      externalAccountId: true,
      platform: true,
      isActive: true,
      missingFromBrokerSince: true,
      brokerConnectionId: true,
      brokerConnection: {
        select: {
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

  const accountIds = accounts.map((a) => a.id);

  // ── Per-user data + bulk audit rows (fetched in parallel) ─────────────────────
  const [defaultRules, guardianProfile, allPreviewAudits, allWriteAudits] = await Promise.all([
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
    accountIds.length > 0
      ? prisma.brokerRiskSettingsSyncAudit.findMany({
          where: {
            accountId: { in: accountIds },
            outcome: "preview",
            ruleType: "daily_loss_recovery_probe",
          },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            accountId: true,
            createdAt: true,
            payloadPreviewJson: true,
          },
        })
      : Promise.resolve([]),
    accountIds.length > 0
      ? prisma.brokerRiskSettingsSyncAudit.findMany({
          where: {
            accountId: { in: accountIds },
            outcome: "success",
            ruleType: { in: ["daily_loss_limit", "daily_loss_recovery_probe"] },
          },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            accountId: true,
            ruleType: true,
            brokerResponseJson: true,
            createdAt: true,
          },
          take: 50,
        })
      : Promise.resolve([]),
  ]);

  // ── Index audit rows by accountId ─────────────────────────────────────────────
  // Most recent preview per account (allPreviewAudits already ordered desc)
  const latestPreviewByAccount = new Map<string, (typeof allPreviewAudits)[0]>();
  for (const row of allPreviewAudits) {
    if (row.accountId == null) {
      continue;
    }
    if (!latestPreviewByAccount.has(row.accountId)) {
      latestPreviewByAccount.set(row.accountId, row);
    }
  }

  const writesByAccount = new Map<string, (typeof allWriteAudits)>();
  for (const row of allWriteAudits) {
    if (row.accountId == null) {
      continue;
    }
    const existing = writesByAccount.get(row.accountId) ?? [];
    existing.push(row);
    writesByAccount.set(row.accountId, existing);
  }

  // ── Env posture ───────────────────────────────────────────────────────────────
  const allowlistRaw = process.env.BROKER_ENFORCEMENT_DEMO_ACCOUNT_ALLOWLIST;
  const allowlistIds = parseBrokerEnforcementAllowlist(allowlistRaw);
  const guardianEnabled = guardianProfile?.guardianEnabled ?? true;

  // ── Build per-account results ─────────────────────────────────────────────────
  const results = accounts.map((account) => {
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

    const env = account.brokerConnection?.env ?? null;
    const connectionStatus = account.brokerConnection?.connectionStatus ?? null;
    const permissionLevel = account.brokerConnection?.permissionLevel ?? null;
    const validExternalAccountId = parseTradovateMasterId(account.externalAccountId) !== null;
    const allowlisted = allowlistIds.includes(account.id);

    // AutoLiq state from latest preview audit (DB-only, no live read)
    const previewRow = latestPreviewByAccount.get(account.id) ?? null;
    let latestAutoLiqPreview: {
      exists: boolean;
      dailyLossAutoLiq: number | null;
      changesLocked: boolean | null;
      doNotUnlock: boolean | null;
      previewAuditId: string | null;
      previewCreatedAt: string | null;
      existingAutoLiqStatus: "known" | "no_existing_autoliq" | "unknown_preview_required";
    };

    if (previewRow != null) {
      const payload = previewRow.payloadPreviewJson as Record<string, unknown> | null;
      const existing = payload?.existing as Record<string, unknown> | null | undefined;
      const dailyLossAutoLiq =
        existing != null && typeof existing.dailyLossAutoLiq === "number"
          ? existing.dailyLossAutoLiq
          : null;
      const changesLocked =
        existing != null && typeof existing.changesLocked === "boolean"
          ? existing.changesLocked
          : null;
      const doNotUnlock =
        existing != null && typeof existing.doNotUnlock === "boolean"
          ? existing.doNotUnlock
          : null;
      latestAutoLiqPreview = {
        exists: existing != null,
        dailyLossAutoLiq,
        changesLocked,
        doNotUnlock,
        previewAuditId: previewRow.id,
        previewCreatedAt: previewRow.createdAt.toISOString(),
        existingAutoLiqStatus: existing != null ? "known" : "no_existing_autoliq",
      };
    } else {
      latestAutoLiqPreview = {
        exists: false,
        dailyLossAutoLiq: null,
        changesLocked: null,
        doNotUnlock: null,
        previewAuditId: null,
        previewCreatedAt: null,
        existingAutoLiqStatus: "unknown_preview_required",
      };
    }

    // Ownership evidence
    const writeRows = writesByAccount.get(account.id) ?? [];
    const hasGuardrailOwnedWrite = writeRows.some((r) => r.brokerResponseJson != null);
    const hasAnyBrokerWrite = writeRows.some(
      (r) => r.brokerResponseJson != null && r.ruleType !== "daily_loss_recovery_probe",
    );
    const latestRecoveryPreview = previewRow
      ? { id: previewRow.id, createdAt: previewRow.createdAt.toISOString() }
      : null;

    // Readiness verdict
    const readiness = deriveReadiness({
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
      existingChangesLocked: latestAutoLiqPreview.changesLocked,
    });

    return {
      id: account.id,
      label: account.label,
      externalAccountId: account.externalAccountId,
      platform: account.platform,
      env,
      connectionStatus,
      permissionLevel,
      isActive: account.isActive,
      missingFromBrokerSince: account.missingFromBrokerSince?.toISOString() ?? null,
      brokerConnectionId: account.brokerConnectionId,
      maxDailyLoss,
      guardianEnabled,
      consentValid,
      consentSource,
      validExternalAccountId,
      allowlisted,
      hasAccountRiskRules: account.riskRules != null,
      latestAutoLiqPreview,
      ownership: {
        hasGuardrailOwnedWrite,
        hasAnyBrokerWrite,
        latestRecoveryPreview,
      },
      readiness,
    };
  });

  // ── Summary ───────────────────────────────────────────────────────────────────
  const demoTradovateAccounts = results.filter(
    (r) => r.platform === "tradovate" && r.env === "demo",
  );
  const candidates = results.filter((r) => r.readiness.status === "candidate");
  const previewRequired = results.filter((r) => r.readiness.status === "preview_required");
  const blocked = results.filter((r) => r.readiness.status === "blocked");
  const recommendedNextAccountId = candidates.length > 0 ? candidates[0].id : null;

  let globalNextSafeAction: string;
  if (candidates.length > 0) {
    globalNextSafeAction =
      `${candidates.length} candidate(s) found. Add to BROKER_ENFORCEMENT_DEMO_ACCOUNT_ALLOWLIST and set BROKER_ENFORCEMENT_ENABLED=true to activate.`;
  } else if (previewRequired.length > 0) {
    globalNextSafeAction =
      `${previewRequired.length} account(s) need a read_only recovery probe preview before candidacy can be assessed.`;
  } else {
    globalNextSafeAction =
      "No candidates found. Review blocked accounts — each has a nextSafeAction explaining what must be resolved.";
  }

  return NextResponse.json({
    ok: true,
    note: "Read-only diagnostic — no writes, no broker calls.",
    summary: {
      totalAccounts: results.length,
      demoTradovateAccounts: demoTradovateAccounts.length,
      candidates: candidates.length,
      previewRequired: previewRequired.length,
      blocked: blocked.length,
      recommendedNextAccountId,
      globalNextSafeAction,
    },
    accounts: results,
  });
}
