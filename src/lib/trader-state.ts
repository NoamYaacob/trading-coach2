import { TraderCurrentState } from "@prisma/client";

import { prisma } from "@/lib/db";

const COOL_DOWN_MINUTES = 20;
const DOUBLE_LOSS_COOL_DOWN_MINUTES = 45;
const RESETTING_COOL_DOWN_MINUTES = 10;

type TraderStateExtraData = {
  stateNotes?: string | null;
  recentLossStreak?: number | null;
  needsCooldown?: boolean;
  cooldownUntil?: Date | null;
};

export function deriveShortLivedCoachingFlags(
  traderState:
    | {
        currentState: TraderCurrentState;
        recentLossStreak: number | null;
        needsCooldown: boolean;
        cooldownUntil: Date | null;
      }
    | null
    | undefined,
) {
  const now = new Date();
  const cooldownActive = Boolean(
    traderState?.needsCooldown &&
      traderState.cooldownUntil &&
      traderState.cooldownUntil > now,
  );

  return {
    currentState: traderState?.currentState ?? TraderCurrentState.NONE,
    recentLossStreak: traderState?.recentLossStreak ?? 0,
    cooldownActive,
    shouldInterruptHard:
      traderState?.currentState === TraderCurrentState.REVENGE ||
      traderState?.currentState === TraderCurrentState.TILTED ||
      cooldownActive,
    stopTradingBias:
      (traderState?.recentLossStreak ?? 0) >= 2 ||
      traderState?.currentState === TraderCurrentState.JUST_TOOK_TWO_LOSSES,
    resetInProgress: traderState?.currentState === TraderCurrentState.RESETTING,
    calmRecovered: traderState?.currentState === TraderCurrentState.CALM,
  };
}

export async function getCurrentTraderState(userId: string) {
  const traderState = await prisma.traderState.findUnique({
    where: { userId },
  });

  return {
    traderState,
    flags: deriveShortLivedCoachingFlags(traderState),
  };
}

export async function setCurrentTraderState(
  userId: string,
  nextState: TraderCurrentState,
  extraData: TraderStateExtraData = {},
) {
  const traderState = await prisma.traderState.upsert({
    where: { userId },
    create: {
      userId,
      currentState: nextState,
      stateNotes: extraData.stateNotes ?? null,
      recentLossStreak: extraData.recentLossStreak ?? 0,
      needsCooldown: extraData.needsCooldown ?? false,
      cooldownUntil: extraData.cooldownUntil ?? null,
      lastStateAt: new Date(),
    },
    update: {
      currentState: nextState,
      stateNotes: extraData.stateNotes ?? null,
      recentLossStreak: extraData.recentLossStreak ?? undefined,
      needsCooldown: extraData.needsCooldown ?? false,
      cooldownUntil: extraData.cooldownUntil ?? null,
      lastStateAt: new Date(),
    },
  });

  return {
    traderState,
    flags: deriveShortLivedCoachingFlags(traderState),
  };
}

export async function clearTraderState(userId: string) {
  return setCurrentTraderState(userId, TraderCurrentState.NONE, {
    stateNotes: null,
    recentLossStreak: 0,
    needsCooldown: false,
    cooldownUntil: null,
  });
}

export function deriveTraderStateUpdate(message: string) {
  const normalized = message
    .trim()
    .toLowerCase()
    .replace(/[׳']/g, "")
    .replace(/\s+/g, " ");

  if (!normalized) {
    return null;
  }

  if (["יש לי fomo", "יש לי פומו"].some((pattern) => normalized.includes(pattern))) {
    return {
      nextState: TraderCurrentState.FOMO,
      extraData: {
        stateNotes: "Live FOMO signal",
      },
    };
  }

  if (
    [
      "אני רוצה להחזיר את ההפסד",
      "אני רוצה להחזיר",
      "אני חייב להחזיר את זה",
      "אני חייב להחזיר",
      "אני רוצה להחזיר עכשיו",
      "אני צריך להחזיר את זה",
    ].some((pattern) => normalized.includes(pattern))
  ) {
    return {
      nextState: TraderCurrentState.REVENGE,
      extraData: {
        stateNotes: "Revenge-loss impulse",
        needsCooldown: true,
        cooldownUntil: new Date(Date.now() + COOL_DOWN_MINUTES * 60_000),
      },
    };
  }

  if (["אני בעצבים", "אני לא בשליטה"].some((pattern) => normalized.includes(pattern))) {
    return {
      nextState: TraderCurrentState.TILTED,
      extraData: {
        stateNotes: "Tilt / loss of control",
        needsCooldown: true,
        cooldownUntil: new Date(Date.now() + COOL_DOWN_MINUTES * 60_000),
      },
    };
  }

  if (normalized.includes("נגררתי")) {
    return {
      nextState: TraderCurrentState.FOMO,
      extraData: {
        stateNotes: "Impulsive entry — got dragged in without a setup",
      },
    };
  }

  if (normalized.includes("עצור אותי")) {
    return {
      nextState: TraderCurrentState.TILTED,
      extraData: {
        stateNotes: "Hard-stop request — trader flagging themselves before doing something wrong",
        needsCooldown: true,
        cooldownUntil: new Date(Date.now() + COOL_DOWN_MINUTES * 60_000),
      },
    };
  }

  if (normalized.includes("הפסדתי פעמיים")) {
    return {
      nextState: TraderCurrentState.JUST_TOOK_TWO_LOSSES,
      extraData: {
        stateNotes: "Two recent losses reported",
        recentLossStreak: 2,
        needsCooldown: true,
        cooldownUntil: new Date(Date.now() + DOUBLE_LOSS_COOL_DOWN_MINUTES * 60_000),
      },
    };
  }

  if (normalized.includes("הפסדתי עכשיו")) {
    return {
      nextState: TraderCurrentState.JUST_TOOK_LOSS,
      extraData: {
        stateNotes: "Fresh loss reported",
        recentLossStreak: 1,
      },
    };
  }

  if (["אני נרגע", "נרגעתי"].some((pattern) => normalized.includes(pattern))) {
    return {
      nextState: TraderCurrentState.RESETTING,
      extraData: {
        stateNotes: "Resetting / decompression",
        needsCooldown: true,
        cooldownUntil: new Date(Date.now() + RESETTING_COOL_DOWN_MINUTES * 60_000),
      },
    };
  }

  if (["חזרתי לשליטה", "חזרתי"].some((pattern) => normalized.includes(pattern))) {
    return {
      nextState: TraderCurrentState.CALM,
      extraData: {
        stateNotes: "Recovered composure",
        needsCooldown: false,
        cooldownUntil: null,
      },
    };
  }

  if (
    ["צק אין", "check in", "אני עומד לסחור", "premarket", "אני לפני מסחר"].some(
      (pattern) => normalized.includes(pattern),
    )
  ) {
    return {
      nextState: TraderCurrentState.PREMARKET_READY,
      extraData: {
        stateNotes: "Premarket check-in",
        needsCooldown: false,
      },
    };
  }

  return null;
}
