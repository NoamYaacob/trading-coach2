/**
 * Dev-only diagnostic for Tradovate order actions (cancel / flatten).
 * Returns 404 in production. Dry-run only — no live broker writes ever.
 *
 * GET  /api/dev/order-actions-debug?connectedAccountId=<id>
 *   Returns recent audit logs + account eligibility for the given account.
 *
 * POST /api/dev/order-actions-debug
 *   Body: { connectedAccountId: string, action: "cancel_orders" | "flatten_positions" }
 *   Runs a forced dry-run and returns the structured result.
 *   The `dryRun: true` override is hardcoded — this route can never trigger
 *   live broker writes regardless of the ENABLE_TRADOVATE_ORDER_ACTIONS flag.
 */

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { validateAccountForOrderActions, canSendLiveOrderActions } from "@/lib/brokers/order-actions-helpers";
import { isTradovateOrderActionsEnabled } from "@/lib/brokers/order-actions-flag";
import { cancelOpenOrdersForAccount } from "@/lib/brokers/cancel-open-orders";
import { flattenPositionsForAccount } from "@/lib/brokers/flatten-positions";

export const runtime = "nodejs";

// ── GET — eligibility + recent audit logs ──────────────────────────────────

export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse("Not found", { status: 404 });
  }

  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const connectedAccountId = searchParams.get("connectedAccountId");

  if (!connectedAccountId) {
    return NextResponse.json(
      { error: "connectedAccountId query param required" },
      { status: 400 },
    );
  }

  const account = await prisma.connectedAccount.findUnique({
    where: { id: connectedAccountId },
    select: {
      id: true,
      userId: true,
      platform: true,
      label: true,
      isActive: true,
      protectionStatus: true,
      missingFromBrokerSince: true,
      connectionStatus: true,
      externalAccountId: true,
      brokerConnection: {
        select: { permissionLevel: true },
      },
    },
  });

  if (!account || account.userId !== currentUser.id) {
    return NextResponse.json({ error: "account not found" }, { status: 404 });
  }

  const permissionLevel = account.brokerConnection?.permissionLevel ?? null;
  const validation = validateAccountForOrderActions({
    platform: account.platform,
    isActive: account.isActive,
    protectionStatus: account.protectionStatus,
    missingFromBrokerSince: account.missingFromBrokerSince,
    connectionStatus: account.connectionStatus,
    externalAccountId: account.externalAccountId,
    permissionLevel,
  });

  const recentLogs = await prisma.brokerOrderActionLog.findMany({
    where: { connectedAccountId },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      actionType: true,
      triggerReason: true,
      dryRun: true,
      success: true,
      errorMessage: true,
      requestSummary: true,
      responseSummary: true,
      createdAt: true,
    },
  });

  return NextResponse.json({
    account: {
      id: account.id,
      label: account.label,
      platform: account.platform,
      connectionStatus: account.connectionStatus,
      permissionLevel,
      externalAccountId: account.externalAccountId,
    },
    eligibility: validation,
    orderActionsEnvFlag: isTradovateOrderActionsEnabled(),
    canSendLive: validation.ok && canSendLiveOrderActions({ permissionLevel }),
    effectiveMode: isTradovateOrderActionsEnabled() && canSendLiveOrderActions({ permissionLevel })
      ? "live (env flag set)"
      : "dry_run (default)",
    recentLogs,
  });
}

// ── POST — forced dry-run cancel or flatten ────────────────────────────────

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse("Not found", { status: 404 });
  }

  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as Record<string, unknown>).connectedAccountId !== "string" ||
    typeof (body as Record<string, unknown>).action !== "string"
  ) {
    return NextResponse.json(
      { error: "body must be { connectedAccountId: string, action: 'cancel_orders' | 'flatten_positions' }" },
      { status: 400 },
    );
  }

  const { connectedAccountId, action } = body as { connectedAccountId: string; action: string };

  if (action !== "cancel_orders" && action !== "flatten_positions") {
    return NextResponse.json(
      { error: "action must be 'cancel_orders' or 'flatten_positions'" },
      { status: 400 },
    );
  }

  // Verify ownership before calling any action.
  const ownership = await prisma.connectedAccount.findUnique({
    where: { id: connectedAccountId },
    select: { userId: true },
  });
  if (!ownership || ownership.userId !== currentUser.id) {
    return NextResponse.json({ error: "account not found" }, { status: 404 });
  }

  try {
    if (action === "cancel_orders") {
      // dryRun: true is hardcoded — this route never sends live cancels.
      const result = await cancelOpenOrdersForAccount(connectedAccountId, {
        dryRun: true,
        triggerReason: "dev_diagnostic",
      });
      return NextResponse.json({ action, result, liveActionsEnabled: isTradovateOrderActionsEnabled() });
    } else {
      // dryRun: true is hardcoded — this route never sends live flattens.
      const result = await flattenPositionsForAccount(connectedAccountId, {
        dryRun: true,
        triggerReason: "dev_diagnostic",
      });
      return NextResponse.json({ action, result, liveActionsEnabled: isTradovateOrderActionsEnabled() });
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 422 },
    );
  }
}
