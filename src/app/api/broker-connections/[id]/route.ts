import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;

  const bc = await prisma.brokerConnection.findFirst({
    where: { id, userId: currentUser.id },
    select: { id: true },
  });
  if (!bc) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Block if any non-archived active accounts are still linked.
  // Archived accounts are safe to unlink: their brokerConnectionId is nulled
  // before deletion so the ConnectedAccount row (and all historical data on it)
  // is preserved. Never deletes NormalizedTradeEvent, AccountRiskRules,
  // InternalLockEvent, GuardianStatus, BrokerOrderActionLog, or RuleChangeAudit.
  const activeLinkedCount = await prisma.connectedAccount.count({
    where: {
      brokerConnectionId: id,
      isActive: true,
      protectionStatus: { not: "archived" },
    },
  });
  if (activeLinkedCount > 0) {
    return NextResponse.json(
      {
        error: "has_linked_accounts",
        message: "Remove linked accounts first, then remove this connection.",
      },
      { status: 409 },
    );
  }

  // All remaining linked accounts (if any) are archived. Unlink them in the
  // same transaction as the delete so the connection is never left dangling.
  await prisma.$transaction([
    prisma.connectedAccount.updateMany({
      where: { brokerConnectionId: id, isActive: true },
      data: { brokerConnectionId: null },
    }),
    prisma.brokerConnection.delete({ where: { id } }),
  ]);

  console.info("[broker-connections/delete] connection removed", {
    brokerConnectionId: id,
    userId: currentUser.id,
  });

  return NextResponse.json({ ok: true });
}

