"use client";

/**
 * Rules rail — sidebar shown in editor mode.
 *
 * Lists every rule grouped by category. The currently-selected rule is
 * highlighted with a copper/amber left border + warm cream tint. Clicking
 * any row switches the editor to that rule (no form mutation).
 *
 * A "Back to overview" button at the top lets the user return to the card
 * grid without selecting a specific rule.
 */
import { RuleStatusBadge } from "./rule-status-badge";
import {
  RULE_GROUPS,
  rulesInGroup,
  ruleDisplayValue,
  type OverviewValues,
  type RuleId,
} from "./rule-meta";

type Props = {
  values: OverviewValues;
  selectedId: RuleId;
  onSelectRule: (id: RuleId) => void;
  onBackToOverview: () => void;
};

export function RulesRail({
  values,
  selectedId,
  onSelectRule,
  onBackToOverview,
}: Props) {
  return (
    <nav
      aria-label="Rules list"
      className="grid gap-3 rounded-2xl border border-stone-200/80 bg-amber-50/30 p-3"
    >
      {/* Back to overview */}
      <button
        type="button"
        onClick={onBackToOverview}
        className="inline-flex w-fit items-center gap-1 text-[11px] font-medium text-amber-700 underline-offset-2 hover:underline"
      >
        ← All rules
      </button>

      {/* Grouped rules list */}
      <div className="grid gap-3">
        {RULE_GROUPS.map((group) => {
          const rules = rulesInGroup(group);
          if (rules.length === 0) return null;
          return (
            <div key={group} className="grid gap-0.5">
              <p className="px-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-stone-400">
                {group}
              </p>
              <ul className="grid gap-0.5">
                {rules.map((r) => {
                  const isSelected = r.id === selectedId;
                  const display = ruleDisplayValue(r.id, values);
                  return (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={() => onSelectRule(r.id)}
                        aria-current={isSelected ? "page" : undefined}
                        className={`group block w-full rounded-md border-l-2 px-2.5 py-2 text-left transition ${
                          isSelected
                            ? "border-amber-600 bg-amber-50/80"
                            : "border-transparent hover:bg-amber-50/30"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={`truncate text-xs ${
                              isSelected ? "font-semibold text-stone-950" : "text-stone-700"
                            }`}
                          >
                            {r.label}
                          </span>
                          <RuleStatusBadge variant={r.status} compact />
                        </div>
                        <div className="mt-0.5 truncate text-[10px] tabular-nums text-stone-400">
                          {display.trim() === "" ? "Not set" : display}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </nav>
  );
}
