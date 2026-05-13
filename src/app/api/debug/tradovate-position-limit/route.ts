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
import {
  computeMiniEquivalentExposure,
  deriveMaxPositionSizeBreach,
  type PositionExposureInput,
} from "@/lib/brokers/position-exposure";

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
 * ── Enforcement model (app-side only) ─────────────────────────────────────────
 * Guardrail CANNOT intercept orders before they execute at Tradovate.
 * Orders placed directly in trader.tradovate.com will fill before Guardrail
 * sees them. Enforcement is detection-response only:
 *   1. Cron sync (every ~5 min) reads live positions via Tradovate API.
 *   2. computeMiniEquivalentExposure computes standard-equivalent total.
 *   3. If exposure > maxContracts: account is locked (riskState=STOPPED),
 *      GuardianIntervention is logged, and positions are flattened if order
 *      actions are enabled and the connection has write permissions.
 *
 * Fields:
 *   guardrailMaxMiniEquivalent   — DB value in standard-equiv units
 *   supportedSymbols             — equity index roots with confirmed 1:10 pairs
 *   effectiveMicroLimits         — per-product raw limits (app-side reference only)
 *   brokerEnforcementMode        — always "app_side_only"
 *   brokerEnforcementWarning     — explains why global raw cap is not applied
 *   staleRawLimitWarning         — set when a stale Guardrail raw limit is still active
 *   guardrailLimitFound          — whether a Guardrail-owned limit exists at Tradovate
 *   exposedLimit                 — raw cap currently at Tradovate (should be absent/inactive)
 *   limitActive                  — whether the Tradovate limit is active (should be false)
 *   hardLimitAttached            — whether userAccountRiskParameter.hardLimit=true
 *   allLimitCount                — total position limits at Tradovate
 *   fetchError                   — set when the Tradovate API call fails
 *   brokerStateOk                — true when no active raw limit exists
 *   suggestedAction              — "deactivate_stale_raw_limit" when needed; null otherwise
 *   suggestedEndpoint            — POST endpoint for the suggested action
 *   livePositions                — current open positions from Tradovate API
 *   exposureByRoot               — standard-equivalent breakdown per parent root
 *   totalMiniEquivalentExposure  — total standard-equivalent exposure across all open positions
 *   unsupportedPositions         — positions in symbols Guardrail cannot classify
 *   wouldBreach                  — true if current exposure exceeds maxContracts
 *   guardrailAction              — what Guardrail would do next sync if breach persists
 *   positionFetchError           — set when live position fetch fails separately
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

  const [brokerConnection, defaultRules] = await Promise.all([
    account.brokerConnectionId
      ? prisma.brokerConnection.findFirst({
          where: { id: account.brokerConnectionId, userId: currentUser.id },
          select: { id: true, connectionStatus: true, permissionLevel: true, lastRenewError: true },
        })
      : null,
    prisma.riskRules.findUnique({
      where: { userId: currentUser.id },
      select: { maxContracts: true },
    }),
  ]);

  const guardrailMaxMiniEquivalent =
    account.riskRules?.maxContracts ?? defaultRules?.maxContracts ?? null;
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

  // ── Live positions + exposure ─────────────────────────────────────────────
  type LivePosition = {
    symbol: string;
    netPos: number;
    side: "LONG" | "SHORT" | "FLAT";
  };
  let livePositions: LivePosition[] = [];
  let exposureByRoot: Array<{
    root: string;
    totalMiniEquivalent: number;
    positions: Array<{ symbol: string; netPos: number; miniEquivalent: number }>;
  }> = [];
  let totalMiniEquivalentExposure: number | null = null;
  let unsupportedPositions: Array<{ symbol: string; netPos: number; reason: string }> = [];
  let wouldBreach: boolean | null = null;
  let positionFetchError: string | null = null;

  if (account.externalAccountId) {
    try {
      const client = new TradovateClient(accountId, currentUser.id);
      await client.initialize();

      // Fetch position limits and live positions in parallel.
      const [limits, rawPositions] = await Promise.all([
        client.listUserAccountPositionLimits(),
        client.toPositions().catch((err) => {
          positionFetchError = err instanceof Error ? err.message : String(err);
          return [];
        }),
      ]);

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

      // Compute standard-equivalent exposure from live positions.
      if (rawPositions.length > 0 || positionFetchError === null) {
        livePositions = rawPositions.map((p) => ({
          symbol: p.symbol,
          netPos: p.side === "SHORT" ? -p.quantity : p.quantity,
          side: p.side,
        }));

        const exposureInputs: PositionExposureInput[] = rawPositions.map((p) => ({
          symbol: p.symbol,
          netPos: p.side === "SHORT" ? -p.quantity : p.quantity,
        }));

        const exposure = computeMiniEquivalentExposure(exposureInputs);
        totalMiniEquivalentExposure = exposure.totalMiniEquivalent;
        exposureByRoot = exposure.byRoot;
        unsupportedPositions = exposure.unsupported;

        if (guardrailMaxMiniEquivalent !== null) {
          const decision = deriveMaxPositionSizeBreach({
            positions: exposureInputs,
            maxContracts: guardrailMaxMiniEquivalent,
          });
          wouldBreach = decision.shouldTrigger;
        }
      }
    } catch (err) {
      fetchError = err instanceof Error ? err.message : String(err);
    }
  } else {
    fetchError = "no_external_account_id";
  }

  // Normal state: no active Guardrail limit at broker (app_side_only mode).
  const isStale = guardrailLimitFound && limitActive === true;
  const staleRawLimitWarning = isStale
    ? "A Guardrail-owned position limit is still active at Tradovate. In app_side_only mode " +
      "this should be deactivated. POST to suggestedEndpoint to repair, or save maxContracts " +
      "again to trigger cleanup automatically."
    : null;

  const brokerStateOk = !guardrailLimitFound || limitActive === false;

  const manualCleanupInstructions =
    isStale && limitId != null
      ? `If the automated repair (POST ${`/api/accounts/${accountId}/sync-broker-rules`}) returns ` +
        `409 manual_cleanup_required, log in to your Tradovate account, go to Risk Settings, ` +
        `find the position limit with ID ${limitId} (description: "Guardrail Max Position Size"), ` +
        "and deactivate or delete it manually."
      : null;

  // What Guardrail would do on the next sync if the current state persists.
  const guardrailAction =
    wouldBreach === true && livePositions.length > 0
      ? "lock_and_flatten: account will be locked (riskState=STOPPED) and open positions flattened (if order actions are enabled and connection has write access)"
      : wouldBreach === true
        ? "lock: account will be locked (riskState=STOPPED); no open positions to flatten"
        : wouldBreach === false
          ? "no_action: exposure is within limit"
          : null;

  return NextResponse.json({
    accountId,
    externalAccountId: account.externalAccountId ?? null,
    accountConnectionStatus: account.connectionStatus,
    brokerConnectionStatus: brokerConnection?.connectionStatus ?? null,
    permissionLevel: brokerConnection?.permissionLevel ?? null,
    lastRenewError: brokerConnection?.lastRenewError ?? null,
    // Guardrail DB value (standard-equivalent units per Apex 10-micro=1-standard model)
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
    appSideEnforcementNote:
      "Guardrail cannot intercept orders before they execute at Tradovate. " +
      "Enforcement is detection-response: cron sync (every ~5 min) reads live positions, " +
      "computes standard-equivalent exposure, and locks/flattens if the limit is exceeded. " +
      "Orders placed directly in trader.tradovate.com will fill before Guardrail sees them.",
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
    brokerStateOk,
    // Repair guidance when a stale raw limit is blocking micro orders
    suggestedAction: isStale ? ("deactivate_stale_raw_limit" as const) : null,
    suggestedEndpoint: isStale ? (`/api/accounts/${accountId}/sync-broker-rules` as const) : null,
    manualCleanupInstructions,
    // ── Live position exposure ─────────────────────────────────────────────
    livePositions,
    exposureByRoot,
    totalMiniEquivalentExposure,
    unsupportedPositions,
    wouldBreach,
    guardrailAction,
    positionFetchError,
  });
}
