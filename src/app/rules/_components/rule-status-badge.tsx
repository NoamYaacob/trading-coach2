/**
 * Unified badge taxonomy for the Trading Plan rules forms.
 *
 * Pure helpers and the variant → label/CSS maps live in
 * `rule-status-badge-helpers.ts` so node:test can import them without
 * needing to load .tsx. This file owns only the React component and
 * re-exports the helpers for ergonomic single-import consumption.
 *
 * Variant truth model:
 *   broker-eligible   → Daily Loss only. Tradovate can back this when consent +
 *                       full_access + opt-in are present. Today the rule-save
 *                       broker write path is verified on demo.
 *   guardrail-lock    → Creates an InternalLockEvent — Guardrail marks the
 *                       account locked inside the app. Does not write to broker.
 *   monitoring-only   → Warning trigger or display-only. Does not lock.
 *   saved-eval-soon   → UI captures the value and saves it; no evaluator reads
 *                       it yet. Schema and form exist; logic ships later.
 *   planned-broker    → Code path or endpoint exists but is not safely active
 *                       in production. Must never be presented as live.
 *   not-active        → Schema or UI gap. Surface only as a disabled placeholder
 *                       so the user knows the rule isn't enforced.
 */
import {
  RULE_STATUS_CLS,
  RULE_STATUS_LABEL,
  RULE_STATUS_LABEL_COMPACT,
  ruleStatusLabel,
  type RuleStatusVariant,
} from "./rule-status-badge-helpers";

export { ruleStatusLabel, type RuleStatusVariant };

export function RuleStatusBadge({
  variant,
  text,
  compact = false,
}: {
  variant: RuleStatusVariant;
  /** Override the default variant label. Use sparingly. */
  text?: string;
  /** When true, renders the compact one-word label (e.g. "Lock" instead of
   *  "Guardrail lock"). Use on form section cards where space is tight.
   *  Full labels remain in HowEnforcementWorks and explanation surfaces. */
  compact?: boolean;
}) {
  const label = text ?? (compact ? RULE_STATUS_LABEL_COMPACT[variant] : RULE_STATUS_LABEL[variant]);
  return (
    <span
      className={`inline-flex items-center rounded-full border px-1.5 py-[1px] text-[9px] font-semibold uppercase tracking-[0.08em] ${RULE_STATUS_CLS[variant]}`}
    >
      {label}
    </span>
  );
}
