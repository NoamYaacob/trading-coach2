import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { TradovateClient } from "@/lib/brokers/tradovate-client";
import {
  findGuardrailPositionLimit,
  type TvUserAccountRiskParameter,
} from "@/lib/brokers/tradovate-position-limit";

/**
 * GET /api/debug/tradovate-position-limit?accountId=...
 *
 * Returns the current state of the Guardrail-owned Tradovate position limit
 * for the given ConnectedAccount. Useful for confirming whether the limit
 * was created, what exposedLimit value was written, and whether
 * userAccountRiskParameter.hardLimit=true is attached.
 *
 * Fields returned:
 *   guardrailMaxContracts   — Guardrail DB value (AccountRiskRules.maxContracts)
 *   externalAccountId       — Tradovate numeric account ID stored in our DB
 *   brokerConnectionStatus  — BrokerConnection.connectionStatus
 *   permissionLevel         — BrokerConnection.permissionLevel
 *   guardrailLimitFound     — whether a Guardrail-owned limit exists at Tradovate
 *   limitId                 — Tradovate internal ID of the limit, if found
 *   exposedLimit            — max contracts value stored at Tradovate
 *   active                  — whether the limit is active at Tradovate
 *   hardLimitAttached       — whether userAccountRiskParameter.hardLimit=true is set
 *   allLimitCount           — total position limits returned by Tradovate for the account
 *   fetchError              — set when the Tradovate API call fails
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

  const guardrailMaxContracts = account.riskRules?.maxContracts ?? null;

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

        // Check if a risk parameter with hardLimit=true is attached.
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

  return NextResponse.json({
    accountId,
    externalAccountId: account.externalAccountId ?? null,
    accountConnectionStatus: account.connectionStatus,
    brokerConnectionStatus: brokerConnection?.connectionStatus ?? null,
    permissionLevel: brokerConnection?.permissionLevel ?? null,
    lastRenewError: brokerConnection?.lastRenewError ?? null,
    // Guardrail DB value
    guardrailMaxContracts,
    // Live Tradovate state
    guardrailLimitFound,
    limitId,
    exposedLimit,
    limitActive,
    hardLimitAttached,
    allLimitCount,
    fetchError,
    // Diagnosis
    limitMatchesGuardrail:
      guardrailLimitFound && exposedLimit === guardrailMaxContracts,
    readyForDemo:
      guardrailLimitFound &&
      limitActive === true &&
      hardLimitAttached === true &&
      exposedLimit === guardrailMaxContracts,
  });
}
