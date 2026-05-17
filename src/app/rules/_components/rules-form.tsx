"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cmeHourToLocalHour, SESSION_WINDOW_TIMEZONE } from "@/lib/trading-day";
import { SESSION_WINDOW_COPY } from "./session-window-copy";
import { MAX_POSITION_SIZE_COPY } from "./position-size-copy";
import { MaxPositionSizeConversionTable } from "./max-position-size-conversion-table";
import { TradingSessionSelector, type TradingSessionValues } from "./trading-session-selector";
import { AUTOMATED_ACTIONS_CONSENT_TEXT } from "@/lib/brokers/automated-actions-consent";
import { validateRules } from "./rule-validation";
import { CmeHourSelect } from "./cme-hour-select";
import { cmeHourBoundaryNote } from "./cme-hour-parsing";

export type RulesFormValues = {
  accountSize: string;
  maxDailyLoss: string;
  dailyProfitTarget: string;
  maxRiskPerTrade: string;
  maxTradesPerDay: string;
  stopAfterLosses: string;
  maxContracts: string;
  sessionEndHour: string;
  sessionEndBehavior: string;
  onBreachWarn: boolean;
  /** Multi-select preset IDs. Empty = no session configured. */
  sessionPresets: string[];
  /** True when user wants a custom (non-preset) session window. */
  sessionIsCustom: boolean;
  sessionStartTime: string;
  sessionEndTime: string;
  sessionTimezone: string;
  ruleEditLockBufferMinutes: string;
};

type Props = {
  initial: RulesFormValues;
  timezone?: string | null;
  /** True when the saved RiskRules row has a valid (current-version)
   *  automated-actions consent. When false, the consent checkbox is shown
   *  and required to submit — broker writes will not fire on accounts that
   *  fall back to this default template until consent is captured. */
  hasValidConsent: boolean;
  /**
   * Parsed pendingPayloadJson from the server. When a field's active DB column
   * is null but the pending payload has a value, we surface an inline note so
   * users don't mistake a pending value for an active one.
   */
  pendingPayload?: Record<string, unknown> | null;
};

const TZ_CITY: Record<string, string> = {
  "Asia/Jerusalem": "Israel",
  "America/New_York": "New York",
  "America/Chicago": "Chicago",
  "America/Los_Angeles": "Los Angeles",
  "Europe/London": "London",
  "Europe/Berlin": "Berlin",
  "Asia/Bangkok": "Bangkok",
  "Asia/Tokyo": "Tokyo",
  "Australia/Sydney": "Sydney",
};

function tzLabel(tz: string | null | undefined): string | null {
  if (!tz) return null;
  const city = TZ_CITY[tz];
  return city ? `${city} time` : null;
}

const SESSION_END_BEHAVIOR_OPTIONS = [
  {
    value: "wait_for_exit_then_lock",
    label: "Let open trade finish, then lock",
    hint: "Saved in Guardrail. Automatic cutoff scheduling is not active yet. When enabled, Guardrail will wait for the open position to close, then mark the account stopped for the rest of the day.",
  },
  {
    value: "flatten_at_session_end",
    label: "Close open positions at cutoff, then lock",
    hint: "Saved for future cutoff automation. This action is not active yet.",
  },
] as const;

function numericOrNull(value: string): number | null {
  if (value.trim() === "") return null;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

function intOrNull(value: string): number | null {
  if (value.trim() === "") return null;
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

export function RulesForm({ initial, timezone, hasValidConsent, pendingPayload }: Props) {
  const router = useRouter();
  const [values, setValues] = useState<RulesFormValues>(initial);
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  const [consentChecked, setConsentChecked] = useState(false);

  const parsedAccountSize = parseFloat(values.accountSize);
  const parsedMaxDailyLoss = parseFloat(values.maxDailyLoss);
  const showDailyLossBalanceWarning =
    values.accountSize.trim() !== "" &&
    values.maxDailyLoss.trim() !== "" &&
    Number.isFinite(parsedAccountSize) &&
    Number.isFinite(parsedMaxDailyLoss) &&
    parsedMaxDailyLoss > parsedAccountSize;

  function update<K extends keyof RulesFormValues>(key: K, value: RulesFormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
    setIsDirty(true);
    setSavedAt(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validateRules({
      maxDailyLoss: values.maxDailyLoss,
      riskPerTrade: values.maxRiskPerTrade,
      maxTradesPerDay: values.maxTradesPerDay,
      stopAfterLosses: values.stopAfterLosses,
    });
    if (errs.length > 0) {
      setError(errs[0].message);
      return;
    }
    setSaving(true);
    setError(null);

    const hasPresets = values.sessionPresets.length > 0;
    const resolvedStartTime = values.sessionIsCustom ? (values.sessionStartTime.trim() || null) : null;
    const resolvedEndTime = values.sessionIsCustom ? (values.sessionEndTime.trim() || null) : null;
    const resolvedTimezone = values.sessionIsCustom ? (values.sessionTimezone.trim() || null) : null;

    const payload = {
      accountSize: numericOrNull(values.accountSize),
      maxDailyLoss: numericOrNull(values.maxDailyLoss),
      dailyProfitTarget: numericOrNull(values.dailyProfitTarget),
      maxRiskPerTrade: numericOrNull(values.maxRiskPerTrade),
      maxTradesPerDay: intOrNull(values.maxTradesPerDay),
      stopAfterLosses: intOrNull(values.stopAfterLosses),
      maxContracts: intOrNull(values.maxContracts),
      sessionEndHour: intOrNull(values.sessionEndHour),
      sessionEndBehavior: values.sessionEndBehavior || null,
      onBreachWarn: values.onBreachWarn,
      selectedSessionPresets: hasPresets ? values.sessionPresets : (values.sessionIsCustom ? null : []),
      sessionPreset: values.sessionIsCustom ? "custom" : null,
      sessionStartTime: resolvedStartTime,
      sessionEndTime: resolvedEndTime,
      sessionTimezone: resolvedTimezone,
      ruleEditLockBufferMinutes: intOrNull(values.ruleEditLockBufferMinutes),
      automatedActionsConsentChecked: consentChecked,
    };

    try {
      const res = await fetch("/api/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        applied?: boolean;
        reason?: string;
        message?: string;
        effectiveDate?: string;
        error?: string;
      };
      if (!res.ok) {
        if (res.status === 429) {
          throw new Error("Saving too quickly. Please wait a moment and try again.");
        }
        throw new Error(data.error ?? "Failed to save rules.");
      }
      if (data.applied === false && data.message) {
        // Saved as pending — surface the server's activation message.
        setError(null);
        setPendingMessage(data.message);
        setIsDirty(false);
      } else {
        setPendingMessage(null);
        setSavedAt(new Date());
        setIsDirty(false);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save rules.");
    } finally {
      setSaving(false);
    }
  }

  // Cross-field validation: block save on logically impossible combinations.
  // Note: maxRiskPerTrade is the default-template name for what the account
  // form calls riskPerTrade — same concept, different field key.
  const validationErrors = validateRules({
    maxDailyLoss: values.maxDailyLoss,
    riskPerTrade: values.maxRiskPerTrade,
    maxTradesPerDay: values.maxTradesPerDay,
    stopAfterLosses: values.stopAfterLosses,
  });

  // Enabled when the form has changes, OR when consent needs to be captured.
  const hasSomethingToSave = isDirty || (!hasValidConsent && consentChecked);
  const saveDisabled = saving || !hasSomethingToSave || validationErrors.length > 0;
  const saveLabel = saving ? "Saving…" : (pendingMessage && !isDirty ? "Saved as pending" : (!isDirty && savedAt ? "Saved" : "Save rules"));

  return (
    <form onSubmit={handleSubmit} className="grid gap-6">

      {/* ── Money limits ────────────────────────────────────────────────── */}
      <div role="group" aria-label="Money limits" className="grid gap-4 rounded-2xl border border-stone-100 bg-stone-50/50 p-5">
        <p className="text-sm font-semibold text-stone-950">Money limits</p>
        <div className="grid items-start gap-4 sm:grid-cols-2">
          <Field
            label="Account size ($)"
            pendingNote={pendingFieldNote(pendingPayload, "accountSize", initial.accountSize)}
          >
            <NumberInput value={values.accountSize} onChange={(v) => update("accountSize", v)} placeholder="50000" />
          </Field>
          <Field
            label="Daily loss limit ($)"
            pendingNote={pendingFieldNote(pendingPayload, "maxDailyLoss", initial.maxDailyLoss)}
          >
            <NumberInput value={values.maxDailyLoss} onChange={(v) => update("maxDailyLoss", v)} placeholder="500" />
            {showDailyLossBalanceWarning && (
              <span className="text-xs text-amber-700">
                Exceeds account size. Your loss limit is higher than your stated account balance — the dashboard will show the balance as the effective cap.
              </span>
            )}
          </Field>
          <Field
            label="Daily profit target ($)"
            pendingNote={pendingFieldNote(pendingPayload, "dailyProfitTarget", initial.dailyProfitTarget)}
          >
            <NumberInput value={values.dailyProfitTarget} onChange={(v) => update("dailyProfitTarget", v)} placeholder="1000" />
          </Field>
          <Field
            label="Risk per trade ($)"
            hint="Warning only — does not lock the account."
            pendingNote={pendingFieldNote(pendingPayload, "maxRiskPerTrade", initial.maxRiskPerTrade)}
          >
            <NumberInput value={values.maxRiskPerTrade} onChange={(v) => update("maxRiskPerTrade", v)} placeholder="200" />
          </Field>
        </div>
      </div>

      {/* ── Trading limits ──────────────────────────────────────────────── */}
      <div role="group" aria-label="Trading limits" className="grid gap-4 rounded-2xl border border-stone-100 bg-stone-50/50 p-5">
        <p className="text-sm font-semibold text-stone-950">Trading limits</p>
        <div className="grid items-start gap-4 sm:grid-cols-2">
          <Field
            label="Max trades per day"
            pendingNote={pendingFieldNote(pendingPayload, "maxTradesPerDay", initial.maxTradesPerDay)}
          >
            <NumberInput value={values.maxTradesPerDay} onChange={(v) => update("maxTradesPerDay", v)} placeholder="5" integer />
          </Field>
          <Field
            label="Stop after consecutive losses"
            pendingNote={pendingFieldNote(pendingPayload, "stopAfterLosses", initial.stopAfterLosses)}
          >
            <NumberInput value={values.stopAfterLosses} onChange={(v) => update("stopAfterLosses", v)} placeholder="3" integer />
          </Field>
          <Field
            label={MAX_POSITION_SIZE_COPY.label}
            hint={MAX_POSITION_SIZE_COPY.hint}
            pendingNote={pendingFieldNote(pendingPayload, "maxContracts", initial.maxContracts)}
          >
            <NumberInput value={values.maxContracts} onChange={(v) => update("maxContracts", v)} placeholder="2" integer />
            <MaxPositionSizeConversionTable maxContracts={values.maxContracts} />
          </Field>
        </div>
      </div>

      {/* ── Daily cutoff ─────────────────────────────────────────────────── */}
      <div role="group" aria-label="Daily cutoff" className="grid gap-4 rounded-2xl border border-stone-100 bg-stone-50/50 p-5">
        <div>
          <p className="text-sm font-semibold text-stone-950">{SESSION_WINDOW_COPY.legend}</p>
          <p className="mt-1 text-xs text-stone-500">Set when Guardrail should stop trading for the day. {SESSION_WINDOW_COPY.helperText}</p>
        </div>
        <Field
          label={SESSION_WINDOW_COPY.endLabel}
          hint={SESSION_WINDOW_COPY.endHint}
          pendingNote={pendingFieldNote(pendingPayload, "sessionEndHour", initial.sessionEndHour)}
        >
          <CmeHourSelect
            value={values.sessionEndHour}
            onChange={(v) => update("sessionEndHour", v)}
            ariaLabel={SESSION_WINDOW_COPY.endLabel}
          />
        </Field>
        {(() => {
          const e = intOrNull(values.sessionEndHour);
          if (e === null) return null;
          const boundary = cmeHourBoundaryNote(e);
          const label = tzLabel(timezone);
          const showLocal = label && timezone && timezone !== SESSION_WINDOW_TIMEZONE;
          const le = showLocal ? cmeHourToLocalHour(e, timezone) : null;
          if (!boundary && le === null) return null;
          return (
            <div className="grid gap-1 text-xs text-stone-500">
              {boundary && <p className="text-stone-600">{boundary}</p>}
              {le !== null && (
                <p className="text-stone-400">
                  {SESSION_WINDOW_COPY.localPreviewPrefix}{" "}
                  {String(le).padStart(2, "0")}:00 {label}
                </p>
              )}
            </div>
          );
        })()}
        <div>
          <p className="text-xs font-medium text-stone-600">{SESSION_WINDOW_COPY.cutoffBehaviorLabel}</p>
          <div className="mt-2 grid gap-2">
            {SESSION_END_BEHAVIOR_OPTIONS.map(({ value, label, hint }) => (
              <label
                key={value}
                className="flex items-start gap-3 rounded-xl border border-stone-200 bg-white px-4 py-2.5 text-sm cursor-pointer"
              >
                <input
                  type="radio"
                  name="sessionEndBehavior"
                  value={value}
                  checked={values.sessionEndBehavior === value}
                  onChange={() => update("sessionEndBehavior", value)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-stone-950"
                />
                <span>
                  <span className="font-medium text-stone-950">{label}</span>
                  <span className="mt-0.5 block text-stone-500">{hint}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* ── Notifications ───────────────────────────────────────────────── */}
      <div role="group" aria-label="Notifications" className="grid gap-4 rounded-2xl border border-stone-100 bg-stone-50/50 p-5">
        <p className="text-sm font-semibold text-stone-950">Notifications</p>
        <label className="flex items-start gap-3 rounded-xl border border-stone-200 bg-white px-4 py-2.5 text-sm sm:py-3">
          <input
            type="checkbox"
            checked={values.onBreachWarn}
            onChange={(e) => update("onBreachWarn", e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-stone-300 accent-stone-950"
          />
          <span>
            <span className="font-medium text-stone-950">Send alert when a rule is triggered</span>
            <span className="mt-0.5 block text-stone-500">Coming soon — Guardrail will use this when in-app and Telegram alerts are enabled.</span>
          </span>
        </label>
      </div>

      <TradingSessionSelector
        values={{
          sessionPresets: values.sessionPresets,
          sessionIsCustom: values.sessionIsCustom,
          sessionStartTime: values.sessionStartTime,
          sessionEndTime: values.sessionEndTime,
          sessionTimezone: values.sessionTimezone,
          ruleEditLockBufferMinutes: values.ruleEditLockBufferMinutes,
        }}
        onChange={(key, val) => update(key as keyof RulesFormValues, val as RulesFormValues[keyof RulesFormValues])}
      />

      {/* ── Submit ──────────────────────────────────────────────────────── */}
      <div className="grid gap-2 border-t border-stone-100 pt-6">
        <p className="text-[11px] text-stone-500">
          Rules are saved in Guardrail. Daily loss can trigger broker risk settings on breach. Profit targets are monitored in Guardrail.
        </p>

        {/* Automated-actions consent — required before broker writes can fire
            on any account that uses this default template. Shown until the
            saved record carries a current-version consent timestamp. */}
        {!hasValidConsent && (
          <label className="mt-2 flex cursor-pointer items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
            <input
              type="checkbox"
              checked={consentChecked}
              onChange={(e) => setConsentChecked(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-stone-300 accent-stone-950"
            />
            <span>
              {AUTOMATED_ACTIONS_CONSENT_TEXT}
            </span>
          </label>
        )}

        {validationErrors.length > 0 && (
          <ul className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-800">
            {validationErrors.map((e) => (
              <li key={`${e.field}:${e.message}`}>{e.message}</li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button
            type="submit"
            disabled={saveDisabled}
            className="inline-flex items-center justify-center whitespace-nowrap rounded-full bg-stone-950 px-5 py-2.5 text-sm font-medium text-stone-50 transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-300"
          >
            {saveLabel}
          </button>
          {isDirty && !saving && (
            <span className="text-xs text-amber-600">Unsaved changes</span>
          )}
          {!hasSomethingToSave && !saving && !savedAt && !error && (
            <span className="text-xs text-stone-400">No changes to save.</span>
          )}
          {savedAt && !pendingMessage && !isDirty && (
            <span className="text-xs text-emerald-700">Saved in Guardrail.</span>
          )}
          {pendingMessage && (
            <span className="text-xs text-amber-700">Activation waiting for next safe window.</span>
          )}
          {error && <span className="text-xs text-red-700">{error}</span>}
        </div>
      </div>
    </form>
  );
}

/**
 * Returns a "Pending next safe window: X" hint when the active DB value is
 * empty (null) but the pending payload contains a value for that field.
 * Only surfaces when the active value is truly absent — when a field already
 * has an active value the user can see it directly.
 */
function pendingFieldNote(
  payload: Record<string, unknown> | null | undefined,
  key: string,
  activeValue: string,
): string | null {
  if (!payload || activeValue.trim() !== "") return null;
  const v = payload[key];
  if (v == null) return null;
  return `Active now: Not set · Pending next: ${v}`;
}

function Field({
  label,
  hint,
  pendingNote,
  children,
}: {
  label: string;
  hint?: string;
  pendingNote?: string | null;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-medium text-stone-600">{label}</span>
      {children}
      {hint && <span className="text-xs text-stone-400">{hint}</span>}
      {pendingNote && (
        <span className="text-xs font-medium text-amber-600">{pendingNote}</span>
      )}
    </label>
  );
}

function NumberInput({
  value,
  onChange,
  placeholder,
  integer = false,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  integer?: boolean;
}) {
  return (
    <input
      type="number"
      inputMode={integer ? "numeric" : "decimal"}
      step={integer ? 1 : "any"}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm focus:border-stone-950 focus:outline-none"
    />
  );
}
