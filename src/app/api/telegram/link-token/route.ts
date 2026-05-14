import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { hasBotAccess } from "@/lib/subscription";
import { generateTelegramLinkToken } from "@/lib/telegram";
import { checkRateLimit } from "@/lib/rate-limit";

export async function POST() {
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const linkTokenLimit = checkRateLimit(`telegram_link_token:${currentUser.id}`, 5, 3_600_000);
  if (!linkTokenLimit.ok) {
    return NextResponse.json(
      { error: "too_many_requests" },
      { status: 429, headers: { "Retry-After": String(linkTokenLimit.retryAfterSeconds) } },
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: currentUser.id },
    select: {
      id: true,
      email: true,
      subscriptionStatus: true,
      trialEndsAt: true,
    },
  });

  if (!user) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }

  if (!hasBotAccess(user.subscriptionStatus, user.trialEndsAt, user.email)) {
    return NextResponse.json(
      { error: "bot access is only available for active trial or subscription" },
      { status: 403 },
    );
  }

  const token = generateTelegramLinkToken();
  const expiresAt = new Date(Date.now() + 1000 * 60 * 15);
  const botUsername =
    process.env.TELEGRAM_BOT_USERNAME ??
    process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;

  // Invalidate any previously issued, still-unused tokens for this
  // user. Generating a new link token is a "redo" intent — old tokens
  // should not remain redeemable.
  const [, linkToken] = await prisma.$transaction([
    prisma.telegramLinkToken.updateMany({
      where: { userId: user.id, usedAt: null, expiresAt: { gt: new Date() } },
      data: { expiresAt: new Date() },
    }),
    prisma.telegramLinkToken.create({
      data: {
        userId: user.id,
        token,
        expiresAt,
      },
      select: {
        token: true,
        expiresAt: true,
      },
    }),
  ]);

  const cleanUsername = botUsername?.replace(/^@/, "");

  return NextResponse.json({
    ok: true,
    linkToken,
    telegramLink: cleanUsername
      ? `https://t.me/${cleanUsername}?start=${linkToken.token}`
      : null,
  });
}
