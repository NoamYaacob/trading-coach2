import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { promoteDefaultPendingRules, type PromoterPrisma } from "@/lib/pending-rule-promoter";

export async function POST(_req: NextRequest) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const summary = await promoteDefaultPendingRules(prisma as unknown as PromoterPrisma, currentUser.id);

  return NextResponse.json({
    promoted: summary.promotedDefaultCount,
    skipped: summary.skippedNotSafeCount,
    skipReason: summary.skippedRows[0]?.skipReason ?? null,
    errors: summary.errors,
  });
}
