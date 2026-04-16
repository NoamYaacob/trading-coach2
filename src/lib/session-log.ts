import { TraderCurrentState, type Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";

type CoachEventSource = "telegram" | "debug";

type LogCoachEventInput = {
  userId: string;
  source: CoachEventSource;
  message: string;
  detectedIntent: string;
  coachMode: string;
  traderState: TraderCurrentState;
  cooldownActive: boolean;
  metadataJson?: Prisma.InputJsonValue;
};

export type TodaySessionSummary = {
  eventCount: number;
  distressCount: number;
  fomoCount: number;
  revengeCount: number;
  tiltCount: number;
  lossCount: number;
  twoLossCount: number;
  resetCount: number;
  calmCount: number;
  cooldownCount: number;
  hasRecoveryToday: boolean;
  stayedUnstable: boolean;
};

export function getTodayRange() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  return { start, end };
}

function inferEventType(input: {
  detectedIntent: string;
  traderState: TraderCurrentState;
}) {
  if (input.detectedIntent === "day_summary") {
    return "DAY_SUMMARY";
  }

  if (input.detectedIntent === "rule_question") {
    return "RULES";
  }

  if (input.traderState === TraderCurrentState.PREMARKET_READY) {
    return "CHECK_IN";
  }

  if (
    input.traderState === TraderCurrentState.FOMO ||
    input.traderState === TraderCurrentState.REVENGE ||
    input.traderState === TraderCurrentState.TILTED ||
    input.traderState === TraderCurrentState.JUST_TOOK_LOSS ||
    input.traderState === TraderCurrentState.JUST_TOOK_TWO_LOSSES
  ) {
    return "DISTRESS";
  }

  if (
    input.traderState === TraderCurrentState.RESETTING ||
    input.traderState === TraderCurrentState.CALM
  ) {
    return "RECOVERY";
  }

  return "COACH_INTERACTION";
}

export async function logCoachEvent(input: LogCoachEventInput) {
  return prisma.dailySessionEvent.create({
    data: {
      userId: input.userId,
      source: input.source,
      message: input.message,
      detectedIntent: input.detectedIntent,
      coachMode: input.coachMode,
      traderState: input.traderState,
      cooldownActive: input.cooldownActive,
      eventType: inferEventType({
        detectedIntent: input.detectedIntent,
        traderState: input.traderState,
      }),
      metadataJson: input.metadataJson,
    },
  });
}

export async function getTodaySessionEvents(
  userId: string,
  limit?: number,
  order: "asc" | "desc" = "desc",
) {
  const { start, end } = getTodayRange();

  return prisma.dailySessionEvent.findMany({
    where: {
      userId,
      createdAt: {
        gte: start,
        lt: end,
      },
    },
    orderBy: { createdAt: order },
    ...(limit ? { take: limit } : {}),
  });
}

export async function getTodaySessionSummary(userId: string): Promise<TodaySessionSummary> {
  const events = await getTodaySessionEvents(userId);

  const summary = events.reduce<TodaySessionSummary>(
    (acc, event) => {
      acc.eventCount += 1;

      if (event.eventType === "DISTRESS") {
        acc.distressCount += 1;
      }

      if (event.cooldownActive) {
        acc.cooldownCount += 1;
      }

      if (event.eventType === "DISTRESS" && event.traderState === TraderCurrentState.FOMO) {
        acc.fomoCount += 1;
      }

      if (event.eventType === "DISTRESS" && event.traderState === TraderCurrentState.REVENGE) {
        acc.revengeCount += 1;
      }

      if (event.eventType === "DISTRESS" && event.traderState === TraderCurrentState.TILTED) {
        acc.tiltCount += 1;
      }

      if (
        event.eventType === "DISTRESS" &&
        event.traderState === TraderCurrentState.JUST_TOOK_LOSS
      ) {
        acc.lossCount += 1;
      }

      if (
        event.eventType === "DISTRESS" &&
        event.traderState === TraderCurrentState.JUST_TOOK_TWO_LOSSES
      ) {
        acc.twoLossCount += 1;
      }

      if (
        event.eventType === "RECOVERY" &&
        event.traderState === TraderCurrentState.RESETTING
      ) {
        acc.resetCount += 1;
      }

      if (event.eventType === "RECOVERY" && event.traderState === TraderCurrentState.CALM) {
        acc.calmCount += 1;
      }

      return acc;
    },
    {
      eventCount: 0,
      distressCount: 0,
      fomoCount: 0,
      revengeCount: 0,
      tiltCount: 0,
      lossCount: 0,
      twoLossCount: 0,
      resetCount: 0,
      calmCount: 0,
      cooldownCount: 0,
      hasRecoveryToday: false,
      stayedUnstable: false,
    },
  );

  summary.hasRecoveryToday = summary.resetCount > 0 || summary.calmCount > 0;
  summary.stayedUnstable = summary.distressCount > 0 && !summary.hasRecoveryToday;

  return summary;
}

export async function getRecentSessionContext(userId: string) {
  const [summary, recentEvents] = await Promise.all([
    getTodaySessionSummary(userId),
    getTodaySessionEvents(userId, 5),
  ]);

  return {
    summary,
    recentEvents,
  };
}
