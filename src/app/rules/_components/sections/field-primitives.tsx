/**
 * Shared field primitives used by every Trading Plan section card.
 *
 * Field — label + optional badge + child input + optional hint/pending note.
 * NumberInput — numeric input (decimal or integer) with consistent styling.
 *
 * Kept tiny and presentational. State, validation, and pending logic live in
 * the parent form so sections stay reusable.
 */
import type { ReactNode } from "react";

export function Field({
  label,
  hint,
  badge,
  pendingNote,
  children,
}: {
  label: string;
  hint?: string;
  badge?: ReactNode;
  pendingNote?: string | null;
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
  children,
}: {
  title: string;
  ariaLabel: string;
  children: ReactNode;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="grid gap-3 rounded-2xl border border-stone-100 bg-stone-50/50 p-3 sm:gap-4 sm:p-5"
    >
      <p className="text-sm font-semibold text-stone-950">{title}</p>
      {children}
    </div>
  );
}
