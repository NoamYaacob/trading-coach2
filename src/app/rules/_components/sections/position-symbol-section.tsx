/**
 * Position & symbol controls section card for the account Trading Plan form.
 *
 * Fields:
 *   - Max standard-equivalent contracts — Guardrail lock. Sync-path detection
 *     creates an InternalLockEvent; no broker pre-trade block.
 *   - Contract limits by symbol         — Saved · Evaluation coming soon.
 *     The schema column exists and the UI captures values, but the guardian
 *     evaluator does not read this yet.
 *   - Symbol blocks                     — Not active. Tradovate has no
 *     symbol-restriction API and there is no Guardrail evaluator wired.
 *
 * Advanced broker hard limit toggle is preserved (account-form-only feature)
 * but kept hidden behind an "Advanced options" expander so it stays out of the
 * way for users who shouldn't touch it.
 */
import { MAX_POSITION_SIZE_COPY, SYMBOL_LIMITS_COPY } from "../position-size-copy";
import { MaxPositionSizeConversionTable } from "../max-position-size-conversion-table";
import { SymbolLimitsTable, type SymbolLimitRow } from "../symbol-limits-table";
import { RuleStatusBadge } from "../rule-status-badge";
import { Field, NumberInput, SectionCard } from "./field-primitives";

export type PositionSymbolValues = {
  maxContracts: string;
  rawBrokerHardLimitEnabled: boolean;
  symbolLimits: SymbolLimitRow[];
};

type Props = {
  values: PositionSymbolValues;
  update: <K extends keyof PositionSymbolValues>(
    key: K,
    value: PositionSymbolValues[K],
  ) => void;
  /** When true, the advanced broker-side raw cap toggle is visible. State
   *  lives in the parent form so it persists across re-renders. */
  showAdvancedBrokerCap: boolean;
  onShowAdvancedBrokerCap: () => void;
  /** Disables the SymbolLimitsTable's add/remove controls when the section is
   *  inside a disabled fieldset; the fieldset itself disables native inputs. */
  symbolLimitsDisabled: boolean;
  pendingNotes?: {
    maxContracts?: string | null;
  };
};

export function PositionSymbolSection({
  values,
  update,
  showAdvancedBrokerCap,
  onShowAdvancedBrokerCap,
  symbolLimitsDisabled,
  pendingNotes,
}: Props) {
  return (
    <SectionCard title="Position & symbol controls" ariaLabel="Position & symbol controls">
      <div className="grid items-start gap-3 sm:grid-cols-2 sm:gap-4">
        <Field
          label={MAX_POSITION_SIZE_COPY.label}
          badge={<RuleStatusBadge variant="guardrail-lock" />}
          hint={MAX_POSITION_SIZE_COPY.hint}
          pendingNote={pendingNotes?.maxContracts ?? null}
        >
          <NumberInput
            value={values.maxContracts}
            onChange={(v) => update("maxContracts", v)}
            placeholder="2"
            integer
          />
          <span className="text-xs text-stone-400">
            {SYMBOL_LIMITS_COPY.globalFallbackNote}
          </span>
          <MaxPositionSizeConversionTable maxContracts={values.maxContracts} />
          {values.maxContracts.trim() !== "" && !showAdvancedBrokerCap && (
            <button
              type="button"
              className="mt-1 text-xs text-stone-400 underline-offset-2 hover:text-stone-600 hover:underline"
              onClick={onShowAdvancedBrokerCap}
            >
              Advanced options
            </button>
          )}
          {values.maxContracts.trim() !== "" && showAdvancedBrokerCap && (
            <div className="mt-1 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs">
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
        </Field>
        <div className="grid gap-2 rounded-xl border border-stone-200 bg-stone-50/60 p-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-semibold text-stone-700">
              {SYMBOL_LIMITS_COPY.heading}
            </span>
            <RuleStatusBadge variant="saved-eval-soon" />
          </div>
          <p className="text-xs text-stone-500">{SYMBOL_LIMITS_COPY.description}</p>
          <SymbolLimitsTable
            value={values.symbolLimits}
            onChange={(rows) => update("symbolLimits", rows)}
            disabled={symbolLimitsDisabled}
          />
        </div>
      </div>
      <div className="grid items-start gap-1.5 rounded-xl border border-stone-200 bg-white px-3 py-2.5">
        <div className="flex items-center gap-1.5 text-xs font-medium text-stone-500">
          Symbol blocks
          <RuleStatusBadge variant="not-active" />
        </div>
        <p className="text-xs text-stone-400">
          Planned. Tradovate does not expose a symbol-restriction API and the
          Guardrail evaluator does not block by symbol yet. Surfaced for
          transparency only.
        </p>
      </div>
    </SectionCard>
  );
}
