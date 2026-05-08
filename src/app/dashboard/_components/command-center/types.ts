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
  | "broker_active"
  | "dry_run"
  | "broker_readonly"
  | "permission_unverified"
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
  /** Raw permission level from the broker connection probe.
   *  "full_access" | "read_only" | "unknown" | null (not yet probed).
   *  Distinct from enforcementMode — used to show accurate labels even when
   *  ENFORCEMENT_DRY_RUN overrides the enforcement mode to "dry_run". */
  permissionLevel: string | null;
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
  /** BrokerConnection.env at the platform level — "live" | "demo" for
   *  Tradovate OAuth grants, null for manual or pre-multi-connection rows.
   *  Used to disambiguate visually-identical personal groups when the same
   *  human has both a live and a demo connection (Tradovate has no stable
   *  cross-environment user identifier to safely merge them). */
  brokerEnv: string | null;
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
  /** True when the account has full broker permissions but the rule record
   *  governing it (account-specific or default) does not have a valid
   *  automated-actions consent. Surfaces the "Action required" banner so
   *  the user opens Trading Plan and confirms. */
  requiresAutomatedActionsConsent: boolean;
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
  /** Tradovate environment of the broker connection ("live" | "demo" | null when unknown). */
  env: string | null;
  /** Human label for env, e.g. "Live account" or "Demo / Sim". */
  envLabel: string | null;
  /** Prop firm name on the discovered ConnectedAccount row, or null for unassigned/personal. */
  propFirm: string | null;
  /** propFirm inherited from existing active accounts on the same brokerConnectionId.
   *  null when the connection has no unambiguous single propFirm.
   *  Takes priority over suggestedPropFirm (connection context > name pattern). */
  inheritedPropFirm: string | null;
  /** accountType inherited from prop-firm accounts on the same connection.
   *  null when the connection has no unambiguous evaluation/funded type. */
  inheritedAccountType: string | null;
  /** Inferred prop firm from the account label pattern (e.g. MFFU→"MyFundedFutures").
   *  null when the pattern didn't match. Used to pre-fill the classification selector. */
  suggestedPropFirm: string | null;
  /** Inferred account type from the label pattern. Defaults to "personal" when no match. */
  suggestedAccountType: string;
  /** True for fake injected preview accounts — never persisted, activation blocked in UI. */
  isPreview?: boolean;
};

export const PERSONAL_BROKER_FIRM_KEY = "__personal_broker__";

export type CommandCenterFirmGroup = {
  /** Stable React key for this group — `${firmKey}::${brokerConnectionId ?? ""}`.
   *  One broker connection = one group; live and demo accounts that share a
   *  connection appear together, while distinct OAuth grants stay separate. */
  groupId: string;
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
  /** Environment of the broker connection backing this group — "live" or
   *  "demo" for Tradovate, null otherwise. Surfaced so the UI can suffix
   *  duplicate "Tradovate · Personal" groups with " · Live" / " · Demo". */
  brokerEnv: string | null;
  /** Most recent account sync timestamp in this group */
  lastSyncAt: Date | null;
  /** Dominant enforcement mode across accounts in this group */
  enforcementMode: EnforcementMode;
};

/** Account "kind" used for the Dashboard summary breakdown.
 *   live     = funded, personal
 *   practice = evaluation, demo
 *  Mapping is intentionally simple and broad so the user can see at a glance
 *  whether their "Allowed" total reflects real money or practice accounts. */
export type AccountKind = "live" | "practice";

export type StatusBreakdown = {
  total: number;
  live: number;
  practice: number;
};

export type CommandCenterSummary = {
  totalActive: number;
  /** Count by status (live + practice combined). */
  counts: Record<AccountStatus, number>;
  /** Same counts split into live vs practice. */
  breakdown: Record<AccountStatus, StatusBreakdown>;
  totalDailyPnl: number;
  totalRiskRemaining: number;
  openInterventions: number;
  hasPnlData: boolean;
  hasRiskData: boolean;
  /** Oldest lastSyncAt across active accounts — drives "Data may be stale" warning.
   *  null when no broker accounts have ever synced. */
  oldestSyncAt: Date | null;
};

/** Active account whose propFirm is null but whose brokerConnectionId has
 *  exactly one sibling propFirm — eligible for one-click classification repair. */
export type ReclassifiableAccount = {
  id: string;
  label: string;
  /** The single unambiguous propFirm inferred from connection siblings. */
  inheritedPropFirm: string;
  /** accountType inferred from siblings, or null when ambiguous. */
  inheritedAccountType: string | null;
};

export type CommandCenterData = {
  accounts: CommandCenterAccount[];
  groups: CommandCenterFirmGroup[];
  summary: CommandCenterSummary;
  firms: { key: string; label: string }[];
  pendingAccounts: PendingDiscoveredAccount[];
  /** Active accounts that were imported without classification but can be
   *  safely repaired from their broker connection's sibling context. */
  reclassifiableAccounts: ReclassifiableAccount[];
  protectionLock: {
    isLocked: boolean;
    cutoffTime: string | null;
    tradingDayKey: string;
    nextTradingDayKey: string;
    hasSessionHours: boolean;
  };
  /** True during the CME daily maintenance break (4:00–5:00 PM CT, Mon–Thu).
   *  Drives "Maintenance" badge and "CME break" banner. */
  isMaintenanceWindow: boolean;
  /** True during the weekend close (Fri 4:00 PM CT → Sun 5:00 PM CT).
   *  Drives "Closed" badge and "Market closed" banner. */
  isWeekendClose: boolean;
};
