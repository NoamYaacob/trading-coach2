/**
 * Adapter: RuleStatusVariant → Guardrail 2 Enforcement taxonomy.
 *
 * Source of truth for RuleStatusVariant:
 *   src/app/rules/_components/rule-status-badge.tsx
 *
 * Source of truth for Enforcement:
 *   /tmp/guardrail-2/project/gr-data.jsx  ENFORCEMENT map
 *
 * This file is the ONLY place the mapping lives. Do not inline
 * variant-to-enforcement logic elsewhere.
 *
 * Enforcement key  → badge colour / label
 *   broker         → green "Broker-backed"
 *   lock           → indigo "App lock"
 *   monitor        → amber "Monitor"
 *   saved          → stone "Saved"
 *   mon-planned    → amber "Monitor · Lock planned"
 *   planned        → ghost "Planned"
 *   utility        → neutral (no badge)
 */

import type { RuleStatusVariant } from "./rule-status-badge";

export type EnforcementKey =
  | "broker"
  | "lock"
  | "monitor"
  | "saved"
  | "mon-planned"
  | "planned"
  | "utility";

export type EnforcementMeta = {
  key: EnforcementKey;
  label: string;
  short: string;
  /** Maps to GrBadgeVariant */
  badge: "broker" | "lock" | "mon" | "saved" | "plan" | "neutral";
  /** Maps to GrIconName */
  icon: "shield" | "lock" | "bell" | "bookmark" | "sparkle";
  tip: string;
};

export const ENFORCEMENT_META: Record<EnforcementKey, EnforcementMeta> = {
  broker: {
    key: "broker",
    label: "Broker-backed",
    short: "Broker",
    badge: "broker",
    icon: "shield",
    tip: "Enforced by the broker. Cannot be bypassed by the trader once live.",
  },
  lock: {
    key: "lock",
    label: "App lock",
    short: "Lock",
    badge: "lock",
    icon: "lock",
    tip: "Guardrail blocks order submission at the app layer before it reaches the broker.",
  },
  monitor: {
    key: "monitor",
    label: "Monitor",
    short: "Monitor",
    badge: "mon",
    icon: "bell",
    tip: "Guardrail tracks and notifies. It does not block trades.",
  },
  saved: {
    key: "saved",
    label: "Saved",
    short: "Saved",
    badge: "saved",
    icon: "bookmark",
    tip: "Configuration is stored. Evaluation coming in a future release.",
  },
  "mon-planned": {
    key: "mon-planned",
    label: "Monitor · Lock planned",
    short: "Monitor",
    badge: "mon",
    icon: "bell",
    tip: "Currently monitor only. Lock enforcement is on the roadmap.",
  },
  planned: {
    key: "planned",
    label: "Planned",
    short: "Planned",
    badge: "plan",
    icon: "sparkle",
    tip: "Not active yet. Listed as a roadmap item.",
  },
  utility: {
    key: "utility",
    label: "",
    short: "",
    badge: "neutral",
    icon: "bell",
    tip: "",
  },
};

/**
 * Map an existing RuleStatusVariant to the G2 Enforcement key.
 *
 * Mapping rationale:
 *   broker-eligible → "broker"   (Tradovate-write eligible daily loss)
 *   guardrail-lock  → "lock"     (app-layer order block)
 *   monitoring-only → "monitor"  (warning, no block)
 *   saved-eval-soon → "saved"    (stored; no active evaluator)
 *   planned-broker  → "planned"  (not active yet)
 *   not-active      → "planned"  (same visual treatment)
 */
export function ruleStatusToEnforcement(variant: RuleStatusVariant): EnforcementKey {
  switch (variant) {
    case "broker-eligible":
      return "broker";
    case "guardrail-lock":
      return "lock";
    case "monitoring-only":
      return "monitor";
    case "saved-eval-soon":
      return "saved";
    case "planned-broker":
    case "not-active":
      return "planned";
  }
}

/** Convenience: get full meta from a RuleStatusVariant. */
export function enforcementMetaForStatus(
  variant: RuleStatusVariant,
): EnforcementMeta {
  return ENFORCEMENT_META[ruleStatusToEnforcement(variant)];
}
