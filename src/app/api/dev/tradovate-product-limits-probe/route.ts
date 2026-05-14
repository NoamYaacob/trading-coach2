/**
 * Diagnostic probe: tests whether Tradovate supports product-scoped position
 * limits (totalBy="PerContract" / totalBy="PerProduct").
 *
 * VERIFICATION STATUS (2026-05):
 *   Both PerContract and PerProduct returned HTTP 400 "illegal enum value" against
 *   the live Tradovate API. Product-specific broker-level limits are NOT supported.
 *   brokerEnforcementMode remains "app_side_only" permanently unless the API adds
 *   support. This probe is retained for re-verification if the API changes.
 *
 * Protection:
 *   - In production: requires x-cron-secret header matching CRON_SECRET env var.
 *     Returns 403 without it. (Same pattern as /api/debug/accounts/[id]/reset-session-state.)
 *   - In all environments: requires an authenticated user session.
 *   - Only operates on demo accounts (accountType === "demo") — returns 403 on live.
 *
 * GET /api/dev/tradovate-product-limits-probe?accountId=<connectedAccountId>
 * Headers: x-cron-secret: <CRON_SECRET>   (required in production)
 *
 * What this does:
 *   1. Reads existing UserAccountPositionLimit rows for context (no writes).
 *   2. Attempts to create three probe limits (PerContract NQ=2, PerContract MNQ=20,
 *      PerProduct NQ=2) — each with description prefixed "Guardrail Probe".
 *   3. For each that succeeds, attaches a UserAccountRiskParameter (hardLimit=true).
 *   4. Immediately deactivates every probe limit that was created (cleanup).
 *   5. Returns full non-sensitive payload + response for each attempt.
 *
 * No tokens appear in the response. No live/funded accounts may be probed.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { TradovateClient } from "@/lib/brokers/tradovate-client";
import { effectiveSupportedRawLimits } from "@/lib/futures/contracts";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  // ── Secret gate (production only) ──────────────────────────────────────────
  const isProduction = process.env.NODE_ENV === "production";
  const secret = request.headers.get("x-cron-secret");
  const expectedSecret = process.env.CRON_SECRET;
  const hasValidSecret = expectedSecret != null && secret === expectedSecret;

  if (isProduction && !hasValidSecret) {
    return NextResponse.json(
      {
        ok: false,
        error: "forbidden",
        message:
          "This endpoint is restricted. " +
          "Provide the x-cron-secret header with the CRON_SECRET value to use it in production.",
      },
      { status: 403 },
    );
  }

  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const accountId = request.nextUrl.searchParams.get("accountId");
  if (!accountId) {
    return NextResponse.json({ error: "accountId query param required" }, { status: 400 });
  }

  const account = await prisma.connectedAccount.findFirst({
    where: { id: accountId, userId: currentUser.id, platform: "tradovate" },
    select: {
      id: true,
      accountType: true,
      externalAccountId: true,
      riskRules: { select: { maxContracts: true } },
    },
  });

  if (!account) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  if (account.accountType !== "demo") {
    return NextResponse.json(
      { error: "probe_only_for_demo_accounts", accountType: account.accountType },
      { status: 403 },
    );
  }

  const guardrailMaxMiniEquivalent = account.riskRules?.maxContracts ?? null;
  const referenceLimits =
    guardrailMaxMiniEquivalent !== null
      ? effectiveSupportedRawLimits(guardrailMaxMiniEquivalent)
      : null;

  let probeResult = null;
  let probeError: string | null = null;

  try {
    const client = new TradovateClient(accountId, currentUser.id);
    await client.initialize();
    probeResult = await client.probePerContractPositionLimits();
  } catch (err) {
    probeError = err instanceof Error ? err.message : String(err);
  }

  return NextResponse.json({
    accountId,
    accountType: account.accountType,
    guardrailMaxMiniEquivalent,
    referenceLimits,
    probeResult,
    probeError,
    verificationResult: {
      verifiedAt: "2026-05",
      outcome: "not_supported",
      detail:
        "PerContract and PerProduct returned HTTP 400 'illegal enum value' from the live Tradovate API. " +
        "Product-specific broker-level position limits are not available. " +
        "brokerEnforcementMode remains app_side_only.",
    },
    interpretation: {
      goal:
        "Verify whether Tradovate supports per-product position limits for standard-equivalent enforcement.",
      standardEquivalentModel:
        "1 NQ-equivalent allows NQ=1 OR MNQ=10 (10 micro = 1 standard, Apex model).",
      successCriteria: [
        "createSuccess=true for PerContract or PerProduct attempts",
        "createResponse includes a product/contract scoping field (e.g. contractId, productId)",
        "Multiple distinct limits can be created with different exposedLimit values",
      ],
      failureMeaning:
        "All attempts fail (createError set) — broker-side standard-equivalent enforcement is not possible. " +
        "Guardrail enforces the rule app-side (detection-response) only.",
    },
  });
}
