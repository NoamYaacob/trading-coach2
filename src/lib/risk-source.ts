/**
 * Risk source abstraction.
 *
 * The product needs to compute the same Safe / Warning / Locked verdict
 * regardless of whether the underlying data is:
 *   - manual journal entries (today)
 *   - broker executions + account snapshot (after broker integration)
 *
 * For now, only the manual path is implemented. The broker entry point
 * exists as a stub that throws NotImplementedError so callers cannot
 * silently fall back to manual numbers when they should be reading from
 * the broker.
 */

import type {
  BrokerAccountSnapshot,
  BrokerExecution,
} from "@/lib/brokers/types";
import { NotImplementedError } from "@/lib/brokers/types";
import type { ManualRiskState } from "@/lib/manual-risk-state";

export type RiskSource = "manual" | "broker";

/**
 * Source-tagged risk state. Today this just wraps the manual shape;
 * broker source will reuse the same shape so UI surfaces stay consistent.
 */
export type SourcedRiskState = ManualRiskState & {
  source: RiskSource;
};

/**
 * Placeholder for the broker risk-state computation.
 *
 * Will accept:
 *   - the user's RiskRules
 *   - a BrokerAccountSnapshot (for live equity / today P&L)
 *   - the day's BrokerExecution[] (for trade count, win/loss, streak)
 *
 * Will return the same verdict shape as computeManualRiskState so all
 * dashboards / Guardian surfaces can render uniformly.
 *
 * Intentionally throws until we have:
 *   1. A live broker adapter that returns real executions + snapshot.
 *   2. Verified semantics for "today" P&L (broker-day vs trading-day vs
 *      our timezone-aware window).
 */
export type BrokerRiskInput = {
  snapshot: BrokerAccountSnapshot;
  todayExecutions: BrokerExecution[];
};

export function computeBrokerRiskState(input: BrokerRiskInput): never {
  // input is intentionally captured so future implementations have a stable
  // signature; today every call path throws.
  void input;
  throw new NotImplementedError("computeBrokerRiskState");
}
