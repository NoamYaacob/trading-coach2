/**
 * Planned rules — collapsed, informational only.
 *
 * Lists rules that have no schema column, no evaluator wiring, and no UI
 * input today. They are surfaced for transparency so traders can see what
 * is coming without confusing them with the rules that actually enforce.
 *
 * Truth model held by this card:
 *   - Max trades per week — no schema column on AccountRiskRules / RiskRules.
 *     Adding it requires a migration + evaluator + UI; deferred.
 *   - Symbol blocks — schema has an orphaned `allowedSymbols` field but no
 *     evaluator reads it and Tradovate exposes no symbol-restriction API,
 *     so we explicitly do not surface a control for it.
 *
 * Rendered as a collapsed <details> so it stays out of the primary scroll.
 */

type PlannedRule = {
  name: string;
  detail: string;
};

const PLANNED_RULES: ReadonlyArray<PlannedRule> = [
  {
    name: "Max trades per week",
    detail:
      "Cap your total trade count across the week. No schema column or evaluator exists yet — planned addition once weekly aggregates are stored.",
  },
  {
    name: "Symbol blocks",
    detail:
      "Block specific symbols from trading. Tradovate offers no symbol-restriction API, so this would be a Guardrail-side rule; the evaluator is not wired yet.",
  },
];

export function PlannedRulesSection() {
  return (
    <details
      className="group rounded-2xl border border-stone-100 bg-stone-50/30 px-3 py-2.5 sm:px-4 sm:py-3"
      aria-label="Planned rules"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-stone-700">
        <span className="flex items-center gap-2">
          Planned rules
          <span className="rounded-full border border-stone-200 bg-stone-50 px-1.5 py-[1px] text-[9px] font-semibold uppercase tracking-[0.08em] text-stone-400">
            Not active
          </span>
        </span>
        <span aria-hidden className="text-stone-400 transition-transform group-open:rotate-45">
          +
        </span>
      </summary>
      <ul className="mt-3 grid gap-2">
        {PLANNED_RULES.map(({ name, detail }) => (
          <li
            key={name}
            className="grid gap-0.5 rounded-xl border border-stone-200 bg-white px-3 py-2"
          >
            <span className="text-xs font-semibold text-stone-700">{name}</span>
            <p className="text-xs text-stone-500">{detail}</p>
          </li>
        ))}
      </ul>
    </details>
  );
}
