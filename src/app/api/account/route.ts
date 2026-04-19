import { NextResponse } from "next/server";

import { clearSession, getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function DELETE() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await prisma.user.delete({ where: { id: user.id } });
  await clearSession();

  return NextResponse.json({ ok: true });
}
