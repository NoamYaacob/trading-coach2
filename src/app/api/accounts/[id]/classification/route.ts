import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";

const VALID_ACCOUNT_TYPES = ["evaluation", "funded", "personal", "demo"] as const;
type ValidAccountType = (typeof VALID_ACCOUNT_TYPES)[number];

type Body = {
  propFirm?: string | null;
  accountType?: string;
};

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const limit = checkRateLimit(`account_classification:${user.id}`, 20, 3_600_000);
  if (!limit.ok) {
    return NextResponse.json({ error: "too_many_requests" }, { status: 429 });
  }

  const { id } = await params;

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const account = await prisma.connectedAccount.findFirst({
    where: {
      id,
      userId: user.id,
      isActive: true,
      protectionStatus: { not: "pending_decision" },
    },
    select: { id: true, propFirm: true, protectionStatus: true },
  });
  if (!account) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Safety guard: only update when propFirm is unset (null/empty). This prevents
  // silently overwriting an explicit user classification with an inferred one.
  if (account.propFirm !== null && account.propFirm.trim() !== "") {
    return NextResponse.json({ error: "already_classified" }, { status: 409 });
  }

  const data: { propFirm?: string | null; accountType?: ValidAccountType } = {};

  if (body.propFirm !== undefined) {
    data.propFirm = body.propFirm?.trim() || null;
  }
  if (body.accountType && VALID_ACCOUNT_TYPES.includes(body.accountType as ValidAccountType)) {
    data.accountType = body.accountType as ValidAccountType;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "nothing_to_update" }, { status: 400 });
  }

  await prisma.connectedAccount.update({
    where: { id: account.id },
    data,
  });

  console.info("[account-classification] classification repaired", {
    accountId: account.id,
    userId: user.id,
    propFirm: data.propFirm,
    accountType: data.accountType,
  });

  return NextResponse.json({ ok: true });
}
