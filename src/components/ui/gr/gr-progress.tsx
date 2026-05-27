/**
 * GrProgress — usage bar for the Guardrail 2 design system.
 *
 * Source: /tmp/guardrail-2/project/gr-tokens.jsx  .gr-bar styles.
 *
 * The fill colour tracks a state variant:
 *   default → ink, ok → green, warn → amber, bad → red, copper → copper.
 *
 * Usage:
 *   <GrProgress value={70} />
 *   <GrProgress value={70} variant="warn" />
 *   <GrProgress value={70} size="thick" aria-label="70% of daily loss used" />
 */

export type GrProgressVariant = "default" | "ok" | "warn" | "bad" | "copper";
export type GrProgressSize = "thin" | "md" | "thick";

type Props = {
  /** 0–100 */
  value: number;
  variant?: GrProgressVariant;
  size?: GrProgressSize;
  className?: string;
  "aria-label"?: string;
};

const HEIGHT: Record<GrProgressSize, number> = { thin: 4, md: 6, thick: 8 };

const FILL_COLOR: Record<GrProgressVariant, string> = {
  default: "var(--gr-ink)",
  ok: "var(--gr-ok)",
  warn: "var(--gr-warn)",
  bad: "var(--gr-bad)",
  copper: "var(--gr-copper)",
};

export function GrProgress({
  value,
  variant = "default",
  size = "md",
  className,
  "aria-label": ariaLabel,
}: Props) {
  const pct = Math.max(0, Math.min(100, value));
  const h = HEIGHT[size];
  return (
    <div
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={ariaLabel}
      className={className}
      style={{
        height: h,
        background: "var(--gr-surface-2)",
        borderRadius: 3,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "block",
          height: "100%",
          width: `${pct}%`,
          background: FILL_COLOR[variant],
          borderRadius: 3,
          transition: "width .2s",
        }}
      />
    </div>
  );
}
