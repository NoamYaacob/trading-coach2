/**
 * Rule Capability Matrix — authoritative, single source of truth for what each
 * Guardrail rule can actually do end-to-end. Used by the Safety Console, docs
 * generation, and enforcement gates.
 *
 * SAFETY INVARIANT: Only `maxDailyLoss` may have brokerRiskSettingsEligible=true.
 * No rule has orderActionEligible=true (Phase 3 not started).
 * No rule has editableAfterBreach=true.
 */

export type RuleEnforcementStatus =
  | "full"        // UI + evaluation + enforcement fully working
  | "partial"     // some path missing
  | "ui_only"     // visible in UI, not evaluated
  | "coming_soon" // planned, not started

export type RuleCapability = {
  ruleKey: string;                          // e.g. "maxDailyLoss"
  userVisibleName: string;
  savedInDefaultRules: boolean;
  savedInAccountOverride: boolean;
  dryRunEvaluated: boolean;                 // Phase 2A
  guardianEvaluated: boolean;               // listener worker evaluates
  internalLockEligible: boolean;            // Phase 2B app lock
  brokerRiskSettingsEligible: boolean;      // Phase 2C Tradovate API write — ONLY maxDailyLoss
  orderActionEligible: boolean;             // cancel/flatten — never true (Phase 3 not started)
  editableDuringActiveSession: boolean;     // can be made stricter even during session
  editableAfterBreach: boolean;             // always false — blocked post-breach
  visibleInDashboard: boolean;
  visibleInSafetyConsole: boolean;
  currentStatus: RuleEnforcementStatus;
  brokerSyncTruth:
    | "broker_synced"          // Tradovate broker receives the limit via API
    | "guardrail_monitored"    // Guardrail tracks it; no broker write
    | "guardrail_lockable"     // Guardrail tracks AND can lock the account internally
    | "advisory_only"          // shown in UI, not evaluated in enforcement path
    | "coming_soon";           // not yet started
  userFacingExplanation: string;            // honest, customer-visible copy
};

export const RULE_CAPABILITIES: readonly RuleCapability[] = [
  {
    ruleKey: "maxDailyLoss",
    userVisibleName: "Daily loss limit",
    savedInDefaultRules: true,
    savedInAccountOverride: true,
    dryRunEvaluated: true,
    guardianEvaluated: true,
    internalLockEligible: true,
    brokerRiskSettingsEligible: true,
    orderActionEligible: false,
    editableDuringActiveSession: false,
    editableAfterBreach: false,
    visibleInDashboard: true,
    visibleInSafetyConsole: true,
    currentStatus: "full",
    brokerSyncTruth: "broker_synced",
    userFacingExplanation:
      "Your daily loss limit is monitored by Guardrail and, when broker permissions allow, sent directly to Tradovate as a hard account risk setting. If you hit your limit, Guardrail locks your account internally and (when enabled) writes the limit to the broker so new orders are rejected at the exchange level.",
  },
  {
    ruleKey: "dailyProfitTarget",
    userVisibleName: "Daily profit target",
    savedInDefaultRules: true,
    savedInAccountOverride: false,
    dryRunEvaluated: true,
    guardianEvaluated: true,
    internalLockEligible: false,
    brokerRiskSettingsEligible: false,
    orderActionEligible: false,
    editableDuringActiveSession: false,
    editableAfterBreach: false,
    visibleInDashboard: true,
    visibleInSafetyConsole: true,
    currentStatus: "partial",
    brokerSyncTruth: "guardrail_monitored",
    userFacingExplanation:
      "Profit targets are monitored by Guardrail and trigger an internal notification when reached. They are NOT enforced via Tradovate broker risk settings — no broker-side stop is placed when you hit your profit goal. Guardrail can alert you and optionally lock the app, but the broker will still accept new orders.",
  },
  {
    ruleKey: "maxTradesPerDay",
    userVisibleName: "Max trades per day",
    savedInDefaultRules: true,
    savedInAccountOverride: true,
    dryRunEvaluated: true,
    guardianEvaluated: true,
    internalLockEligible: true,
    brokerRiskSettingsEligible: false,
    orderActionEligible: false,
    editableDuringActiveSession: false,
    editableAfterBreach: false,
    visibleInDashboard: true,
    visibleInSafetyConsole: true,
    currentStatus: "partial",
    brokerSyncTruth: "guardrail_lockable",
    userFacingExplanation:
      "Guardrail counts your trades during the session. The number you set is the inclusive allowance — for example, \"Max trades per day = 3\" permits 3 trades, and your Guardrail account is locked when a 4th trade is detected. This is an app-side enforcement only — the broker will still accept orders if you bypass Guardrail. Broker-side trade-count enforcement is not supported by Tradovate.",
  },
  {
    ruleKey: "stopAfterLosses",
    userVisibleName: "Stop after consecutive losses",
    savedInDefaultRules: true,
    savedInAccountOverride: true,
    dryRunEvaluated: true,
    guardianEvaluated: true,
    internalLockEligible: true,
    brokerRiskSettingsEligible: false,
    orderActionEligible: false,
    editableDuringActiveSession: false,
    editableAfterBreach: false,
    visibleInDashboard: true,
    visibleInSafetyConsole: true,
    currentStatus: "partial",
    brokerSyncTruth: "guardrail_lockable",
    userFacingExplanation:
      "Guardrail tracks your consecutive losing trades and locks your Guardrail account when the streak limit is hit. This is an app-side enforcement only — no broker-side consecutive-loss rule exists in Tradovate.",
  },
  {
    ruleKey: "maxContracts",
    userVisibleName: "Max contracts (position size)",
    savedInDefaultRules: true,
    savedInAccountOverride: true,
    dryRunEvaluated: true,
    guardianEvaluated: true,
    internalLockEligible: true,
    brokerRiskSettingsEligible: false,
    orderActionEligible: false,
    editableDuringActiveSession: false,
    editableAfterBreach: false,
    visibleInDashboard: true,
    visibleInSafetyConsole: true,
    currentStatus: "partial",
    brokerSyncTruth: "guardrail_lockable",
    userFacingExplanation:
      "Guardrail monitors position size using standard-equivalent contract counting (e.g. 10 MNQ = 1 NQ equivalent). The number you set is the inclusive allowance — \"Max contracts = 2\" permits up to 2 standard-equivalent contracts, and your Guardrail account is locked when a 3rd is detected on the next sync. There is no real-time pre-trade enforcement — Guardrail cannot intercept an order before it reaches the broker, so a fill that breaches the cap is recorded after the fact. App-side enforcement only — no broker-side position cap is written.",
  },
  {
    ruleKey: "sessionEndHour",
    userVisibleName: "Session end time",
    savedInDefaultRules: true,
    savedInAccountOverride: true,
    dryRunEvaluated: false,
    guardianEvaluated: false,
    internalLockEligible: false,
    brokerRiskSettingsEligible: false,
    orderActionEligible: false,
    editableDuringActiveSession: false,
    editableAfterBreach: false,
    visibleInDashboard: false,
    visibleInSafetyConsole: true,
    currentStatus: "coming_soon",
    brokerSyncTruth: "advisory_only",
    userFacingExplanation:
      "Session end time is used by Guardrail to define when the rule-edit lock window closes. Active session-end enforcement (automatically stopping trading at the session end) is planned but not yet implemented.",
  },
  {
    ruleKey: "sessionEndBehavior",
    userVisibleName: "Session end behavior",
    savedInDefaultRules: true,
    savedInAccountOverride: true,
    dryRunEvaluated: false,
    guardianEvaluated: false,
    internalLockEligible: false,
    brokerRiskSettingsEligible: false,
    orderActionEligible: false,
    editableDuringActiveSession: false,
    editableAfterBreach: false,
    visibleInDashboard: false,
    visibleInSafetyConsole: true,
    currentStatus: "coming_soon",
    brokerSyncTruth: "advisory_only",
    userFacingExplanation:
      "Session-end behavior (flatten positions or wait for exit) is saved but not yet acted on automatically. This feature is planned for a future phase.",
  },
  {
    ruleKey: "notifications",
    userVisibleName: "Breach notifications",
    savedInDefaultRules: true,
    savedInAccountOverride: false,
    dryRunEvaluated: false,
    guardianEvaluated: false,
    internalLockEligible: false,
    brokerRiskSettingsEligible: false,
    orderActionEligible: false,
    editableDuringActiveSession: true,
    editableAfterBreach: false,
    visibleInDashboard: true,
    visibleInSafetyConsole: true,
    currentStatus: "ui_only",
    brokerSyncTruth: "advisory_only",
    userFacingExplanation:
      "Notification preferences (Telegram, in-app) control how Guardrail alerts you when rules are breached. These are delivery settings only — they do not affect enforcement decisions.",
  },
] as const;

// ── Lookup helpers ──────────────────────────────────────────────────────────

/**
 * Returns the RuleCapability for the given ruleKey, or null if unknown.
 */
export function getRuleCapability(ruleKey: string): RuleCapability | null {
  return RULE_CAPABILITIES.find((r) => r.ruleKey === ruleKey) ?? null;
}

/**
 * Returns true when the rule is eligible for Tradovate broker risk settings writes.
 * SAFETY: Only maxDailyLoss returns true. No profit target or other rule is broker-eligible.
 */
export function isBrokerEligible(ruleKey: string): boolean {
  const cap = getRuleCapability(ruleKey);
  return cap?.brokerRiskSettingsEligible === true;
}

/**
 * Returns true when the rule triggers an internal Guardrail account lock on breach.
 */
export function isInternalLockEligible(ruleKey: string): boolean {
  const cap = getRuleCapability(ruleKey);
  return cap?.internalLockEligible === true;
}
