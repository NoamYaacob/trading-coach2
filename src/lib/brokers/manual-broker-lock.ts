/**
 * Manual broker-lock orchestrator — the broker-side half of the user-initiated
 * Dashboard "Lockout" button.
 *
 * Authorization model (deliberately different from automatic enforcement):
 *   A manual lock is authorized by the user's explicit click + confirmation, so
 *   it is NOT gated by BROKER_ENFORCEMENT_ENABLED, the demo-only restriction, or
 *   the account allowlist (those gate the automatic listener path). It DOES
 *   still require:
 *     - a live (non-expired/non-error) Tradovate connection, and
 *     - Account Risk Settings: Full Access permission.
 *
 * It reuses the exact same safe risk-setting write path as daily-loss
 * enforcement — TradovateClient.applyDailyLossLock (userAccountAutoLiq/update
 * or /create). It NEVER places, cancels, or flattens orders.
 *
 * This module intentionally does NOT call applyBrokerDayLockout:
 *   - keeping the manual path isolated means the automatic daily-loss
 *     enforcement code is untouched (no regression), and
 *   - the manual path is not subject to the automated-action consent gate (the
 *     explicit confirmation modal is the consent for a user-initiated action).
 *
 * No listener-worker code is touched.
 */

import { prisma } from "../db";
import { TradovateClient } from "./tradovate-client";
import { TradovateClientError } from "./tradovate-client-helpers";
import {
  shouldSkipManualBrokerLock,
  isEnforcementDryRun,
  type BrokerLockStatus,
} from "./enforcement-helpers";

export type ManualBrokerLockResult = {
  status: BrokerLockStatus;
  /** Human-readable outcome — safe to surface (no tokens / no raw broker body). */
  message: string;
  brokerEndpoint: string | null;
  brokerPayload: Record<string, unknown> | null;
  brokerResponse: unknown;
};

/**
 * Threshold sent to Tradovate to lock the account immediately. Setting
 * dailyLossAutoLiq=0 means the account is at/below its max-loss threshold the
 * moment the write lands, so Tradovate's risk engine blocks new opening orders
 * for the rest of the CME session. This is the same field daily-loss
 * enforcement writes — no new risk surface.
 */
const MANUAL_LOCK_LOSS_THRESHOLD = 0;

/**
 * Attempt a broker-side lock for a user-initiated manual lockout.
 *
 * Returns a structured result describing the outcome and the exact endpoint /
 * payload / response for audit. Never throws for an expected broker condition
 * (permission gap, non-live connection, write failure) — those are mapped to a
 * status. The caller records the result and must NOT roll back the internal
 * Guardrail lock on a broker failure.
 */
export async function applyManualBrokerLock(ctx: {
  accountId: string;
  userId: string;
}): Promise<ManualBrokerLockResult> {
  const { accountId, userId } = ctx;

  const account = await prisma.connectedAccount.findUnique({
    where: { id: accountId },
    select: {
      platform: true,
      externalAccountId: true,
      isActive: true,
      missingFromBrokerSince: true,
      brokerConnection: {
        select: { connectionStatus: true, permissionLevel: true },
      },
    },
  });

  // Account availability — never write for an inactive / missing account.
  if (account == null || !account.isActive || account.missingFromBrokerSince != null) {
    const why =
      account == null
        ? "not found"
        : !account.isActive
          ? "inactive (archived)"
          : "no longer returned by Tradovate";
    return {
      status: "broker_lock_failed",
      message: `Broker lock skipped: account is ${why}. No broker write attempted.`,
      brokerEndpoint: null,
      brokerPayload: null,
      brokerResponse: null,
    };
  }

  const platform = account.platform ?? "unknown";
  const connStatus = account.brokerConnection?.connectionStatus ?? "not_connected";
  const permissionLevel = account.brokerConnection?.permissionLevel ?? null;

  // Use the manual-specific gate: never blocks on connected_readonly alone when
  // permissionLevel=full_access. Does not check the automatic-enforcement env
  // gates (BROKER_ENFORCEMENT_ENABLED / demo-only / allowlist) — the user's
  // explicit confirmation is the authorization.
  const skip = shouldSkipManualBrokerLock({
    platform,
    connectionStatus: connStatus,
    permissionLevel,
  });
  if (skip.skip) {
    return {
      status: skip.lockStatus,
      message: skip.reason,
      brokerEndpoint: null,
      brokerPayload: null,
      brokerResponse: null,
    };
  }

  // Dry-run: simulate the intended write; never instantiate the client or call
  // Tradovate. The internal Guardrail lock (set by the caller) still applies.
  if (isEnforcementDryRun()) {
    const tvAccountId =
      account.externalAccountId != null ? parseInt(account.externalAccountId, 10) : null;
    const intendedPayload = {
      accountId: tvAccountId,
      dailyLossAutoLiq: MANUAL_LOCK_LOSS_THRESHOLD,
      changesLocked: true,
    };
    return {
      status: "dry_run",
      message:
        "Test mode · Broker lock simulated. No Tradovate write was sent. " +
        `Would have called userAccountAutoLiq/update (or /create) with ${JSON.stringify(intendedPayload)}.`,
      brokerEndpoint: "userAccountAutoLiq/update (or /create)",
      brokerPayload: intendedPayload,
      brokerResponse: null,
    };
  }

  // Live write — reuse the exact same risk-setting path daily-loss enforcement
  // uses. No flatten / liquidate / order placement / order cancellation.
  try {
    const client = new TradovateClient(accountId, userId);
    await client.initialize();
    const result = await client.applyDailyLossLock({
      lossAmountToSet: MANUAL_LOCK_LOSS_THRESHOLD,
      changesLocked: true,
    });

    if (result.confirmed) {
      return {
        status: "broker_locked",
        message:
          "Broker lock active — Tradovate confirmed the account risk setting. " +
          "No new opening orders for the rest of this CME session.",
        brokerEndpoint: result.endpoint,
        brokerPayload: result.payload,
        brokerResponse: result.response,
      };
    }
    return {
      status: "broker_lock_failed",
      message:
        "Broker write was sent but Tradovate did not confirm the locked risk setting. " +
        "Guardrail is still enforcing internally.",
      brokerEndpoint: result.endpoint,
      brokerPayload: result.payload,
      brokerResponse: result.response,
    };
  } catch (err) {
    // 403 → Account Risk Settings: Full Access scope gap (capability limit, not
    // a global auth failure). Everything else → generic broker failure. Only
    // err.message (our own classification text) is surfaced — never the raw
    // response body — so no secrets leak.
    const isPermission = err instanceof TradovateClientError && err.statusCode === 403;
    const status: BrokerLockStatus = isPermission ? "unavailable_permission" : "broker_lock_failed";
    const message = isPermission
      ? "Broker lock unavailable: Tradovate returned 403 (Account Risk Settings: Full Access required). " +
        "Guardrail is still enforcing internally."
      : `Broker lock failed: ${err instanceof Error ? err.message : "unknown error"}. ` +
        "Guardrail is still enforcing internally.";
    return {
      status,
      message,
      brokerEndpoint: null,
      brokerPayload: null,
      brokerResponse: null,
    };
  }
}
