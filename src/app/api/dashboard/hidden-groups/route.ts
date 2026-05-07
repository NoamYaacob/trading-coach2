import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

// UI-only dashboard preference: per-user list of group IDs hidden from the
// main account list. Hiding a group does NOT delete, archive, or disconnect
// any account; sync, webhooks, enforcement, trade counts and risk monitoring
// all continue exactly as before.

type HiddenGroupBody = { groupId?: unknown };

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as HiddenGroupBody;
  if (!isNonEmptyString(body.groupId)) {
    return NextResponse.json({ error: "groupId is required" }, { status: 400 });
  }
  const groupId = body.groupId.trim();

  // Idempotent: silently no-op if already hidden.
  await prisma.hiddenDashboardGroup.upsert({
    where: { userId_groupId: { userId: user.id, groupId } },
    create: { userId: user.id, groupId },
    update: {},
  });

  return NextResponse.json({ groupId, hidden: true });
}

export async function DELETE(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const groupIdParam = url.searchParams.get("groupId");
  let groupId: string | null = null;
  if (isNonEmptyString(groupIdParam)) {
    groupId = groupIdParam.trim();
  } else {
    const body = (await request.json().catch(() => ({}))) as HiddenGroupBody;
    if (isNonEmptyString(body.groupId)) groupId = body.groupId.trim();
  }
  if (!groupId) {
    return NextResponse.json({ error: "groupId is required" }, { status: 400 });
  }

  await prisma.hiddenDashboardGroup.deleteMany({
    where: { userId: user.id, groupId },
  });

  return NextResponse.json({ groupId, hidden: false });
}
