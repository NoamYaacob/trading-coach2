/**
 * Money limits section card for the account Trading Plan form.
 *
 * Fields:
 *   - Daily loss limit ($) — Broker-backed eligible (only rule actually eligible
 *     for Tradovate-side enforcement on supported connections).
 *   - Risk per trade ($)   — Monitoring only (warning trigger; never locks).
 *
 * Inherited-only context (Account size, Daily profit target) is rendered at
 * the top of the card so the section mirrors the default-template form's
 * mental model without surfacing extra account-form inputs.
 *
 * Daily profit target is shown as "Monitoring only" even on the default-template
 * form — the dailyProfitAutoLiq broker write path is marked LIVE QA REQUIRED
 * and is intentionally excluded from any active write path today.
 */
import { REVIEW_INHERITED_HINT } from "../account-rules-form-logic";
import { RuleStatusBadge } from "../rule-status-badge";
import { Field, NumberInput, SectionCard } from "./field-primitives";

export type MoneyLimitsValues = {
  maxDailyLoss: string;
  riskPerTrade: string;
};

type Props = {
  values: MoneyLimitsValues;
  update: <K extends keyof MoneyLimitsValues>(key: K, value: MoneyLimitsValues[K]) => void;
  /** When false (creating override), show the "review inherited values" hint. */
  hasExistingRules: boolean;
  /** Hints that the inherited mini-table should render. */
  showInheritedContext: boolean;
  /** Optional pending-payload diff notes per field. */
  pendingNotes?: {
    maxDailyLoss?: string | null;
    riskPerTrade?: string | null;
  };
};

export function MoneyLimitsSection({
  values,
  update,
  hasExistingRules,
  showInheritedContext,
  pendingNotes,
}: Props) {
  return (
    <SectionCard title="Money limits" ariaLabel="Money limits">
      {!hasExistingRules && (
        <p className="-mt-1 text-xs text-stone-400">{REVIEW_INHERITED_HINT}</p>
      )}
      {showInheritedContext && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-xl border border-stone-100 bg-white px-3 py-2 text-[11px] text-stone-500">
          <div>
            <dt className="text-[10px] uppercase tracking-[0.1em] text-stone-400">
              Account size
            </dt>
            <dd className="text-stone-700">
              <span className="rounded-full border border-sky-200 bg-sky-50 px-1.5 py-[1px] text-[9px] font-medium uppercase tracking-[0.08em] text-sky-700">
                Inherited
              </span>{" "}
              <span className="text-stone-500">configured on default template</span>
            </dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-[0.1em] text-stone-400">
              Daily profit target
            </dt>
            <dd className="text-stone-700">
              <span className="rounded-full border border-sky-200 bg-sky-50 px-1.5 py-[1px] text-[9px] font-medium uppercase tracking-[0.08em] text-sky-700">
                Inherited
              </span>{" "}
              <span className="text-stone-500">configured on default template</span>
            </dd>
          </div>
        </dl>
      )}
      <div className="grid items-start gap-3 sm:grid-cols-2 sm:gap-4">
        <Field
          label="Daily loss limit ($)"
          badge={<RuleStatusBadge variant="broker-eligible" />}
          hint="On supported Tradovate connections with consent and full access, the limit can be written to Tradovate's own risk settings. Off by default."
          pendingNote={pendingNotes?.maxDailyLoss ?? null}
        >
          <NumberInput
            value={values.maxDailyLoss}
            onChange={(v) => update("maxDailyLoss", v)}
            placeholder="500"
          />
        </Field>
        <Field
          label="Risk per trade ($)"
          badge={<RuleStatusBadge variant="monitoring-only" />}
          hint="Warning only — does not lock the account."
          pendingNote={pendingNotes?.riskPerTrade ?? null}
        >
          <NumberInput
            value={values.riskPerTrade}
            onChange={(v) => update("riskPerTrade", v)}
            placeholder="100"
          />
        </Field>
      </div>
    </SectionCard>
  );
}
