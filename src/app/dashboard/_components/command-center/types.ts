export type AccountStatus =
  | "allowed"
  | "warning"
  | "locked"
  | "setup_needed"
  | "not_connected";

export type EnforcementMode =
  | "manual_app_level"
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
  dailyPnl: number | null;
  maxDailyLoss: number | null;
  remainingDailyLoss: number | null;
  dailyLossUsedPct: number | null;
  tradesCount: number | null;
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
  brokerLockStatus: "broker_locked" | "monitoring_only" | "broker_lock_failed" | null;
  lastInterventionAt: Date | null;
  hasOpenIntervention: boolean;
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
