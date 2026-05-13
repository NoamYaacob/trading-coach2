import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { TradovateClient } from "@/lib/brokers/tradovate-client";
import { TradovateClientError } from "@/lib/brokers/tradovate-client-helpers";

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
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;

  const account = await prisma.connectedAccount.findFirst({
    where: { id, userId: currentUser.id, platform: "tradovate", isActive: true },
    select: {
      id: true,
      externalAccountId: true,
      brokerConnectionId: true,
    },
  });

  if (!account) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  if (!account.externalAccountId) {
    return NextResponse.json(
      {
        ok: false,
        error: "no_external_account_id",
        message: "Account has no Tradovate external account ID. Connect the account first.",
      },
      { status: 422 },
    );
  }

  try {
    const client = new TradovateClient(id, currentUser.id);
    await client.initialize();

    // maxContracts: null → deactivate path in applyMaxPositionSize: removes any
    // Guardrail-owned raw limit (description="Guardrail Max Position Size").
    // User-created and prop-firm-created limits are never touched.
    const result = await client.applyMaxPositionSize({
      maxContracts: null,
      brokerEnforcementMode: "app_side_only",
    });

    const deactivated = result.action === "deactivated";

    console.info("[accounts/sync-broker-rules] broker position limit synced", {
      accountId: id,
      externalAccountId: account.externalAccountId,
      brokerConnectionId: account.brokerConnectionId ?? null,
      brokerEnforcementMode: "app_side_only",
      action: result.action,
      endpoints: result.endpoints,
    });

    return NextResponse.json({
      ok: true,
      action: result.action,
      deactivated,
      brokerEnforcementMode: "app_side_only",
      message: deactivated
        ? "Stale raw Guardrail position limit deactivated. Tradovate will no longer reject micro orders."
        : "No active Guardrail-owned raw position limit found at Tradovate. Broker state is already clean.",
    });
  } catch (err) {
    const isTvError = err instanceof TradovateClientError;
    const code = isTvError ? err.code : "UNKNOWN";
    const statusCode = isTvError ? (err.statusCode ?? null) : null;
    const message = err instanceof Error ? err.message : String(err);

    console.warn("[accounts/sync-broker-rules] broker cleanup failed", {
      accountId: id,
      externalAccountId: account.externalAccountId,
      brokerConnectionId: account.brokerConnectionId ?? null,
      brokerEnforcementMode: "app_side_only",
      code,
      statusCode,
      error: message,
    });

    return NextResponse.json(
      {
        ok: false,
        error: "broker_cleanup_failed",
        code,
        message,
        details: statusCode != null ? `HTTP ${statusCode}` : null,
      },
      { status: 502 },
    );
  }
}
