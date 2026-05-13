import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { promoteAccountPendingRules, type PromoterPrisma } from "@/lib/pending-rule-promoter";
import { TradovateClient } from "@/lib/brokers/tradovate-client";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, ctx: Ctx) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;

  const existing = await prisma.connectedAccount.findFirst({
    where: { id, userId: currentUser.id },
  });
  if (!existing) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const summary = await promoteAccountPendingRules(prisma as unknown as PromoterPrisma, id);

  // After a successful promotion, fire-and-forget broker sync for the updated
  // maxContracts value. A broker sync failure must NOT roll back the DB promotion —
  // the Guardrail DB is authoritative and the user can retry via the account page.
  if (summary.promotedAccountCount > 0 && existing.platform === "tradovate" && existing.externalAccountId) {
    void (async () => {
      try {
        const rules = await prisma.accountRiskRules.findUnique({
          where: { accountId: id },
          select: { maxContracts: true },
        });
        const maxContracts = rules?.maxContracts ?? null;
        const client = new TradovateClient(id, currentUser.id);
        await client.initialize();
        // app_side_only: a global raw cap blocks micro products incorrectly.
        const result = await client.applyMaxPositionSize({
          maxContracts,
          brokerEnforcementMode: "app_side_only",
        });
        console.info("[accounts/apply-pending] broker max position size synced", {
          accountId: id,
          externalAccountId: existing.externalAccountId,
          maxContracts,
          brokerEnforcementMode: "app_side_only",
          action: result.action,
          endpoints: result.endpoints,
        });
      } catch (err) {
        console.warn("[accounts/apply-pending] broker max position size sync failed (non-fatal)", {
          accountId: id,
          externalAccountId: existing.externalAccountId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();
  }

  return NextResponse.json({
    promoted: summary.promotedAccountCount,
    skipped: summary.skippedNotSafeCount,
    skipReason: summary.skippedRows[0]?.skipReason ?? null,
    errors: summary.errors,
  });
}
