"use client";

/**
 * Rules overview screen — the default view of the Trading Plan editor.
 *
 * Shows all real Guardrail rules as clickable cards, grouped by category
 * (Capital / Discipline / Sizing / Schedule / Alerts / Enforcement).
 * Clicking a card switches the AccountRulesForm into editor mode for that
 * specific rule via the onSelectRule callback.
 *
 * The grid is purely a navigation/summary surface — no form mutations happen
 * here. The submit button stays in AccountRulesForm and saves all fields
 * together (existing product behavior preserved).
 *
 * Empty states: a card with no value yet shows italic "Not set" in place of
 * the value; the enforcement chip is still rendered so the user can see what
 * the rule WOULD do if configured.
 *
 * Phase D: richer premium cards — larger value display, stats strip with
 * real data only (no fabricated telemetry), locked-state badge (no opacity
 * wash), warmer hover transitions.
 */
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
      className={`group relative flex flex-col rounded-2xl border bg-white p-5 text-left shadow-[0_1px_4px_rgba(41,37,36,0.05)] transition focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-1 ${
        isViewOnly
          ? "border-stone-200/70 hover:border-stone-300 hover:shadow-[0_3px_10px_rgba(41,37,36,0.07)]"
          : disabled
          ? "cursor-pointer border-stone-200/80 hover:border-stone-300"
          : "border-stone-200/80 hover:-translate-y-0.5 hover:border-amber-300 hover:shadow-[0_8px_24px_rgba(41,37,36,0.1)]"
      }`}
    >
      {/* Locked badge — intentional visual indicator, no opacity wash */}
      {disabled && (
        <span className="absolute right-3 top-3 rounded-full border border-stone-200 bg-stone-100 px-1.5 py-[1px] text-[9px] font-semibold uppercase tracking-[0.08em] text-stone-500">
          Locked
        </span>
      )}

      {/* Category eyebrow + enforcement chip */}
      <div className="flex items-start justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-700/80">
          {rule.group}
        </span>
        <RuleStatusBadge variant={rule.status} compact />
      </div>

      {/* Rule title */}
      <h3 className="mt-3 text-sm font-semibold leading-tight tracking-tight text-stone-900">
        {rule.label}
      </h3>

      {/* Helper copy */}
      <p className="mt-1 text-[11px] leading-snug text-stone-400">
        {rule.helper}
      </p>

      {/* Value + configure action */}
      <div className="mt-5 flex flex-1 items-end justify-between gap-2">
        <span
          className={
            isEmpty
              ? "text-sm italic text-stone-300"
              : isViewOnly
              ? "text-[13px] font-medium leading-snug text-stone-600"
              : "text-2xl font-bold tabular-nums leading-none tracking-tight text-stone-950"
          }
        >
          {isEmpty ? "Not set" : display}
        </span>
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
        <p className="mt-3 border-t border-amber-100 pt-2 text-[10px] font-medium text-amber-700">
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

  return (
    <div className="grid gap-5" role="group" aria-label="Rules overview">

      {/* Plan stats strip — real data only; balance/P&L omitted (not available on this page) */}
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

      {RULE_GROUPS.map((group) => {
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
    </div>
  );
}
