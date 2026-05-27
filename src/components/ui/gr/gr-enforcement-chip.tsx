/**
 * GrEnforcementChip — Guardrail 2 enforcement status chip.
 *
 * Bridges the existing RuleStatusVariant (source of truth for rule enforcement)
 * into the G2 visual design via the rule-status-to-enforcement adapter.
 *
 * Truth model (do not regress):
 *   broker-eligible → green "Broker-backed"
 *   guardrail-lock  → indigo "App lock"
 *   monitoring-only → amber "Monitor"
 *   saved-eval-soon → stone "Saved"
 *   planned-broker  → ghost dashed "Planned"
 *   not-active      → ghost dashed "Planned"
 *
 * Usage:
 *   <GrEnforcementChip variant="broker-eligible" />
 *   <GrEnforcementChip variant="guardrail-lock" showIcon />
 *   <GrEnforcementChip variant="monitoring-only" showTooltip />
 */

import React from "react";
import type { RuleStatusVariant } from "@/app/rules/_components/rule-status-badge-helpers";
import {
  enforcementMetaForStatus,
  type EnforcementMeta,
} from "@/app/rules/_components/rule-status-to-enforcement";
import { GrBadge, type GrBadgeVariant } from "./gr-badge";
import { GrIcon } from "./gr-icon";
import type { GrIconName } from "./gr-icon";

type Props = {
  variant: RuleStatusVariant;
  /** Show the enforcement icon before the label */
  showIcon?: boolean;
  /** Show tooltip on hover with the full enforcement tip */
  showTooltip?: boolean;
  /** Override the label — defaults to meta.short */
  label?: string;
  className?: string;
};

export function GrEnforcementChip({
  variant,
  showIcon,
  showTooltip,
  label,
  className,
}: Props) {
  const meta: EnforcementMeta = enforcementMetaForStatus(variant);

  // utility = no badge rendered
  if (meta.key === "utility") return null;

  const badgeVariant = meta.badge as GrBadgeVariant;
  const iconName = meta.icon as GrIconName;
  const displayLabel = label ?? meta.short;

  return (
    <GrBadge
      variant={badgeVariant}
      className={className}
      title={showTooltip ? meta.tip : undefined}
    >
      {showIcon && (
        <GrIcon name={iconName} size="sm" aria-hidden />
      )}
      {displayLabel}
    </GrBadge>
  );
}
