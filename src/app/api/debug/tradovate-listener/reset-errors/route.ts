import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * POST /api/debug/tradovate-listener/reset-errors
 *
 * Clears stale `listenerStatus = "error"` state on the current user's
 * Tradovate broker connections so the listener worker will retry them on
 * the next reconcile cycle.
 *
 * Body (all optional — defaults to "clear all current user's error rows"):
 *   { connectionId?: string, env?: "live" | "demo" }
 *
 * Fields cleared: listenerStatus, listenerErrorMessage, listenerLastHeartbeatAt
 * Fields kept:    listenerConnectedAt, listenerLastEventAt
 *
 * Security:
 *   - Requires authenticated session (401 otherwise).
 *   - In production requires `x-cron-secret` header matching CRON_SECRET env var.
 *   - Only touches rows owned by the current user.
 *   - Never reads or returns token fields.
 */
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

  let body: { connectionId?: unknown; env?: unknown } = {};
  try {
    const parsed = (await request.json()) as unknown;
    if (parsed && typeof parsed === "object") {
      body = parsed as { connectionId?: unknown; env?: unknown };
    }
  } catch {
    body = {};
  }

  const connectionIdFilter =
    typeof body.connectionId === "string" && body.connectionId.length > 0
      ? body.connectionId
      : null;
  const envFilter =
    body.env === "live" || body.env === "demo" ? body.env : null;

  const where = {
    userId: currentUser.id,
    listenerStatus: "error",
    ...(connectionIdFilter ? { id: connectionIdFilter } : {}),
    ...(envFilter ? { env: envFilter } : {}),
  };

  const errorRows = await prisma.brokerConnection.findMany({
    where,
    select: { id: true },
  });

  if (errorRows.length === 0) {
    return NextResponse.json({
      ok: true,
      cleared: 0,
      connectionIds: [],
      filter: { connectionId: connectionIdFilter, env: envFilter },
    });
  }

  const connectionIds = errorRows.map((r) => r.id);

  await prisma.brokerConnection.updateMany({
    where,
    data: {
      listenerStatus: null,
      listenerErrorMessage: null,
      listenerLastHeartbeatAt: null,
    },
  });

  return NextResponse.json({
    ok: true,
    cleared: connectionIds.length,
    connectionIds,
    filter: { connectionId: connectionIdFilter, env: envFilter },
  });
}
