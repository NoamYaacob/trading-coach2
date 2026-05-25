"use client";

/**
 * Simple editor for non-Daily-Loss rules.
 *
 * Same warm card style as the Daily Loss editor but without the broker-backed
 * tint or "when triggered" actions section. Used for: risk-per-trade, max
 * trades, tilt protection, max contracts, per-symbol limits, session cutoff.
 *
 * Display-only rules (notifications, advanced broker actions) render a
 * read-only summary card with the canonical disclosure copy — no input.
 *
 * Form-state mutation still flows through the parent's update() function. No
 * separate save/submit; the AccountRulesForm save button captures everything.
 */
import type { ReactNode } from "react";
import { RuleStatusBadge } from "../rule-status-badge";
import { getRuleMeta, type RuleId } from "../rule-meta";

type Props = {
  ruleId: RuleId;
  /** Optional short subtitle / context (e.g. "Resets at session close"). */
  subtitle?: string;
  description: string;
  pendingNote?: string | null;
  /** Editable inputs slot. Omit for display-only rules. */
  children?: ReactNode;
  /** Optional supplementary content (e.g. a related disclosure / table). */
  extra?: ReactNode;
  /** Banner pinned to top of editor when the rule cannot be edited live. */
  notActiveBanner?: ReactNode;
};

export function SimpleRuleEditor({
  ruleId,
  subtitle,
  description,
  pendingNote,
  children,
  extra,
  notActiveBanner,
}: Props) {
  const rule = getRuleMeta(ruleId);

  return (
    <div className="grid gap-4">
      {/* Header */}
      <header className="grid gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <RuleStatusBadge variant={rule.status} />
          <span className="rounded-full border border-stone-200 bg-stone-50 px-2 py-[1px] text-[10px] font-medium uppercase tracking-[0.1em] text-stone-500">
            {rule.group}
          </span>
          {subtitle && (
            <span className="text-[11px] text-stone-500">{subtitle}</span>
          )}
        </div>
        <h2 className="text-xl font-semibold tracking-tight text-stone-950">
          {rule.label}
        </h2>
        <p className="max-w-2xl text-xs leading-relaxed text-stone-600">
          {description}
        </p>
      </header>

      {notActiveBanner}

      {/* Input or display body */}
      {children && (
        <section className="grid gap-3 rounded-2xl border border-stone-200/80 bg-white p-4 shadow-[0_1px_4px_rgba(41,37,36,0.05)]">
          {children}
          {pendingNote && (
            <p className="rounded-lg border border-amber-100 bg-amber-50/60 px-3 py-1.5 text-[11px] font-medium text-amber-700">
              {pendingNote}
            </p>
          )}
        </section>
      )}

      {extra}
    </div>
  );
}
