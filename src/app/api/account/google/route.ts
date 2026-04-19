import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function DELETE() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [dbUser, oauthConnections] = await Promise.all([
    prisma.user.findUnique({ where: { id: user.id }, select: { passwordHash: true } }),
    prisma.oAuthConnection.findMany({ where: { userId: user.id } }),
  ]);

  const hasPassword = Boolean(dbUser?.passwordHash);
  const otherOAuthCount = oauthConnections.filter((c) => c.provider !== "google").length;

  if (!hasPassword && otherOAuthCount === 0) {
    return NextResponse.json(
      { error: "Google is your only sign-in method. Add a password before disconnecting." },
      { status: 400 },
    );
  }

  await prisma.oAuthConnection.deleteMany({
    where: { userId: user.id, provider: "google" },
  });

  return NextResponse.json({ ok: true });
}
