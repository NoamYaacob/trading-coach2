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

  // Only allow deleting connections that have no active linked accounts —
  // removing a live connection's token while accounts exist would silently
  // break their sync without any visible warning to the user.
  const linkedCount = await prisma.connectedAccount.count({
    where: { brokerConnectionId: id, isActive: true },
  });
  if (linkedCount > 0) {
    return NextResponse.json(
      { error: "has_linked_accounts", message: "Cannot remove a connection with linked accounts." },
      { status: 409 },
    );
  }

  await prisma.brokerConnection.delete({ where: { id } });

  console.info("[broker-connections/delete] connection removed", {
    brokerConnectionId: id,
    userId: currentUser.id,
  });

  return NextResponse.json({ ok: true });
}
