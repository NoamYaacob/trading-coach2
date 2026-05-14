import { NextResponse } from "next/server";
import { TraderCurrentState } from "@prisma/client";

import { generateMorningCheckIn } from "@/lib/ai-coach";
import { getTelegramQuickActionKeyboard } from "@/lib/coach-actions";
import { prisma } from "@/lib/db";
import { getLocale } from "@/lib/i18n";
import { sendTelegramMessage } from "@/lib/telegram";

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function yesterdayKey(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return toDateKey(d);
}

export async function POST(request: Request) {
  const secret = request.headers.get("x-cron-secret");
  const expected = process.env.CRON_SECRET;
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const users = await prisma.user.findMany({
    where: {
      coachingPreferences: { premarketCheckinEnabled: true },
      telegramConnection: { telegramChatId: { not: null } },
    },
    select: {
      id: true,
      mentalProfile: {
        select: {
          coachingTone: true,
          tradingWhy: true,
          tradingGoal: true,
          groundingReminder: true,
          primaryChallenge: true,
          preferredAddress: true,
        },
      },
      coachingPreferences: {
        select: {
          preferredLanguage: true,
          checkinFormat: true,
        },
      },
      traderProfile: {
        select: {
          primaryMarket: true,
          tradingStyle: true,
        },
      },
      telegramConnection: {
        select: { telegramChatId: true },
      },
    },
  });

  const yKey = yesterdayKey();
  const results: Array<{ userId: string; status: string }> = [];

  for (const user of users) {
    const chatId = user.telegramConnection?.telegramChatId;
    if (!chatId) continue;

    const language = user.coachingPreferences?.preferredLanguage ?? "he";

    const yesterdaySession = await prisma.dailyGuardianSession.findFirst({
      where: { userId: user.id, sessionDateKey: yKey },
      select: { endedAt: true },
    });

    let yesterdayFinalState: string | null = null;
    if (yesterdaySession) {
      const lastEvent = await prisma.dailySessionEvent.findFirst({
        where: { userId: user.id, createdAt: { gte: new Date(yKey) } },
        orderBy: { createdAt: "desc" },
        select: { traderState: true },
      });
      yesterdayFinalState = lastEvent?.traderState
        ? String(lastEvent.traderState as TraderCurrentState)
        : null;
    }

    try {
      const message = await generateMorningCheckIn({
        language,
        coachingTone: user.mentalProfile?.coachingTone ?? null,
        preferredAddress: user.mentalProfile?.preferredAddress ?? null,
        tradingWhy: user.mentalProfile?.tradingWhy ?? null,
        tradingGoal: user.mentalProfile?.tradingGoal ?? null,
        groundingReminder: user.mentalProfile?.groundingReminder ?? null,
        primaryChallenge: user.mentalProfile?.primaryChallenge ?? null,
        primaryMarket: user.traderProfile?.primaryMarket ?? null,
        tradingStyle: user.traderProfile?.tradingStyle ?? null,
        yesterdayHadSession: Boolean(yesterdaySession?.endedAt),
        yesterdayFinalState,
        checkinFormat: user.coachingPreferences?.checkinFormat ?? null,
      });

      if (message) {
        const locale = getLocale(language);
        await sendTelegramMessage(chatId, message, {
          replyMarkup: {
            keyboard: getTelegramQuickActionKeyboard(locale),
            resize_keyboard: true,
            input_field_placeholder: locale.system.inputPlaceholder,
          },
        });
        results.push({ userId: user.id, status: "sent" });
      } else {
        results.push({ userId: user.id, status: "skipped_no_message" });
      }
    } catch (err) {
      console.error(`[morning-checkin] Failed for user ${user.id}:`, err);
      results.push({ userId: user.id, status: "error" });
    }
  }

  return NextResponse.json({ ok: true, sent: results.filter((r) => r.status === "sent").length, results });
}
