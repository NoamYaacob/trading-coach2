/**
 * Real-time enforcement decision for max position size.
 *
 * Pure function — no I/O, no DB, no broker calls. Takes:
 *   - a list of current open positions (resolved to contract symbols)
 *   - the account's effective max position size setting (standard-equivalent)
 *   - the event that triggered re-evaluation
 *
 * Returns an enforcement decision struct describing whether to lock/flatten,
 * why, and diagnostic fields for audit logging.
 *
 * The actual enforcement actions (riskState=STOPPED, DB writes, position
 * flatten) are performed by the caller (the listener or cron sync) using
 * the existing four-gate model from tradovate-sync.ts.
 *
 * Enforcement model (detection-response, NOT pre-trade):
 *   Guardrail cannot intercept orders before they execute at Tradovate.
 *   This module fires after an event arrives (WebSocket or polling), reads
 *   the most recent position snapshot, and determines the correct response.
 *
 * Token safety: no function in this module reads, stores, or logs tokens.
 */

import { deriveMaxPositionSizeBreach, type PositionExposureInput } from "./position-exposure.ts";
import type { TradovatePropsEventData, TradovateEntityType, TradovateEventType } from "./tradovate-websocket-protocol.ts";

// ── Input types ──────────────────────────────────────────────────────────────

/** Trigger source identifies how the enforcement re-evaluation was invoked. */
export type RealtimeEnforcementTriggerSource =
  | "tradovate_user_sync_websocket"
  | "tradovate_polling_fallback"
  | "manual_sync"
  | "cron_sync";

/** Context about the specific event that triggered re-evaluation. */
export type RealtimeEnforcementEventContext = {
  triggerSource: RealtimeEnforcementTriggerSource;
  eventType: TradovateEventType | null;
  entityType: TradovateEntityType | null;
  /** Tradovate numeric contractId from the event entity, if available. */
  contractId: number | null;
  /** Resolved contract symbol (e.g. "MNQZ4"), if available. */
  contractName: string | null;
  /** Resolved parent root (e.g. "NQ"), if available. */
  symbolRoot: string | null;
};

/** Input to the real-time enforcement decision function. */
export type RealtimeEnforcementInput = {
  /** Current open positions, resolved to contract symbols. */
  positions: PositionExposureInput[];
  /** Effective max position size in standard-equivalent contracts. null = no rule. */
  maxContracts: number | null;
  /** True when the account is already in riskState=STOPPED (prevents double-logging). */
  alreadyStopped: boolean;
  /** Context about the event that triggered this re-evaluation. */
  eventContext: RealtimeEnforcementEventContext;
};

// ── Output types ─────────────────────────────────────────────────────────────

/** Result of the enforcement decision. No side-effects in this function. */
export type RealtimeEnforcementDecision = {
  /** True when the account should be locked (riskState=STOPPED). */
  shouldLock: boolean;
  /** True when a new violation record should be created. */
  shouldCreateViolation: boolean;
  /** True when position flatten should be attempted (caller checks four gates). */
  shouldFlattenIfGated: boolean;
  /** Standard-equivalent exposure across all open positions. */
  standardEquivalentExposure: number;
  /** Limit that was checked against. null when no rule. */
  maxContracts: number | null;
  /** Whether there were any open positions. */
  hasOpenPositions: boolean;
  /** Primary reason for the enforcement decision. */
  reason: string | null;
  /** Detailed diagnostics for audit logging. */
  diagnostics: RealtimeEnforcementDiagnostics;
};

export type RealtimeEnforcementDiagnostics = {
  triggerSource: RealtimeEnforcementTriggerSource;
  eventType: TradovateEventType | null;
  entityType: TradovateEntityType | null;
  contractId: number | null;
  contractName: string | null;
  symbolRoot: string | null;
  standardEquivalentExposure: number;
  maxContracts: number | null;
  hasOpenPositions: boolean;
  alreadyStopped: boolean;
  /** True when some positions are in unrecognized symbols (conservative: forces lock). */
  hasUnsupportedPositions: boolean;
  unsupportedSymbols: string[];
  /** "exceeded" | "unsupported_symbol" | "no_breach" | "no_rule" */
  breachKind: "exceeded" | "unsupported_symbol" | "no_breach" | "no_rule";
};

// ── Decision function ────────────────────────────────────────────────────────

/**
 * Evaluate whether a real-time event should trigger enforcement.
 *
 * Mirrors the logic of tradovate-sync.ts:
 *   - accounts with no maxContracts rule → no enforcement
 *   - accounts with unsupported symbols → lock (cannot verify, fail-safe)
 *   - accounts with standard-equivalent exposure > maxContracts → lock
 *
 * Callers MUST separately check the four gates before acting:
 *   1. ENFORCEMENT_DRY_RUN=false
 *   2. ENABLE_TRADOVATE_ORDER_ACTIONS=true
 *   3. permissionAllowsOrders=true (from permissionLevel)
 *   4. userConsentGranted=true
 */
export function decideRealtimeEnforcement(input: RealtimeEnforcementInput): RealtimeEnforcementDecision {
  const { positions, maxContracts, alreadyStopped, eventContext } = input;
  const hasOpenPositions = positions.length > 0;

  // ── No rule: enforcement inactive ───────────────────────────────────────
  if (maxContracts === null || maxContracts <= 0) {
    return buildNoRuleDecision(positions.length, eventContext, maxContracts);
  }

  // ── Run standard-equivalent breach check ────────────────────────────────
  const decision = deriveMaxPositionSizeBreach({ positions, maxContracts });

  const standardEquivalentExposure = decision.totalMiniEquivalent;
  const hasUnsupportedPositions = decision.hasUnsupportedPositions;
  const unsupportedSymbols = decision.unsupportedSymbols;
  const shouldLock = decision.shouldTrigger;

  // ── Determine breach kind for diagnostics ───────────────────────────────
  let breachKind: RealtimeEnforcementDiagnostics["breachKind"] = "no_breach";
  if (shouldLock) {
    breachKind = hasUnsupportedPositions ? "unsupported_symbol" : "exceeded";
  }

  const diagnostics: RealtimeEnforcementDiagnostics = {
    ...eventContext,
    standardEquivalentExposure,
    maxContracts,
    hasOpenPositions,
    alreadyStopped,
    hasUnsupportedPositions,
    unsupportedSymbols,
    breachKind,
  };

  if (!shouldLock) {
    return {
      shouldLock: false,
      shouldCreateViolation: false,
      shouldFlattenIfGated: false,
      standardEquivalentExposure,
      maxContracts,
      hasOpenPositions,
      reason: null,
      diagnostics,
    };
  }

  // ── Breach detected ──────────────────────────────────────────────────────
  const shouldCreateViolation = !alreadyStopped;
  const shouldFlattenIfGated = hasOpenPositions;

  return {
    shouldLock: true,
    shouldCreateViolation,
    shouldFlattenIfGated,
    standardEquivalentExposure,
    maxContracts,
    hasOpenPositions,
    reason: decision.reason,
    diagnostics,
  };
}

function buildNoRuleDecision(
  positionCount: number,
  eventContext: RealtimeEnforcementEventContext,
  maxContracts: number | null,
): RealtimeEnforcementDecision {
  const diagnostics: RealtimeEnforcementDiagnostics = {
    ...eventContext,
    standardEquivalentExposure: 0,
    maxContracts,
    hasOpenPositions: positionCount > 0,
    alreadyStopped: false,
    hasUnsupportedPositions: false,
    unsupportedSymbols: [],
    breachKind: "no_rule",
  };
  return {
    shouldLock: false,
    shouldCreateViolation: false,
    shouldFlattenIfGated: false,
    standardEquivalentExposure: 0,
    maxContracts,
    hasOpenPositions: positionCount > 0,
    reason: null,
    diagnostics,
  };
}

// ── Event context builder ────────────────────────────────────────────────────

/** Build a RealtimeEnforcementEventContext from a Tradovate props event. */
export function buildEventContextFromPropsEvent(
  props: TradovatePropsEventData,
  triggerSource: RealtimeEnforcementTriggerSource,
  resolvedContractName: string | null,
  resolvedSymbolRoot: string | null,
): RealtimeEnforcementEventContext {
  const contractId =
    typeof (props.entity as Record<string, unknown>).contractId === "number"
      ? ((props.entity as Record<string, unknown>).contractId as number)
      : null;

  return {
    triggerSource,
    eventType: props.eventType,
    entityType: props.entityType,
    contractId,
    contractName: resolvedContractName,
    symbolRoot: resolvedSymbolRoot,
  };
}

/** Build a minimal event context for cron or manual sync (no event data). */
export function buildCronEventContext(
  source: "cron_sync" | "manual_sync",
): RealtimeEnforcementEventContext {
  return {
    triggerSource: source,
    eventType: null,
    entityType: null,
    contractId: null,
    contractName: null,
    symbolRoot: null,
  };
}
