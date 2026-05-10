import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { promoteAccountPendingRules, type PromoterPrisma } from "@/lib/pending-rule-promoter";

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

  return NextResponse.json({
    promoted: summary.promotedAccountCount,
    skipped: summary.skippedNotSafeCount,
    skipReason: summary.skippedRows[0]?.skipReason ?? null,
    errors: summary.errors,
  });
}
