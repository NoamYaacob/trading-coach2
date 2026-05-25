/**
 * Pure helpers for the rule status badge taxonomy.
 *
 * Kept in a .ts file (no JSX) so node:test source-scan + unit tests can import
 * the label map directly. The React component (rule-status-badge.tsx) re-exports
 * these names alongside the JSX so consumers only need one import.
 */

export type RuleStatusVariant =
  | "broker-eligible"
  | "guardrail-lock"
  | "monitoring-only"
  | "saved-eval-soon"
  | "planned-broker"
  | "not-active";

export const RULE_STATUS_LABEL: Record<RuleStatusVariant, string> = {
  "broker-eligible": "Broker-backed eligible",
  "guardrail-lock": "Guardrail lock",
  "monitoring-only": "Monitoring only",
  "saved-eval-soon": "Saved · Evaluation coming soon",
  "planned-broker": "Planned broker action",
  "not-active": "Not active",
};

/** Compact one-word labels for inline form badges where horizontal space
 *  is tight. Full labels stay in HowEnforcementWorks and test surfaces. */
export const RULE_STATUS_LABEL_COMPACT: Record<RuleStatusVariant, string> = {
  "broker-eligible": "Broker",
  "guardrail-lock": "Lock",
  "monitoring-only": "Monitor",
  "saved-eval-soon": "Saved",
  "planned-broker": "Planned",
  "not-active": "Not active",
};

export const RULE_STATUS_CLS: Record<RuleStatusVariant, string> = {
  "broker-eligible": "border-emerald-200 bg-emerald-50 text-emerald-700",
  "guardrail-lock": "border-red-200 bg-red-50 text-red-700",
  "monitoring-only": "border-stone-200 bg-stone-100 text-stone-500",
  "saved-eval-soon": "border-sky-200 bg-sky-50 text-sky-700",
  "planned-broker": "border-amber-200 bg-amber-50 text-amber-700",
  "not-active": "border-stone-200 bg-stone-50 text-stone-400",
};

export function ruleStatusLabel(variant: RuleStatusVariant): string {
  return RULE_STATUS_LABEL[variant];
}
