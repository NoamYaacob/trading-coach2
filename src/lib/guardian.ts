import {
  GuardianConnectionStatus,
  GuardianLockoutReason,
  GuardianResetMode,
  type DailyGuardianSession,
  type GuardianProfile,
  type GuardianStatus,
  type Prisma,
} from "@prisma/client";

import { prisma } from "@/lib/db";
import {
  getCurrentPreNewsPolicy,
  getSelectedEconomicCalendarSnapshot,
  type EconomicPreNewsPolicyStatus,
} from "@/lib/economic-calendar";

function decimalToNumber(value: Prisma.Decimal | null | undefined) {
  return value ? Number(value.toString()) : null;
}

function numberToDecimalInput(value: number | null | undefined) {
  return value === null || value === undefined || Number.isNaN(value) ? null : value;
}

function clampResetHour(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return 9;
  }

  return Math.min(23, Math.max(0, Math.trunc(value)));
}

function isValidTimeZone(timeZone: string | null | undefined) {
  if (!timeZone) {
    return false;
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function resolveTimeZone(
  candidate: string | null | undefined,
  fallback = "UTC",
): string {
  return isValidTimeZone(candidate) ? (candidate ?? fallback) : fallback;
}

function isPrismaUniqueConstraintError(
  error: unknown,
): error is Prisma.PrismaClientKnownRequestError {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: string }).code === "P2002"
  );
}

function getZonedParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const lookup = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  return {
    year: Number(lookup.year),
    month: Number(lookup.month),
    day: Number(lookup.day),
    hour: Number(lookup.hour),
    minute: Number(lookup.minute),
    second: Number(lookup.second),
  };
}

function addUtcDays(
  value: { year: number; month: number; day: number },
  days: number,
) {
  const date = new Date(Date.UTC(value.year, value.month - 1, value.day));
  date.setUTCDate(date.getUTCDate() + days);

  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function zonedDateTimeToUtc(input: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute?: number;
  second?: number;
  timeZone: string;
}) {
  const desiredUtc = Date.UTC(
    input.year,
    input.month - 1,
    input.day,
    input.hour,
    input.minute ?? 0,
    input.second ?? 0,
  );
  let guess = new Date(desiredUtc);

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actual = getZonedParts(guess, input.timeZone);
    const actualUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    );
    const difference = desiredUtc - actualUtc;

    if (difference === 0) {
      break;
    }

    guess = new Date(guess.getTime() + difference);
  }

  return guess;
}

function calculateNextDailyResetAt(
  dailyResetHour: number,
  timeZone: string,
  fromDate: Date,
) {
  const normalizedHour = clampResetHour(dailyResetHour);
  const zonedNow = getZonedParts(fromDate, timeZone);

  let candidate = zonedDateTimeToUtc({
    year: zonedNow.year,
    month: zonedNow.month,
    day: zonedNow.day,
    hour: normalizedHour,
    timeZone,
  });

  if (candidate <= fromDate) {
    const nextLocalDay = addUtcDays(zonedNow, 1);
    candidate = zonedDateTimeToUtc({
      year: nextLocalDay.year,
      month: nextLocalDay.month,
      day: nextLocalDay.day,
      hour: normalizedHour,
      timeZone,
    });
  }

  return candidate;
}

function calculateNextAllowedResetAt(profile: Pick<
  GuardianProfile,
  "resetMode" | "dailyResetHour" | "dailyResetTimezone"
>, fromDate: Date) {
  if (profile.resetMode === GuardianResetMode.MANUAL) {
    return null;
  }

  return calculateNextDailyResetAt(
    profile.dailyResetHour,
    resolveTimeZone(profile.dailyResetTimezone),
    fromDate,
  );
}

function formatResetTimestamp(value: Date, timeZone: string) {
  return `${new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(value)} ${timeZone}`;
}

function formatSessionDateKey(value: { year: number; month: number; day: number }) {
  return `${value.year}-${String(value.month).padStart(2, "0")}-${String(value.day).padStart(2, "0")}`;
}

function getCurrentGuardianSessionDateKey(
  profile: Pick<GuardianProfile, "dailyResetHour" | "dailyResetTimezone">,
  now: Date,
) {
  const timeZone = resolveTimeZone(profile.dailyResetTimezone);
  const zonedNow = getZonedParts(now, timeZone);
  const currentLocalDate = {
    year: zonedNow.year,
    month: zonedNow.month,
    day: zonedNow.day,
  };

  return formatSessionDateKey(
    zonedNow.hour >= clampResetHour(profile.dailyResetHour)
      ? currentLocalDate
      : addUtcDays(currentLocalDate, -1),
  );
}

function humanizeConnectionStatus(status: GuardianConnectionStatus) {
  return status === GuardianConnectionStatus.MOCK_CONNECTED
    ? "Mock connected"
    : "Not connected";
}

function humanizeLockoutReason(reason: GuardianLockoutReason) {
  switch (reason) {
    case GuardianLockoutReason.MAX_TRADES_PER_DAY:
      return "Daily trade limit reached";
    case GuardianLockoutReason.MAX_DAILY_LOSS:
      return "Daily loss limit breached";
    case GuardianLockoutReason.CONSECUTIVE_LOSSES:
      return "Consecutive loss limit reached";
    case GuardianLockoutReason.DAILY_PROFIT_TARGET:
      return "Daily profit target reached";
    default:
      return "No active lockout";
  }
}

function humanizeResetMode(resetMode: GuardianResetMode) {
  return resetMode === GuardianResetMode.MANUAL ? "Manual reset" : "Daily reset";
}

type GuardianRuleEvaluation = {
  triggeredRules: GuardianLockoutReason[];
  primaryReason: GuardianLockoutReason;
  triggeredRuleLabels: string[];
  activeRules: string[];
  todayTradesCount: number;
  todayPnL: number;
  consecutiveLosses: number;
  lockoutActive: boolean;
};

export type GuardianSnapshot = {
  profile: GuardianProfile;
  status: GuardianStatus;
  evaluation: GuardianRuleEvaluation & {
    guardianActive: boolean;
    connectionLabel: string;
    primaryReasonLabel: string;
    actionGuidance: string[];
    resetMode: GuardianResetMode;
    resetModeLabel: string;
    resetTimezone: string;
    nextAllowedResetAt: Date | null;
    lastResetAt: Date | null;
    lockoutClearedAt: Date | null;
    resetAllowedNow: boolean;
  };
};

export type TodaySessionStateKind =
  | "ONBOARDING_REQUIRED"
  | "READY_TO_TRADE"
  | "LOCKED_BY_GUARDIAN"
  | "RESET_PENDING"
  | "GUARDIAN_DISABLED";

export type TodaySessionState = {
  kind: TodaySessionStateKind;
  statusLabel: string;
  headline: string;
  detail: string;
  nextStep: string;
  primaryReasonLabel: string | null;
  nextResetAt: Date | null;
  resetMode: GuardianResetMode;
  resetTimezone: string;
  todayTradesCount: number;
  todayPnL: number;
  consecutiveLosses: number;
  activeRules: string[];
  sessionStarted: boolean;
  sessionStartedAt: Date | null;
  sessionStartSource: string | null;
  sessionEnded: boolean;
  sessionEndedAt: Date | null;
  sessionEndSource: string | null;
  preNewsPolicyStatus?: EconomicPreNewsPolicyStatus | null;
};

export type PremarketReadiness = {
  status: string;
  headline: string;
  detail: string;
  actionLabel: string;
  actionHref: string;
  tone: "ready" | "blocked" | "warning" | "setup";
  upcomingEventNote?: string;
};

function evaluateGuardianRules(
  profile: GuardianProfile,
  status: GuardianStatus,
): GuardianRuleEvaluation {
  const todayPnL = Number(status.todayPnL.toString());
  const maxDailyLoss = decimalToNumber(profile.maxDailyLoss);
  const dailyProfitTarget = decimalToNumber(profile.dailyProfitTarget);

  const triggeredRules: GuardianLockoutReason[] = !profile.guardianEnabled
    ? []
    : [
        profile.maxTradesPerDay !== null &&
        profile.maxTradesPerDay !== undefined &&
        status.todayTradesCount >= profile.maxTradesPerDay
          ? GuardianLockoutReason.MAX_TRADES_PER_DAY
          : null,
        maxDailyLoss !== null && todayPnL <= -maxDailyLoss
          ? GuardianLockoutReason.MAX_DAILY_LOSS
          : null,
        profile.stopAfterConsecutiveLosses !== null &&
        profile.stopAfterConsecutiveLosses !== undefined &&
        status.consecutiveLosses >= profile.stopAfterConsecutiveLosses
          ? GuardianLockoutReason.CONSECUTIVE_LOSSES
          : null,
        dailyProfitTarget !== null && todayPnL >= dailyProfitTarget
          ? GuardianLockoutReason.DAILY_PROFIT_TARGET
          : null,
      ].filter(Boolean) as GuardianLockoutReason[];

  return {
    triggeredRules,
    primaryReason: triggeredRules[0] ?? GuardianLockoutReason.NONE,
    triggeredRuleLabels: triggeredRules.map((reason) => humanizeLockoutReason(reason)),
    activeRules: [
      profile.maxTradesPerDay ? `Max trades per day: ${profile.maxTradesPerDay}` : null,
      maxDailyLoss !== null ? `Max daily loss: ${maxDailyLoss}` : null,
      profile.stopAfterConsecutiveLosses
        ? `Stop after consecutive losses: ${profile.stopAfterConsecutiveLosses}`
        : null,
      dailyProfitTarget !== null ? `Daily profit target: ${dailyProfitTarget}` : null,
      `Reset mode: ${humanizeResetMode(profile.resetMode)}`,
      `Reset time zone: ${resolveTimeZone(profile.dailyResetTimezone)}`,
      profile.resetMode === GuardianResetMode.DAILY
        ? `Daily reset hour: ${clampResetHour(profile.dailyResetHour)}:00`
        : null,
      `Copy trade mode: ${profile.copyTradeMode ? "On" : "Off"}`,
    ].filter(Boolean) as string[],
    todayTradesCount: status.todayTradesCount,
    todayPnL,
    consecutiveLosses: status.consecutiveLosses,
    lockoutActive: profile.guardianEnabled && triggeredRules.length > 0,
  };
}

async function syncGuardianResetTimezone(
  profile: GuardianProfile,
  onboardingTimezone: string | null,
) {
  const preferredTimezone = resolveTimeZone(onboardingTimezone);
  const currentTimezone = resolveTimeZone(profile.dailyResetTimezone);

  if (
    onboardingTimezone &&
    preferredTimezone !== currentTimezone &&
    currentTimezone === "UTC"
  ) {
    return prisma.guardianProfile.update({
      where: { id: profile.id },
      data: { dailyResetTimezone: preferredTimezone },
    });
  }

  if (currentTimezone !== profile.dailyResetTimezone) {
    return prisma.guardianProfile.update({
      where: { id: profile.id },
      data: { dailyResetTimezone: currentTimezone },
    });
  }

  return profile;
}

async function ensureGuardianRecords(userId: string) {
  return ensureGuardianRecordsWithRetries(userId, 1);
}

async function ensureGuardianRecordsWithRetries(
  userId: string,
  retries: number,
) {
  const onboardingProfile = await prisma.traderProfile.findUnique({
    where: { userId },
    select: { timezone: true },
  });
  const fallbackTimezone = resolveTimeZone(onboardingProfile?.timezone);
  const initialNextResetAt = calculateNextDailyResetAt(9, fallbackTimezone, new Date());

  try {
    let [profile, status] = await Promise.all([
      prisma.guardianProfile.upsert({
        where: { userId },
        create: {
          userId,
          guardianEnabled: true,
          adapterKey: "mock",
          platformName: "Mock Platform",
          connectionStatus: GuardianConnectionStatus.MOCK_CONNECTED,
          maxTradesPerDay: 4,
          maxDailyLoss: 500,
          stopAfterConsecutiveLosses: 2,
          dailyProfitTarget: null,
          copyTradeMode: false,
          resetMode: GuardianResetMode.DAILY,
          dailyResetHour: 9,
          dailyResetTimezone: fallbackTimezone,
        },
        update: {},
      }),
      prisma.guardianStatus.upsert({
        where: { userId },
        create: {
          userId,
          todayTradesCount: 0,
          todayPnL: 0,
          consecutiveLosses: 0,
          currentLockoutActive: false,
          lockoutReason: GuardianLockoutReason.NONE,
          nextAllowedResetAt: initialNextResetAt,
        },
        update: {},
      }),
    ]);

    profile = await syncGuardianResetTimezone(profile, onboardingProfile?.timezone ?? null);

    if (
      profile.resetMode === GuardianResetMode.DAILY &&
      !status.nextAllowedResetAt
    ) {
      status = await prisma.guardianStatus.update({
        where: { id: status.id },
        data: {
          nextAllowedResetAt: calculateNextAllowedResetAt(profile, new Date()),
        },
      });
    }

    return { profile, status };
  } catch (error) {
    if (retries > 0 && isPrismaUniqueConstraintError(error)) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return ensureGuardianRecordsWithRetries(userId, retries - 1);
    }

    throw error;
  }
}

type ResetGuardianStatusInput = {
  profile: GuardianProfile;
  status: GuardianStatus;
  resetAt: Date;
};

async function applyGuardianReset({
  profile,
  status,
  resetAt,
}: ResetGuardianStatusInput) {
  const nextAllowedResetAt = calculateNextAllowedResetAt(profile, resetAt);

  return prisma.guardianStatus.update({
    where: { id: status.id },
    data: {
      todayTradesCount: 0,
      todayPnL: 0,
      consecutiveLosses: 0,
      currentLockoutActive: false,
      lockoutReason: GuardianLockoutReason.NONE,
      lockoutStartedAt: null,
      lockoutEndsAt: null,
      nextAllowedResetAt,
      lastResetAt: resetAt,
      lockoutClearedAt: resetAt,
    },
  });
}

async function maybeAutoClearGuardianLockout(
  profile: GuardianProfile,
  status: GuardianStatus,
  now: Date,
) {
  if (
    profile.resetMode === GuardianResetMode.DAILY &&
    status.currentLockoutActive &&
    status.nextAllowedResetAt &&
    now >= status.nextAllowedResetAt
  ) {
    return applyGuardianReset({ profile, status, resetAt: now });
  }

  return status;
}

async function persistGuardianEvaluation(
  profile: GuardianProfile,
  status: GuardianStatus,
  evaluation: GuardianRuleEvaluation,
  now: Date,
) {
  const shouldStartLockout =
    evaluation.lockoutActive && !status.currentLockoutActive;
  const nextAllowedResetAt = evaluation.lockoutActive
    ? status.currentLockoutActive && status.nextAllowedResetAt
      ? status.nextAllowedResetAt
      : calculateNextAllowedResetAt(profile, now)
    : calculateNextAllowedResetAt(profile, now);

  return prisma.guardianStatus.update({
    where: { id: status.id },
    data: {
      currentLockoutActive: evaluation.lockoutActive,
      lockoutReason: evaluation.primaryReason,
      lockoutStartedAt: evaluation.lockoutActive
        ? shouldStartLockout
          ? now
          : status.lockoutStartedAt
        : null,
      lockoutEndsAt:
        evaluation.lockoutActive && profile.resetMode === GuardianResetMode.DAILY
          ? nextAllowedResetAt
          : null,
      nextAllowedResetAt,
    },
  });
}

function buildGuardianActionGuidance(
  profile: GuardianProfile,
  status: GuardianStatus,
  evaluation: GuardianRuleEvaluation,
) {
  if (!evaluation.lockoutActive) {
    return [];
  }

  const resetTimezone = resolveTimeZone(profile.dailyResetTimezone);
  const resetLine =
    profile.resetMode === GuardianResetMode.DAILY && status.nextAllowedResetAt
      ? `Guardian protection is active until ${formatResetTimestamp(
          status.nextAllowedResetAt,
          resetTimezone,
        )}.`
      : "Guardian protection is active until an allowed manual reset is performed.";

  return [
    "No further trades allowed in this session.",
    resetLine,
    "Review your rules before re-entering.",
  ];
}

function buildGuardianSnapshot(
  profile: GuardianProfile,
  status: GuardianStatus,
  evaluation: GuardianRuleEvaluation,
  now: Date,
): GuardianSnapshot {
  return {
    profile,
    status,
    evaluation: {
      ...evaluation,
      guardianActive: profile.guardianEnabled,
      connectionLabel: humanizeConnectionStatus(profile.connectionStatus),
      primaryReasonLabel: humanizeLockoutReason(evaluation.primaryReason),
      actionGuidance: buildGuardianActionGuidance(profile, status, evaluation),
      resetMode: profile.resetMode,
      resetModeLabel: humanizeResetMode(profile.resetMode),
      resetTimezone: resolveTimeZone(profile.dailyResetTimezone),
      nextAllowedResetAt: status.nextAllowedResetAt,
      lastResetAt: status.lastResetAt,
      lockoutClearedAt: status.lockoutClearedAt,
      resetAllowedNow:
        profile.resetMode === GuardianResetMode.MANUAL
          ? status.currentLockoutActive
          : Boolean(status.nextAllowedResetAt && now >= status.nextAllowedResetAt),
    },
  };
}

export function deriveTodaySessionState(
  snapshot: GuardianSnapshot,
  options?: {
    onboardingComplete?: boolean;
    sessionStart?: Pick<
      DailyGuardianSession,
      "startedAt" | "source" | "endedAt" | "endedSource"
    > | null;
    preNewsPolicyStatus?: EconomicPreNewsPolicyStatus | null;
  },
): TodaySessionState {
  const { profile, evaluation } = snapshot;
  const onboardingComplete = options?.onboardingComplete ?? true;
  const sessionStart = options?.sessionStart ?? null;
  const preNewsPolicyStatus = options?.preNewsPolicyStatus ?? null;

  if (
    evaluation.lockoutActive &&
    evaluation.resetMode === GuardianResetMode.DAILY &&
    Boolean(evaluation.nextAllowedResetAt)
  ) {
    return {
      kind: "RESET_PENDING",
      statusLabel: "Reset pending",
      headline: "Trading is locked for today.",
      detail: evaluation.primaryReasonLabel,
      nextStep: "Wait for the reset window before trying to start a new session.",
      primaryReasonLabel: evaluation.primaryReasonLabel,
      nextResetAt: evaluation.nextAllowedResetAt,
      resetMode: evaluation.resetMode,
      resetTimezone: evaluation.resetTimezone,
      todayTradesCount: evaluation.todayTradesCount,
      todayPnL: evaluation.todayPnL,
      consecutiveLosses: evaluation.consecutiveLosses,
      activeRules: evaluation.activeRules,
      sessionStarted: false,
      sessionStartedAt: null,
      sessionStartSource: null,
      sessionEnded: false,
      sessionEndedAt: null,
      sessionEndSource: null,
    };
  }

  if (evaluation.lockoutActive) {
    return {
      kind: "LOCKED_BY_GUARDIAN",
      statusLabel: "Locked by Guardian",
      headline: "Trading is locked for today.",
      detail: evaluation.primaryReasonLabel,
      nextStep: "No more trades today. Step away and reset only through the allowed process.",
      primaryReasonLabel: evaluation.primaryReasonLabel,
      nextResetAt: evaluation.nextAllowedResetAt,
      resetMode: evaluation.resetMode,
      resetTimezone: evaluation.resetTimezone,
      todayTradesCount: evaluation.todayTradesCount,
      todayPnL: evaluation.todayPnL,
      consecutiveLosses: evaluation.consecutiveLosses,
      activeRules: evaluation.activeRules,
      sessionStarted: false,
      sessionStartedAt: null,
      sessionStartSource: null,
      sessionEnded: false,
      sessionEndedAt: null,
      sessionEndSource: null,
    };
  }

  if (!onboardingComplete) {
    return {
      kind: "ONBOARDING_REQUIRED",
      statusLabel: "Onboarding required",
      headline: "Complete onboarding before starting the day.",
      detail: "Your trading profile and rules need to be set before the session can open.",
      nextStep: "Finish onboarding first, then come back here to start clean.",
      primaryReasonLabel: null,
      nextResetAt: evaluation.nextAllowedResetAt,
      resetMode: evaluation.resetMode,
      resetTimezone: evaluation.resetTimezone,
      todayTradesCount: evaluation.todayTradesCount,
      todayPnL: evaluation.todayPnL,
      consecutiveLosses: evaluation.consecutiveLosses,
      activeRules: evaluation.activeRules,
      sessionStarted: false,
      sessionStartedAt: null,
      sessionStartSource: null,
      sessionEnded: false,
      sessionEndedAt: null,
      sessionEndSource: null,
    };
  }

  if (!evaluation.guardianActive) {
    return {
      kind: "GUARDIAN_DISABLED",
      statusLabel: "Guardian off",
      headline: "Guardian is disabled.",
      detail: "Protection rules are not enforcing today’s session.",
      nextStep: "Turn Guardian back on before relying on the session boundaries.",
      primaryReasonLabel: null,
      nextResetAt: evaluation.nextAllowedResetAt,
      resetMode: evaluation.resetMode,
      resetTimezone: evaluation.resetTimezone,
      todayTradesCount: evaluation.todayTradesCount,
      todayPnL: evaluation.todayPnL,
      consecutiveLosses: evaluation.consecutiveLosses,
      activeRules: evaluation.activeRules,
      sessionStarted: false,
      sessionStartedAt: null,
      sessionStartSource: null,
      sessionEnded: false,
      sessionEndedAt: null,
      sessionEndSource: null,
    };
  }

  const sessionEnded = Boolean(sessionStart?.endedAt);
  const isPreNewsActive =
    !sessionStart &&
    Boolean(preNewsPolicyStatus?.isActive) &&
    preNewsPolicyStatus;
  const isPreNewsBlocked =
    isPreNewsActive && preNewsPolicyStatus?.policy.mode === "HARD_BLOCK_MAJOR";
  const isPreNewsCaution =
    isPreNewsActive && preNewsPolicyStatus?.policy.mode === "SOFT_CAUTION";
  const isPreNewsWarning =
    isPreNewsActive && preNewsPolicyStatus?.policy.mode === "WARNING_ONLY";

  if (isPreNewsBlocked) {
    return {
      kind: "READY_TO_TRADE",
      statusLabel: "Delayed by news",
      headline: "Start is paused until the major event window finishes.",
      detail:
        preNewsPolicyStatus?.message ??
        "A significant economic event is active. Wait for the window to pass before starting the session.",
      nextStep:
        "Hold off on session start until the major event window is behind you.",
      primaryReasonLabel: null,
      nextResetAt: evaluation.nextAllowedResetAt,
      resetMode: evaluation.resetMode,
      resetTimezone: evaluation.resetTimezone,
      todayTradesCount: evaluation.todayTradesCount,
      todayPnL: evaluation.todayPnL,
      consecutiveLosses: evaluation.consecutiveLosses,
      activeRules: evaluation.activeRules,
      sessionStarted: false,
      sessionStartedAt: null,
      sessionStartSource: null,
      sessionEnded: false,
      sessionEndedAt: null,
      sessionEndSource: null,
      preNewsPolicyStatus,
    };
  }

  if (isPreNewsCaution) {
    return {
      kind: "READY_TO_TRADE",
      statusLabel: "Start with caution",
      headline: "High-impact news is approaching.",
      detail:
        preNewsPolicyStatus?.message ??
        "Trading can still begin, but use smaller size and a clear plan.",
      nextStep:
        "Begin the session carefully and stick to the plan.",
      primaryReasonLabel: null,
      nextResetAt: evaluation.nextAllowedResetAt,
      resetMode: evaluation.resetMode,
      resetTimezone: evaluation.resetTimezone,
      todayTradesCount: evaluation.todayTradesCount,
      todayPnL: evaluation.todayPnL,
      consecutiveLosses: evaluation.consecutiveLosses,
      activeRules: evaluation.activeRules,
      sessionStarted: false,
      sessionStartedAt: null,
      sessionStartSource: null,
      sessionEnded: false,
      sessionEndedAt: null,
      sessionEndSource: null,
      preNewsPolicyStatus,
    };
  }

  if (isPreNewsWarning) {
    return {
      kind: "READY_TO_TRADE",
      statusLabel: "Ready with warning",
      headline: "A high-impact event is nearby.",
      detail:
        preNewsPolicyStatus?.message ??
        "Trading can start, but stay alert and keep the process clear.",
      nextStep: "Start the session and keep the plan over the noise.",
      primaryReasonLabel: null,
      nextResetAt: evaluation.nextAllowedResetAt,
      resetMode: evaluation.resetMode,
      resetTimezone: evaluation.resetTimezone,
      todayTradesCount: evaluation.todayTradesCount,
      todayPnL: evaluation.todayPnL,
      consecutiveLosses: evaluation.consecutiveLosses,
      activeRules: evaluation.activeRules,
      sessionStarted: false,
      sessionStartedAt: null,
      sessionStartSource: null,
      sessionEnded: false,
      sessionEndedAt: null,
      sessionEndSource: null,
      preNewsPolicyStatus,
    };
  }

  return {
    kind: "READY_TO_TRADE",
    statusLabel: sessionEnded
      ? "Session ended"
      : sessionStart
        ? "Session active"
        : "Today is open",
    headline: sessionEnded
      ? "Session is closed for today."
      : sessionStart
        ? "Session is active."
        : "Trading is open.",
    detail: sessionEnded
      ? `Started at ${formatResetTimestamp(
          sessionStart!.startedAt,
          evaluation.resetTimezone,
        )} and ended at ${formatResetTimestamp(
          sessionStart!.endedAt as Date,
          evaluation.resetTimezone,
        )}.`
      : sessionStart
      ? `Started at ${formatResetTimestamp(
          sessionStart.startedAt,
          evaluation.resetTimezone,
        )}${sessionStart.source ? ` from ${sessionStart.source}.` : "."}`
      : profile.resetMode === GuardianResetMode.DAILY && evaluation.nextAllowedResetAt
        ? `Next reset window is ${formatResetTimestamp(
            evaluation.nextAllowedResetAt,
            evaluation.resetTimezone,
          )}.`
        : "Guardian is active and the session is within limits.",
    nextStep: sessionEnded
      ? "The day is wrapped. Review what happened and wait for the next Guardian day before starting again."
      : sessionStart
      ? "Trade the plan, stay inside your limits, and use the coach if your state starts to slip."
      : "Review your rules and start clean.",
    primaryReasonLabel: null,
    nextResetAt: evaluation.nextAllowedResetAt,
    resetMode: evaluation.resetMode,
    resetTimezone: evaluation.resetTimezone,
    todayTradesCount: evaluation.todayTradesCount,
    todayPnL: evaluation.todayPnL,
    consecutiveLosses: evaluation.consecutiveLosses,
    activeRules: evaluation.activeRules,
    sessionStarted: Boolean(sessionStart),
    sessionStartedAt: sessionStart?.startedAt ?? null,
    sessionStartSource: sessionStart?.source ?? null,
    sessionEnded,
    sessionEndedAt: sessionStart?.endedAt ?? null,
    sessionEndSource: sessionStart?.endedSource ?? null,
    preNewsPolicyStatus,
  };
}

export function derivePremarketReadiness(
  sessionState: TodaySessionState,
): PremarketReadiness | null {
  if (sessionState.sessionStarted || sessionState.sessionEnded) {
    return null;
  }

  switch (sessionState.kind) {
    case "ONBOARDING_REQUIRED":
      return {
        status: "Onboarding required",
        headline: "Complete onboarding before the session can begin.",
        detail: "Your profile, trading rules, and coaching setup need to be in place first.",
        actionLabel: "Complete onboarding",
        actionHref: "/onboarding",
        tone: "setup",
      };
    case "GUARDIAN_DISABLED":
      return {
        status: "Guardian off",
        headline: "Guardian is not enforcing the day.",
        detail: "Turn Guardian back on before relying on session boundaries.",
        actionLabel: "Enable Guardian",
        actionHref: "/guardian",
        tone: "warning",
      };
    case "RESET_PENDING":
      return {
        status: "Locked until reset",
        headline: "Trading stays closed until the next reset window.",
        detail: sessionState.primaryReasonLabel ?? "Guardian is still blocking the day.",
        actionLabel: "Open Guardian",
        actionHref: "/guardian",
        tone: "blocked",
      };
    case "LOCKED_BY_GUARDIAN":
      return {
        status: "Locked by Guardian",
        headline: "Trading is not available right now.",
        detail: sessionState.primaryReasonLabel ?? "Guardian has blocked the session.",
        actionLabel: "Open Guardian",
        actionHref: "/guardian",
        tone: "blocked",
      };
    case "READY_TO_TRADE": {
      const policy = sessionState.preNewsPolicyStatus;

      if (policy?.isActive && policy.policy.mode === "HARD_BLOCK_MAJOR") {
        return {
          status: "Blocked by news",
          headline: "Session start is paused until the major event clears.",
          detail:
            policy.message ??
            "A major economic event is active. Wait for the window to pass before starting the session.",
          actionLabel: "Open Guardian",
          actionHref: "/guardian",
          tone: "blocked",
        };
      }

      if (policy?.isActive && policy.policy.mode === "SOFT_CAUTION") {
        return {
          status: "Start with caution",
          headline: "A high-impact event is approaching.",
          detail:
            policy.message ??
            "Trading can still start, but keep size smaller and your plan tighter.",
          actionLabel: "Start session",
          actionHref: "/dashboard",
          tone: "warning",
        };
      }

      if (policy?.isActive && policy.policy.mode === "WARNING_ONLY") {
        return {
          status: "Ready with warning",
          headline: "A high-impact event is nearby.",
          detail:
            policy.message ??
            "Trading can start, but stay alert for news risk.",
          actionLabel: "Start session",
          actionHref: "/dashboard",
          tone: "warning",
        };
      }

      return {
        status: "Ready to start",
        headline: "You are clear to begin the session.",
        detail: "Guardian is active, setup is complete, and the day is inside limits.",
        actionLabel: "Start session",
        actionHref: "/dashboard",
        tone: "ready",
      };
    }
    default:
      return null;
  }
}

export async function getTodayGuardianSessionStart(userId: string) {
  const { profile } = await ensureGuardianRecords(userId);
  const sessionDateKey = getCurrentGuardianSessionDateKey(profile, new Date());

  return prisma.dailyGuardianSession.findUnique({
    where: {
      userId_sessionDateKey: {
        userId,
        sessionDateKey,
      },
    },
  });
}

export async function startTodayGuardianSession(userId: string) {
  const [guardian, traderProfile, existingSession, coachingPreferences] = await Promise.all([
    getGuardianSnapshot(userId),
    prisma.traderProfile.findUnique({
      where: { userId },
      select: { id: true },
    }),
    getTodayGuardianSessionStart(userId),
    prisma.coachingPreferences.findUnique({
      where: { userId },
    }),
  ]);

  const economicCalendarSnapshot = await getSelectedEconomicCalendarSnapshot(
    coachingPreferences,
  );

  const onboardingComplete = Boolean(traderProfile);
  const economicPolicy = getCurrentPreNewsPolicy(economicCalendarSnapshot);
  const currentState = deriveTodaySessionState(guardian, {
    onboardingComplete,
    sessionStart: existingSession,
    preNewsPolicyStatus: economicPolicy,
  });

  if (
    economicPolicy.isActive &&
    economicPolicy.policy.mode === "HARD_BLOCK_MAJOR" &&
    !existingSession
  ) {
    throw new Error(
      "Session start is blocked until the major economic event window passes.",
    );
  }

  if (currentState.kind !== "READY_TO_TRADE") {
    throw new Error("Session start is not available right now.");
  }

  if (existingSession?.endedAt) {
    throw new Error("This Guardian day has already been ended.");
  }

  const sessionDateKey = getCurrentGuardianSessionDateKey(guardian.profile, new Date());

  return prisma.dailyGuardianSession.upsert({
    where: {
      userId_sessionDateKey: {
        userId,
        sessionDateKey,
      },
    },
    update: {},
    create: {
      userId,
      sessionDateKey,
      source: "dashboard",
    },
  });
}

export async function endTodayGuardianSession(userId: string) {
  const [guardian, traderProfile, existingSession] = await Promise.all([
    getGuardianSnapshot(userId),
    prisma.traderProfile.findUnique({
      where: { userId },
      select: { id: true },
    }),
    getTodayGuardianSessionStart(userId),
  ]);

  if (!existingSession) {
    throw new Error("There is no active session to end.");
  }

  if (existingSession.endedAt) {
    return existingSession;
  }

  const onboardingComplete = Boolean(traderProfile);
  const currentState = deriveTodaySessionState(guardian, {
    onboardingComplete,
    sessionStart: existingSession,
  });

  if (currentState.kind !== "READY_TO_TRADE" || !currentState.sessionStarted) {
    throw new Error("Session end is not available right now.");
  }

  return prisma.dailyGuardianSession.update({
    where: { id: existingSession.id },
    data: {
      endedAt: new Date(),
      endedSource: "dashboard",
    },
  });
}

export async function getGuardianSnapshot(userId: string): Promise<GuardianSnapshot> {
  const now = new Date();
  const ensured = await ensureGuardianRecords(userId);
  const statusAfterReset = await maybeAutoClearGuardianLockout(
    ensured.profile,
    ensured.status,
    now,
  );
  const evaluation = evaluateGuardianRules(ensured.profile, statusAfterReset);
  const syncedStatus = await persistGuardianEvaluation(
    ensured.profile,
    statusAfterReset,
    evaluation,
    now,
  );

  return buildGuardianSnapshot(ensured.profile, syncedStatus, evaluation, now);
}

export async function updateGuardianProfile(
  userId: string,
  input: {
    guardianEnabled: boolean;
    adapterKey: string;
    platformName: string;
    connectionStatus: GuardianConnectionStatus;
    maxTradesPerDay: number | null;
    maxDailyLoss: number | null;
    stopAfterConsecutiveLosses: number | null;
    dailyProfitTarget: number | null;
    copyTradeMode: boolean;
    resetMode: GuardianResetMode;
    dailyResetHour: number;
    dailyResetTimezone: string;
  },
) {
  await ensureGuardianRecords(userId);

  await prisma.guardianProfile.update({
    where: { userId },
    data: {
      guardianEnabled: input.guardianEnabled,
      adapterKey: input.adapterKey.trim().toLowerCase() || "mock",
      platformName: input.platformName,
      connectionStatus: input.connectionStatus,
      maxTradesPerDay: input.maxTradesPerDay,
      maxDailyLoss: numberToDecimalInput(input.maxDailyLoss),
      stopAfterConsecutiveLosses: input.stopAfterConsecutiveLosses,
      dailyProfitTarget: numberToDecimalInput(input.dailyProfitTarget),
      copyTradeMode: input.copyTradeMode,
      resetMode: input.resetMode,
      dailyResetHour: clampResetHour(input.dailyResetHour),
      dailyResetTimezone: resolveTimeZone(input.dailyResetTimezone),
    },
  });

  return getGuardianSnapshot(userId);
}

export async function updateGuardianStatus(
  userId: string,
  input: {
    todayTradesCount: number;
    todayPnL: number;
    consecutiveLosses: number;
  },
) {
  await ensureGuardianRecords(userId);

  await prisma.guardianStatus.update({
    where: { userId },
    data: {
      todayTradesCount: input.todayTradesCount,
      todayPnL: input.todayPnL,
      consecutiveLosses: input.consecutiveLosses,
    },
  });

  return getGuardianSnapshot(userId);
}

export async function resetGuardianStatus(userId: string) {
  const { profile, status } = await ensureGuardianRecords(userId);

  if (profile.resetMode !== GuardianResetMode.MANUAL) {
    throw new Error("Manual reset is only available when Guardian reset mode is MANUAL.");
  }

  await applyGuardianReset({
    profile,
    status,
    resetAt: new Date(),
  });

  return getGuardianSnapshot(userId);
}
