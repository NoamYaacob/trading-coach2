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
 *
 * Safety invariants:
 *   - changesLocked is always sent as FALSE for the manual/emergency path.
 *     Sending changesLocked:true caused the broker-side lock to persist beyond
 *     the CME daily session reset (Tradovate's "Will release by 6:00 PM ET"
 *     hint is suppressed when changesLocked=true). With changesLocked:false the
 *     daily session reset at 6 PM ET will naturally clear dailyLossAutoLiq,
 *     and the user can also manually reset it from the Tradovate UI.
 *   - accountType/env mismatch is refused before any broker write. A demo
 *     account must use a demo BrokerConnection; a live account must use a live
 *     BrokerConnection. Any mismatch returns broker_lock_failed immediately.
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
 * changesLocked=false is intentional for the manual/emergency path.
 *
 * changesLocked=true would prevent Tradovate's daily session reset (6 PM ET)
 * from clearing dailyLossAutoLiq, causing the lock to persist indefinitely
 * and requiring Tradovate support intervention to clear. With false, the
 * session reset clears the risk setting naturally, and the user can also
 * reset it from the Tradovate UI if needed intraday.
 *
 * The automatic enforcement path (not this module) may still send true —
 * this constant affects only the manual/emergency user-initiated lockout.
 */
const MANUAL_LOCK_CHANGES_LOCKED = false;

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
      label: true,
      platform: true,
      accountType: true,
      externalAccountId: true,
      isActive: true,
      missingFromBrokerSince: true,
      brokerConnection: {
        select: { id: true, env: true, connectionStatus: true, permissionLevel: true },
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

  // Env/accountType safety guard: demo accounts must use demo connections and
  // live accounts must use live connections. A mismatch means a write would go
  // to the wrong Tradovate environment and potentially affect the wrong account.
  const bcEnv = account.brokerConnection?.env ?? null;
  const accountType = account.accountType ?? null;
  if (bcEnv != null && accountType != null) {
    const accountIsDemo = accountType === "demo";
    const connectionIsDemo = bcEnv === "demo";
    if (accountIsDemo && !connectionIsDemo) {
      console.error("[manual-broker-lock] env/accountType mismatch: demo account with live connection — refusing write", {
        accountId,
        label: account.label,
        accountType,
        bcEnv,
        brokerConnectionId: account.brokerConnection?.id,
      });
      return {
        status: "broker_lock_failed",
        message:
          "Broker lock refused: account is demo but BrokerConnection.env is live. " +
          "This mismatch would write to the wrong Tradovate environment. No broker write attempted.",
        brokerEndpoint: null,
        brokerPayload: null,
        brokerResponse: null,
      };
    }
    if (!accountIsDemo && connectionIsDemo) {
      console.error("[manual-broker-lock] env/accountType mismatch: live account with demo connection — refusing write", {
        accountId,
        label: account.label,
        accountType,
        bcEnv,
        brokerConnectionId: account.brokerConnection?.id,
      });
      return {
        status: "broker_lock_failed",
        message:
          "Broker lock refused: account is live/personal but BrokerConnection.env is demo. " +
          "This mismatch would write to the wrong Tradovate environment. No broker write attempted.",
        brokerEndpoint: null,
        brokerPayload: null,
        brokerResponse: null,
      };
    }
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
      changesLocked: MANUAL_LOCK_CHANGES_LOCKED,
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
      changesLocked: MANUAL_LOCK_CHANGES_LOCKED,
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
