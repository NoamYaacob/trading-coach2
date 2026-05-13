import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { TradovateClient } from "@/lib/brokers/tradovate-client";
import { findGuardrailPositionLimit } from "@/lib/brokers/tradovate-position-limit";
import {
  effectiveSupportedRawLimits,
  getSupportedRoots,
} from "@/lib/futures/contracts";

/**
 * GET /api/debug/tradovate-position-limit?accountId=...
 *
 * Returns the current state of the Guardrail-owned Tradovate position limit
 * for the given ConnectedAccount.
 *
 * ── Standard-equivalent vs raw contract distinction ───────────────────────────
 * Guardrail stores maxContracts in standard-equivalent units (Apex model):
 *   1 NQ = 1, 1 MNQ = 0.1, 1 ES = 1, 1 MES = 0.1  (10 micro = 1 standard)
 *
 * Tradovate's UserAccountPositionLimit (totalBy="Overall") is a global raw
 * contract cap — it applies the same integer ceiling to every open position
 * regardless of product. Setting it to 1 blocks ANY second contract including
 * 2 MNQ (= 0.2 NQ-equivalent, well within a 1-standard-equivalent limit).
 *
 * Therefore, Guardrail uses "app_side_only" broker enforcement mode:
 *   - No global raw limit is written to Tradovate.
 *   - Any previously-written Guardrail limit is deactivated.
 *   - Standard-equivalent enforcement runs in Guardrail's app engine only.
 *   - Product-specific broker limits (totalBy="PerContract") are unverified.
 *
 * Fields:
 *   guardrailMaxMiniEquivalent  — DB value (AccountRiskRules.maxContracts) in standard-equiv units
 *   supportedSymbols            — equity index roots with confirmed 1:10 micro/standard pairs
 *   effectiveMicroLimits        — per-product raw limits (app-side reference only; not broker-enforced)
 *   brokerEnforcementMode       — always "app_side_only" (global raw cap is not applied)
 *   brokerEnforcementWarning    — explains why the global raw limit is not used
 *   staleRawLimitWarning        — set when a Guardrail raw limit is still active at Tradovate
 *   guardrailLimitFound         — whether a Guardrail-owned limit still exists at Tradovate
 *   exposedLimit                — raw cap value currently stored at Tradovate (should be absent/inactive)
 *   limitActive                 — whether the Tradovate limit is active (should be false in normal state)
 *   hardLimitAttached           — whether userAccountRiskParameter.hardLimit=true is set
 *   allLimitCount               — total position limits at Tradovate
 *   fetchError                  — set when the Tradovate API call fails
 *   brokerStateOk               — true when no active raw limit exists at broker (expected normal state)
 */
export async function GET(request: NextRequest) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const accountId = request.nextUrl.searchParams.get("accountId");
  if (!accountId) {
    return NextResponse.json({ error: "accountId query param required" }, { status: 400 });
  }

  // ── Load Guardrail DB state ───────────────────────────────────────────────
  const account = await prisma.connectedAccount.findFirst({
    where: { id: accountId, userId: currentUser.id, platform: "tradovate" },
    select: {
      id: true,
      externalAccountId: true,
      connectionStatus: true,
      brokerConnectionId: true,
      riskRules: { select: { maxContracts: true } },
    },
  });

  if (!account) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const brokerConnection = account.brokerConnectionId
    ? await prisma.brokerConnection.findFirst({
        where: { id: account.brokerConnectionId, userId: currentUser.id },
        select: { id: true, connectionStatus: true, permissionLevel: true, lastRenewError: true },
      })
    : null;

  const guardrailMaxMiniEquivalent = account.riskRules?.maxContracts ?? null;
  const supportedSymbols = getSupportedRoots();

  // Per-product raw limits — app-side reference only (broker does not enforce these).
  const effectiveMicroLimits =
    guardrailMaxMiniEquivalent !== null
      ? effectiveSupportedRawLimits(guardrailMaxMiniEquivalent)
      : null;

  // ── Fetch live Tradovate state ────────────────────────────────────────────
  let guardrailLimitFound = false;
  let limitId: number | null = null;
  let exposedLimit: number | null = null;
  let limitActive: boolean | null = null;
  let hardLimitAttached: boolean | null = null;
  let allLimitCount: number | null = null;
  let fetchError: string | null = null;

  if (account.externalAccountId) {
    try {
      const client = new TradovateClient(accountId, currentUser.id);
      await client.initialize();
      const limits = await client.listUserAccountPositionLimits();
      allLimitCount = limits.length;

      const guardrailLimit = findGuardrailPositionLimit(limits);
      if (guardrailLimit) {
        guardrailLimitFound = true;
        limitId = guardrailLimit.id ?? null;
        exposedLimit = guardrailLimit.exposedLimit ?? null;
        limitActive = guardrailLimit.active ?? null;

        if (limitId != null) {
          try {
            const riskParams = await client.listUserAccountRiskParameters(limitId);
            const param = riskParams[0] ?? null;
            hardLimitAttached = param?.hardLimit === true;
          } catch {
            hardLimitAttached = null;
          }
        }
      }
    } catch (err) {
      fetchError = err instanceof Error ? err.message : String(err);
    }
  } else {
    fetchError = "no_external_account_id";
  }

  // Normal state: no active Guardrail limit at broker (app_side_only mode).
  // Warning when a limit is still active (may be a stale raw limit from before the mode change).
  const staleRawLimitWarning =
    guardrailLimitFound && limitActive === true
      ? "A Guardrail-owned position limit is still active at Tradovate. In app_side_only mode " +
        "this should be deactivated. Save maxContracts again to trigger cleanup, or check " +
        "applyMaxPositionSize logs."
      : null;

  return NextResponse.json({
    accountId,
    externalAccountId: account.externalAccountId ?? null,
    accountConnectionStatus: account.connectionStatus,
    brokerConnectionStatus: brokerConnection?.connectionStatus ?? null,
    permissionLevel: brokerConnection?.permissionLevel ?? null,
    lastRenewError: brokerConnection?.lastRenewError ?? null,
    // Guardrail DB value (standard-equivalent units per the Apex 10-micro=1-standard model)
    guardrailMaxMiniEquivalent,
    // Supported mini/micro pairs
    supportedSymbols,
    // Per-product raw limits (app-side reference; broker does not enforce these)
    effectiveMicroLimits,
    // Broker enforcement metadata
    brokerEnforcementMode: "app_side_only" as const,
    brokerEnforcementWarning:
      "Tradovate's global position limit (totalBy=Overall) enforces a single raw contract " +
      "count across all positions. Setting it to maxContracts=1 incorrectly blocks 2 MNQ " +
      "(0.2 NQ-equivalent, within the 1-standard-equivalent limit). Product-specific limits " +
      "(totalBy=PerContract) are unverified. Standard-equivalent enforcement is Guardrail " +
      "app-side only — no product-specific broker enforcement is active.",
    staleRawLimitWarning,
    // Live Tradovate state (in app_side_only mode: limit should be absent or inactive)
    guardrailLimitFound,
    limitId,
    exposedLimit,
    limitActive,
    hardLimitAttached,
    allLimitCount,
    fetchError,
    // Diagnosis
    brokerStateOk: !guardrailLimitFound || limitActive === false,
  });
}
