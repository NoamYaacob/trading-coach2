import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET() {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const accounts = await prisma.connectedAccount.findMany({
    where: { userId: currentUser.id, isActive: true },
    include: { riskRules: true, sessionState: true },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ accounts });
}

export async function POST(request: Request) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as {
    label: string;
    externalAccountId?: string;
    platform?: string;
    propFirm?: string;
    accountType?: string;
    currency?: string;
    riskRules?: {
      maxDailyLoss?: number;
      riskPerTrade?: number;
      maxTradesPerDay?: number;
      stopAfterLosses?: number;
      allowedStartHour?: number;
      allowedEndHour?: number;
    };
  };

  if (!body.label) {
    return NextResponse.json({ error: "label is required" }, { status: 400 });
  }

  const validPlatforms = ["tradovate", "tradingview", "manual"] as const;
  const validAccountTypes = ["evaluation", "funded", "personal", "demo"] as const;

  const platform = validPlatforms.includes(body.platform as (typeof validPlatforms)[number])
    ? (body.platform as (typeof validPlatforms)[number])
    : ("manual" as const);

  const accountType = validAccountTypes.includes(body.accountType as (typeof validAccountTypes)[number])
    ? (body.accountType as (typeof validAccountTypes)[number])
    : ("personal" as const);

  const account = await prisma.connectedAccount.create({
    data: {
      userId: currentUser.id,
      label: body.label,
      externalAccountId: body.externalAccountId ?? null,
      platform,
      propFirm: body.propFirm ?? null,
      accountType,
      currency: body.currency ?? "USD",
      ...(body.riskRules
        ? {
            riskRules: {
              create: {
                maxDailyLoss: body.riskRules.maxDailyLoss != null ? String(body.riskRules.maxDailyLoss) : null,
                riskPerTrade: body.riskRules.riskPerTrade != null ? String(body.riskRules.riskPerTrade) : null,
                maxTradesPerDay: body.riskRules.maxTradesPerDay ?? null,
                stopAfterLosses: body.riskRules.stopAfterLosses ?? null,
                allowedStartHour: body.riskRules.allowedStartHour ?? null,
                allowedEndHour: body.riskRules.allowedEndHour ?? null,
              },
            },
          }
        : {}),
    },
    include: { riskRules: true },
  });

  return NextResponse.json({ account }, { status: 201 });
}
