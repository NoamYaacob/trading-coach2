/**
 * Pure eligibility logic for the Phase 4E symbol-limits QA diagnostic.
 *
 * Decides whether an account is ready for live Phase 4E QA — saving
 * symbol-specific max contracts through the Trading Plan UI — BEFORE it has
 * traded in the current CME session.
 *
 * No I/O, no DB, no framework imports — every input is a primitive supplied by
 * the route handler, so this is unit-testable directly.
 *
 * `canEditRulesNow` mirrors the three-signal session-traded check used by the
 * real PATCH / copy rule-edit lock. It is NOT a new lock, does NOT change lock
 * behavior, and is NOT the source of truth for saving rules — this is a
 * read-only diagnostic.
 */

export type QaEligibilityInput = {
  /** account.connectionStatus (ConnectedAccount-level). */
  connectionStatus: string | null;
  /** Whether the account already has an AccountRiskRules row. */
  hasAccountRiskRules: boolean;
  /** BrokerConnection.tokenExpiresAt < now. null when no expiry is stored. */
  tokenExpired: boolean | null;
  /** Current CME trading-day key. */
  currentCmeTradingDayKey: string;
  /** LiveSessionState.sessionDate, or null when no session row exists. */
  sessionDate: string | null;
  /** LiveSessionState.tradesCount. */
  tradesCount: number;
  /** LiveSessionState.lastTradeAt as an ISO string, or null (passthrough). */
  lastTradeAtIso: string | null;
  /** Signal 2: lastTradeAt falls within the current CME session. */
  lastTradeAtInCurrentSession: boolean;
  /** Signal 3: count of trade events since the current session start. */
  normalizedTradeEventCountThisSession: number;
};

export type QaEligibility = {
  connectedReadonly: boolean;
  connectionStatus: string | null;
  tokenExpired: boolean | null;
  hasAccountRiskRules: boolean;
  currentCmeTradingDayKey: string;
  sessionDate: string | null;
  tradesCount: number;
  lastTradeAt: string | null;
  lastTradeAtInCurrentSession: boolean;
  normalizedTradeEventCountThisSession: number;
  hasTradedThisSession: boolean;
  ruleEditLocked: boolean;
  canEditRulesNow: boolean;
  reasons: string[];
};

const USABLE_CONNECTION_STATUSES = new Set(["connected_readonly", "connected_live"]);

export function deriveSymbolLimitsQaEligibility(input: QaEligibilityInput): QaEligibility {
  const connectedReadonly = input.connectionStatus === "connected_readonly";
  const connectionUsable =
    input.connectionStatus !== null && USABLE_CONNECTION_STATUSES.has(input.connectionStatus);

  // Three-signal session-traded check — identical shape to the PATCH / copy
  // rule-edit lock. Any signal true ⇒ the account has traded this session.
  //   1. LiveSessionState.tradesCount > 0 for the current CME day
  //   2. lastTradeAt is within the current CME session
  //   3. a NormalizedTradeEvent exists since the current session start
  const signal1 =
    input.sessionDate === input.currentCmeTradingDayKey && input.tradesCount > 0;
  const signal2 = input.lastTradeAtInCurrentSession;
  const signal3 = input.normalizedTradeEventCountThisSession > 0;
  const hasTradedThisSession = signal1 || signal2 || signal3;

  const ruleEditLocked = hasTradedThisSession;
  const canEditRulesNow =
    connectionUsable && input.tokenExpired !== true && !hasTradedThisSession;

  const reasons: string[] = [];
  if (!connectionUsable) {
    reasons.push(
      `Connection is not usable for QA (status: ${input.connectionStatus ?? "unknown"}).`,
    );
  }
  if (input.tokenExpired === true) {
    reasons.push("Broker token is expired.");
  }
  if (signal1) {
    reasons.push(
      `Account has traded this CME session (tradesCount ${input.tradesCount} for ${input.currentCmeTradingDayKey}).`,
    );
  }
  if (signal2) {
    reasons.push("Account's lastTradeAt falls within the current CME session.");
  }
  if (signal3) {
    reasons.push(
      `${input.normalizedTradeEventCountThisSession} trade event(s) recorded since the current session start.`,
    );
  }
  if (canEditRulesNow && reasons.length === 0) {
    reasons.push(
      "Account has not traded this CME session and the connection is usable — eligible for Phase 4E QA before trading.",
    );
  }

  return {
    connectedReadonly,
    connectionStatus: input.connectionStatus,
    tokenExpired: input.tokenExpired,
    hasAccountRiskRules: input.hasAccountRiskRules,
    currentCmeTradingDayKey: input.currentCmeTradingDayKey,
    sessionDate: input.sessionDate,
    tradesCount: input.tradesCount,
    lastTradeAt: input.lastTradeAtIso,
    lastTradeAtInCurrentSession: input.lastTradeAtInCurrentSession,
    normalizedTradeEventCountThisSession: input.normalizedTradeEventCountThisSession,
    hasTradedThisSession,
    ruleEditLocked,
    canEditRulesNow,
    reasons,
  };
}
