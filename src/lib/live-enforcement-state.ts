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
    case "max_trades_reached":         return "Max trades exceeded";
    case "consecutive_losses":         return "Consecutive losses";
    case "rapid_trading":              return "Rapid trading detected";
    case "revenge_entry":              return "Revenge entry";
    case "increased_size_after_loss":  return "Increased size after loss";
    case "unrealized_drawdown":        return "Unrealized drawdown";
    case "outside_allowed_hours":      return "Outside allowed hours";
    default:                           return triggerType.replace(/_/g, " ");
  }
}

export type LiveStatusMessage = {
  headline: string;
  detail: string;
  whyLabel: string | null;
  whatNext: string;
  enforcementScope: string;
};

export function deriveLiveStatusMessage(state: LiveEnforcementState): LiveStatusMessage {
  const trigger = state.lastIntervention?.triggerType ?? null;
  const whyLabel = trigger ? formatTriggerLabel(trigger) : null;

  if (state.cooldownActive) {
    const untilStr = state.cooldownUntil
      ? ` Cooldown expires at ${new Intl.DateTimeFormat("en-US", { timeStyle: "short" }).format(state.cooldownUntil)}.`
      : "";
    return {
      headline: "Account on cooldown — trading paused.",
      detail: whyLabel
        ? `Guardrail paused this account after detecting ${whyLabel.toLowerCase()}.`
        : "Guardrail paused this account after a rule was triggered.",
      whyLabel,
      whatNext: `Wait for the cooldown to clear.${untilStr} Trading resumes automatically.`,
      enforcementScope:
        "Guardrail has flagged this account internally and notified you via Telegram. No live orders are blocked at the broker — broker-level enforcement is not yet available.",
    };
  }

  if (state.riskState === "STOPPED") {
    return {
      headline: "Account locked — trading is stopped.",
      detail: whyLabel
        ? `Guardrail stopped this account after detecting ${whyLabel.toLowerCase()}.`
        : "A hard limit has been reached. Guardrail has stopped this account.",
      whyLabel,
      whatNext:
        "Trading state resets at the start of the next trading day. If you need to trade before then, contact your prop firm or use a manual reset.",
      enforcementScope:
        "Guardrail has set this account to STOPPED internally and notified you via Telegram. Your broker will not block live orders — broker-level enforcement is not yet available.",
    };
  }

  if (state.riskState === "WARNING") {
    return {
      headline: "Account flagged — trade with caution.",
      detail: whyLabel
        ? `Guardrail flagged this account after detecting ${whyLabel.toLowerCase()}. No hard stop is in effect.`
        : "A warning condition was detected. No hard stop has been applied.",
      whyLabel,
      whatNext:
        "No hard limit has been hit. Proceed with caution — another trigger could escalate to a cooldown or lockdown.",
      enforcementScope:
        "Guardrail has flagged this account internally and notified you via Telegram. Trading is not blocked at the broker.",
    };
  }

  if (state.tier === "soft_warning") {
    return {
      headline: "Guardrail sent a warning.",
      detail: whyLabel
        ? `A warning was issued for ${whyLabel.toLowerCase()}. No account state change was applied.`
        : "A soft warning was issued. No account state change was applied.",
      whyLabel,
      whatNext:
        "Trading is open. Stay aware — Guardrail is monitoring for further rule breaches.",
      enforcementScope:
        "Guardrail sent a Telegram alert. No account state was changed and no broker-level action was taken.",
    };
  }

  return {
    headline: "Trading is open.",
    detail:
      state.tradesCount === 0
        ? "Guardrail is active and ready to enforce your rules on the first trade."
        : "All rules are active. Guardrail has not detected any breaches today.",
    whyLabel: null,
    whatNext:
      "No action needed. Guardrail will alert you via Telegram when a rule is triggered.",
    enforcementScope:
      "Guardrail enforces rules internally via account state and Telegram coaching. Broker-level order blocking is not yet available.",
  };
}
