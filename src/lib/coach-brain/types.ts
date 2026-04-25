import type { CoachingMove } from "@/lib/coaching-state";
import type { MarketStatus } from "@/lib/market-hours";
import type { TradingPermission } from "@/lib/trading-status";

export type { CoachingMove };

export type CoachMode = "factual" | "distress" | "reflective" | "free_text" | "market_hours" | "trading_status";

export type TraderRules = {
  accountSize: number | null;
  maxDailyLoss: number | null;
  maxTradesPerDay: number | null;
  stopAfterLosses: number | null;
};

export type TraderUsage = {
  todayPnL: number;
  todayTradesCount: number;
  consecutiveLosses: number;
};

export type RecentExchange = {
  userMessage: string;
  coachReply: string;
};

export type CoachBrainInput = {
  userId: string;
  language: string;
  message: string;
  actionId: string | null;
  /** Raw TraderCurrentState string, e.g. "FOMO", "REVENGE", "NONE" */
  traderState: string;
  rules: TraderRules;
  usage: TraderUsage;
  coachingTone: string | null;
  preferredAddress: string | null;
  responseStyle: string | null;
  tradingWhy: string | null;
  tiltTrigger: string | null;
  reminderAnchors: string[];
  /** At most 2 most-recent exchanges, for anti-repetition only */
  recentContext: RecentExchange[];
  guardianLocked: boolean;
  lockoutReason: string | null;
  cooldownActive: boolean;
  hasBlockingViolation: boolean;
  violationMessage: string | null;
  sessionStarted: boolean;
  sessionEnded: boolean;
  /** Broker / rule-engine alert injected for free-text coaching only */
  alertContext: string | null;
  /** Pre-computed market open/close status for the user's primary market. */
  marketStatus: MarketStatus | null;
  /** Pre-computed trading permission from rule engine + market status. */
  tradingPermission: TradingPermission | null;
};

export type CoachBrainOutput = {
  reply: string;
  mode: CoachMode;
  language: string;
  source: "code" | "model";
  model?: string;
  /** Passed through to session logging */
  coachingMove: CoachingMove;
};
