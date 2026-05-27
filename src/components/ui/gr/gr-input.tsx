/**
 * GrInput — Guardrail 2 text input primitive.
 *
 * Source: /tmp/guardrail-2/project/gr-tokens.jsx  .gr-input / .gr-input-affix styles.
 *
 * Supports an optional prefix/suffix affix slot (e.g. "$" or "CT").
 *
 * Usage:
 *   <GrInput placeholder="0.00" />
 *   <GrInput prefix="$" placeholder="1 200" />
 *   <GrInput suffix="CT" type="number" />
 */

import React from "react";

type Props = React.InputHTMLAttributes<HTMLInputElement> & {
  prefix?: React.ReactNode;
  suffix?: React.ReactNode;
  /** Override the input wrapper style */
  wrapperStyle?: React.CSSProperties;
};

export function GrInput({ prefix, suffix, wrapperStyle, style, ...rest }: Props) {
  if (!prefix && !suffix) {
    return (
      <input
        {...rest}
        style={{
          fontFamily: "inherit",
          fontSize: "14px",
          color: "var(--gr-ink)",
          background: "var(--gr-surface)",
          border: "1px solid var(--gr-border)",
          borderRadius: "var(--gr-r-md)",
          padding: "9px 12px",
          outline: "none",
          width: "100%",
          transition: "border-color .12s, box-shadow .12s",
          ...style,
        }}
        onFocus={(e) => {
          (e.currentTarget as HTMLInputElement).style.borderColor = "var(--gr-copper)";
          (e.currentTarget as HTMLInputElement).style.boxShadow = "0 0 0 3px var(--gr-copper-bg)";
          rest.onFocus?.(e);
        }}
        onBlur={(e) => {
          (e.currentTarget as HTMLInputElement).style.borderColor = "var(--gr-border)";
          (e.currentTarget as HTMLInputElement).style.boxShadow = "";
          rest.onBlur?.(e);
        }}
      />
    );
  }

  // Affixed variant
  const affixStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    padding: "0 12px",
    color: "var(--gr-text-mute)",
    fontSize: "13px",
    background: "var(--gr-surface-warm)",
    fontWeight: 500,
  };

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "stretch",
        background: "var(--gr-surface)",
        border: "1px solid var(--gr-border)",
        borderRadius: "var(--gr-r-md)",
        overflow: "hidden",
        transition: "border-color .12s, box-shadow .12s",
        width: "100%",
        ...wrapperStyle,
      }}
      onFocusCapture={(e) => {
        (e.currentTarget as HTMLDivElement).style.borderColor = "var(--gr-copper)";
        (e.currentTarget as HTMLDivElement).style.boxShadow = "0 0 0 3px var(--gr-copper-bg)";
      }}
      onBlurCapture={(e) => {
        // Only clear if focus truly left the wrapper
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          (e.currentTarget as HTMLDivElement).style.borderColor = "var(--gr-border)";
          (e.currentTarget as HTMLDivElement).style.boxShadow = "";
        }
      }}
    >
      {prefix && (
        <span
          style={{
            ...affixStyle,
            borderRight: "1px solid var(--gr-border)",
          }}
        >
          {prefix}
        </span>
      )}
      <input
        {...rest}
        style={{
          fontFamily: "inherit",
          fontSize: "14px",
          color: "var(--gr-ink)",
          background: "transparent",
          border: "none",
          padding: "9px 12px",
          outline: "none",
          flex: 1,
          minWidth: 0,
          ...style,
        }}
      />
      {suffix && (
        <span
          style={{
            ...affixStyle,
            borderLeft: "1px solid var(--gr-border)",
          }}
        >
          {suffix}
        </span>
      )}
    </div>
  );
}
