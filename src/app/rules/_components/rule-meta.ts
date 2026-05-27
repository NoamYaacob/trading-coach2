/**
 * Rule metadata for the Trading Plan overview/editor model.
 *
 * This file is the canonical list of rules surfaced in the Trading Plan page.
 * Each entry maps a stable RuleId to its category, label, enforcement status,
 * helper copy, and whether it has an editable input today.
 *
 * Truth model (do not regress):
 *   - Only rules that exist in the current product appear here.
 *   - No placeholder/fake rules (Max Drawdown, Consistency, News Blackout,
 *     Max Open Positions) — those have no schema/evaluator and are out of
 *     scope until built.
 *   - Enforcement variants stay aligned with rule-status-badge-helpers.ts:
 *       Daily loss            → broker-eligible (Tradovate-write eligible)
 *       Risk per trade        → monitoring-only
 *       Max trades / Tilt / Max contracts → guardrail-lock (app-level)
 *       Per-symbol limits     → saved-eval-soon
 *       Session cutoff        → monitoring-only
 *       Notifications         → saved-eval-soon (utility surface)
 *       Advanced broker acts  → planned-broker
 */
import type { RuleStatusVariant } from "./rule-status-badge";
import type { SymbolLimitRow } from "./symbol-limits-table";
import { isValidCmeHour, formatCmeHourLabel } from "./cme-hour-parsing.ts";

export type RuleGroup =
  | "Capital"
  | "Discipline"
  | "Sizing"
  | "Schedule"
  | "Alerts"
  | "Enforcement";

export const RULE_GROUPS: ReadonlyArray<RuleGroup> = [
  "Capital",
  "Discipline",
  "Sizing",
  "Schedule",
  "Alerts",
  "Enforcement",
];

export type RuleId =
  | "daily-loss"
  | "risk-per-trade"
  | "max-trades-per-day"
  | "tilt-protection"
  | "max-contracts"
  | "per-symbol-limits"
  | "session-cutoff"
  | "notifications"
  | "advanced-broker-actions";

export type RuleMeta = {
  id: RuleId;
  label: string;
  group: RuleGroup;
  status: RuleStatusVariant;
  helper: string;
  /** True when the rule has an editable input today. Notifications and
   *  Advanced broker actions are display-only (no edit form). */
  editable: boolean;
};

export const RULES: ReadonlyArray<RuleMeta> = [
  {
    id: "daily-loss",
    label: "Daily loss limit",
    group: "Capital",
    status: "broker-eligible",
    helper: "Locks when P&L crosses this loss",
    editable: true,
  },
  {
    id: "risk-per-trade",
    label: "Risk per trade",
    group: "Capital",
    status: "monitoring-only",
    helper: "Warning only — no lock",
    editable: true,
  },
  {
    id: "max-trades-per-day",
    label: "Max trades per day",
    group: "Discipline",
    status: "guardrail-lock",
    helper: "Locks after allowance is exceeded",
    editable: true,
  },
  {
    id: "tilt-protection",
    label: "Tilt protection",
    group: "Discipline",
    status: "guardrail-lock",
    helper: "Stops trading after this many consecutive losses",
    editable: true,
  },
  {
    id: "max-contracts",
    label: "Max contracts",
    group: "Sizing",
    status: "guardrail-lock",
    helper: "Caps total open size in standard-equivalent contracts",
    editable: true,
  },
  {
    id: "per-symbol-limits",
    label: "Per-symbol limits",
    group: "Sizing",
    status: "saved-eval-soon",
    helper: "Saved — evaluation coming soon",
    editable: true,
  },
  {
    id: "session-cutoff",
    label: "Session cutoff",
    group: "Schedule",
    status: "monitoring-only",
    helper: "End-of-session behavior — saved; auto-cutoff not active yet",
    editable: true,
  },
  {
    id: "notifications",
    label: "Notifications",
    group: "Alerts",
    status: "saved-eval-soon",
    helper: "In-app active · Telegram optional",
    editable: false,
  },
  {
    id: "advanced-broker-actions",
    label: "Advanced broker actions",
    group: "Enforcement",
    status: "planned-broker",
    helper: "Auto-flatten, cancel, lockout — pending broker integration",
    editable: false,
  },
];

export function getRuleMeta(id: RuleId): RuleMeta {
  const r = RULES.find((x) => x.id === id);
  if (!r) throw new Error(`Unknown rule: ${id}`);
  return r;
}

export function rulesInGroup(group: RuleGroup): RuleMeta[] {
  return RULES.filter((r) => r.group === group);
}

/** Subset of form values needed to compute the rule overview display value.
 *  Kept narrow on purpose so editors don't need to lift the entire form. */
export type OverviewValues = {
  maxDailyLoss: string;
  riskPerTrade: string;
  maxTradesPerDay: string;
  stopAfterLosses: string;
  maxContracts: string;
  symbolLimits: SymbolLimitRow[];
  allowedEndHour: string;
};

function fmtMoney(v: string): string {
  if (!v.trim()) return "";
  const n = parseFloat(v);
  return Number.isFinite(n) ? `$${n.toLocaleString("en-US")}` : "";
}

function fmtCount(v: string): string {
  if (!v.trim()) return "";
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? String(n) : "";
}

/**
 * Returns the short display value for a rule given current form values.
 * Empty string means "not set" — callers render placeholder copy then.
 */
export function ruleDisplayValue(id: RuleId, values: OverviewValues): string {
  switch (id) {
    case "daily-loss":
      return fmtMoney(values.maxDailyLoss);
    case "risk-per-trade":
      return fmtMoney(values.riskPerTrade);
    case "max-trades-per-day":
      return fmtCount(values.maxTradesPerDay);
    case "tilt-protection":
      return fmtCount(values.stopAfterLosses);
    case "max-contracts":
      return fmtCount(values.maxContracts);
    case "per-symbol-limits": {
      const valid = values.symbolLimits.filter(
        (r) => r.symbol.trim() && r.maxContracts.trim(),
      );
      if (valid.length === 0) return "";
      return valid
        .map((r) => `${r.symbol.trim().toUpperCase()} ≤ ${r.maxContracts}`)
        .join(" · ");
    }
    case "session-cutoff": {
      const h = parseInt(values.allowedEndHour, 10);
      return isValidCmeHour(h) ? `Stops at ${formatCmeHourLabel(h)}` : "";
    }
    case "notifications":
      return "In-app active · Telegram optional";
    case "advanced-broker-actions":
      return "Not active in this beta";
  }
}
