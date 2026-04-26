/**
 * GET /api/brokers/tradovate/snapshot?accountId=<id>
 *
 * Internal developer route — tests the Tradovate read pipeline end-to-end
 * for a connected account. NOT intended as a production data endpoint.
 *
 * Security:
 *  - Requires an authenticated session (redirects to /login if missing).
 *  - The account must belong to the requesting user (ownership enforced by
 *    TradovateClient → getTradovateTokensForAccount).
 *  - Tokens are NEVER returned. Only normalised broker-layer data is included.
 *
 * Response shape:
 *  { ok: true, accountId, snapshot, positions, orders, executions, connectionStatus }
 *  or
 *  { ok: false, error: <code>, message: <string> }
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { TradovateClient, TradovateClientError } from "@/lib/brokers/tradovate-client";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
  }

  const accountId = request.nextUrl.searchParams.get("accountId");
  if (!accountId) {
    return NextResponse.json(
      { ok: false, error: "MISSING_PARAM", message: "accountId query parameter is required." },
      { status: 400 },
    );
  }

  // Ownership pre-check: confirm the account exists and belongs to this user
  // before we even try to load tokens (belt-and-suspenders on top of the
  // ownership check inside TradovateClient).
  const account = await prisma.connectedAccount.findUnique({
    where: { id: accountId },
    select: { userId: true, platform: true, connectionStatus: true },
  });

  if (!account) {
    return NextResponse.json(
      { ok: false, error: "NOT_FOUND", message: "Account not found." },
      { status: 404 },
    );
  }
  if (account.userId !== user.id) {
    return NextResponse.json(
      { ok: false, error: "FORBIDDEN", message: "Account does not belong to you." },
      { status: 403 },
    );
  }
  if (account.platform !== "tradovate") {
    return NextResponse.json(
      { ok: false, error: "WRONG_PLATFORM", message: "Account is not a Tradovate connection." },
      { status: 400 },
    );
  }

  const client = new TradovateClient(accountId, user.id);

  try {
    await client.initialize();
  } catch (err) {
    const code = err instanceof TradovateClientError ? err.code : "UNKNOWN";
    const message =
      err instanceof TradovateClientError ? err.message : "Unexpected error during initialization.";
    return NextResponse.json(
      { ok: false, error: code, message },
      { status: err instanceof TradovateClientError && err.statusCode ? err.statusCode : 502 },
    );
  }

  // Run all reads in parallel; catch errors per-call so partial results are
  // still returned for debugging.
  const [snapshotResult, positionsResult, ordersResult, executionsResult] =
    await Promise.allSettled([
      client.toAccountSnapshot(),
      client.toPositions(),
      client.toOrders(),
      client.toExecutions(),
    ]);

  // Record the sync time regardless of partial failures.
  await prisma.connectedAccount.update({
    where: { id: accountId },
    data: { lastSyncAt: new Date() },
  });

  function settle<T>(r: PromiseSettledResult<T>): T | { error: string } {
    if (r.status === "fulfilled") return r.value;
    const err = r.reason as Error;
    return {
      error:
        err instanceof TradovateClientError
          ? `${err.code}: ${err.message}`
          : err.message ?? "Unknown error",
    };
  }

  return NextResponse.json({
    ok: true,
    accountId,
    snapshot: settle(snapshotResult),
    positions: settle(positionsResult),
    orders: settle(ordersResult),
    executions: settle(executionsResult),
  });
}
