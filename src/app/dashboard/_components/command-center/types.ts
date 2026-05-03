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
  lastSyncAt: Date | null;
  lastInterventionAt: Date | null;
  hasOpenIntervention: boolean;
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
};
