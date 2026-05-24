/**
 * Wire-up helper for syncing a saved daily loss rule to Tradovate Risk Settings.
 *
 * This module is the call site for `syncDailyLossRiskSettingToTradovate` from
 * the account rules PATCH handler. It:
 *   - Reads BROKER_ENFORCEMENT_ENABLED / ENFORCEMENT_DRY_RUN / BROKER_ENFORCEMENT_DEMO_ACCOUNT_ALLOWLIST
 *   - Evaluates gates before creating a TradovateClient (avoids unnecessary I/O)
 *   - Routes to simulate (dry-run) or live sync accordingly
 *
 * SAFETY CONTRACT: this file must NEVER import from broker-enforcement-gate.ts or
 * broker-enforcement-service.ts — the rule-save sync path and listener-path must
 * remain independent.
 */

import { parseBrokerEnforcementAllowlist } from "@/lib/guardian-engine/broker-enforcement-gate";
import {
  canSyncTradovateRiskSettings,
  simulateTradovateRiskSettingsSync,
  syncDailyLossRiskSettingToTradovate,
  type SyncInput,
} from "@/lib/brokers/tradovate-risk-settings-service";
import type { TradovateClient } from "@/lib/brokers/tradovate-client";

export type DailyLossSyncContext = {
  accountId: string;
  userId: string;
  maxDailyLoss: number;
  isActive: boolean;
  missingFromBroker: boolean;
  brokerConnectionEnv: string | null;
  brokerConnectionStatus: string | null;
  permissionLevel: string | null;
  guardianEnabled: boolean;
  /**
   * Persisted automated-actions consent state for this account. The caller
   * resolves AccountRiskRules (account-specific) → RiskRules (default) and
   * passes the resolved values. Pass nulls when no consent has been recorded.
   */
  consentAt: Date | null;
  consentVersion: string | null;
  /** Raw externalAccountId from ConnectedAccount; validated by Gate 10. */
  externalAccountId: string | null;
};

export type DailyLossSyncOutcome =
  | { status: "skipped"; reason: string }
  | { status: "gate_blocked"; gateFailureReason: string | null; skipReason: string }
  | { status: "dry_run"; payloadPreview: Record<string, unknown> | null }
  | { status: "synced"; brokerResponse: unknown }
  | { status: "error"; error: string };

/** Returns true when accountId is in BROKER_ENFORCEMENT_DEMO_ACCOUNT_ALLOWLIST. */
export function isAccountAllowlisted(accountId: string): boolean {
  const raw = process.env.BROKER_ENFORCEMENT_DEMO_ACCOUNT_ALLOWLIST;
  return parseBrokerEnforcementAllowlist(raw).includes(accountId);
}

/**
 * Executes the daily loss sync with full gate evaluation.
 *
 * Order of operations:
 *   1. Skip immediately if maxDailyLoss ≤ 0
 *   2. Build SyncInput from ctx + process.env
 *   3. Evaluate gates — return gate_blocked without creating a client if any fail
 *   4. If ENFORCEMENT_DRY_RUN=true → use simulateTradovateRiskSettingsSync (no client)
 *   5. Otherwise → call clientFactory(), then syncDailyLossRiskSettingToTradovate
 */
export async function executeDailyLossSync(
  ctx: DailyLossSyncContext,
  clientFactory: () => Promise<TradovateClient>,
): Promise<DailyLossSyncOutcome> {
  if (ctx.maxDailyLoss <= 0) {
    return { status: "skipped", reason: "maxDailyLoss is zero or negative" };
  }

  const input: SyncInput = {
    brokerEnforcementEnabled: process.env.BROKER_ENFORCEMENT_ENABLED === "true",
    env: ctx.brokerConnectionEnv ?? "unknown",
    isActive: ctx.isActive,
    missingFromBroker: ctx.missingFromBroker,
    connectionStatus: ctx.brokerConnectionStatus,
    permissionLevel: ctx.permissionLevel,
    accountAllowlisted: isAccountAllowlisted(ctx.accountId),
    guardianEnabled: ctx.guardianEnabled,
    consentAt: ctx.consentAt,
    consentVersion: ctx.consentVersion,
    externalAccountId: ctx.externalAccountId,
    maxDailyLoss: ctx.maxDailyLoss,
  };

  // Check gates before creating client — avoids TradovateClient.initialize() when blocked.
  const gateResult = canSyncTradovateRiskSettings(input);
  if (!gateResult.allowed) {
    return {
      status: "gate_blocked",
      gateFailureReason: gateResult.gateFailureReason,
      skipReason: gateResult.skipReason!,
    };
  }

  // Dry-run path: gates passed but live writes are suppressed.
  if (process.env.ENFORCEMENT_DRY_RUN === "true") {
    const simResult = await simulateTradovateRiskSettingsSync(input);
    return {
      status: "dry_run",
      payloadPreview: simResult.attempted ? simResult.payloadPreview : null,
    };
  }

  const client = await clientFactory();
  const syncResult = await syncDailyLossRiskSettingToTradovate(input, client);

  if (syncResult.synced) {
    return { status: "synced", brokerResponse: syncResult.brokerResponse };
  }
  if (syncResult.auditNote === "dry_run") {
    return { status: "dry_run", payloadPreview: syncResult.payloadPreview };
  }
  const gateFailureReason =
    "gateFailureReason" in syncResult ? syncResult.gateFailureReason : null;
  return {
    status: "gate_blocked",
    gateFailureReason,
    skipReason: syncResult.skipReason,
  };
}
