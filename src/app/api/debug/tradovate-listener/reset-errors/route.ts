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

  const errorRows = await prisma.brokerConnection.findMany({
    where: { userId: currentUser.id, listenerStatus: "error" },
    select: { id: true },
  });

  if (errorRows.length === 0) {
    return NextResponse.json({ ok: true, cleared: 0, connectionIds: [] });
  }

  const connectionIds = errorRows.map((r) => r.id);

  await prisma.brokerConnection.updateMany({
    where: { userId: currentUser.id, listenerStatus: "error" },
    data: {
      listenerStatus: null,
      listenerErrorMessage: null,
      listenerLastHeartbeatAt: null,
    },
  });

  return NextResponse.json({ ok: true, cleared: connectionIds.length, connectionIds });
}
