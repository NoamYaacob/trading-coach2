/**
 * Trading behavior section card for the account Trading Plan form.
 *
 * Fields:
 *   - Max trades per day            — Guardrail lock (internal lock, no broker write)
 *   - Stop after consecutive losses — Guardrail lock (internal lock, no broker write)
 *   - Max trades per week           — placeholder only ("Not active"). The
 *     schema field does not exist yet; this is surfaced as a disabled hint
 *     so the user can see it's planned without falsely implying enforcement.
 *
 * Semantics held by the evaluator (do not restate in copy):
 *   maxTradesPerDay is an allowance; lock fires when tradesCount > maxTradesPerDay.
 *   stopAfterLosses=3 locks on the 3rd consecutive loss; a win resets the streak.
 *   Cooldown after loss is derived state, not user-editable.
 */
import { RuleStatusBadge } from "../rule-status-badge";
import { Field, NumberInput, SectionCard } from "./field-primitives";

export type TradingBehaviorValues = {
  maxTradesPerDay: string;
  stopAfterLosses: string;
};

type Props = {
  values: TradingBehaviorValues;
  update: <K extends keyof TradingBehaviorValues>(
    key: K,
    value: TradingBehaviorValues[K],
  ) => void;
  pendingNotes?: {
    maxTradesPerDay?: string | null;
    stopAfterLosses?: string | null;
  };
};

export function TradingBehaviorSection({ values, update, pendingNotes }: Props) {
  return (
    <SectionCard title="Trading behavior" ariaLabel="Trading behavior">
      <div className="grid items-start gap-3 sm:grid-cols-2 sm:gap-4">
        <Field
          label="Max trades per day"
          badge={<RuleStatusBadge variant="guardrail-lock" />}
          hint="Guardrail locks the account inside the app when the count exceeds your allowance. No broker action."
          pendingNote={pendingNotes?.maxTradesPerDay ?? null}
        >
          <NumberInput
            value={values.maxTradesPerDay}
            onChange={(v) => update("maxTradesPerDay", v)}
            placeholder="5"
            integer
          />
        </Field>
        <Field
          label="Stop after consecutive losses"
          badge={<RuleStatusBadge variant="guardrail-lock" />}
          hint="If this many losing trades happen in a row in the same session, Guardrail locks the account. A win resets the streak."
          pendingNote={pendingNotes?.stopAfterLosses ?? null}
        >
          <NumberInput
            value={values.stopAfterLosses}
            onChange={(v) => update("stopAfterLosses", v)}
            placeholder="3"
            integer
          />
        </Field>
      </div>
      <div className="grid items-start gap-1.5 rounded-xl border border-stone-200 bg-white px-3 py-2.5">
        <div className="flex items-center gap-1.5 text-xs font-medium text-stone-500">
          Max trades per week
          <RuleStatusBadge variant="not-active" />
        </div>
        <p className="text-xs text-stone-400">
          Planned. This rule is not yet stored, evaluated, or enforced. Surfaced
          here so you can see what is coming.
        </p>
      </div>
    </SectionCard>
  );
}
