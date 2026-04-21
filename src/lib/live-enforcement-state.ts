import { prisma } from "@/lib/db";

export type LiveEnforcementTier =
  | "monitoring"
  | "soft_warning"
  | "hard_warning"
  | "cooldown"
  | "lockdown";

export type LiveEnforcementState = {
  accountId: string;
  accountLabel: string;
  platform: string;
  connectionStatus: string;
  connectedAt: Date | null;
  riskState: "NORMAL" | "WARNING" | "STOPPED";
  dailyPnl: number;
  tradesCount: number;
  consecutiveLosses: number;
  cooldownActive: boolean;
  cooldownUntil: Date | null;
  tier: LiveEnforcementTier;
  lastIntervention: {
    triggerType: string;
    outcome: string;
    message: string | null;
    createdAt: Date;
    sentAt: Date | null;
  } | null;
  rules: {
    maxDailyLoss: number | null;
    maxTradesPerDay: number | null;
    stopAfterLosses: number | null;
    riskPerTrade: number | null;
    allowedStartHour: number | null;
    allowedEndHour: number | null;
  };
};

function deriveTier(
  riskState: "NORMAL" | "WARNING" | "STOPPED",
  cooldownActive: boolean,
  lastInterventionOutcome: string | null,
): LiveEnforcementTier {
  if (cooldownActive) return "cooldown";
  if (riskState === "STOPPED") return "lockdown";
  if (riskState === "WARNING") return "hard_warning";
  if (lastInterventionOutcome?.endsWith(":soft_warning")) return "soft_warning";
  return "monitoring";
}

export async function getLiveEnforcementState(
  userId: string,
): Promise<LiveEnforcementState | null> {
  const account = await prisma.connectedAccount.findFirst({
    where: {
      userId,
      isActive: true,
      connectionStatus: "connected_live",
    },
    orderBy: { connectedAt: "desc" },
    include: {
      sessionState: true,
      riskRules: true,
      interventions: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  if (!account || !account.sessionState) return null;

  const s = account.sessionState;
  const lastIntervention = account.interventions[0] ?? null;
  const riskState = s.riskState as "NORMAL" | "WARNING" | "STOPPED";

  return {
    accountId: account.id,
    accountLabel: account.label,
    platform: account.platform,
    connectionStatus: account.connectionStatus,
    connectedAt: account.connectedAt,
    riskState,
    dailyPnl: Number(s.dailyPnl),
    tradesCount: s.tradesCount,
    consecutiveLosses: s.consecutiveLosses,
    cooldownActive: s.cooldownActive,
    cooldownUntil: s.cooldownUntil,
    tier: deriveTier(riskState, s.cooldownActive, lastIntervention?.outcome ?? null),
    lastIntervention: lastIntervention
      ? {
          triggerType: lastIntervention.triggerType,
          outcome: lastIntervention.outcome,
          message: lastIntervention.message,
          createdAt: lastIntervention.createdAt,
          sentAt: lastIntervention.sentAt,
        }
      : null,
    rules: {
      maxDailyLoss:
        account.riskRules?.maxDailyLoss != null
          ? Number(account.riskRules.maxDailyLoss)
          : null,
      maxTradesPerDay: account.riskRules?.maxTradesPerDay ?? null,
      stopAfterLosses: account.riskRules?.stopAfterLosses ?? null,
      riskPerTrade:
        account.riskRules?.riskPerTrade != null
          ? Number(account.riskRules.riskPerTrade)
          : null,
      allowedStartHour: account.riskRules?.allowedStartHour ?? null,
      allowedEndHour: account.riskRules?.allowedEndHour ?? null,
    },
  };
}

export function formatLiveEnforcementTierLabel(tier: LiveEnforcementTier): string {
  switch (tier) {
    case "monitoring":   return "Monitoring";
    case "soft_warning": return "Warning";
    case "hard_warning": return "Strong warning";
    case "cooldown":     return "Cooldown";
    case "lockdown":     return "Lockdown";
  }
}

export function formatTriggerLabel(triggerType: string): string {
  switch (triggerType) {
    case "daily_loss_limit":           return "Daily loss limit hit";
    case "max_trades_reached":         return "Max trades reached";
    case "consecutive_losses":         return "Consecutive losses";
    case "rapid_trading":              return "Rapid trading detected";
    case "revenge_entry":              return "Revenge entry";
    case "increased_size_after_loss":  return "Increased size after loss";
    case "unrealized_drawdown":        return "Unrealized drawdown";
    case "outside_allowed_hours":      return "Outside allowed hours";
    default:                           return triggerType.replace(/_/g, " ");
  }
}
