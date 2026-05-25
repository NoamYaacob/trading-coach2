/**
 * Core rules section card — the only always-visible rule editor on the
 * account Trading Plan page.
 *
 * Renders the five enforce-today rules as compact RuleRow controls:
 *   - Daily loss limit ($)           — broker-eligible (Tradovate write opt-in)
 *   - Risk per trade ($)             — monitoring only
 *   - Max trades per day             — guardrail lock (app-level)
 *   - Stop after consecutive losses  — guardrail lock (app-level)
 *   - Max standard-equivalent contracts — guardrail lock (app-level)
 *
 * Everything beyond these five rules (symbol limits, session cutoff,
 * notifications, advanced broker actions, planned rules) lives in the
 * collapsed advanced area below this section.
 *
 * Help is centralised: a single "About these rules" disclosure at the
 * bottom of the card lists explanations for each rule. Per-row "?" buttons
 * were removed to reduce visual noise on the always-visible card.
 *
 * The advanced broker-side raw contract cap toggle ALSO lives here so the
 * trader sees it in context with the rule it modifies, but it is folded
 * behind an "Advanced options" expander so it stays out of the way.
 */
import { REVIEW_INHERITED_HINT } from "../account-rules-form-logic";
import { MAX_POSITION_SIZE_COPY } from "../position-size-copy";
import { MaxPositionSizeConversionTable } from "../max-position-size-conversion-table";
import { NumberInput, NumberStepperInput, RuleRow, SectionCard } from "./field-primitives";

export type CoreRulesValues = {
  maxDailyLoss: string;
  riskPerTrade: string;
  maxTradesPerDay: string;
  stopAfterLosses: string;
  maxContracts: string;
  rawBrokerHardLimitEnabled: boolean;
};

type Props = {
  values: CoreRulesValues;
  update: <K extends keyof CoreRulesValues>(key: K, value: CoreRulesValues[K]) => void;
  /** When false (creating override), show the "review inherited values" hint. */
  hasExistingRules: boolean;
  /** Hints that the inherited mini-strip should render. */
  showInheritedContext: boolean;
  /** Advanced broker hard-limit expander state — owned by the parent form. */
  showAdvancedBrokerCap: boolean;
  onShowAdvancedBrokerCap: () => void;
  pendingNotes?: {
    maxDailyLoss?: string | null;
    riskPerTrade?: string | null;
    maxTradesPerDay?: string | null;
    stopAfterLosses?: string | null;
    maxContracts?: string | null;
  };
};

export function CoreRulesSection({
  values,
  update,
  hasExistingRules,
  showInheritedContext,
  showAdvancedBrokerCap,
  onShowAdvancedBrokerCap,
  pendingNotes,
}: Props) {
  return (
    <SectionCard title="Core rules" ariaLabel="Core rules">
      {!hasExistingRules && (
        <p className="-mt-1 text-xs text-stone-500">{REVIEW_INHERITED_HINT}</p>
      )}
      {showInheritedContext && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-xl border border-stone-200 bg-white px-3 py-2 text-[11px] text-stone-600">
          <div>
            <dt className="text-[10px] uppercase tracking-[0.1em] text-stone-500">
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
            <dt className="text-[10px] uppercase tracking-[0.1em] text-stone-500">
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

      <div className="grid">
        <RuleRow
          label="Daily loss limit ($)"
          status="broker-eligible"
          inputWidth="w-28"
          pendingNote={pendingNotes?.maxDailyLoss ?? null}
        >
          <NumberInput
            value={values.maxDailyLoss}
            onChange={(v) => update("maxDailyLoss", v)}
            placeholder="500"
          />
        </RuleRow>

        <RuleRow
          label="Risk per trade ($)"
          status="monitoring-only"
          inputWidth="w-28"
          pendingNote={pendingNotes?.riskPerTrade ?? null}
        >
          <NumberInput
            value={values.riskPerTrade}
            onChange={(v) => update("riskPerTrade", v)}
            placeholder="100"
          />
        </RuleRow>

        <RuleRow
          label="Max trades per day"
          status="guardrail-lock"
          pendingNote={pendingNotes?.maxTradesPerDay ?? null}
        >
          <NumberStepperInput
            value={values.maxTradesPerDay}
            onChange={(v) => update("maxTradesPerDay", v)}
            placeholder="5"
          />
        </RuleRow>

        <RuleRow
          label="Stop after consecutive losses"
          status="guardrail-lock"
          pendingNote={pendingNotes?.stopAfterLosses ?? null}
        >
          <NumberStepperInput
            value={values.stopAfterLosses}
            onChange={(v) => update("stopAfterLosses", v)}
            placeholder="3"
          />
        </RuleRow>

        <RuleRow
          label={MAX_POSITION_SIZE_COPY.label}
          status="guardrail-lock"
          pendingNote={pendingNotes?.maxContracts ?? null}
        >
          <NumberStepperInput
            value={values.maxContracts}
            onChange={(v) => update("maxContracts", v)}
            placeholder="2"
          />
        </RuleRow>
      </div>

      {/* Inline link expanders — kept subtle so the row grid above stays the
          focal point. Contract sizing only renders the trigger when there is
          something to expand (maxContracts entered); the broker-cap opt-in
          only appears once a value is set. */}
      {values.maxContracts.trim() !== "" && (
        <details className="group text-xs">
          <summary className="inline-flex w-fit cursor-pointer list-none items-center gap-1 text-stone-500 underline-offset-2 hover:text-stone-800 hover:underline">
            <span className="text-[10px]">View contract sizing</span>
            <span aria-hidden className="text-[10px] transition-transform group-open:rotate-45">+</span>
          </summary>
          <div className="mt-1.5">
            <MaxPositionSizeConversionTable maxContracts={values.maxContracts} />
          </div>
        </details>
      )}

      {/* Advanced broker-side raw cap — opt-in expander tucked at the bottom. */}
      {values.maxContracts.trim() !== "" && !showAdvancedBrokerCap && (
        <button
          type="button"
          className="w-fit text-xs text-stone-500 underline-offset-2 hover:text-stone-800 hover:underline"
          onClick={onShowAdvancedBrokerCap}
        >
          Advanced options
        </button>
      )}
      {values.maxContracts.trim() !== "" && showAdvancedBrokerCap && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs">
          <p className="font-semibold text-amber-900">
            Advanced broker-side contract cap
          </p>
          <p className="mt-1 text-amber-800">
            Enables a broker-side contract cap on your Tradovate account
            (immediate reject before execution). Tradovate counts all contracts
            equally — 2&nbsp;MNQ counts as 2 contracts, even though it is well
            within a 1-standard-equivalent limit. Use only if you want Tradovate
            to enforce a raw contract count.
          </p>
          <label className="mt-2 flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 rounded border-amber-400 text-amber-600 focus:ring-amber-500"
              checked={values.rawBrokerHardLimitEnabled}
              onChange={(e) => update("rawBrokerHardLimitEnabled", e.target.checked)}
            />
            <span className="text-amber-900">
              Enable broker-side contract cap (applies to all contracts equally)
            </span>
          </label>
        </div>
      )}

      {/* Section-level rule explanations — replaces per-row "?" buttons so the
          rule grid stays scannable. Collapsed by default; one click reveals
          all five explanations together. */}
      <details className="group border-t border-stone-200 pt-2 text-xs">
        <summary className="inline-flex w-fit cursor-pointer list-none items-center gap-1 text-stone-500 underline-offset-2 hover:text-stone-800 hover:underline">
          <span className="text-[10px]">About these rules</span>
          <span aria-hidden className="text-[10px] transition-transform group-open:rotate-45">+</span>
        </summary>
        <dl className="mt-2 grid gap-2 text-stone-600">
          <div>
            <dt className="font-medium text-stone-800">Daily loss limit</dt>
            <dd className="mt-0.5">
              Locks when today&apos;s P&amp;L crosses this loss. On supported
              Tradovate connections with consent and full access granted,
              Guardrail can also write this limit to Tradovate&apos;s own risk
              settings so the broker enforces it independently. Off by
              default — opt-in per account.
            </dd>
          </div>
          <div>
            <dt className="font-medium text-stone-800">Risk per trade</dt>
            <dd className="mt-0.5">Warning only — does not lock the account.</dd>
          </div>
          <div>
            <dt className="font-medium text-stone-800">Max trades per day</dt>
            <dd className="mt-0.5">
              Lock fires when today&apos;s trade count is strictly above this
              value. Guardrail marks the account locked inside the app; no
              broker order is cancelled or blocked.
            </dd>
          </div>
          <div>
            <dt className="font-medium text-stone-800">Stop after consecutive losses</dt>
            <dd className="mt-0.5">
              Same session only. A winning trade resets the streak to zero.
              Guardrail marks the account locked inside the app; no broker action.
            </dd>
          </div>
          <div>
            <dt className="font-medium text-stone-800">{MAX_POSITION_SIZE_COPY.label}</dt>
            <dd className="mt-0.5">{MAX_POSITION_SIZE_COPY.hint}</dd>
          </div>
        </dl>
      </details>
    </SectionCard>
  );
}
