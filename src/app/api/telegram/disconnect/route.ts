/**
 * POST /api/telegram/disconnect
 *
 * Disconnects the user's Telegram integration. This only removes the
 * TelegramConnection row (and any unused link tokens) for the current user.
 *
 * It does NOT touch broker connections, connected accounts, rules, alert
 * history, trading data, audit logs, or internal lock events — Telegram is an
 * optional notification channel and disconnecting it is independent of all
 * trading state.
 */
import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";

export async function POST() {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const limit = checkRateLimit(`telegram_disconnect:${currentUser.id}`, 10, 3_600_000);
  if (!limit.ok) {
    return NextResponse.json({ error: "too_many_requests" }, { status: 429 });
  }

  // deleteMany (not delete) so a missing connection is a no-op success rather
  // than a 404 — the desired end-state (not connected) is already true.
  const [, removedTokens] = await prisma.$transaction([
    prisma.telegramConnection.deleteMany({ where: { userId: currentUser.id } }),
    prisma.telegramLinkToken.deleteMany({ where: { userId: currentUser.id } }),
  ]);

  console.info("[telegram/disconnect] telegram disconnected", {
    userId: currentUser.id,
    removedTokens: removedTokens.count,
  });

  return NextResponse.json({ ok: true });
}
