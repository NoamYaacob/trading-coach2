/**
 * GET /api/brokers/tradovate/snapshot?accountId=<id>
 *
 * Verification endpoint — runs every read against the Tradovate API and
 * returns a structured pass/fail report. Used by the verification page
 * (/accounts/tradovate/verify) and available as JSON for tooling.
 *
 * Response shape (see VerificationReport in tradovate-verification.ts):
 *   {
 *     ok: boolean,
 *     connectionStatus: "connected" | "expired" | "error" | "disconnected",
 *     tokenStatus: "valid" | "expired" | "no_refresh" | "load_failed" | "config_missing" | "unknown",
 *     checks: Array<{ name, label, status: "pass"|"fail"|"skip", message, durationMs, errorCode? }>,
 *     snapshot: { account, positions, orders, executions },
 *     warnings: string[],
 *     lastSyncAt: ISOString | null,
 *   }
 *
 * Auth + ownership are enforced. Tokens and raw upstream payloads are
 * NEVER returned. An endpoint failure does NOT abort the rest of the
 * checks — token / auth failure short-circuits the remaining endpoints.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { runTradovateVerification } from "@/lib/brokers/tradovate-verification";

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

  // Ownership pre-check.
  const account = await prisma.connectedAccount.findUnique({
    where: { id: accountId },
    select: { userId: true, platform: true },
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

  const report = await runTradovateVerification(accountId, user.id);
  return NextResponse.json(report);
}
