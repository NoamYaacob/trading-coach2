"use client";

/**
 * Rules overview screen — the default view of the Trading Plan editor.
 *
 * Shows all real Guardrail rules as clickable cards, grouped by category
 * (Capital / Discipline / Sizing / Schedule / Alerts / Enforcement).
 * Clicking a card switches the AccountRulesForm into editor mode for that
 * specific rule via the onSelectRule callback.
 *
 * Phase E (Guardrail design pass): filter chips per group, richer card anatomy
 * matching the GR design spec, enforcement key footnote.
 *
 * Data policy: only real form values from the DB are displayed.
 * Balance / P&L are omitted (not available on this page — no fabricated telemetry).
 */
import { useState } from "react";
import { RuleStatusBadge } from "./rule-status-badge";
import {
  RULE_GROUPS,
  rulesInGroup,
  ruleDisplayValue,
  type OverviewValues,
  type RuleId,
  type RuleMeta,
} from "./rule-meta";

type Props = {
  values: OverviewValues;
  onSelectRule: (id: RuleId) => void;
  /** When true (locked session), cards stay clickable for read-only view,
   *  but the editor will refuse mutations downstream. */
  disabled?: boolean;
  pendingNotes?: Partial<Record<RuleId, string | null>>;
};

/** Count of user-configurable rules with a value entered (excludes static-display rules). */
function countSetRules(values: OverviewValues): number {
  let n = 0;
  if (values.maxDailyLoss.trim()) n++;
  if (values.riskPerTrade.trim()) n++;
  if (values.maxTradesPerDay.trim()) n++;
  if (values.stopAfterLosses.trim()) n++;
  if (values.maxContracts.trim()) n++;
  if (values.allowedEndHour.trim()) n++;
  if (values.symbolLimits.some((r) => r.symbol.trim() && r.maxContracts.trim())) n++;
  return n;
}

function RuleCard({
  rule,
  display,
  onSelect,
  disabled,
  pendingNote,
}: {
  rule: RuleMeta;
  display: string;
  onSelect: () => void;
  disabled?: boolean;
  pendingNote?: string | null;
}) {
  const isEmpty = display.trim() === "";
  const isViewOnly = !rule.editable;

  return (
    <button
      type="button"
      onClick={onSelect}
      data-rule-id={rule.id}
      aria-label={`Open editor for ${rule.label}`}
      className={`group relative flex flex-col rounded-[14px] border bg-white p-5 text-left transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-1 ${
        disabled
          ? "cursor-pointer border-stone-200/80"
          : "border-stone-200/80 hover:border-amber-300/70 hover:shadow-[0_4px_20px_rgba(162,61,16,0.07)] hover:-translate-y-px"
      }`}
    >
      {/* Group eyebrow + enforcement chip */}
      <div className="flex items-start justify-between gap-2">
        <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-amber-700/60">
          {rule.group}
        </span>
        <RuleStatusBadge variant={rule.status} compact />
      </div>

      {/* Rule title */}
      <h3 className="mt-2.5 text-sm font-semibold leading-snug tracking-tight text-stone-900">
        {rule.label}
      </h3>

      {/* Sub-text */}
      <p className="mt-0.5 text-[11px] leading-snug text-stone-400">
        {rule.helper}
      </p>

      {/* Value — prominent display */}
      <div className="mt-4 flex-1">
        <span
          className={
            isEmpty
              ? "text-sm italic text-stone-300"
              : isViewOnly
              ? "text-[13px] font-medium text-stone-600"
              : "text-2xl font-bold tabular-nums leading-none tracking-tight text-stone-950"
          }
        >
          {isEmpty ? "Not set" : display}
        </span>
      </div>

      {/* Footer row — state indicator + action affordance */}
      <div className="mt-4 flex items-center justify-between gap-2 border-t border-stone-100/80 pt-2.5">
        <div className="flex min-w-0 items-center gap-1.5">
          {disabled ? (
            <span className="rounded-full border border-stone-200 bg-stone-100 px-1.5 py-px text-[9px] font-semibold uppercase tracking-[0.08em] text-stone-500">
              Locked
            </span>
          ) : (
            <span className="text-[10px] text-stone-400">
              {isEmpty ? "Not configured" : "Configured"}
            </span>
          )}
        </div>
        {rule.editable && !disabled && (
          <span className="shrink-0 text-[10px] font-semibold text-amber-700 opacity-0 transition group-hover:opacity-100">
            Configure →
          </span>
        )}
        {isViewOnly && (
          <span className="shrink-0 text-[10px] font-medium text-stone-400">
            View
          </span>
        )}
      </div>

      {pendingNote && (
        <p className="mt-2 border-t border-amber-100 pt-2 text-[10px] font-medium text-amber-700">
          {pendingNote}
        </p>
      )}
    </button>
  );
}

export function RulesOverviewScreen({
  values,
  onSelectRule,
  disabled,
  pendingNotes,
}: Props) {
  const configured = countSetRules(values);
  const hasPending = pendingNotes && Object.values(pendingNotes).some((v) => v != null);
  const [activeGroup, setActiveGroup] = useState<string | null>(null);

  const activeGroups = RULE_GROUPS.filter((g) => rulesInGroup(g).length > 0);
  const visibleGroups = activeGroup
    ? RULE_GROUPS.filter((g) => g === activeGroup)
    : RULE_GROUPS;

  return (
    <div className="grid gap-5" role="group" aria-label="Rules overview">

      {/* Stats strip — real data only; balance/P&L omitted (not available on this page) */}
      <div className="grid grid-cols-3 divide-x divide-stone-200/60 overflow-hidden rounded-2xl border border-stone-200/70 bg-stone-50/50">
        <div className="px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-stone-400">
            Rules set
          </p>
          <p className="mt-0.5 text-base font-bold tabular-nums text-stone-900">
            {configured} / 7
          </p>
        </div>
        <div className="px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-stone-400">
            Session
          </p>
          <p className={`mt-0.5 text-base font-bold ${disabled ? "text-amber-700" : "text-stone-400"}`}>
            {disabled ? "Locked" : "Open"}
          </p>
        </div>
        <div className="px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-stone-400">
            Pending
          </p>
          <p className={`mt-0.5 text-base font-bold ${hasPending ? "text-amber-700" : "text-stone-400"}`}>
            {hasPending ? "Yes" : "None"}
          </p>
        </div>
      </div>

      {/* Group filter chips */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setActiveGroup(null)}
          className={`btn-compact rounded-full border px-3 py-1.5 text-[11px] font-semibold transition ${
            activeGroup === null
              ? "border-amber-300 bg-amber-50 text-amber-800"
              : "border-stone-200 bg-white text-stone-500 hover:border-stone-300 hover:text-stone-700"
          }`}
        >
          All rules
        </button>
        {activeGroups.map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => setActiveGroup(activeGroup === g ? null : g)}
            className={`btn-compact rounded-full border px-3 py-1.5 text-[11px] font-semibold transition ${
              activeGroup === g
                ? "border-amber-300 bg-amber-50 text-amber-800"
                : "border-stone-200 bg-white text-stone-500 hover:border-stone-300 hover:text-stone-700"
            }`}
          >
            {g}
          </button>
        ))}
      </div>

      {/* Rule cards — grouped by category */}
      {visibleGroups.map((group) => {
        const rules = rulesInGroup(group);
        if (rules.length === 0) return null;
        return (
          <section key={group} className="grid gap-2.5">
            <div className="flex items-baseline justify-between">
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-amber-700">
                {group}
              </p>
              <p className="text-[10px] text-stone-400">
                {rules.length} {rules.length === 1 ? "rule" : "rules"}
              </p>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {rules.map((r) => (
                <RuleCard
                  key={r.id}
                  rule={r}
                  display={ruleDisplayValue(r.id, values)}
                  onSelect={() => onSelectRule(r.id)}
                  disabled={disabled}
                  pendingNote={pendingNotes?.[r.id] ?? null}
                />
              ))}
            </div>
          </section>
        );
      })}

      {/* Enforcement key — explains badge meaning at the bottom of the overview */}
      <div className="rounded-xl border border-stone-100 bg-stone-50/60 px-4 py-3.5">
        <p className="mb-2.5 text-[9.5px] font-bold uppercase tracking-[0.16em] text-stone-400">
          About enforcement labels
        </p>
        <div className="flex flex-wrap gap-x-5 gap-y-1.5">
          {[
            { dot: "bg-emerald-500", label: "Broker-backed — enforced by the broker" },
            { dot: "bg-indigo-500", label: "App lock — blocks orders in Guardrail" },
            { dot: "bg-amber-500", label: "Monitor — tracks and notifies, never blocks" },
            { dot: "bg-stone-400", label: "Saved — stored, evaluation coming" },
            { dot: "border border-dashed border-stone-400", label: "Planned — not active yet" },
          ].map((item) => (
            <span
              key={item.label}
              className="inline-flex items-center gap-1.5 text-[10.5px] text-stone-500"
            >
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${item.dot}`} />
              {item.label}
            </span>
          ))}
        </div>
      </div>

    </div>
  );
}
