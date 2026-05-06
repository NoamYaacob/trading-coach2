import type { EnforcementTrigger, FlattenStatus } from "@/lib/brokers/enforcement";

export type AccountStatus =
  | "allowed"
  | "warning"
  | "locked"
  | "setup_needed"
  | "not_connected"
  /** Broker /account/list no longer returns this account. May have been
   *  reset, closed, or removed by the prop firm. Not counted in totals,
   *  not synced, not enforced. */
  | "unavailable";

export type EnforcementMode =
  | "broker_readonly"
  | "not_connected";

export type RuleSource = "account" | "default" | "none";

export type ProtectionStatus =
  | "protected"
  | "monitor_only"
  | "ignored"
  | "archived"
  | "pending_decision";

export type CommandCenterAccount = {
  id: string;
  label: string;
  platform: string;
  platformLabel: string;
  propFirm: string | null;
  firmKey: string;
  firmLabel: string;
  accountType: string;
  accountTypeLabel: string;
  connectionStatus: string;
  connectionStatusLabel: string;
  status: AccountStatus;
  enforcementMode: EnforcementMode;
  ruleSource: RuleSource;
  rulesLabel: string;
  dailyPnl: number | null;
  maxDailyLoss: number | null;
  remainingDailyLoss: number | null;
  dailyLossUsedPct: number | null;
  tradesCount: number | null;
  /** True when tradesCount may include broker activity from before this account
   *  was connected to Guardrail today (full-day count is used for risk
   *  enforcement; this flag drives the disclosure note in the UI). */
  tradesMayIncludePreConnection: boolean;
  /** How tradesCount was derived. "verified" means the broker source was
   *  account-scoped and the count can drive trade-limit enforcement. "estimated"
   *  means fills could not be attributed to a specific account (multi-account
   *  OAuth tokens) — UI shows the count with a disclaimer and trade-limit
   *  enforcement is suppressed. "unavailable" means fills failed to fetch this
   *  sync; daily P&L based locks remain authoritative. */
  tradeCountSource: "verified" | "estimated" | "unavailable";
  maxTradesPerDay: number | null;
  tradesUsedPct: number | null;
  consecutiveLosses: number | null;
  stopAfterLosses: number | null;
  balance: number | null;
  openPnl: number | null;
  lastSyncAt: Date | null;
  fillsSyncedAt: Date | null;
  /** true when maxDailyLoss > balance for personal accounts — effective budget is capped */
  balanceLimitedWarning: boolean;
  /** true when a personal account has maxDailyLoss configured but balance hasn't synced yet */
  balanceUnavailableForBudget: boolean;
  /** true when this is a prop firm account with no prop firm limits configured */
  propFirmSetupNeeded: boolean;
  /** true when the prop firm drawdown/daily limit is tighter than the user-configured limit */
  propFirmLimited: boolean;
  /** Why this account is in setup_needed state, used for context-specific labels */
  setupNeededReason: "no_rules" | "pending_connection" | "prop_firm_rules_missing" | null;
  /** Explanation of the current breach, when status is warning or locked */
  breachReason: { headline: string; detail?: string } | null;
  /** Broker enforcement outcome from the most recent GuardianIntervention */
  brokerLockStatus:
    | "not_requested"
    | "unavailable_read_only"
    | "unavailable_permission"
    | "pending"
    | "broker_locked"
    | "monitoring_only"
    | "broker_lock_failed"
    | "dry_run"
    | null;
  /** OAuth broker connection ID — used to group accounts by connection */
  brokerConnectionId: string | null;
  /** triggerType from the most recent GuardianIntervention, for rule-specific UI copy */
  lastInterventionTrigger: EnforcementTrigger | null;
  lastInterventionAt: Date | null;
  hasOpenIntervention: boolean;
  /** flattenStatus from the most recent GuardianIntervention */
  flattenStatus: FlattenStatus | null;
  protectionStatus: ProtectionStatus;
  pendingProtectionStatus: ProtectionStatus | null;
  pendingProtectionEffectiveDate: string | null;
  missingFromBrokerSince: Date | null;
  isLockedForToday: boolean;
};

export type PendingDiscoveredAccount = {
  id: string;
  label: string;
  externalAccountId: string | null;
  platform: string;
  platformLabel: string;
  accountType: string;
  accountTypeLabel: string;
  brokerConnectionId: string | null;
  lastSeenInBrokerAt: Date | null;
};

export type CommandCenterFirmGroup = {
  firmKey: string;
  firmLabel: string;
  accounts: CommandCenterAccount[];
  counts: Record<AccountStatus, number>;
  totalDailyPnl: number;
  totalRiskRemaining: number;
  hasPnlData: boolean;
  hasRiskData: boolean;
  /** Broker platform for all accounts in this group (e.g. "tradovate") */
  platform: string;
  platformLabel: string;
  /** Connection status of the broker connection serving this group */
  connectionStatus: string;
  connectionStatusLabel: string;
  /** OAuth broker connection ID shared by accounts in this group */
  brokerConnectionId: string | null;
  /** Most recent account sync timestamp in this group */
  lastSyncAt: Date | null;
  /** Dominant enforcement mode across accounts in this group */
  enforcementMode: EnforcementMode;
};

export type CommandCenterSummary = {
  totalActive: number;
  counts: Record<AccountStatus, number>;
  totalDailyPnl: number;
  totalRiskRemaining: number;
  openInterventions: number;
  hasPnlData: boolean;
  hasRiskData: boolean;
};

export type CommandCenterData = {
  accounts: CommandCenterAccount[];
  groups: CommandCenterFirmGroup[];
  summary: CommandCenterSummary;
  firms: { key: string; label: string }[];
  pendingAccounts: PendingDiscoveredAccount[];
  protectionLock: {
    isLocked: boolean;
    cutoffTime: string | null;
    tradingDayKey: string;
    nextTradingDayKey: string;
    hasSessionHours: boolean;
  };
};
