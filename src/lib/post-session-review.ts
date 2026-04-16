import type { DailyGuardianSession } from "@prisma/client";

import type { GuardianSnapshot } from "@/lib/guardian";
import type { ViolationFeed } from "@/lib/rule-engine";
import type { TodaySessionSummary } from "@/lib/session-log";
import type { TodayActivityItem } from "@/lib/today-activity";

export type PostSessionReview = {
  startedAt: Date;
  endedAt: Date;
  meaningfulEventCount: number;
  guardianIntervened: boolean;
  showGuardianLinkout: boolean;
  bullets: string[];
  takeaway: string;
};

function hasActivity(items: TodayActivityItem[], title: string) {
  return items.some((item) => item.title === title);
}

export function buildPostSessionReview(input: {
  session: DailyGuardianSession | null;
  summary: TodaySessionSummary;
  activityItems: TodayActivityItem[];
  guardian: GuardianSnapshot;
  violationFeed?: ViolationFeed | null;
}): PostSessionReview | null {
  const session = input.session;

  if (!session?.endedAt) {
    return null;
  }

  const guardianIntervened = hasActivity(
    input.activityItems,
    "Guardian lockout triggered",
  );
  const meaningfulEventCount = input.activityItems.length;
  const bullets: string[] = [];

  if (input.summary.fomoCount > 0) {
    bullets.push("FOMO showed up.");
  }

  if (input.summary.revengeCount > 0) {
    bullets.push("Recovery impulse showed up.");
  }

  if (input.summary.tiltCount > 0 || input.summary.twoLossCount > 0) {
    bullets.push("Emotional pressure escalated during the session.");
  }

  if (guardianIntervened) {
    bullets.push("Guardian closed the day.");
  }

  if (input.summary.hasRecoveryToday) {
    bullets.push("You returned to control before the day ended.");
  }

  // Rule engine violation context — surfaces things not captured by Guardian lockout
  if (input.violationFeed) {
    const feed = input.violationFeed;

    const preNewsFired = feed.activeViolations.find(
      (v) => v.ruleId === "no_trade_before_major_news" && v.status === "blocked",
    );
    if (preNewsFired) {
      bullets.push("A major news event blocked or restricted the session.");
    }

    const approachingLoss = feed.activeViolations.find(
      (v) =>
        v.ruleId === "max_daily_loss" &&
        v.status === "warning" &&
        !feed.triggeredViolations.some((t) => t.ruleId === "max_daily_loss"),
    );
    if (approachingLoss) {
      bullets.push("The session approached the daily loss limit without breaching it.");
    }

    const approachingTrades = feed.activeViolations.find(
      (v) =>
        v.ruleId === "max_trades_per_day" &&
        v.status === "warning" &&
        !feed.triggeredViolations.some((t) => t.ruleId === "max_trades_per_day"),
    );
    if (approachingTrades) {
      bullets.push("The session came close to the max daily trade count.");
    }

    if (
      feed.activeViolations.some(
        (v) => v.ruleId === "guardian_disabled" && v.status === "warning",
      )
    ) {
      bullets.push("Guardian was off during this session.");
    }
  }

  if (bullets.length === 0) {
    bullets.push("The session stayed quiet and controlled.");
  }

  let takeaway = "The session stayed clean and controlled.";

  if (guardianIntervened) {
    takeaway = "Guardian had to close the day after limits were hit.";
  } else if (input.summary.revengeCount > 0) {
    takeaway = "The main risk today was trying to make back pressure quickly.";
  } else if (input.summary.fomoCount > 0 && input.summary.hasRecoveryToday) {
    takeaway = "Pressure showed up, but you regained control before the close.";
  } else if (input.summary.fomoCount > 0 || input.summary.tiltCount > 0) {
    takeaway = "The main risk today was chasing after pressure.";
  } else if (input.summary.hasRecoveryToday) {
    takeaway = "You recovered after pressure, which matters.";
  } else if (meaningfulEventCount <= 2 && input.summary.eventCount === 0) {
    takeaway = "The session stayed quiet and controlled.";
  }

  return {
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    meaningfulEventCount,
    guardianIntervened,
    showGuardianLinkout: guardianIntervened,
    bullets,
    takeaway,
  };
}
