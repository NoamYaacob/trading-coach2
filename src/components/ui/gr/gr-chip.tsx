/**
 * GrChip — filter / pill chip for the Guardrail 2 design system.
 *
 * Source: /tmp/guardrail-2/project/gr-tokens.jsx  .gr-chip styles.
 *
 * Usage:
 *   <GrChip active onClick={...}>All rules</GrChip>
 *   <GrChip onClick={...}>Capital</GrChip>
 */

import React from "react";

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
};

export function GrChip({ active, children, style, ...rest }: Props) {
  return (
    <button
      type="button"
      {...rest}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "5px 11px",
        fontSize: "12.5px",
        fontWeight: 500,
        background: active ? "var(--gr-ink)" : "var(--gr-surface)",
        color: active ? "var(--gr-bg)" : "var(--gr-text-mid)",
        border: `1px solid ${active ? "var(--gr-ink)" : "var(--gr-border)"}`,
        borderRadius: 999,
        cursor: "pointer",
        lineHeight: 1.2,
        fontFamily: "inherit",
        transition: "background .12s, border-color .12s, color .12s",
        ...style,
      }}
    >
      {children}
    </button>
  );
}
