/**
 * Trading behavior section card for the account Trading Plan form.
 *
 * Fields:
 *   - Max trades per day            — Guardrail lock (internal lock, no broker write)
 *   - Stop after consecutive losses — Guardrail lock (internal lock, no broker write)
 *
 * Max trades per week is intentionally NOT shown here — it lives in the
 * collapsed PlannedRulesSection at the bottom of the page so it doesn't
 * compete visually with the rules that actually enforce today.
 *
 * Inline copy is short; deeper semantics live behind each field's "Learn more"
 * disclosure so the section stays scannable.
 */
import { RuleStatusBadge } from "../rule-status-badge";
import { Field, NumberStepperInput, SectionCard } from "./field-primitives";

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
      <div className="grid items-start gap-3 sm:grid-cols-2">
        <Field
          label="Max trades per day"
          badge={<RuleStatusBadge variant="guardrail-lock" />}
          hint="Locks after the allowance is exceeded."
          details="Lock fires when today's trade count is strictly above this value. Guardrail marks the account locked inside the app; no broker order is cancelled or blocked."
          pendingNote={pendingNotes?.maxTradesPerDay ?? null}
        >
          <NumberStepperInput
            value={values.maxTradesPerDay}
            onChange={(v) => update("maxTradesPerDay", v)}
            placeholder="5"
          />
        </Field>
        <Field
          label="Stop after consecutive losses"
          badge={<RuleStatusBadge variant="guardrail-lock" />}
          hint="Locks after this many losing trades in a row."
          details="Same session only. A winning trade resets the streak to zero. Guardrail marks the account locked inside the app; no broker action."
          pendingNote={pendingNotes?.stopAfterLosses ?? null}
        >
          <NumberStepperInput
            value={values.stopAfterLosses}
            onChange={(v) => update("stopAfterLosses", v)}
            placeholder="3"
          />
        </Field>
      </div>
    </SectionCard>
  );
}
