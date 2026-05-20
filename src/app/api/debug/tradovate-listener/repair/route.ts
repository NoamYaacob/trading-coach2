import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * POST /api/debug/tradovate-listener/repair
 *
 * Operator-controlled repair actions for stuck Tradovate listeners.
 *
 * Body:
 *   {
 *     connectionId: string,
 *     action: "clear_error" | "clear_error_and_retry" | "disable_connection_listener",
 *   }
 *
 * Actions:
 *   - clear_error
 *       Clears listenerStatus="error", listenerErrorMessage, and retry tracking.
 *       The worker will pick the connection up on the next reconcile loop.
 *   - clear_error_and_retry
 *       Like clear_error, but also forces listenerNextRetryAt to "now" so the
 *       next reconcile runs the listener immediately (no cooldown wait).
 *   - disable_connection_listener
 *       Sets listenerDisabledAt = now. The worker will permanently skip this
 *       connection with reason "listener_disabled" until cleared via clear_error.
 *
 * Security:
 *   - Requires authenticated session (401 otherwise).
 *   - In production requires `x-cron-secret` header matching CRON_SECRET env var.
 *   - Only operates on rows owned by the current user.
 *   - Never reads, decrypts, or returns token fields.
 */
type RepairAction = "clear_error" | "clear_error_and_retry" | "disable_connection_listener";

const VALID_ACTIONS: ReadonlySet<RepairAction> = new Set<RepairAction>([
  "clear_error",
  "clear_error_and_retry",
  "disable_connection_listener",
]);

export async function POST(request: NextRequest) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (process.env.NODE_ENV === "production") {
    const secret = request.headers.get("x-cron-secret");
    const expected = process.env.CRON_SECRET;
    if (!expected || secret !== expected) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }

  let body: { connectionId?: unknown; action?: unknown } = {};
  try {
    const parsed = (await request.json()) as unknown;
    if (parsed && typeof parsed === "object") {
      body = parsed as { connectionId?: unknown; action?: unknown };
    }
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  if (typeof body.connectionId !== "string" || body.connectionId.length === 0) {
    return NextResponse.json(
      { error: "connectionId required" },
      { status: 400 },
    );
  }
  if (
    typeof body.action !== "string" ||
    !VALID_ACTIONS.has(body.action as RepairAction)
  ) {
    return NextResponse.json(
      {
        error: "invalid action",
        validActions: Array.from(VALID_ACTIONS),
      },
      { status: 400 },
    );
  }
  const action = body.action as RepairAction;
  const connectionId = body.connectionId;

  const bc = await prisma.brokerConnection.findFirst({
    where: { id: connectionId, userId: currentUser.id },
    select: { id: true, env: true, listenerStatus: true, listenerDisabledAt: true },
  });
  if (!bc) {
    return NextResponse.json(
      { error: "connection not found or not owned by current user" },
      { status: 404 },
    );
  }

  const now = new Date();
  if (action === "clear_error") {
    await prisma.brokerConnection.update({
      where: { id: connectionId },
      data: {
        listenerStatus: null,
        listenerErrorMessage: null,
        listenerNextRetryAt: null,
        listenerRetryCount: 0,
        listenerLastAuthFailureAt: null,
        listenerDisabledAt: null,
      },
    });
  } else if (action === "clear_error_and_retry") {
    await prisma.brokerConnection.update({
      where: { id: connectionId },
      data: {
        listenerStatus: null,
        listenerErrorMessage: null,
        listenerNextRetryAt: now,
        listenerRetryCount: 0,
        listenerLastAuthFailureAt: null,
        listenerDisabledAt: null,
      },
    });
  } else if (action === "disable_connection_listener") {
    await prisma.brokerConnection.update({
      where: { id: connectionId },
      data: { listenerDisabledAt: now },
    });
  }

  return NextResponse.json({
    ok: true,
    connectionId,
    action,
    appliedAt: now.toISOString(),
  });
}
