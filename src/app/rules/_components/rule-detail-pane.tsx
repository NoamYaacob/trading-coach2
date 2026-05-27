"use client";

/**
 * Rule detail pane — sidebar rail + selected-rule editor.
 *
 * Renders when a rule is selected (selectedRuleId != null). Picks the right
 * editor based on rule id:
 *   - daily-loss        → DailyLossEditor (premium, full-design)
 *   - all others        → SimpleRuleEditor with the appropriate input
 *
 * All form state and mutations flow through the props passed in from
 * AccountRulesForm — this component owns no values of its own. The single
 * save button still lives in AccountRulesForm.
 */
import type { SymbolLimitRow } from "./symbol-limits-table";
import { SymbolLimitsTable } from "./symbol-limits-table";
import { CmeHourSelect } from "./cme-hour-select";
import { cmeHourBoundaryNote } from "./cme-hour-parsing";
import { SESSION_WINDOW_COPY } from "./session-window-copy";
import { MAX_POSITION_SIZE_COPY } from "./position-size-copy";
import {
  NumberInput,
  NumberStepperInput,
} from "./sections/field-primitives";
import { RulesRail } from "./rules-rail";
import { DailyLossEditor } from "./editors/daily-loss-editor";
import { SimpleRuleEditor } from "./editors/simple-rule-editor";
import { RuleStatusBadge } from "./rule-status-badge";
import {
  type OverviewValues,
  type RuleId,
} from "./rule-meta";

type Props = {
  selectedId: RuleId;
  values: OverviewValues;
  /** Allow per-field updates on the parent's form state. */
  update: (key: string, value: unknown) => void;
  /** Symbol-limit rows live in a separate slot (not part of OverviewValues
   *  mutation, since onChange returns the full array). */
  onSymbolLimitsChange: (rows: SymbolLimitRow[]) => void;
  /** When true, all inputs are disabled (locked session). */
  disabled?: boolean;
  /** Per-field "default template pending" notes. */
  pendingNotes?: Partial<Record<RuleId, string | null>>;
  onSelectRule: (id: RuleId) => void;
  onBackToOverview: () => void;
  /** Hour timezone label for session cutoff context (CME → user TZ). */
  timezone?: string | null;
  /** Raw broker-side contract cap toggle — surfaced under Max contracts
   *  "Advanced options" disclosure. Kept reachable so users can opt in. */
  rawBrokerHardLimitEnabled: boolean;
  onRawBrokerHardLimitChange: (next: boolean) => void;
};

export function RuleDetailPane({
  selectedId,
  values,
  update,
  onSymbolLimitsChange,
  disabled = false,
  pendingNotes,
  onSelectRule,
  onBackToOverview,
  timezone,
  rawBrokerHardLimitEnabled,
  onRawBrokerHardLimitChange,
}: Props) {
  return (
    <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)] lg:items-start lg:gap-5">
      {/* Left rail — rules list grouped by category */}
      <div className="lg:sticky lg:top-6">
        <RulesRail
          values={values}
          selectedId={selectedId}
          onSelectRule={onSelectRule}
          onBackToOverview={onBackToOverview}
        />
      </div>

      {/* Right pane — selected-rule editor */}
      <div className="min-w-0">
        <EditorSwitch
          selectedId={selectedId}
          values={values}
          update={update}
          onSymbolLimitsChange={onSymbolLimitsChange}
          disabled={disabled}
          pendingNotes={pendingNotes}
          timezone={timezone}
          rawBrokerHardLimitEnabled={rawBrokerHardLimitEnabled}
          onRawBrokerHardLimitChange={onRawBrokerHardLimitChange}
        />
      </div>
    </div>
  );
}

function EditorSwitch({
  selectedId,
  values,
  update,
  onSymbolLimitsChange,
  disabled,
  pendingNotes,
  timezone,
  rawBrokerHardLimitEnabled,
  onRawBrokerHardLimitChange,
}: Pick<
  Props,
  | "selectedId"
  | "values"
  | "update"
  | "onSymbolLimitsChange"
  | "disabled"
  | "pendingNotes"
  | "timezone"
  | "rawBrokerHardLimitEnabled"
  | "onRawBrokerHardLimitChange"
>) {
  switch (selectedId) {
    case "daily-loss":
      return (
        <DailyLossEditor
          value={values.maxDailyLoss}
          onChange={(v) => update("maxDailyLoss", v)}
          pendingNote={pendingNotes?.["daily-loss"] ?? null}
          disabled={disabled}
        />
      );
    case "risk-per-trade":
      return (
        <SimpleRuleEditor
          ruleId="risk-per-trade"
          subtitle="Warning only — no lock"
          description="Warns when an order would risk more than this dollar amount on a single trade. The warning is informational; it does not block the order."
          pendingNote={pendingNotes?.["risk-per-trade"] ?? null}
        >
          <div className="grid gap-1.5">
            <label className="text-[11px] font-medium uppercase tracking-[0.08em] text-stone-500">
              Risk per trade (USD)
            </label>
            <NumberInput
              value={values.riskPerTrade}
              onChange={(v) => update("riskPerTrade", v)}
              placeholder="100"
            />
            <p className="text-[11px] text-stone-400">
              Set to 0 or leave empty to disable the warning.
            </p>
          </div>
        </SimpleRuleEditor>
      );
    case "max-trades-per-day":
      return (
        <SimpleRuleEditor
          ruleId="max-trades-per-day"
          subtitle="Hard app-level lock"
          description="Guardrail marks the account locked inside the app once today's trade count strictly exceeds this value. No broker order is cancelled or blocked — the lock is app-level only."
          pendingNote={pendingNotes?.["max-trades-per-day"] ?? null}
        >
          <div className="grid gap-1.5">
            <label className="text-[11px] font-medium uppercase tracking-[0.08em] text-stone-500">
              Trades per day allowance
            </label>
            <div className="w-44">
              <NumberStepperInput
                value={values.maxTradesPerDay}
                onChange={(v) => update("maxTradesPerDay", v)}
                placeholder="5"
              />
            </div>
            <p className="text-[11px] text-stone-400">
              Trade count is incremented when an order fills.
            </p>
          </div>
        </SimpleRuleEditor>
      );
    case "tilt-protection":
      return (
        <SimpleRuleEditor
          ruleId="tilt-protection"
          subtitle="Hard app-level lock"
          description="Stops trading after this many consecutive losing trades in the same session. A winning trade resets the streak to zero. Guardrail marks the account locked inside the app — no broker action."
          pendingNote={pendingNotes?.["tilt-protection"] ?? null}
        >
          <div className="grid gap-1.5">
            <label className="text-[11px] font-medium uppercase tracking-[0.08em] text-stone-500">
              Consecutive losses before lock
            </label>
            <div className="w-44">
              <NumberStepperInput
                value={values.stopAfterLosses}
                onChange={(v) => update("stopAfterLosses", v)}
                placeholder="3"
              />
            </div>
          </div>
        </SimpleRuleEditor>
      );
    case "max-contracts":
      return (
        <SimpleRuleEditor
          ruleId="max-contracts"
          subtitle="Hard app-level lock"
          description={MAX_POSITION_SIZE_COPY.hint}
          pendingNote={pendingNotes?.["max-contracts"] ?? null}
          extra={
            <details className="group grid gap-2 rounded-2xl border border-stone-200/80 bg-white p-4 shadow-[0_1px_4px_rgba(41,37,36,0.05)]">
              <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold text-stone-700">
                <span className="flex items-center gap-2">
                  Advanced options
                  <span className="rounded-full border border-amber-200 bg-amber-50 px-1.5 py-[1px] text-[9px] font-semibold uppercase tracking-[0.08em] text-amber-700">
                    Broker-side
                  </span>
                </span>
                <span
                  aria-hidden
                  className="text-stone-400 transition-transform group-open:rotate-45"
                >
                  +
                </span>
              </summary>
              <div className="mt-1 grid gap-2 rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-xs text-amber-900">
                <p className="font-semibold">Broker-side raw contract cap</p>
                <p>
                  Writes a raw contract cap to your Tradovate account so the
                  broker rejects orders before execution. Tradovate counts every
                  contract equally — 2&nbsp;MNQ counts as 2 contracts, even when
                  that is well inside a 1-standard-equivalent limit. Use only if
                  you want the broker to enforce a raw contract count.
                </p>
                <label className="mt-1 flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 rounded border-amber-400 text-amber-600 focus:ring-amber-500 disabled:cursor-not-allowed"
                    checked={rawBrokerHardLimitEnabled}
                    disabled={disabled}
                    onChange={(e) => onRawBrokerHardLimitChange(e.target.checked)}
                    aria-label="Enable broker-side raw contract cap"
                  />
                  <span className="text-amber-900">
                    Enable broker-side contract cap (applies to all contracts
                    equally)
                  </span>
                </label>
              </div>
            </details>
          }
        >
          <div className="grid gap-1.5">
            <label className="text-[11px] font-medium uppercase tracking-[0.08em] text-stone-500">
              {MAX_POSITION_SIZE_COPY.label}
            </label>
            <div className="w-44">
              <NumberStepperInput
                value={values.maxContracts}
                onChange={(v) => update("maxContracts", v)}
                placeholder="2"
              />
            </div>
            <p className="text-[11px] text-stone-400">
              Standard-equivalent contracts — 2 MNQ counts as 0.4 of a standard ES.
            </p>
          </div>
        </SimpleRuleEditor>
      );
    case "per-symbol-limits":
      return (
        <SimpleRuleEditor
          ruleId="per-symbol-limits"
          subtitle="Saved · evaluation coming soon"
          description="Optional per-symbol caps that override Max contracts for specific instruments. The configuration is saved with the Trading Plan; the evaluator that uses these caps ships in a future release."
          pendingNote={pendingNotes?.["per-symbol-limits"] ?? null}
        >
          <SymbolLimitsTable
            value={values.symbolLimits}
            onChange={onSymbolLimitsChange}
            disabled={disabled ?? false}
          />
        </SimpleRuleEditor>
      );
    case "session-cutoff": {
      const h = parseInt(values.allowedEndHour, 10);
      const boundary = Number.isFinite(h) ? cmeHourBoundaryNote(h) : null;
      return (
        <SimpleRuleEditor
          ruleId="session-cutoff"
          subtitle={timezone ? `Configured in ${timezone}` : "CME exchange time"}
          description={SESSION_WINDOW_COPY.endHint}
        >
          <div className="grid gap-1.5">
            <label className="text-[11px] font-medium uppercase tracking-[0.08em] text-stone-500">
              {SESSION_WINDOW_COPY.endLabel}
            </label>
            <CmeHourSelect
              value={values.allowedEndHour}
              onChange={(v) => update("allowedEndHour", v)}
              ariaLabel={SESSION_WINDOW_COPY.endLabel}
            />
            {boundary && <p className="text-[11px] text-stone-500">{boundary}</p>}
            <p className="text-[11px] text-stone-400">
              Saved — auto-cutoff scheduling is not active yet.
            </p>
          </div>
        </SimpleRuleEditor>
      );
    }
    case "notifications":
      return (
        <SimpleRuleEditor
          ruleId="notifications"
          subtitle="In-app + Telegram"
          description="Rule-breach notices appear in-app on the Dashboard. Connect Telegram in Settings to also receive proactive alerts in your chat."
          extra={
            <div className="grid gap-2 rounded-2xl border border-stone-200/80 bg-white p-4 shadow-[0_1px_4px_rgba(41,37,36,0.05)]">
              <p className="text-xs font-semibold text-stone-700">Delivery channels</p>
              <ul className="grid gap-1.5 text-xs text-stone-600">
                <li className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
                  In-app dashboard notices — always on
                </li>
                <li className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-stone-400" aria-hidden />
                  Telegram — optional, configure in Settings
                </li>
                <li className="flex items-center gap-2">
                  <RuleStatusBadge variant="planned-broker" compact />
                  Email delivery — planned, not active
                </li>
              </ul>
            </div>
          }
          notActiveBanner={
            <p className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-[11px] text-stone-500">
              No per-rule toggles today. Every active rule delivers a breach
              notice through the channels listed below.
            </p>
          }
        />
      );
    case "advanced-broker-actions":
      return (
        <SimpleRuleEditor
          ruleId="advanced-broker-actions"
          subtitle="Pending broker integration"
          description="Broker-side actions Guardrail can perform on your Tradovate account. These are listed for transparency. None are active for end users in this beta."
          extra={
            <div className="grid gap-2">
              {[
                {
                  name: "Broker-side daily loss lock",
                  detail:
                    "Ask Tradovate to enforce the daily loss limit broker-side. Planned broker action; not active.",
                },
                {
                  name: "Broker-side profit target lock",
                  detail:
                    "Broker-side enforcement of a profit target. Code path is live-QA-required; not active.",
                },
                {
                  name: "Flatten positions through broker",
                  detail:
                    "Close every open position via the broker API. Endpoint reachable but unverified on live; not wired to any trigger today.",
                },
                {
                  name: "Cancel pending orders through broker",
                  detail:
                    "Flatten positions and write the broker-side daily-loss lock. Depends on flatten verification and broker-write opt-in.",
                },
              ].map((a) => (
                <div
                  key={a.name}
                  className="grid gap-1 rounded-xl border border-dashed border-stone-300 bg-stone-50/50 p-3"
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-semibold text-stone-700">{a.name}</span>
                    <RuleStatusBadge variant="planned-broker" compact />
                  </div>
                  <p className="text-[11px] text-stone-500">{a.detail}</p>
                </div>
              ))}
              <p className="text-[10px] text-stone-400">
                Cancel orders, flatten positions, and broker-side order blocking
                are not active in this beta.
              </p>
            </div>
          }
          notActiveBanner={
            <p className="rounded-lg border border-dashed border-stone-300 bg-stone-50/60 px-3 py-2 text-[11px] text-stone-500">
              No inputs — every action on this page is a planned broker action
              and not safely active in production.
            </p>
          }
        />
      );
  }
}
