/**
 * GrDot — small coloured dot used in enforcement chips, rule rows, etc.
 *
 * Source: /tmp/guardrail-2/project/gr-tokens.jsx  .gr-dot styles.
 *
 * Usage:
 *   <GrDot variant="broker" />          // static
 *   <GrDot variant="lock" pulse />      // animated pulse
 *   <GrDot variant="mon" size="lg" />   // larger 8×8
 */

export type GrDotVariant = "broker" | "lock" | "mon" | "saved" | "plan" | "ok" | "warn" | "bad" | "copper" | "neutral";

type Props = {
  variant: GrDotVariant;
  /** Animate with pulsing box-shadow */
  pulse?: boolean;
  /** 8×8 instead of default 6×6 */
  size?: "sm" | "lg";
  className?: string;
};

const COLOR: Record<GrDotVariant, string> = {
  broker: "var(--gr-broker)",
  lock: "var(--gr-lock)",
  mon: "var(--gr-mon)",
  saved: "var(--gr-saved)",
  plan: "var(--gr-plan)",
  ok: "var(--gr-ok)",
  warn: "var(--gr-warn)",
  bad: "var(--gr-bad)",
  copper: "var(--gr-copper)",
  neutral: "var(--gr-text-mute)",
};

export function GrDot({ variant, pulse, size = "sm", className }: Props) {
  const px = size === "lg" ? 8 : 6;
  return (
    <span
      className={className}
      style={{
        display: "inline-block",
        width: px,
        height: px,
        borderRadius: "50%",
        background: COLOR[variant],
        flex: "0 0 auto",
        animation: pulse ? "gr-dot-pulse 2s infinite" : undefined,
      }}
      aria-hidden
    />
  );
}
