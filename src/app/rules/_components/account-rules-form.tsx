"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export type DefaultRuleValues = {
  maxDailyLoss: string;
  riskPerTrade: string;
  maxTradesPerDay: string;
  stopAfterLosses: string;
  allowedStartHour: string;
  allowedEndHour: string;
};

export type AccountRulesValues = {
  maxDailyLoss: string;
  riskPerTrade: string;
  maxTradesPerDay: string;
  stopAfterLosses: string;
  allowedStartHour: string;
  allowedEndHour: string;
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
  initial: AccountRulesValues;
  isLocked: boolean;
  hasPropFirm: boolean;
  hasDefaultRules: boolean;
  timezone?: string | null;
  defaultValues?: DefaultRuleValues;
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

export function AccountRulesForm({
  accountId,
  accountLabel,
  hasExistingRules,
  initial,
  isLocked,
  hasPropFirm,
  hasDefaultRules,
  timezone,
  defaultValues,
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
      rulesLock?: { applied: boolean; message?: string };
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
      const data = await sendPatch({
        riskRules: {
          maxDailyLoss: num(values.maxDailyLoss),
          riskPerTrade: num(values.riskPerTrade),
          maxTradesPerDay: int(values.maxTradesPerDay),
          stopAfterLosses: int(values.stopAfterLosses),
          allowedStartHour: int(values.allowedStartHour),
          allowedEndHour: int(values.allowedEndHour),
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
      });
      if (data.rulesLock?.applied === false && data.rulesLock.message) {
        setPendingMessage(data.rulesLock.message);
      } else {
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
      await sendPatch({ riskRules: null });
      setIsDirty(false);
      router.refresh();
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
      { label: "Session start", value: defaultValues?.allowedStartHour ?? "" },
      { label: "Session end", value: defaultValues?.allowedEndHour ?? "" },
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
          className="self-start rounded-full bg-stone-950 px-5 py-2.5 text-sm font-medium text-stone-50 transition hover:bg-stone-800"
        >
          Create account-specific rules
        </button>
      </div>
    );
  }

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

      {isLocked && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
          Today&apos;s rules are locked. Changes will apply on the next trading day.
        </div>
      )}

      {/* Account limits */}
      <fieldset className="grid gap-3 rounded-2xl border border-stone-100 bg-stone-50/50 p-3 sm:gap-4 sm:p-5">
        <legend className="text-sm font-semibold text-stone-950">Account limits</legend>
        <div className="grid gap-3 sm:grid-cols-2 sm:gap-4">
          <Field label="Daily loss limit ($)">
            <Input value={values.maxDailyLoss} onChange={(v) => update("maxDailyLoss", v)} placeholder="500" />
          </Field>
          <Field label="Risk per trade ($)">
            <Input value={values.riskPerTrade} onChange={(v) => update("riskPerTrade", v)} placeholder="100" />
          </Field>
          <Field label="Max trades per day">
            <Input value={values.maxTradesPerDay} onChange={(v) => update("maxTradesPerDay", v)} placeholder="5" integer />
          </Field>
          <Field label="Stop after consecutive losses">
            <Input value={values.stopAfterLosses} onChange={(v) => update("stopAfterLosses", v)} placeholder="3" integer />
          </Field>
        </div>
      </fieldset>

      {/* Trading window */}
      <fieldset className="grid gap-3 rounded-2xl border border-stone-100 bg-stone-50/50 p-3 sm:gap-4 sm:p-5">
        <legend className="text-sm font-semibold text-stone-950">
          Protected session window{timezone && tzLabel(timezone) ? ` · ${tzLabel(timezone)}` : ""}
        </legend>
        <p className="-mt-2 text-xs text-stone-500">
          Override the default protected session hours for this account. Use 24-hour format (0–23).
        </p>
        <div className="grid gap-3 sm:grid-cols-2 sm:gap-4">
          <Field label="Session start">
            <Input value={values.allowedStartHour} onChange={(v) => update("allowedStartHour", v)} placeholder="9" integer />
          </Field>
          <Field label="Session end">
            <Input value={values.allowedEndHour} onChange={(v) => update("allowedEndHour", v)} placeholder="16" integer />
          </Field>
        </div>
      </fieldset>

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

      {/* Submit row */}
      <div className="grid gap-2 border-t border-stone-100 pt-4 sm:pt-6">
        <p className="text-[11px] text-stone-400">
          Rules target: <span className="font-semibold text-stone-600">{accountLabel}</span>
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={saving || removing}
            className="rounded-full bg-stone-950 px-5 py-2.5 text-sm font-medium text-stone-50 transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-300"
          >
            {saving ? "Saving…" : "Save rules"}
          </button>
          {hasExistingRules && (
            <button
              type="button"
              onClick={handleRemove}
              disabled={saving || removing}
              className="rounded-full border border-stone-200 px-4 py-2.5 text-sm font-medium text-stone-600 transition hover:border-red-300 hover:text-red-700 disabled:opacity-50"
            >
              {removing ? "Removing…" : "Remove account-specific rules"}
            </button>
          )}
          <Link
            href={`/accounts/${accountId}/edit`}
            className="text-xs text-stone-400 underline-offset-2 hover:text-stone-700 hover:underline"
          >
            Full account settings ↗
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
