import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { maybeAttemptBrokerLockForManualLock } from "@/lib/guardian-engine/manual-broker-lock-service";
import { cancelOpenOrdersForAccount } from "@/lib/brokers/cancel-open-orders";
import { flattenPositionsForAccount } from "@/lib/brokers/flatten-positions";
import { isTradovateOrderActionsEnabled } from "@/lib/brokers/order-actions-flag";
import {
  buildManualLockoutPlan,
  mapManualBrokerLockStatus,
  type ManualBrokerLockUiStatus,
} from "./lockout-helpers";

/** Reason label written to BrokerOrderActionLog for every order/flatten write. */
const EMERGENCY_TRIGGER = "emergency_lockout";

/** Per-step cancel result surfaced to the UI. */
type CancelOrdersOutcome =
  | { ran: true; dryRun: boolean; attempted: number; succeeded: number; failed: number }
  | { ran: false; reason: string };

/** Per-step flatten result surfaced to the UI. */
type FlattenOutcome =
  | { ran: true; dryRun: boolean; status: string; message: string }
  | { ran: false; reason: string };

/**
 * POST /api/accounts/[id]/lockout — emergency lockout for a single account.
 *
 * Order of operations (each broker step is best-effort; the internal Guardrail
 * lock is the ONE unconditional step and always commits):
 *   1. Cancel working orders   (cancelOpenOrdersForAccount — account-scoped)
 *   2. Flatten open positions  (flattenPositionsForAccount — account-scoped)
 *   3. Internal Guardrail lock (LiveSessionState=STOPPED + InternalLockEvent)
 *   4. Broker daily-loss lock  (userAccountAutoLiq dailyLossAutoLiq=0)
 *
 * Steps 1 and 2 only perform a LIVE broker write when
 * ENABLE_TRADOVATE_ORDER_ACTIONS=true AND the connection has Orders: Full
 * Access. Otherwise they run dry-run and the result says so explicitly — they
 * are never reported as successful live actions. A failure in step 1 never
 * blocks step 2; a failure in 1 or 2 never blocks the internal lock; a broker
 * failure in step 4 never rolls back the internal lock.
 *
 * Account isolation: cancel/flatten resolve the Tradovate account id strictly
 * from THIS account's externalAccountId and scope every broker call to it
 * (order list filtered by accountId; positions read via masterid). No other
 * account on the same OAuth token can be affected.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const limit = checkRateLimit(`account_lockout:${user.id}`, 10, 3_600_000);
  if (!limit.ok) {
    return NextResponse.json({ error: "too_many_requests" }, { status: 429 });
  }

  const { id } = await params;

  // Ownership + eligibility gate: only the owner's active, protected/monitor_only
  // account can be locked. Archived / inactive / pending rows are excluded here,
  // so they can never reach the broker steps below.
  const account = await prisma.connectedAccount.findFirst({
    where: {
      id,
      userId: user.id,
      isActive: true,
      protectionStatus: { in: ["protected", "monitor_only"] },
    },
    select: {
      id: true,
      userId: true,
      label: true,
      externalAccountId: true,
      brokerConnectionId: true,
      brokerConnection: { select: { env: true, permissionLevel: true } },
    },
  });
  if (!account) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const plan = buildManualLockoutPlan({ accountId: id, userId: user.id });
  const orderActionsEnabled = isTradovateOrderActionsEnabled();

  // Pre-write audit log — the exact target identity for every broker action
  // that follows. Surfaces account, label, external id, connection, env, and
  // probed permission level so the write target is never ambiguous.
  console.info("[account-lockout] emergency lockout requested", {
    accountId: account.id,
    userId: user.id,
    label: account.label,
    externalAccountId: account.externalAccountId,
    brokerConnectionId: account.brokerConnectionId,
    env: account.brokerConnection?.env ?? null,
    permissionLevel: account.brokerConnection?.permissionLevel ?? null,
    orderActionsEnabled,
    tradingDay: plan.tradingDay,
  });

  // ── Step 1: cancel working orders (best-effort) ────────────────────────────
  let cancelOrders: CancelOrdersOutcome;
  try {
    const r = await cancelOpenOrdersForAccount(account.id, {
      triggerReason: EMERGENCY_TRIGGER,
    });
    cancelOrders = {
      ran: true,
      dryRun: r.dryRun,
      attempted: r.attemptedCount,
      succeeded: r.succeededCount,
      failed: r.failedCount,
    };
    console.info("[account-lockout] cancelled working orders", {
      accountId: account.id,
      attempted: r.attemptedCount,
      succeeded: r.succeededCount,
      failed: r.failedCount,
      dryRun: r.dryRun,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    cancelOrders = { ran: false, reason };
    console.error("[account-lockout] cancel working orders failed — continuing", {
      accountId: account.id,
      error: reason,
    });
  }

  // ── Step 2: flatten open positions (best-effort; runs even if cancel failed) ─
  let flattenPositions: FlattenOutcome;
  try {
    const r = await flattenPositionsForAccount(account.id, {
      triggerReason: EMERGENCY_TRIGGER,
    });
    flattenPositions = {
      ran: true,
      dryRun: r.dryRun,
      status: r.flattenStatus,
      message: r.flattenMessage,
    };
    console.info("[account-lockout] flattened positions", {
      accountId: account.id,
      flattenStatus: r.flattenStatus,
      flattenMessage: r.flattenMessage,
      dryRun: r.dryRun,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    flattenPositions = { ran: false, reason };
    console.error("[account-lockout] flatten positions failed — continuing to internal lock", {
      accountId: account.id,
      error: reason,
    });
  }

  // ── Step 3 — internal Guardrail lock (UNCONDITIONAL, committed first as the
  // source of truth). It must survive even if every broker step above/below
  // failed. ───────────────────────────────────────────────────────────────────
  const [, lockEvent] = await prisma.$transaction([
    prisma.liveSessionState.upsert({
      where: { accountId: id },
      create: plan.liveSessionState.create,
      update: plan.liveSessionState.update,
    }),
    prisma.internalLockEvent.upsert({
      where: { activeDedupKey: plan.activeDedupKey },
      create: plan.internalLockEvent.create,
      update: plan.internalLockEvent.update,
    }),
  ]);

  console.info("[account-lockout] manual internal lock applied", {
    accountId: id,
    userId: user.id,
    tradingDay: plan.tradingDay,
  });

  // ── Step 4 — broker daily-loss lock (delegated; reuses the risk-setting write,
  // no order placement / cancellation / flatten). A failure here NEVER rolls
  // back the internal lock — it is caught and surfaced as a broker status. ─────
  let brokerLock: { status: ManualBrokerLockUiStatus; message: string } = {
    status: "unavailable",
    message: "Broker lock was not attempted.",
  };
  try {
    const svc = await maybeAttemptBrokerLockForManualLock(lockEvent.id);
    brokerLock = {
      status: mapManualBrokerLockStatus(svc.status, svc.brokerActionTaken),
      message: svc.message,
    };
    console.info("[account-lockout] broker lock result", {
      accountId: id,
      status: svc.status,
      brokerActionTaken: svc.brokerActionTaken,
    });
  } catch (err) {
    console.error("[account-lockout] broker lock attempt errored — internal lock preserved", {
      accountId: id,
      userId: user.id,
      error: err instanceof Error ? err.message : String(err),
    });
    brokerLock = {
      status: "failed",
      message: "Broker lock attempt errored. The Guardrail lock is still active.",
    };
  }

  return NextResponse.json({
    ok: true,
    accountId: id,
    tradingDay: plan.tradingDay,
    status: "locked",
    orderActionsEnabled,
    cancelOrders,
    flattenPositions,
    internalLock: { applied: true, tradingDay: plan.tradingDay },
    brokerLock,
  });
}
