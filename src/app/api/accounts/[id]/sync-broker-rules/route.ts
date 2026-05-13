import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { TradovateClient } from "@/lib/brokers/tradovate-client";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/accounts/[id]/sync-broker-rules
 *
 * Repair action: deactivates any stale Guardrail-owned raw position limit at
 * Tradovate and confirms app_side_only enforcement is in effect.
 *
 * Background: prior to the standard-equivalent enforcement model, Guardrail
 * wrote a raw global contract cap (exposedLimit=N, totalBy="Overall") to
 * Tradovate. That cap is product-blind — it incorrectly blocks 2 MNQ even
 * when the user's limit means "1 NQ-equivalent" (2 MNQ = 0.2 NQ-equiv).
 * This endpoint deactivates any such leftover limit. Only limits with
 * description="Guardrail Max Position Size" are touched; user-created and
 * prop-firm-created Tradovate settings are never modified.
 *
 * Idempotent: safe to call repeatedly.
 */
export async function POST(_req: NextRequest, ctx: Ctx) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;

  const account = await prisma.connectedAccount.findFirst({
    where: { id, userId: currentUser.id, platform: "tradovate", isActive: true },
    select: {
      id: true,
      externalAccountId: true,
      riskRules: { select: { maxContracts: true } },
    },
  });

  if (!account) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  if (!account.externalAccountId) {
    return NextResponse.json({ error: "no_external_account_id" }, { status: 422 });
  }

  const maxContracts = account.riskRules?.maxContracts ?? null;

  const client = new TradovateClient(id, currentUser.id);
  await client.initialize();

  // app_side_only: deactivates any Guardrail-owned raw limit so Tradovate
  // no longer rejects micro orders. Only our owned limit is touched.
  const result = await client.applyMaxPositionSize({
    maxContracts,
    brokerEnforcementMode: "app_side_only",
  });

  console.info("[accounts/sync-broker-rules] broker position limit synced", {
    accountId: id,
    externalAccountId: account.externalAccountId,
    maxContracts,
    brokerEnforcementMode: "app_side_only",
    action: result.action,
    endpoints: result.endpoints,
  });

  return NextResponse.json({
    ok: true,
    action: result.action,
    endpoints: result.endpoints,
    brokerEnforcementMode: "app_side_only",
    maxContracts,
  });
}
