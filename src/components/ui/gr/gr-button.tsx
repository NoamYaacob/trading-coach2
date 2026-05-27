/**
 * GrButton — Guardrail 2 button primitive.
 *
 * Source: /tmp/guardrail-2/project/gr-tokens.jsx  .gr-btn styles.
 *
 * Variants: default | primary | ink | ghost
 * Sizes: md (default) | sm | icon
 *
 * Usage:
 *   <GrButton>Save</GrButton>
 *   <GrButton variant="primary">Apply</GrButton>
 *   <GrButton variant="ghost" size="icon" aria-label="Settings"><GrIcon name="settings" /></GrButton>
 */

import React from "react";

export type GrButtonVariant = "default" | "primary" | "ink" | "ghost";
export type GrButtonSize = "md" | "sm" | "icon";

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: GrButtonVariant;
  size?: GrButtonSize;
  /** Show as disabled but still render — does not forward disabled attribute */
  soft?: boolean;
};

export function GrButton({
  variant = "default",
  size = "md",
  soft,
  disabled,
  style,
  children,
  ...rest
}: Props) {
  const isDisabled = disabled || soft;

  const base: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: size === "sm" ? 5 : 7,
    fontFamily: "inherit",
    fontSize: size === "sm" ? "12.5px" : "13.5px",
    fontWeight: 500,
    letterSpacing: "-0.005em",
    padding: size === "icon" ? "7px" : size === "sm" ? "5px 10px" : "8px 14px",
    borderRadius: size === "sm" ? 7 : size === "icon" ? 8 : 9,
    cursor: isDisabled ? "not-allowed" : "pointer",
    lineHeight: 1,
    whiteSpace: "nowrap",
    border: "1px solid",
    opacity: isDisabled ? 0.5 : 1,
    transition: "background .12s, border-color .12s, color .12s",
    ...getVariantStyle(variant),
    ...style,
  };

  return (
    <button
      {...rest}
      disabled={disabled}
      style={base}
    >
      {children}
    </button>
  );
}

function getVariantStyle(variant: GrButtonVariant): React.CSSProperties {
  switch (variant) {
    case "primary":
      return {
        background: "var(--gr-copper)",
        color: "white",
        borderColor: "var(--gr-copper)",
      };
    case "ink":
      return {
        background: "var(--gr-ink)",
        color: "var(--gr-bg)",
        borderColor: "var(--gr-ink)",
      };
    case "ghost":
      return {
        background: "transparent",
        borderColor: "transparent",
        color: "var(--gr-text-mid)",
      };
    default:
      return {
        background: "var(--gr-surface)",
        color: "var(--gr-text)",
        borderColor: "var(--gr-border)",
      };
  }
}
