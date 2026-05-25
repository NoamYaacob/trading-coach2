/**
 * Core rules — premium card-grid layout.
 *
 * Six rules in three paired sections:
 *   Money limits      — Daily loss limit (Broker) · Risk per trade (Monitor)
 *   Trading behavior  — Max trades per day (Lock) · Tilt protection (Lock)
 *   Position & symbols — Max contracts (Lock) · Per-symbol limits (Saved)
 *
 * Cards are read-first: they display the current value prominently. An "Edit"
 * affordance (visible on hover) flips the card into an inline edit mode.
 * When `disabled` is true (session locked, already traded today) the Edit
 * button is suppressed and the card stays in read mode — text remains fully
 * readable (no opacity dimming).
 *
 * The "Per-symbol limits" card is display-only; editing happens via the
 * "Contract limits by symbol" collapsed row below the card grid.
 *
 * Below the card grid:
 *   - "View contract sizing" expander (conditional on maxContracts being set)
 *   - "Advanced options" / raw broker cap toggle (conditional on maxContracts)
 *   - "About these rules" single disclosure (replaces per-row "?" buttons)
 *
 * Field keys and submit payload are unchanged.
 */
import type { SymbolLimitRow } from "../symbol-limits-table";
import { REVIEW_INHERITED_HINT } from "../account-rules-form-logic";
import { MAX_POSITION_SIZE_COPY } from "../position-size-copy";
import { MaxPositionSizeConversionTable } from "../max-position-size-conversion-table";
import { NumberInput, NumberStepperInput } from "./field-primitives";
import { RuleCard, RuleCardGroup } from "./rule-card";

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
  /** Symbol limits rows — used for read-only summary in the Per-symbol card. */
  symbolLimits?: SymbolLimitRow[];
  /** When false (creating override), show the "review inherited values" hint. */
  hasExistingRules: boolean;
  /** Hints that the inherited mini-strip should render. */
  showInheritedContext: boolean;
  /** Advanced broker hard-limit expander state — owned by the parent form. */
  showAdvancedBrokerCap: boolean;
  onShowAdvancedBrokerCap: () => void;
  /** When true, suppresses Edit buttons (session locked / hard-locked). */
  disabled?: boolean;
  pendingNotes?: {
    maxDailyLoss?: string | null;
    riskPerTrade?: string | null;
    maxTradesPerDay?: string | null;
    stopAfterLosses?: string | null;
    maxContracts?: string | null;
  };
};

function displayMoney(v: string): string {
  const n = parseFloat(v);
  if (!v.trim() || !Number.isFinite(n)) return "";
  return `$${n.toLocaleString("en-US")}`;
}

function displayCount(v: string): string {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? String(n) : "";
}

function symbolSummary(rows: SymbolLimitRow[]): string {
  const valid = rows.filter((r) => r.symbol.trim() && r.maxContracts.trim());
  if (valid.length === 0) return "";
  return valid.map((r) => `${r.symbol.trim().toUpperCase()} ≤ ${r.maxContracts}`).join(" · ");
}

export function CoreRulesSection({
  values,
  update,
  symbolLimits = [],
  hasExistingRules,
  showInheritedContext,
  showAdvancedBrokerCap,
  onShowAdvancedBrokerCap,
  disabled = false,
  pendingNotes,
}: Props) {
  const symbolDisplay = symbolSummary(symbolLimits);

  return (
    <div className="grid gap-4" role="group" aria-label="Core rules">
      {!hasExistingRules && (
        <p className="-mb-1 text-xs text-stone-500">{REVIEW_INHERITED_HINT}</p>
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

      {/* ── Money limits ─────────────────────────────────────────────────── */}
      <RuleCardGroup title="Money limits">
        <RuleCard
          label="Daily loss limit"
          status="broker-eligible"
          displayValue={displayMoney(values.maxDailyLoss)}
          emptyText="Not set"
          helper="Locks when P&L crosses this loss"
          pendingNote={pendingNotes?.maxDailyLoss ?? null}
          disabled={disabled}
        >
          <NumberInput
            value={values.maxDailyLoss}
            onChange={(v) => update("maxDailyLoss", v)}
            placeholder="500"
          />
        </RuleCard>

        <RuleCard
          label="Risk per trade"
          status="monitoring-only"
          displayValue={displayMoney(values.riskPerTrade)}
          emptyText="Not set"
          helper="Warning only — no lock"
          pendingNote={pendingNotes?.riskPerTrade ?? null}
          disabled={disabled}
        >
          <NumberInput
            value={values.riskPerTrade}
            onChange={(v) => update("riskPerTrade", v)}
            placeholder="100"
          />
        </RuleCard>
      </RuleCardGroup>

      {/* ── Trading behavior ─────────────────────────────────────────────── */}
      <RuleCardGroup title="Trading behavior">
        <RuleCard
          label="Max trades per day"
          status="guardrail-lock"
          displayValue={displayCount(values.maxTradesPerDay)}
          emptyText="Not set"
          helper="Locks after allowance is exceeded"
          pendingNote={pendingNotes?.maxTradesPerDay ?? null}
          disabled={disabled}
        >
          <NumberStepperInput
            value={values.maxTradesPerDay}
            onChange={(v) => update("maxTradesPerDay", v)}
            placeholder="5"
          />
        </RuleCard>

        <RuleCard
          label="Tilt protection"
          status="guardrail-lock"
          displayValue={displayCount(values.stopAfterLosses)}
          emptyText="Not set"
          helper="Stops trading after this many consecutive losses"
          pendingNote={pendingNotes?.stopAfterLosses ?? null}
          disabled={disabled}
        >
          <NumberStepperInput
            value={values.stopAfterLosses}
            onChange={(v) => update("stopAfterLosses", v)}
            placeholder="3"
          />
        </RuleCard>
      </RuleCardGroup>

      {/* ── Position & symbols ───────────────────────────────────────────── */}
      <RuleCardGroup title="Position & symbols">
        <RuleCard
          label="Max contracts"
          status="guardrail-lock"
          displayValue={displayCount(values.maxContracts)}
          emptyText="Not set"
          helper={MAX_POSITION_SIZE_COPY.hint}
          pendingNote={pendingNotes?.maxContracts ?? null}
          disabled={disabled}
        >
          <NumberStepperInput
            value={values.maxContracts}
            onChange={(v) => update("maxContracts", v)}
            placeholder="2"
          />
        </RuleCard>

        {/* Read-only — editing happens in the Symbol limits accordion below */}
        <RuleCard
          label="Per-symbol limits"
          status="saved-eval-soon"
          displayValue={symbolDisplay}
          emptyText="No symbol limits set"
          helper="Saved — evaluation coming soon · edit in Symbol limits below"
        />
      </RuleCardGroup>

      {/* Contract sizing expander — only when maxContracts is set */}
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

      {/* Advanced broker-side raw cap — opt-in expander */}
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
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs">
          <p className="font-semibold text-amber-900">Advanced broker-side contract cap</p>
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

      {/* Section-level explanations — consolidated, collapsed by default */}
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
            <dt className="font-medium text-stone-800">Tilt protection (stop after consecutive losses)</dt>
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
    </div>
  );
}
