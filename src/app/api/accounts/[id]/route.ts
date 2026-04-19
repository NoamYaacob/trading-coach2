import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

type Ctx = { params: Promise<{ id: string }> };

const VALID_PLATFORMS = ["tradovate", "tradingview", "manual"] as const;
const VALID_ACCOUNT_TYPES = ["evaluation", "funded", "personal", "demo"] as const;

type RiskRulesBody = {
  maxDailyLoss?: number | null;
  riskPerTrade?: number | null;
  maxTradesPerDay?: number | null;
  stopAfterLosses?: number | null;
  allowedStartHour?: number | null;
  allowedEndHour?: number | null;
};

function riskRulesData(r: RiskRulesBody) {
  return {
    maxDailyLoss: r.maxDailyLoss != null ? String(r.maxDailyLoss) : null,
    riskPerTrade: r.riskPerTrade != null ? String(r.riskPerTrade) : null,
    maxTradesPerDay: r.maxTradesPerDay ?? null,
    stopAfterLosses: r.stopAfterLosses ?? null,
    allowedStartHour: r.allowedStartHour ?? null,
    allowedEndHour: r.allowedEndHour ?? null,
  };
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
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

  const body = (await req.json()) as {
    label?: string;
    platform?: string;
    propFirm?: string | null;
    accountType?: string;
    externalAccountId?: string | null;
    currency?: string;
    isActive?: boolean;
    riskRules?: RiskRulesBody | null;
  };

  const platform = VALID_PLATFORMS.includes(body.platform as (typeof VALID_PLATFORMS)[number])
    ? (body.platform as (typeof VALID_PLATFORMS)[number])
    : undefined;

  const accountType = VALID_ACCOUNT_TYPES.includes(
    body.accountType as (typeof VALID_ACCOUNT_TYPES)[number],
  )
    ? (body.accountType as (typeof VALID_ACCOUNT_TYPES)[number])
    : undefined;

  const account = await prisma.connectedAccount.update({
    where: { id },
    data: {
      ...(body.label !== undefined && { label: body.label }),
      ...(platform !== undefined && { platform }),
      ...(body.propFirm !== undefined && { propFirm: body.propFirm }),
      ...(accountType !== undefined && { accountType }),
      ...(body.externalAccountId !== undefined && { externalAccountId: body.externalAccountId }),
      ...(body.currency !== undefined && { currency: body.currency }),
      ...(body.isActive !== undefined && { isActive: body.isActive }),
    },
  });

  if (body.riskRules !== undefined) {
    if (body.riskRules === null) {
      await prisma.accountRiskRules.deleteMany({ where: { accountId: id } });
    } else {
      const data = riskRulesData(body.riskRules);
      await prisma.accountRiskRules.upsert({
        where: { accountId: id },
        create: { accountId: id, ...data },
        update: data,
      });
    }
  }

  return NextResponse.json({ account });
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
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

  await prisma.connectedAccount.update({
    where: { id },
    data: { isActive: false },
  });

  return NextResponse.json({ ok: true });
}
