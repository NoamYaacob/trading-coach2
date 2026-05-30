import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  buildDisconnectUpdate,
  buildNoRevocationResult,
  buildSkippedCleanupResult,
  buildSucceededCleanupResult,
  buildFailedCleanupResult,
  classifyBrokerCleanupError,
  platformHasRevocationEndpoint,
  shouldAttemptBrokerCleanup,
} from "@/lib/brokers/tradovate-disconnect";
import { getProtectionLockState } from "@/lib/account-protection";
import {
  deriveRuleEditEligibility,
  buildRuleEditLockMessage,
} from "@/lib/rule-edit-eligibility";
import { AUTOMATED_ACTIONS_CONSENT_VERSION } from "@/lib/brokers/automated-actions-consent";
import { type RiskRulesBody, riskRulesData } from "./risk-rules-data";
import { validateRiskRulesBody } from "./risk-rules-validate";
import { TradovateClient } from "@/lib/brokers/tradovate-client";
import { writeRuleChangeAudit } from "@/lib/rules/rule-change-audit-writer";
import { getAccountIdsWithTradeToday } from "@/lib/rules/session-trade-guard";
import { deriveCmeTradingDayKey } from "@/lib/trading-day";
import { getCmeSessionStartForKey } from "@/lib/time/cme-session";
import { executeDailyLossSync } from "./daily-loss-sync";
import { writeBrokerRiskSettingsSyncAudit } from "@/lib/brokers/broker-risk-settings-sync-audit-writer";

type Ctx = { params: Promise<{ id: string }> };

const VALID_PLATFORMS = ["tradovate", "tradingview", "manual"] as const;
const VALID_ACCOUNT_TYPES = ["evaluation", "funded", "personal", "demo"] as const;

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;

  const existing = await prisma.connectedAccount.findFirst({
    where: { id, userId: currentUser.id },
  });
  if (!existing) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const body = (await req.json()) as {
    label?: string;
    /** Optional user-facing name. Trimmed; empty string clears it back to null
     *  so the friendly fallback label applies again. */
    displayName?: string | null;
    platform?: string;
    propFirm?: string | null;
    accountType?: string;
    externalAccountId?: string | null;
    currency?: string;
    isActive?: boolean;
    riskRules?: RiskRulesBody | null;
    /** When true, stamp automatedActionsConsentAt + Version on the saved
     *  AccountRiskRules row. Required before broker-side automated actions
     *  can fire on this account. */
    automatedActionsConsentChecked?: boolean;
  };

  const platform = VALID_PLATFORMS.includes(body.platform as (typeof VALID_PLATFORMS)[number])
    ? (body.platform as (typeof VALID_PLATFORMS)[number])
    : undefined;

  const accountType = VALID_ACCOUNT_TYPES.includes(
    body.accountType as (typeof VALID_ACCOUNT_TYPES)[number],
  )
    ? (body.accountType as (typeof VALID_ACCOUNT_TYPES)[number])
    : undefined;

  // Validate risk rule integer ranges before any DB write so a 123 or 0.5
  // can't reach AccountRiskRules even if the client bypassed the dropdown.
  const ruleErr = validateRiskRulesBody(body.riskRules);
  if (ruleErr) {
    return NextResponse.json({ error: ruleErr.message }, { status: 400 });
  }

  // Block deactivating a protected/monitor-only account while the session is locked.
  // Bypass for unavailable accounts (missingFromBrokerSince is set) and ignored accounts —
  // there is no active monitoring to disrupt.
  const isUnavailableForDeactivation =
    existing.missingFromBrokerSince != null ||
    existing.protectionStatus === "ignored" ||
    existing.protectionStatus === "archived";
  if (
    !isUnavailableForDeactivation &&
    body.isActive === false &&
    (existing.protectionStatus === "protected" || existing.protectionStatus === "monitor_only")
  ) {
    const userRules = await prisma.riskRules.findUnique({
      where: { userId: currentUser.id },
      select: { sessionStartHour: true, sessionEndHour: true, protectionLockCutoffMinutes: true },
    });
    const lock = getProtectionLockState({
      sessionStartHour: userRules?.sessionStartHour ?? null,
      sessionEndHour: userRules?.sessionEndHour ?? null,
      cutoffMinutes: userRules?.protectionLockCutoffMinutes ?? null,
    });
    if (lock.isLocked) {
      return NextResponse.json(
        {
          error: "protection_locked",
          message:
            "This account is protected during today's trading session. Deactivating is blocked until the session ends.",
        },
        { status: 409 },
      );
    }
  }

  const account = await prisma.connectedAccount.update({
    where: { id },
    data: {
      ...(body.label !== undefined && { label: body.label }),
      ...(body.displayName !== undefined && {
        displayName: body.displayName?.trim() || null,
      }),
      ...(platform !== undefined && { platform }),
      ...(body.propFirm !== undefined && { propFirm: body.propFirm }),
      ...(accountType !== undefined && { accountType }),
      ...(body.externalAccountId !== undefined && {
        externalAccountId: body.externalAccountId?.trim() || null,
        // Keep live status if already connected — only walk back if ID is cleared.
        ...(existing.connectionStatus !== "connected_live"
          ? { connectionStatus: body.externalAccountId?.trim() ? "pending_webhook" : "not_connected" }
          : !body.externalAccountId?.trim()
            ? { connectionStatus: "not_connected", connectedAt: null }
            : {}),
      }),
      ...(body.currency !== undefined && { currency: body.currency }),
      ...(body.isActive !== undefined && { isActive: body.isActive }),
    },
  });

  let rulesLockResult:
    | { applied: false; reason: string; effectiveDate: string; message: string }
    | null = null;

  if (body.riskRules !== undefined) {
    // Check the user's rule-edit eligibility before mutating account rules.
    const [userRules, existingAccountRules, liveState, guardianStatus] = await Promise.all([
      prisma.riskRules.findUnique({
        where: { userId: currentUser.id },
        select: {
          sessionStartHour: true,
          sessionEndHour: true,
          sessionTimezone: true,
          ruleEditLockBufferMinutes: true,
          sessionStartTime: true,
          sessionEndTime: true,
          sessionPresetsJson: true,
        },
      }),
      prisma.accountRiskRules.findUnique({
        where: { accountId: id },
        select: { accountId: true },
      }),
      prisma.liveSessionState.findUnique({
        where: { accountId: id },
        select: { riskState: true, cooldownActive: true, tradesCount: true, sessionDate: true, lastTradeAt: true },
      }),
      prisma.guardianStatus.findUnique({
        where: { userId: currentUser.id },
        select: { currentLockoutActive: true },
      }),
    ]);
    const isFirstTimeSetup = !existingAccountRules;
    const isAccountStopped =
      liveState?.riskState === "STOPPED" || liveState?.cooldownActive === true;
    const hasProtectionLockToday =
      isAccountStopped || guardianStatus?.currentLockoutActive === true;

    // ── Hard reject: riskState=STOPPED blocks rule changes (not first-time setup) ──
    const ip =
      req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? null;
    const userAgent = req.headers.get("user-agent") ?? null;
    if (liveState?.riskState === "STOPPED" && !isFirstTimeSetup) {
      await writeRuleChangeAudit({
        userId: currentUser.id,
        accountId: id,
        scope: "account",
        newValuesJson: (body.riskRules ?? {}) as Record<string, unknown>,
        allowed: false,
        reason: "account_stopped",
        blockReason: "account_stopped",
        sessionRiskState: "STOPPED",
        ip,
        userAgent,
      });
      return NextResponse.json(
        {
          error:
            "Rules are locked for this account right now because protection is active. You can edit them after the lock clears.",
        },
        { status: 423 },
      );
    }

    // ── Hard reject: account has already traded this session ──────────────────
    // Multiple signals are checked to close the first-fill race window: the user
    // may enter a trade and immediately edit rules before the next sync runs and
    // increments tradesCount / updates sessionDate.
    const tradingDayKey = deriveCmeTradingDayKey(new Date());
    const sessionStart = getCmeSessionStartForKey(tradingDayKey);

    // Signal 1 & 2: LiveSessionState (may lag on first fill of the session)
    const liveStateHasTraded =
      (liveState?.sessionDate === tradingDayKey && (liveState?.tradesCount ?? 0) > 0) ||
      (liveState?.lastTradeAt != null &&
        deriveCmeTradingDayKey(liveState.lastTradeAt) === tradingDayKey);

    // Signal 3: NormalizedTradeEvent — written immediately on first fill,
    // before tradesCount/sessionDate are updated by the sync cron.
    const accountsWithTrades = await getAccountIdsWithTradeToday([id], sessionStart);
    const hasTradeEventToday = accountsWithTrades.has(id);

    if (!isFirstTimeSetup && (liveStateHasTraded || hasTradeEventToday)) {
      await writeRuleChangeAudit({
        userId: currentUser.id,
        accountId: id,
        scope: "account",
        newValuesJson: (body.riskRules ?? {}) as Record<string, unknown>,
        allowed: false,
        reason: "session_already_traded",
        blockReason: "session_already_traded",
        sessionRiskState: liveState?.riskState ?? null,
        ip,
        userAgent,
      });
      return NextResponse.json(
        {
          error: "session_already_traded",
          message:
            "You already started trading this account today. To protect your rules, changes will be available next trading day.",
        },
        { status: 423 },
      );
    }

    const userRulesPresetsJson = userRules?.sessionPresetsJson ?? null;
    const eligibility = deriveRuleEditEligibility({
      selectedSessionPresets: userRulesPresetsJson ? JSON.parse(userRulesPresetsJson) : null,
      sessionStartHour: userRules?.sessionStartHour ?? null,
      sessionEndHour: userRules?.sessionEndHour ?? null,
      sessionStartTime: userRules?.sessionStartTime ?? null,
      sessionEndTime: userRules?.sessionEndTime ?? null,
      sessionTimezone: userRules?.sessionTimezone ?? null,
      lockBufferMinutes: userRules?.ruleEditLockBufferMinutes ?? null,
      // First-time setup bypasses state-based locks: no active rules to weaken.
      isAccountStopped: isFirstTimeSetup ? false : isAccountStopped,
      hasProtectionLockToday: isFirstTimeSetup ? false : hasProtectionLockToday,
    });

    // When the broker connection is not live (expired, disconnected, etc.) the
    // account cannot be actively trading, so rule changes are safe to apply
    // immediately regardless of session-timing locks.
    const accountIsNotLive = existing.connectionStatus !== "connected_live";

    if (!eligibility.canEditNow && !isFirstTimeSetup && !accountIsNotLive) {
      // Save the requested change as a pending payload that will apply on
      // the next trading day. Do NOT mutate AccountRiskRules columns now.
      const nextDayKey = eligibility.nextAllowedAt
        ? eligibility.nextAllowedAt.toISOString().slice(0, 10)
        : new Date(Date.now() + 24 * 60 * 60_000).toISOString().slice(0, 10);
      const payload =
        body.riskRules === null ? { __delete: true } : riskRulesData(body.riskRules);
      await prisma.accountRiskRules.upsert({
        where: { accountId: id },
        create: {
          accountId: id,
          pendingPayloadJson: payload as Prisma.InputJsonValue,
          pendingEffectiveDate: nextDayKey,
        },
        update: {
          pendingPayloadJson: payload as Prisma.InputJsonValue,
          pendingEffectiveDate: nextDayKey,
        },
      });
      const userExistingPresets: string[] | null = userRulesPresetsJson
        ? (JSON.parse(userRulesPresetsJson) as string[])
        : null;
      const lockMsgTz = userExistingPresets?.length
        ? "America/New_York"
        : (userRules?.sessionTimezone ?? null);
      rulesLockResult = {
        applied: false,
        reason: eligibility.reason,
        effectiveDate: nextDayKey,
        message: buildRuleEditLockMessage(eligibility, lockMsgTz),
      };
      // Audit: saved as pending
      await writeRuleChangeAudit({
        userId: currentUser.id,
        accountId: id,
        scope: "account",
        newValuesJson: (body.riskRules ?? {}) as Record<string, unknown>,
        allowed: true,
        reason: "saved_as_pending",
        blockReason: eligibility.reason ?? null,
        sessionRiskState: hasProtectionLockToday ? "LOCKED" : null,
        ip,
        userAgent,
      });
    } else if (body.riskRules === null) {
      await prisma.accountRiskRules.deleteMany({ where: { accountId: id } });
    } else {
      const data = riskRulesData(body.riskRules);
      const consentFields = body.automatedActionsConsentChecked
        ? {
            automatedActionsConsentAt: new Date(),
            automatedActionsConsentVersion: AUTOMATED_ACTIONS_CONSENT_VERSION,
          }
        : {};
      await prisma.accountRiskRules.upsert({
        where: { accountId: id },
        create: { accountId: id, ...data, ...consentFields },
        update: {
          ...data,
          ...consentFields,
          pendingPayloadJson: Prisma.JsonNull,
          pendingEffectiveDate: null,
        },
      });

      // Audit: successful save of account-specific rules
      await writeRuleChangeAudit({
        userId: currentUser.id,
        accountId: id,
        scope: "account",
        newValuesJson: body.riskRules as Record<string, unknown>,
        allowed: true,
        reason: "allowed",
        ip,
        userAgent,
      });

      // Sync broker-side Max Position Size when maxContracts is present in the
      // payload and the account is a connected Tradovate account. Fire-and-forget
      // (void) — a broker sync failure must NOT roll back the DB save; the
      // Guardrail DB value is authoritative and the broker sync can be retried.
      if (
        body.riskRules !== null &&
        "maxContracts" in body.riskRules &&
        existing.platform === "tradovate" &&
        existing.externalAccountId
      ) {
        void (async () => {
          try {
            const client = new TradovateClient(existing.id, currentUser.id);
            await client.initialize();
            const maxContracts = body.riskRules!.maxContracts ?? null;
            // global_raw only when user explicitly opts into raw broker hard limit;
            // default is app_side_only (standard-equivalent detection-response).
            // global_raw writes totalBy="Overall" — counts all contracts equally,
            // so 2 MNQ is rejected even when the standard-equivalent limit allows 10.
            const brokerEnforcementMode =
              body.riskRules!.rawBrokerHardLimitEnabled === true
                ? ("global_raw" as const)
                : ("app_side_only" as const);
            const result = await client.applyMaxPositionSize({
              maxContracts,
              brokerEnforcementMode,
            });
            console.info("[accounts/patch] broker max position size synced", {
              accountId: id,
              externalAccountId: existing.externalAccountId,
              maxContracts,
              brokerEnforcementMode,
              action: result.action,
              endpoints: result.endpoints,
            });
          } catch (err) {
            console.warn("[accounts/patch] broker max position size sync failed (non-fatal)", {
              accountId: id,
              externalAccountId: existing.externalAccountId,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        })();
      }

      // Sync Daily Loss risk setting to Tradovate when maxDailyLoss is saved.
      // Fire-and-forget (void) — broker sync failure must NOT roll back the DB save.
      // Gates (BROKER_ENFORCEMENT_ENABLED, env=demo, allowlist, guardian, etc.) are
      // evaluated inside executeDailyLossSync before any broker call is made.
      if (
        body.riskRules !== null &&
        "maxDailyLoss" in body.riskRules &&
        typeof body.riskRules.maxDailyLoss === "number" &&
        body.riskRules.maxDailyLoss > 0 &&
        existing.platform === "tradovate"
      ) {
        void (async () => {
          // brokerEnv is declared outside the try so the catch block can include it
          // in the audit row even if the execution path failed after the DB queries.
          let brokerEnv: string | null = null;
          const maxDailyLoss = body.riskRules!.maxDailyLoss as number;
          const baseAudit = {
            userId: currentUser.id,
            accountId: id,
            externalAccountId: existing.externalAccountId ?? null,
            brokerConnectionId: existing.brokerConnectionId ?? null,
            broker: "tradovate" as const,
            ruleType: "daily_loss_limit" as const,
            amount: maxDailyLoss,
            dryRun: process.env.ENFORCEMENT_DRY_RUN === "true",
            brokerEnforcementEnabled: process.env.BROKER_ENFORCEMENT_ENABLED === "true",
          };
          try {
            const [brokerConnection, guardianProfile, accountRulesForConsent, defaultRulesForConsent] = await Promise.all([
              existing.brokerConnectionId
                ? prisma.brokerConnection.findUnique({
                    where: { id: existing.brokerConnectionId },
                    select: { env: true, connectionStatus: true, permissionLevel: true },
                  })
                : null,
              prisma.guardianProfile.findUnique({
                where: { userId: currentUser.id },
                select: { guardianEnabled: true },
              }),
              prisma.accountRiskRules.findUnique({
                where: { accountId: id },
                select: {
                  automatedActionsConsentAt: true,
                  automatedActionsConsentVersion: true,
                },
              }),
              prisma.riskRules.findUnique({
                where: { userId: currentUser.id },
                select: {
                  automatedActionsConsentAt: true,
                  automatedActionsConsentVersion: true,
                },
              }),
            ]);
            brokerEnv = brokerConnection?.env ?? null;

            // Resolve consent the same way decideConsentGate does: account-level
            // record (if present) takes precedence over the user's default
            // RiskRules. The sync gate calls hasValidConsent on the resolved
            // pair (Gate 9 in canSyncTradovateRiskSettings).
            const consentState = accountRulesForConsent ?? defaultRulesForConsent ?? null;

            const outcome = await executeDailyLossSync(
              {
                accountId: id,
                userId: currentUser.id,
                maxDailyLoss,
                isActive: account.isActive,
                missingFromBroker: existing.missingFromBrokerSince != null,
                brokerConnectionEnv: brokerEnv,
                brokerConnectionStatus: brokerConnection?.connectionStatus ?? null,
                permissionLevel: brokerConnection?.permissionLevel ?? null,
                guardianEnabled: guardianProfile?.guardianEnabled ?? false,
                consentAt: consentState?.automatedActionsConsentAt ?? null,
                consentVersion: consentState?.automatedActionsConsentVersion ?? null,
                externalAccountId: existing.externalAccountId ?? null,
              },
              async () => {
                const client = new TradovateClient(existing.id, currentUser.id);
                await client.initialize();
                return client;
              },
            );

            console.info("[accounts/patch] daily loss sync outcome", {
              accountId: id,
              status: outcome.status,
              ...("gateFailureReason" in outcome && { gateFailureReason: outcome.gateFailureReason }),
              ...("payloadPreview" in outcome && { payloadPreview: outcome.payloadPreview }),
            });

            await writeBrokerRiskSettingsSyncAudit({
              ...baseAudit,
              environment: brokerEnv,
              outcome:
                outcome.status === "synced"
                  ? "success"
                  : outcome.status === "error"
                    ? "failed"
                    : outcome.status,
              gateFailureReason:
                "gateFailureReason" in outcome ? outcome.gateFailureReason : null,
              skipReason:
                "skipReason" in outcome
                  ? outcome.skipReason
                  : outcome.status === "skipped"
                    ? (outcome as { status: "skipped"; reason: string }).reason
                    : null,
              payloadPreviewJson:
                "payloadPreview" in outcome &&
                outcome.payloadPreview != null
                  ? (outcome.payloadPreview as Record<string, unknown>)
                  : null,
              brokerResponseJson:
                "brokerResponse" in outcome
                  ? outcome.brokerResponse
                  : null,
            });
          } catch (err) {
            console.warn("[accounts/patch] daily loss sync failed (non-fatal)", {
              accountId: id,
              error: err instanceof Error ? err.message : String(err),
            });
            await writeBrokerRiskSettingsSyncAudit({
              ...baseAudit,
              environment: brokerEnv,
              outcome: "failed",
              errorMessage: err instanceof Error ? err.message : String(err),
            });
          }
        })();
      }
    }
  }

  return NextResponse.json({ account, rulesLock: rulesLockResult });
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;

  const existing = await prisma.connectedAccount.findFirst({
    where: { id, userId: currentUser.id },
  });
  if (!existing) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Block disconnecting a protected account while the trading session is locked.
  // Bypass for unavailable accounts (no longer returned by the broker) and ignored accounts —
  // there is nothing active to protect, so removal is safe immediately.
  const canRemoveImmediately =
    existing.missingFromBrokerSince != null ||
    existing.protectionStatus === "ignored" ||
    existing.protectionStatus === "archived";
  if (
    !canRemoveImmediately &&
    (existing.protectionStatus === "protected" || existing.protectionStatus === "monitor_only")
  ) {
    const userRules = await prisma.riskRules.findUnique({
      where: { userId: currentUser.id },
      select: { sessionStartHour: true, sessionEndHour: true, protectionLockCutoffMinutes: true },
    });
    const lock = getProtectionLockState({
      sessionStartHour: userRules?.sessionStartHour ?? null,
      sessionEndHour: userRules?.sessionEndHour ?? null,
      cutoffMinutes: userRules?.protectionLockCutoffMinutes ?? null,
    });
    if (lock.isLocked) {
      return NextResponse.json(
        {
          error: "protection_locked",
          message:
            "This account is protected during today's trading session. Disconnect is blocked until the session ends.",
        },
        { status: 409 },
      );
    }
  }

  const revokeAttempted = platformHasRevocationEndpoint(existing.platform);
  const revokeSucceeded = false;

  console.info("[accounts/disconnect] disconnecting broker account", {
    accountId: id,
    userId: currentUser.id,
    platform: existing.platform,
    revokeAttempted,
  });

  // ── Best-effort broker-side cleanup ────────────────────────────────────────
  // Before deleting local tokens, attempt to deactivate any Guardrail-owned
  // broker rules (identified by description = "Guardrail Max Position Size").
  // User- or prop-firm-created settings are never touched — the position-limit
  // helpers guard against that using the description field.
  //
  // For userAccountAutoLiq records: Tradovate provides no ownership marker on
  // those records, so we cannot safely distinguish Guardrail-set values from
  // user-set ones. autoLiq cleanup is intentionally skipped.
  //
  // Failure is non-fatal: we always proceed to local disconnect so the user
  // is never left in a half-disconnected state.
  let cleanupResult = buildSkippedCleanupResult();
  if (shouldAttemptBrokerCleanup(existing)) {
    try {
      const client = new TradovateClient(existing.id, currentUser.id);
      await client.initialize();
      const posResult = await client.applyMaxPositionSize({ maxContracts: null });
      cleanupResult = buildSucceededCleanupResult();
      console.info("[accounts/disconnect] broker cleanup succeeded", {
        accountId: id,
        action: posResult.action,
        endpoints: posResult.endpoints,
      });
    } catch (err) {
      cleanupResult = buildFailedCleanupResult(err);
      const errorClass = classifyBrokerCleanupError(err);
      console.warn("[accounts/disconnect] broker cleanup failed (non-fatal, proceeding with local disconnect)", {
        accountId: id,
        errorClass,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ── Local disconnect ────────────────────────────────────────────────────────
  const update = buildDisconnectUpdate();
  await prisma.connectedAccount.update({
    where: { id },
    data: update,
  });

  console.info("[accounts/disconnect] local disconnect succeeded", {
    accountId: id,
    platform: existing.platform,
    cleanupAttempted: cleanupResult.attempted,
    cleanupSucceeded: cleanupResult.succeeded,
  });

  if (!revokeAttempted) {
    void buildNoRevocationResult();
  }

  return NextResponse.json({
    ok: true,
    revokeAttempted,
    revokeSucceeded,
    cleanupAttempted: cleanupResult.attempted,
    cleanupSucceeded: cleanupResult.succeeded,
    cleanupWarning: cleanupResult.warning,
  });
}
