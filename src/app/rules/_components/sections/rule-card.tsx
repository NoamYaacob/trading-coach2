"use client";

/**
 * RuleCard + RuleCardGroup — premium control-panel card primitives.
 *
 * RuleCardGroup: section heading + 2-column card grid.
 * RuleCard: read-first card showing label, status badge, large value, and
 *   helper text. An optional Edit affordance (hidden by default, revealed on
 *   hover) flips the card into edit mode to surface the input slot. When
 *   `disabled` is true (locked session) the card stays in read mode and the
 *   Edit button is suppressed entirely — the card still looks premium, not
 *   greyed-out.
 */
import { useState, useRef, type ReactNode } from "react";
import { RuleStatusBadge, type RuleStatusVariant } from "../rule-status-badge";

export function RuleCardGroup({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-stone-400">
        {title}
      </p>
      <div className="grid grid-cols-2 gap-2.5 sm:gap-3">{children}</div>
    </div>
  );
}

export function RuleCard({
  label,
  status,
  displayValue,
  emptyText = "Not set",
  helper,
  helpDetail,
  pendingNote,
  disabled = false,
  children,
}: {
  label: string;
  status: RuleStatusVariant;
  /** Formatted value to display in large text. Pass "" to show emptyText. */
  displayValue: string;
  /** Text shown when displayValue is empty (default "Not set"). */
  emptyText?: string;
  helper: string;
  /** Optional detailed explanation shown when the user clicks the ? button. */
  helpDetail?: string;
  pendingNote?: string | null;
  /** When true, suppresses the Edit button and locks the card in read mode. */
  disabled?: boolean;
  /** Edit input. Omit to make the card display-only (no Edit affordance). */
  children?: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const helpBtnRef = useRef<HTMLButtonElement>(null);
  const isEmpty = displayValue.trim() === "";
  const canEdit = !disabled && !!children;

  return (
    <div
      className={`group relative flex flex-col rounded-2xl border p-3.5 transition-shadow ${
        editing
          ? "border-amber-300/70 bg-[#fffdf8] shadow-[0_0_0_3px_rgba(180,120,30,0.08),0_1px_4px_rgba(41,37,36,0.06)]"
          : "border-stone-200/80 bg-white shadow-[0_1px_4px_rgba(41,37,36,0.06)] hover:border-stone-300 hover:shadow-[0_2px_8px_rgba(41,37,36,0.09)]"
      }`}
    >
      {/* Label + badge + edit toggle */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1">
            <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-stone-400">
              {label}
            </span>
            {helpDetail && (
              <button
                ref={helpBtnRef}
                type="button"
                onClick={() => setShowHelp((v) => !v)}
                aria-label={`Help for ${label}`}
                aria-expanded={showHelp}
                className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border text-[8px] font-bold transition ${
                  showHelp
                    ? "border-amber-400 bg-amber-50 text-amber-700"
                    : "border-stone-300 bg-white text-stone-400 hover:border-stone-400 hover:text-stone-600"
                }`}
              >
                ?
              </button>
            )}
          </div>
          <RuleStatusBadge variant={status} compact />
        </div>
        {canEdit && !editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="shrink-0 rounded-lg border border-amber-200/80 bg-amber-50/60 px-2 py-1 text-[10px] font-medium text-amber-700 opacity-0 transition group-hover:opacity-100 hover:border-amber-300 hover:bg-amber-50"
          >
            Edit
          </button>
        )}
        {editing && (
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="shrink-0 rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 text-[10px] font-medium text-amber-800 transition hover:border-amber-400"
          >
            Done
          </button>
        )}
      </div>

      {/* Value or edit input */}
      <div className="mt-3 flex-1">
        {editing && children ? (
          children
        ) : (
          <p
            className={
              isEmpty
                ? "text-sm italic text-stone-300"
                : "text-2xl font-bold tabular-nums leading-none tracking-tight text-stone-950"
            }
          >
            {isEmpty ? emptyText : displayValue}
          </p>
        )}
      </div>

      {/* Helper */}
      <p className="mt-2.5 text-[11px] leading-snug text-stone-400">{helper}</p>

      {helpDetail && showHelp && (
        <p className="mt-2 rounded-lg border border-amber-200/70 bg-amber-50/60 px-2.5 py-2 text-[11px] leading-snug text-amber-900">
          {helpDetail}
        </p>
      )}

      {pendingNote && (
        <p className="mt-1 text-xs font-medium text-amber-600">{pendingNote}</p>
      )}
    </div>
  );
}
