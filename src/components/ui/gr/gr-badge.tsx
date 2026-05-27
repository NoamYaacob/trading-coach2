/**
 * GrBadge — pill-shaped status badge for the Guardrail 2 design system.
 *
 * Source: /tmp/guardrail-2/project/gr-tokens.jsx  .gr-badge styles.
 *
 * Variants map to the enforcement palette + state colours.
 * The `dashed` border on `plan` is preserved from the source design.
 *
 * Usage:
 *   <GrBadge variant="broker">Broker-backed</GrBadge>
 *   <GrBadge variant="warn">70% used</GrBadge>
 */

import React from "react";

export type GrBadgeVariant =
  | "ok" | "warn" | "bad" | "neutral"
  | "broker" | "lock" | "mon" | "saved" | "plan" | "copper";

type Props = React.HTMLAttributes<HTMLSpanElement> & {
  variant: GrBadgeVariant;
  children: React.ReactNode;
};

type TokenSet = { color: string; bg: string; border: string; borderStyle?: string };

const VARIANTS: Record<GrBadgeVariant, TokenSet> = {
  ok:      { color: "var(--gr-ok)",      bg: "var(--gr-ok-bg)",      border: "var(--gr-ok-bd)" },
  warn:    { color: "var(--gr-warn)",    bg: "var(--gr-warn-bg)",    border: "var(--gr-warn-bd)" },
  bad:     { color: "var(--gr-bad)",     bg: "var(--gr-bad-bg)",     border: "var(--gr-bad-bd)" },
  neutral: { color: "var(--gr-text-mid)", bg: "var(--gr-surface-2)", border: "var(--gr-border)" },
  broker:  { color: "var(--gr-broker)",  bg: "var(--gr-broker-bg)",  border: "var(--gr-broker-bd)" },
  lock:    { color: "var(--gr-lock)",    bg: "var(--gr-lock-bg)",    border: "var(--gr-lock-bd)" },
  mon:     { color: "var(--gr-mon)",     bg: "var(--gr-mon-bg)",     border: "var(--gr-mon-bd)" },
  saved:   { color: "var(--gr-saved)",   bg: "var(--gr-saved-bg)",   border: "var(--gr-saved-bd)" },
  plan:    { color: "var(--gr-plan)",    bg: "var(--gr-plan-bg)",    border: "var(--gr-plan-bd)", borderStyle: "dashed" },
  copper:  { color: "var(--gr-copper)",  bg: "var(--gr-copper-bg)",  border: "var(--gr-copper-bd)" },
};

export function GrBadge({ variant, children, className, style, ...rest }: Props) {
  const t = VARIANTS[variant];
  return (
    <span
      {...rest}
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: "11.5px",
        fontWeight: 500,
        padding: "3px 9px",
        borderRadius: 999,
        lineHeight: 1.3,
        border: `1px ${t.borderStyle ?? "solid"} ${t.border}`,
        background: t.bg,
        color: t.color,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {children}
    </span>
  );
}
