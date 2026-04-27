import {
  GuardianLockoutReason,
  TraderCurrentState,
  type DailyGuardianSession,
  type DailySessionEvent,
} from "@prisma/client";

import type { GuardianSnapshot } from "@/lib/guardian";
import type { ViolationFeed } from "@/lib/rule-engine";

export type TodayActivityItemTone =
  | "neutral"
  | "info"
  | "warning"
  | "danger"
  | "success";

export type TodayActivityItem = {
  id: string;
  occurredAt: Date;
  title: string;
  detail: string;
  badge: string;
  tone: TodayActivityItemTone;
};

function isSameLocalDay(value: Date | null, reference: Date) {
  if (!value) {
    return false;
  }

  return (
    value.getFullYear() === reference.getFullYear() &&
    value.getMonth() === reference.getMonth() &&
    value.getDate() === reference.getDate()
  );
}

function humanizeSource(source: string) {
  if (source === "telegram") {
    return "Telegram";
  }

  if (source === "debug") {
    return "local debug";
  }

  if (source === "manual") {
    return "manual entry";
  }

  return source;
}

type ManualEventDisplay = {
  title: string;
  badge: string;
  tone: TodayActivityItemTone;
  /** Detail shown when the event carries no user note (message equals the default label) */
  defaultDetail: string;
};

const MANUAL_EVENT_DISPLAY: Record<string, ManualEventDisplay> = {
  trade_opened: { title: "Trade opened", badge: "Trade", tone: "info", defaultDetail: "Entry recorded manually." },
  trade_closed: { title: "Trade closed", badge: "Trade", tone: "info", defaultDetail: "Exit recorded manually." },
  win:          { title: "Win logged",   badge: "Win",   tone: "success", defaultDetail: "Profitable trade." },
  loss:         { title: "Loss logged",  badge: "Loss",  tone: "warning", defaultDetail: "Losing trade." },
  pnl_update:   { title: "P&L updated",  badge: "P&L",   tone: "neutral", defaultDetail: "P&L updated manually." },
  rule_breach:  { title: "Rule breach logged", badge: "Rule", tone: "danger", defaultDetail: "Review if session limits were exceeded." },
  manual_note:  { title: "Note logged",  badge: "Note",  tone: "neutral", defaultDetail: "Session note." },
};

// Short default messages set by logManualTradeEvent when no note is provided.
// When event.message matches one of these, the richer defaultDetail is used instead.
const MANUAL_EVENT_DEFAULT_MESSAGES = new Set([
  "Trade opened", "Trade closed", "Win", "Loss", "P&L update", "Rule breach", "Note",
]);

function buildManualTradeEventItem(event: DailySessionEvent): TodayActivityItem | null {
  const display = event.detectedIntent ? MANUAL_EVENT_DISPLAY[event.detectedIntent] : undefined;
  if (!display) return null;

  const detail = MANUAL_EVENT_DEFAULT_MESSAGES.has(event.message)
    ? display.defaultDetail
    : event.message;

  return {
    id: `event-${event.id}`,
    occurredAt: event.createdAt,
    title: display.title,
    detail,
    badge: display.badge,
    tone: display.tone,
  };
}

function buildSessionEventItem(event: DailySessionEvent): TodayActivityItem | null {
  // Manual trade events logged via the dashboard entry panel
  if (event.source === "manual" && event.eventType === "TRADE_EVENT") {
    return buildManualTradeEventItem(event);
  }

  const sourceLabel = event.source === "telegram" ? "Reported in Telegram" : "Logged from local debug";

  switch (event.traderState) {
    case TraderCurrentState.PREMARKET_READY:
      return {
        id: `event-${event.id}`,
        occurredAt: event.createdAt,
        title: "Check-in logged",
        detail: sourceLabel,
        badge: "Check-in",
        tone: "info",
      };
    case TraderCurrentState.FOMO:
      return {
        id: `event-${event.id}`,
        occurredAt: event.createdAt,
        title: "FOMO detected",
        detail: "You reported urgency before entry.",
        badge: "Distress",
        tone: "warning",
      };
    case TraderCurrentState.REVENGE:
      return {
        id: `event-${event.id}`,
        occurredAt: event.createdAt,
        title: "Recovery impulse detected",
        detail: "You reported wanting to make back a loss.",
        badge: "Distress",
        tone: "danger",
      };
    case TraderCurrentState.TILTED:
      return {
        id: `event-${event.id}`,
        occurredAt: event.createdAt,
        title: "Tilt detected",
        detail: "You reported losing emotional control.",
        badge: "Distress",
        tone: "danger",
      };
    case TraderCurrentState.JUST_TOOK_LOSS:
      return {
        id: `event-${event.id}`,
        occurredAt: event.createdAt,
        title: "Loss reported",
        detail: "You said the last trade ended in a loss.",
        badge: "Loss",
        tone: "warning",
      };
    case TraderCurrentState.JUST_TOOK_TWO_LOSSES:
      return {
        id: `event-${event.id}`,
        occurredAt: event.createdAt,
        title: "Two losses reported",
        detail: "You reported hitting two losses in a row.",
        badge: "Loss streak",
        tone: "danger",
      };
    case TraderCurrentState.RESETTING:
      return {
        id: `event-${event.id}`,
        occurredAt: event.createdAt,
        title: "Recovery noted",
        detail: "You reported that the intensity came down.",
        badge: "Recovery",
        tone: "info",
      };
    case TraderCurrentState.CALM:
      return {
        id: `event-${event.id}`,
        occurredAt: event.createdAt,
        title: "Back under control",
        detail: "You reported returning to a calmer state.",
        badge: "Recovery",
        tone: "success",
      };
    default:
      if (event.detectedIntent === "day_summary") {
        return {
          id: `event-${event.id}`,
          occurredAt: event.createdAt,
          title: "Day review requested",
          detail: sourceLabel,
          badge: "Review",
          tone: "neutral",
        };
      }

      return null;
  }
}

function humanizeGuardianReason(reason: GuardianLockoutReason) {
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
      return "Guardian closed the session.";
  }
}

export function buildTodayActivityTimeline(input: {
  sessionStart: DailyGuardianSession | null;
  guardian: GuardianSnapshot;
  sessionEvents: DailySessionEvent[];
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const items: TodayActivityItem[] = [];

  if (input.sessionStart) {
    items.push({
      id: `session-start-${input.sessionStart.id}`,
      occurredAt: input.sessionStart.startedAt,
      title: "Session started",
      detail: `Started from ${humanizeSource(input.sessionStart.source)}.`,
      badge: "Session",
      tone: "success",
    });
  }

  if (input.sessionStart?.endedAt) {
    items.push({
      id: `session-end-${input.sessionStart.id}`,
      occurredAt: input.sessionStart.endedAt,
      title: "Session ended",
      detail: `Ended from ${humanizeSource(input.sessionStart.endedSource ?? "dashboard")}.`,
      badge: "Session",
      tone: "neutral",
    });
  }

  for (const event of input.sessionEvents) {
    const item = buildSessionEventItem(event);

    if (item) {
      items.push(item);
    }
  }

  if (isSameLocalDay(input.guardian.status.lockoutStartedAt, now)) {
    items.push({
      id: `guardian-lockout-${input.guardian.status.id}`,
      occurredAt: input.guardian.status.lockoutStartedAt as Date,
      title: "Guardian lockout triggered",
      detail: humanizeGuardianReason(input.guardian.status.lockoutReason),
      badge: "Guardian",
      tone: "danger",
    });
  }

  if (isSameLocalDay(input.guardian.status.lockoutClearedAt, now)) {
    items.push({
      id: `guardian-reset-${input.guardian.status.id}`,
      occurredAt: input.guardian.status.lockoutClearedAt as Date,
      title: "Reset completed",
      detail:
        input.guardian.profile.resetMode === "DAILY"
          ? "Guardian reopened the day at the next reset window."
          : "Guardian was reset manually.",
      badge: "Reset",
      tone: "success",
    });
  }

  return items.sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime());
}

export function getRecentTodayActivityItems(
  items: TodayActivityItem[],
  limit = 5,
) {
  return [...items]
    .sort((left, right) => right.occurredAt.getTime() - left.occurredAt.getTime())
    .slice(0, limit);
}

/**
 * Convert active rule violations into activity items.
 * Only surfaces violations that are not already covered by the main timeline
 * (Guardian lockout is already handled via guardian.status.lockoutStartedAt).
 * Call this separately and merge with buildTodayActivityTimeline output if desired.
 */
export function buildViolationActivityItems(
  violations: ViolationFeed,
  now?: Date,
): TodayActivityItem[] {
  const at = now ?? new Date();
  const items: TodayActivityItem[] = [];

  for (const violation of violations.activeViolations) {
    // Guardian lockout + reset are already surfaced from guardian.status timestamps —
    // skip triggered guard rules to avoid duplication.
    if (
      violation.ruleId === "max_trades_per_day" ||
      violation.ruleId === "max_daily_loss" ||
      violation.ruleId === "stop_after_consecutive_losses"
    ) {
      continue;
    }

    if (violation.ruleId === "guardian_disabled" && violation.status === "warning") {
      items.push({
        id: `violation-guardian-disabled`,
        occurredAt: at,
        title: "Guardian paused",
        detail: "Protection is paused. Enable it to start monitoring.",
        badge: "Warning",
        tone: "warning",
      });
      continue;
    }

    if (violation.ruleId === "no_trade_before_major_news") {
      const tone: TodayActivityItemTone =
        violation.status === "blocked" ? "danger" : "warning";
      items.push({
        id: `violation-pre-news`,
        occurredAt: at,
        title:
          violation.status === "blocked"
            ? "Session blocked by news policy"
            : "News caution active",
        detail: violation.message,
        badge: "News",
        tone,
      });
      continue;
    }

    if (violation.ruleId === "session_not_started" && violation.status === "warning") {
      items.push({
        id: `violation-session-not-started`,
        occurredAt: at,
        title: "Session not started",
        detail: "The trading session has not been opened yet today.",
        badge: "Session",
        tone: "neutral",
      });
      continue;
    }
  }

  return items;
}
