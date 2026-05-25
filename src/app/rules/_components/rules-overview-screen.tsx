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
  return (
    <button
      type="button"
      onClick={onSelect}
      data-rule-id={rule.id}
      aria-label={`Open editor for ${rule.label}`}
      className="group relative flex flex-col rounded-2xl border border-stone-200/80 bg-white p-4 text-left shadow-[0_1px_4px_rgba(41,37,36,0.05)] transition hover:-translate-y-px hover:border-amber-300 hover:shadow-[0_4px_14px_rgba(41,37,36,0.08)] focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-1"
    >
      {/* Top: category eyebrow + enforcement chip */}
      <div className="flex items-start justify-between gap-2">
        <span className="text-[10px] font-medium uppercase tracking-[0.1em] text-stone-400">
          {rule.group}
        </span>
        <RuleStatusBadge variant={rule.status} compact />
      </div>

      {/* Title + helper */}
      <h3 className="mt-3 text-sm font-semibold tracking-tight text-stone-950">
        {rule.label}
      </h3>
      <p className="mt-0.5 text-[11px] leading-snug text-stone-400">
        {rule.helper}
      </p>

      {/* Value + configure affordance */}
      <div className="mt-4 flex flex-1 items-end justify-between gap-2">
        <span
          className={
            isEmpty
              ? "text-sm italic text-stone-300"
              : "text-xl font-bold tabular-nums leading-none tracking-tight text-stone-950"
          }
        >
          {isEmpty ? "Not set" : display}
        </span>
        {rule.editable && !disabled && (
          <span className="shrink-0 text-[10px] font-medium text-amber-700 opacity-0 transition group-hover:opacity-100">
            Configure →
          </span>
        )}
        {!rule.editable && (
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
  return (
    <div className="grid gap-5" role="group" aria-label="Rules overview">
      {RULE_GROUPS.map((group) => {
        const rules = rulesInGroup(group);
        if (rules.length === 0) return null;
        return (
          <section key={group} className="grid gap-2">
            <div className="flex items-baseline justify-between">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-amber-700">
                {group}
              </p>
              <p className="text-[10px] text-stone-400">
                {rules.length} {rules.length === 1 ? "rule" : "rules"}
              </p>
            </div>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-3 lg:grid-cols-3">
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
