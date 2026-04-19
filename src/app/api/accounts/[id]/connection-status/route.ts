import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;

  // Ownership check before returning event data.
  const account = await prisma.connectedAccount.findFirst({
    where: { id, userId: currentUser.id },
    select: { id: true },
  });
  if (!account) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const lastEvent = await prisma.normalizedTradeEvent.findFirst({
    where: { accountId: id },
    orderBy: { occurredAt: "desc" },
    select: { eventType: true, occurredAt: true },
  });

  return NextResponse.json({ lastEvent });
}
