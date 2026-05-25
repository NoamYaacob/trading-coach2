/**
 * Shared field primitives used by every Trading Plan section card.
 *
 * Field — label + optional badge + child input + at-most-one short hint line
 *   + optional "Learn more" disclosure with longer explanation.
 * NumberInput — numeric input (decimal or integer) with consistent styling.
 *
 * Progressive disclosure: short hint is always visible; long copy goes behind
 * the `details` slot which renders a collapsed-by-default <details>. Keeps
 * each row scannable while preserving full transparency for users who want it.
 */
import type { ReactNode } from "react";

export function Field({
  label,
  hint,
  badge,
  pendingNote,
  details,
  children,
}: {
  label: string;
  /** Short helper line shown directly under the input. Keep to ~70 chars. */
  hint?: string;
  badge?: ReactNode;
  pendingNote?: string | null;
  /** Optional longer explanation tucked behind a collapsed "Learn more" row. */
  details?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="flex items-center gap-1.5 text-xs font-medium text-stone-600">
        {label}
        {badge}
      </span>
      {children}
      {hint && <span className="text-xs text-stone-400">{hint}</span>}
      {details && (
        <details className="group text-xs text-stone-400">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-stone-400 hover:text-stone-600">
            <span className="text-[10px]">Learn more</span>
            <span aria-hidden className="text-[10px] transition-transform group-open:rotate-45">+</span>
          </summary>
          <div className="mt-1 text-stone-500">{details}</div>
        </details>
      )}
      {pendingNote && (
        <span className="text-xs font-medium text-amber-600">{pendingNote}</span>
      )}
    </label>
  );
}

export function NumberInput({
  value,
  onChange,
  placeholder,
  integer = false,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  integer?: boolean;
}) {
  return (
    <input
      type="number"
      inputMode={integer ? "numeric" : "decimal"}
      step={integer ? 1 : "any"}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm focus:border-stone-950 focus:outline-none"
    />
  );
}

/**
 * Shared card wrapper for every section. Keeps spacing, border, and aria-label
 * consistent across the form.
 */
export function SectionCard({
  title,
  ariaLabel,
  badge,
  children,
}: {
  title: string;
  ariaLabel: string;
  /** Optional badge or chip rendered inline next to the section title. */
  badge?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="grid gap-2.5 rounded-2xl border border-stone-100 bg-stone-50/50 p-3 sm:gap-3 sm:p-4"
    >
      <div className="flex items-center gap-2">
        <p className="text-sm font-semibold text-stone-950">{title}</p>
        {badge}
      </div>
      {children}
    </div>
  );
}
