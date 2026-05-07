"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { cmeHourToLocalHour, SESSION_WINDOW_TIMEZONE } from "@/lib/trading-day";
import { SESSION_WINDOW_COPY } from "./session-window-copy";
import { MAX_POSITION_SIZE_COPY } from "./position-size-copy";
import {
  computeAccountRulesBanner,
  REVIEW_INHERITED_HINT,
} from "./account-rules-form-logic";
import { TradingSessionSelector, type TradingSessionValues } from "./trading-session-selector";
import { fmt12h } from "./trading-session-utils";
import { SESSION_PRESETS } from "@/lib/rule-edit-eligibility";

export type DefaultRuleValues = {
  maxDailyLoss: string;
  riskPerTrade: string;
  maxTradesPerDay: string;
  stopAfterLosses: string;
  allowedEndHour: string;
  maxContracts?: string;
};

export type AccountRulesValues = {
  maxDailyLoss: string;
  riskPerTrade: string;
  maxTradesPerDay: string;
  stopAfterLosses: string;
  allowedEndHour: string;
  sessionEndBehavior: string;
  sessionPresets: string[];
  sessionIsCustom: boolean;
  sessionStartTime: string;
  sessionEndTime: string;
  sessionTimezone: string;
  ruleEditLockBufferMinutes: string;
  maxContracts: string;
  propFirmAccountSize: string;
  propFirmPhase: string;
  propFirmDailyLossLimit: string;
  propFirmMaxDrawdown: string;
  propFirmEODDrawdown: string;
  propFirmTrailingDrawdown: boolean;
  propFirmDrawdownRemaining: string;
  propFirmProfitTarget: string;
  propFirmMinTradingDays: string;
};

type Props = {
  accountId: string;
  accountLabel: string;
  hasExistingRules: boolean;
  /** True when the saved rule record has a valid (current-version) automated-
   *  actions consent. When false, the consent checkbox is shown and required
   *  to submit — broker-side enforcement will not fire without it. */
  hasValidConsent: boolean;
  initial: AccountRulesValues;
  isLocked: boolean;
  /** Human-readable message explaining the current lock reason (session-aware). */
  lockMessage?: string | null;
  hasPropFirm: boolean;
  hasDefaultRules: boolean;
  timezone?: string | null;
  defaultValues?: DefaultRuleValues;
  /** Pending payload stored for this account (not yet applied). */
  pendingPayload?: Record<string, unknown> | null;
  pendingEffectiveDate?: string | null;
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

function num(v: string): number | null {
  if (!v.trim()) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function int(v: string): number | null {
  if (!v.trim()) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-medium text-stone-600">{label}</span>
      {children}
      {hint && <span className="text-xs text-stone-400">{hint}</span>}
    </label>
  );
}

function Input({
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

const ACCOUNT_SESSION_END_BEHAVIOR_OPTIONS = [
  {
    value: "wait_for_exit_then_lock",
    label: "Let open trade finish, then lock",
    hint: "Guardrail will not force-close the open trade. After the position is closed, the account is locked for the rest of the day.",
  },
  {
    value: "flatten_at_session_end",
    label: "Flatten at cutoff, then lock",
    hint: "If a trade is still open at the cutoff time, Guardrail will attempt to exit the position and lock the account for the day.",
  },
] as const;

export function AccountRulesForm({
  accountId,
  accountLabel,
  hasExistingRules,
  hasValidConsent,
  initial,
  isLocked,
  lockMessage,
  hasPropFirm,
  hasDefaultRules,
  timezone,
  defaultValues,
  pendingPayload,
  pendingEffectiveDate,
}: Props) {
  const router = useRouter();
  const [values, setValues] = useState<AccountRulesValues>(initial);
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(hasExistingRules);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  const [consentChecked, setConsentChecked] = useState(false);
  const [localPendingPresets, setLocalPendingPresets] = useState<string[] | null>(() => {
    if (!pendingPayload) return null;
    const j = pendingPayload.sessionPresetsJson;
    if (typeof j === "string") return JSON.parse(j) as string[];
    return null;
  });
  const [localPendingDate, setLocalPendingDate] = useState<string | null>(pendingEffectiveDate ?? null);

  // Warn before unload/refresh when there are unsaved changes.
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  function update<K extends keyof AccountRulesValues>(key: K, value: AccountRulesValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
    setIsDirty(true);
    setSavedAt(null);
  }

  async function sendPatch(body: Record<string, unknown>) {
    const res = await fetch(`/api/accounts/${accountId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as {
      rulesLock?: { applied: boolean; message?: string; effectiveDate?: string };
      error?: string;
    };
    if (!res.ok) throw new Error(data.error ?? "Failed to save.");
    return data;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const hasPresets = values.sessionPresets.length > 0;
      const data = await sendPatch({
        riskRules: {
          maxDailyLoss: num(values.maxDailyLoss),
          riskPerTrade: num(values.riskPerTrade),
          maxTradesPerDay: int(values.maxTradesPerDay),
          stopAfterLosses: int(values.stopAfterLosses),
          allowedEndHour: int(values.allowedEndHour),
          sessionEndBehavior: values.sessionEndBehavior || null,
          selectedSessionPresets: hasPresets ? values.sessionPresets : (values.sessionIsCustom ? null : []),
          sessionPreset: values.sessionIsCustom ? "custom" : null,
          sessionStartTime: values.sessionIsCustom ? (values.sessionStartTime.trim() || null) : null,
          sessionEndTime: values.sessionIsCustom ? (values.sessionEndTime.trim() || null) : null,
          sessionTimezone: values.sessionIsCustom ? (values.sessionTimezone.trim() || null) : null,
          ruleEditLockBufferMinutes: values.ruleEditLockBufferMinutes ? parseInt(values.ruleEditLockBufferMinutes, 10) || null : null,
          maxContracts: int(values.maxContracts),
          propFirmAccountSize: num(values.propFirmAccountSize),
          propFirmPhase: values.propFirmPhase.trim() || null,
          propFirmDailyLossLimit: num(values.propFirmDailyLossLimit),
          propFirmMaxDrawdown: num(values.propFirmMaxDrawdown),
          propFirmEODDrawdown: num(values.propFirmEODDrawdown),
          propFirmTrailingDrawdown: values.propFirmTrailingDrawdown,
          propFirmDrawdownRemaining: num(values.propFirmDrawdownRemaining),
          propFirmProfitTarget: num(values.propFirmProfitTarget),
          propFirmMinTradingDays: int(values.propFirmMinTradingDays),
        },
        // Stamp consent only on submissions where the user explicitly checked
        // the box. Re-saves of rules on already-consented accounts pass false
        // and leave the existing consent timestamp intact server-side.
        automatedActionsConsentChecked: consentChecked,
      });
      if (data.rulesLock?.applied === false) {
        const pendingPresets = hasPresets ? values.sessionPresets.slice() : (values.sessionIsCustom ? null : []);
        setLocalPendingPresets(pendingPresets);
        setLocalPendingDate(data.rulesLock.effectiveDate ?? null);
        setPendingMessage("Changes saved as pending — will apply at the next edit window.");
      } else {
        setLocalPendingPresets(null);
        setLocalPendingDate(null);
        setPendingMessage(null);
        setSavedAt(new Date());
      }
      setIsDirty(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    setRemoving(true);
    setError(null);
    try {
      const data = await sendPatch({ riskRules: null });
      setIsDirty(false);
      if (data.rulesLock?.applied === false && data.rulesLock.message) {
        setPendingMessage(data.rulesLock.message);
      } else {
        setPendingMessage("Account-specific rules removed. This account now uses the Default Trading Plan.");
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove.");
    } finally {
      setRemoving(false);
    }
  }

  // No existing rules: show read-only inherited summary + CTA before revealing the form
  if (!showForm) {
    const summaryFields: { label: string; value: string; prefix?: string }[] = [
      { label: "Daily loss limit", value: defaultValues?.maxDailyLoss ?? "", prefix: "$" },
      { label: "Risk per trade", value: defaultValues?.riskPerTrade ?? "", prefix: "$" },
      { label: "Max trades / day", value: defaultValues?.maxTradesPerDay ?? "" },
      { label: "Stop after losses", value: defaultValues?.stopAfterLosses ?? "" },
      { label: "Cutoff time (CME)", value: defaultValues?.allowedEndHour ?? "" },
      { label: "Max position size", value: defaultValues?.maxContracts ?? "" },
    ];
    return (
      <div className="grid gap-4">
        <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          <p className="font-medium">Create account-specific override</p>
          <p className="mt-0.5">
            {hasDefaultRules
              ? `This account currently uses the default template. Saving here will create rules only for ${accountLabel}.`
              : `No default template is set. Saving here will create rules only for ${accountLabel}.`}
          </p>
        </div>

        {hasDefaultRules && defaultValues && (
          <div className="rounded-2xl border border-stone-100 bg-stone-50/50 px-4 py-4">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.15em] text-stone-400">
              Inherited from default template
            </p>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
              {summaryFields.map(({ label, value, prefix }) => (
                <div key={label}>
                  <dt className="text-xs text-stone-400">{label}</dt>
                  <dd className="mt-0.5 text-sm font-medium text-stone-700">
                    {value ? `${prefix ?? ""}${value}` : <span className="text-stone-300">—</span>}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="inline-flex items-center justify-center self-start rounded-full bg-stone-950 px-5 py-2.5 text-sm font-medium text-stone-50 transition hover:bg-stone-800"
        >
          Create account-specific rules
        </button>
      </div>
    );
  }

  const banner = computeAccountRulesBanner(hasExistingRules, isLocked, showForm, lockMessage);

  return (
    <form onSubmit={handleSubmit} className="grid gap-3 sm:gap-5">

      {!hasExistingRules && (
        <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          <p className="font-medium">Create account-specific override</p>
          <p className="mt-0.5">
            {hasDefaultRules
              ? `This account currently uses the default template. Saving here will create rules only for ${accountLabel}.`
              : `No default template is set. Saving here will create rules only for ${accountLabel}.`}
          </p>
        </div>
      )}

      {banner.kind === "first_time" && (
        <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-2.5 text-xs text-sky-800">
          {banner.message}
        </div>
      )}

      {banner.kind === "locked" && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
          {banner.message}
        </div>
      )}

      {/* Account limits */}
      <div role="group" aria-label="Account limits" className="grid gap-3 rounded-2xl border border-stone-100 bg-stone-50/50 p-3 sm:gap-4 sm:p-5">
        <p className="text-sm font-semibold text-stone-950">Account limits</p>
        {!hasExistingRules && (
          <p className="-mt-1 text-xs text-stone-400">{REVIEW_INHERITED_HINT}</p>
        )}
        <div className="grid gap-3 sm:grid-cols-2 sm:gap-4">
          <Field label="Daily loss limit ($)">
            <Input value={values.maxDailyLoss} onChange={(v) => update("maxDailyLoss", v)} placeholder="500" />
          </Field>
          <Field label="Risk per trade ($)" hint="Warning fires when unrealized P&L on an open position exceeds this amount. Does not lock the account.">
            <Input value={values.riskPerTrade} onChange={(v) => update("riskPerTrade", v)} placeholder="100" />
          </Field>
          <Field label="Max trades per day">
            <Input value={values.maxTradesPerDay} onChange={(v) => update("maxTradesPerDay", v)} placeholder="5" integer />
          </Field>
          <Field label="Stop after consecutive losses">
            <Input value={values.stopAfterLosses} onChange={(v) => update("stopAfterLosses", v)} placeholder="3" integer />
          </Field>
        </div>
      </div>

      {/* Daily cutoff */}
      <div role="group" aria-label="Daily cutoff" className="grid gap-3 rounded-2xl border border-stone-100 bg-stone-50/50 p-3 sm:gap-4 sm:p-5">
        <div>
          <p className="text-sm font-semibold text-stone-950">{SESSION_WINDOW_COPY.legend}</p>
          <p className="mt-1 text-xs text-stone-500">
            Override the default daily cutoff for this account.{" "}
            {SESSION_WINDOW_COPY.helperText}
          </p>
        </div>
        <Field label={SESSION_WINDOW_COPY.endLabel} hint="At this time, Guardrail will lock the account for the rest of the trading day.">
          <Input value={values.allowedEndHour} onChange={(v) => update("allowedEndHour", v)} placeholder="16" integer />
        </Field>
        {(() => {
          const e = int(values.allowedEndHour);
          const label = tzLabel(timezone);
          if (e === null || !label || !timezone || timezone === SESSION_WINDOW_TIMEZONE) return null;
          const le = cmeHourToLocalHour(e, timezone);
          if (le === null) return null;
          return (
            <p className="text-xs text-stone-400">
              {SESSION_WINDOW_COPY.localPreviewPrefix}{" "}
              {String(le).padStart(2, "0")}:00 {label}
            </p>
          );
        })()}
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
        onChange={(key, val) => update(key as keyof AccountRulesValues, val as AccountRulesValues[keyof AccountRulesValues])}
      />

      {/* At cutoff */}
      <div role="group" aria-label="At cutoff" className="grid gap-3 rounded-2xl border border-stone-100 bg-stone-50/50 p-3 sm:gap-4 sm:p-5">
        <div>
          <p className="text-sm font-semibold text-stone-950">{SESSION_WINDOW_COPY.cutoffBehaviorLabel}</p>
          <p className="mt-1 text-xs text-stone-500">
            What Guardrail does if a position is open at the cutoff time.
          </p>
        </div>
        <div className="grid gap-2">
          {ACCOUNT_SESSION_END_BEHAVIOR_OPTIONS.map(({ value, label, hint }) => (
            <label
              key={value}
              className="flex cursor-pointer items-start gap-3 rounded-xl border border-stone-200 bg-white px-4 py-2.5 text-sm"
            >
              <input
                type="radio"
                name="accountSessionEndBehavior"
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

      {/* Advanced settings */}
      <details className="group rounded-2xl border border-stone-100 bg-stone-50/50 p-3 sm:p-5">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-semibold text-stone-950">
          Advanced
          <span className="text-xs font-normal text-stone-400 transition-transform group-open:rotate-45">+</span>
        </summary>
        <div className="mt-3 grid gap-3 sm:mt-4 sm:gap-4">
          <Field label={MAX_POSITION_SIZE_COPY.label} hint={MAX_POSITION_SIZE_COPY.hint}>
            <Input value={values.maxContracts} onChange={(v) => update("maxContracts", v)} placeholder="2" integer />
          </Field>
        </div>
      </details>

      {/* Prop firm parameters — collapsible */}
      {hasPropFirm && (
        <details className="group rounded-2xl border border-stone-100 bg-stone-50/50 p-3 sm:p-5">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-semibold text-stone-950">
            Prop firm parameters
            <span className="text-xs font-normal text-stone-400 transition-transform group-open:rotate-45">+</span>
          </summary>
          <div className="mt-3 grid gap-3 sm:mt-5 sm:grid-cols-2 sm:gap-4">
            <Field label="Account size ($)">
              <Input value={values.propFirmAccountSize} onChange={(v) => update("propFirmAccountSize", v)} placeholder="50000" />
            </Field>
            <Field label="Phase" hint="evaluation, funded, pa, sim">
              <input
                type="text"
                value={values.propFirmPhase}
                onChange={(e) => update("propFirmPhase", e.target.value)}
                placeholder="evaluation"
                className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm focus:border-stone-950 focus:outline-none"
              />
            </Field>
            <Field label="Daily loss limit ($)">
              <Input value={values.propFirmDailyLossLimit} onChange={(v) => update("propFirmDailyLossLimit", v)} placeholder="500" />
            </Field>
            <Field label="Max drawdown ($)">
              <Input value={values.propFirmMaxDrawdown} onChange={(v) => update("propFirmMaxDrawdown", v)} placeholder="2000" />
            </Field>
            <Field label="EOD drawdown ($)">
              <Input value={values.propFirmEODDrawdown} onChange={(v) => update("propFirmEODDrawdown", v)} placeholder="1500" />
            </Field>
            <Field label="Drawdown remaining ($)">
              <Input value={values.propFirmDrawdownRemaining} onChange={(v) => update("propFirmDrawdownRemaining", v)} placeholder="1800" />
            </Field>
            <Field label="Profit target ($)">
              <Input value={values.propFirmProfitTarget} onChange={(v) => update("propFirmProfitTarget", v)} placeholder="3000" />
            </Field>
            <Field label="Min trading days">
              <Input value={values.propFirmMinTradingDays} onChange={(v) => update("propFirmMinTradingDays", v)} placeholder="10" integer />
            </Field>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input
                type="checkbox"
                checked={values.propFirmTrailingDrawdown}
                onChange={(e) => update("propFirmTrailingDrawdown", e.target.checked)}
                className="h-4 w-4 rounded border-stone-300 accent-stone-950"
              />
              <span className="font-medium text-stone-950">Trailing drawdown</span>
            </label>
          </div>
        </details>
      )}

      {/* Pending session panel — shown when a locked save introduced a pending preset change */}
      {localPendingPresets !== null && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900 space-y-2">
          <p className="font-medium">Session change pending</p>
          <div className="grid gap-1">
            <p className="text-[11px] text-amber-800">
              <span className="font-medium">Active now: </span>
              {values.sessionPresets.length > 0
                ? SESSION_PRESETS.filter((p) => values.sessionPresets.includes(p.id))
                    .map((p) => `${p.label} (${fmt12h(p.sessionStartTime)}–${fmt12h(p.sessionEndTime)} ET)`)
                    .join(", ")
                : values.sessionIsCustom
                ? "Custom session"
                : "None"}
            </p>
            <p className="text-[11px] text-amber-800">
              <span className="font-medium">Pending{localPendingDate ? ` from ${localPendingDate}` : ""}: </span>
              {localPendingPresets.length > 0
                ? SESSION_PRESETS.filter((p) => localPendingPresets.includes(p.id))
                    .map((p) => `${p.label} (${fmt12h(p.sessionStartTime)}–${fmt12h(p.sessionEndTime)} ET)`)
                    .join(", ")
                : "None (presets cleared)"}
            </p>
          </div>
        </div>
      )}

      {/* Submit row */}
      <div className="grid gap-2 border-t border-stone-100 pt-4 sm:pt-6">
        <p className="text-[11px] text-stone-400">
          Rules target: <span className="font-semibold text-stone-600">{accountLabel}</span>
        </p>

        {/* Automated-actions consent — required before broker writes can fire.
            Shown whenever consent is missing or its version is outdated, not
            just on first save. Existing accounts that pre-date this feature
            see the checkbox until they re-confirm. */}
        {!hasValidConsent && (
          <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
            <input
              type="checkbox"
              checked={consentChecked}
              onChange={(e) => setConsentChecked(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-stone-300 accent-stone-950"
            />
            <span>
              I understand that Guardrail may automatically lock this account and may attempt to close open positions when my configured rules are breached.
            </span>
          </label>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={saving || removing || (!hasValidConsent && !consentChecked)}
            className="inline-flex items-center justify-center whitespace-nowrap rounded-full bg-stone-950 px-5 py-2.5 text-sm font-medium text-stone-50 transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-300"
          >
            {saving ? "Saving…" : "Save rules"}
          </button>
          {hasExistingRules && (
            <button
              type="button"
              onClick={handleRemove}
              disabled={saving || removing}
              className="inline-flex items-center justify-center whitespace-nowrap rounded-full border border-stone-200 px-4 py-2.5 text-sm font-medium text-stone-600 transition hover:border-red-300 hover:text-red-700 disabled:opacity-50"
            >
              {removing ? "Removing…" : "Remove account-specific rules"}
            </button>
          )}
          <Link
            href={`/accounts/${accountId}/edit`}
            className="text-xs text-stone-400 underline-offset-2 hover:text-stone-700 hover:underline"
          >
            Broker connection settings ↗
          </Link>
          {isDirty && !saving && (
            <span className="text-xs text-amber-600">Unsaved changes</span>
          )}
          {savedAt && !pendingMessage && !isDirty && (
            <span className="text-xs text-emerald-700">
              Saved {savedAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}.
            </span>
          )}
          {pendingMessage && <span className="text-xs text-amber-700">{pendingMessage}</span>}
          {error && <span className="text-xs text-red-700">{error}</span>}
        </div>
      </div>
    </form>
  );
}
