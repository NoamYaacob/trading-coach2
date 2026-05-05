"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type RulesFormValues = {
  accountSize: string;
  maxDailyLoss: string;
  dailyProfitTarget: string;
  maxRiskPerTrade: string;
  maxTradesPerDay: string;
  stopAfterLosses: string;
  maxContracts: string;
  allowedSymbols: string;
  sessionStartHour: string;
  sessionEndHour: string;
  tradingDays: string[];
  newsLockoutEnabled: boolean;
  onBreachWarn: boolean;
  onBreachAppLock: boolean;
  onBreachCancelOrders: boolean;
  onBreachFlatten: boolean;
};

type Props = {
  initial: RulesFormValues;
  hasBroker: boolean;
  timezone?: string | null;
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

const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const;
type Day = (typeof DAYS)[number];

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

export function RulesForm({ initial, hasBroker, timezone }: Props) {
  const router = useRouter();
  const [values, setValues] = useState<RulesFormValues>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);

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
    setSavedAt(null);
  }

  function toggleDay(day: Day) {
    const next = values.tradingDays.includes(day)
      ? values.tradingDays.filter((d) => d !== day)
      : [...values.tradingDays, day];
    update("tradingDays", next);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const payload = {
      accountSize: numericOrNull(values.accountSize),
      maxDailyLoss: numericOrNull(values.maxDailyLoss),
      dailyProfitTarget: numericOrNull(values.dailyProfitTarget),
      maxRiskPerTrade: numericOrNull(values.maxRiskPerTrade),
      maxTradesPerDay: intOrNull(values.maxTradesPerDay),
      stopAfterLosses: intOrNull(values.stopAfterLosses),
      maxContracts: intOrNull(values.maxContracts),
      allowedSymbols: values.allowedSymbols.trim() || null,
      sessionStartHour: intOrNull(values.sessionStartHour),
      sessionEndHour: intOrNull(values.sessionEndHour),
      tradingDays: values.tradingDays.length > 0 ? values.tradingDays.join(",") : null,
      newsLockoutEnabled: values.newsLockoutEnabled,
      onBreachWarn: values.onBreachWarn,
      onBreachAppLock: values.onBreachAppLock,
      onBreachCancelOrders: values.onBreachCancelOrders,
      onBreachFlatten: values.onBreachFlatten,
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
        // Saved as pending — surface the message to the user instead of
        // pretending the change took effect today.
        setError(null);
        setPendingMessage(data.message);
      } else {
        setPendingMessage(null);
        setSavedAt(new Date());
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save rules.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-3 sm:gap-5">

      {/* ── Money limits ────────────────────────────────────────────────── */}
      <fieldset className="grid gap-3 rounded-2xl border border-stone-100 bg-stone-50/50 p-3 sm:gap-4 sm:p-5">
        <legend className="text-sm font-semibold text-stone-950">Money limits</legend>
        <div className="grid gap-3 sm:gap-4 sm:grid-cols-2">
          <Field label="Account size ($)">
            <NumberInput value={values.accountSize} onChange={(v) => update("accountSize", v)} placeholder="50000" />
          </Field>
          <Field label="Daily loss limit ($)">
            <NumberInput value={values.maxDailyLoss} onChange={(v) => update("maxDailyLoss", v)} placeholder="500" />
            {showDailyLossBalanceWarning && (
              <span className="text-xs text-amber-700">
                Exceeds account size. Your loss limit is higher than your stated account balance — the dashboard will show the balance as the effective cap.
              </span>
            )}
          </Field>
          <Field label="Daily profit target ($)">
            <NumberInput value={values.dailyProfitTarget} onChange={(v) => update("dailyProfitTarget", v)} placeholder="1000" />
          </Field>
          <Field label="Max risk per trade ($)">
            <NumberInput value={values.maxRiskPerTrade} onChange={(v) => update("maxRiskPerTrade", v)} placeholder="200" />
          </Field>
        </div>
      </fieldset>

      {/* ── Trading limits ──────────────────────────────────────────────── */}
      <fieldset className="grid gap-3 rounded-2xl border border-stone-100 bg-stone-50/50 p-3 sm:gap-4 sm:p-5">
        <legend className="text-sm font-semibold text-stone-950">Trading limits</legend>
        <div className="grid gap-3 sm:gap-4 sm:grid-cols-2">
          <Field label="Max trades per day">
            <NumberInput value={values.maxTradesPerDay} onChange={(v) => update("maxTradesPerDay", v)} placeholder="5" integer />
          </Field>
          <Field label="Stop after consecutive losses">
            <NumberInput value={values.stopAfterLosses} onChange={(v) => update("stopAfterLosses", v)} placeholder="3" integer />
          </Field>
        </div>
      </fieldset>

      {/* ── Trading window ──────────────────────────────────────────────── */}
      <fieldset className="grid gap-3 rounded-2xl border border-stone-100 bg-stone-50/50 p-3 sm:gap-4 sm:p-5">
        <legend className="text-sm font-semibold text-stone-950">
          Protected session window{timezone && tzLabel(timezone) ? ` · ${tzLabel(timezone)}` : ""}
        </legend>
        <p className="-mt-2 text-xs text-stone-500">
          The hours when Guardian monitors this account&apos;s rules. Disconnect protection and daily rule progress use this window.
          Use 24-hour format (0–23).
        </p>
        <div className="grid gap-3 sm:gap-4 sm:grid-cols-2">
          <Field label="Session start">
            <NumberInput value={values.sessionStartHour} onChange={(v) => update("sessionStartHour", v)} placeholder="9" integer />
          </Field>
          <Field label="Session end">
            <NumberInput value={values.sessionEndHour} onChange={(v) => update("sessionEndHour", v)} placeholder="16" integer />
          </Field>
        </div>
        <div>
          <p className="text-xs font-medium text-stone-600">Trading days</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {DAYS.map((day) => {
              const active = values.tradingDays.includes(day);
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => toggleDay(day)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                    active
                      ? "border-stone-950 bg-stone-950 text-stone-50"
                      : "border-stone-200 bg-white text-stone-600 hover:border-stone-400"
                  }`}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>
      </fieldset>

      {/* ── Breach actions — main two ────────────────────────────────────── */}
      <fieldset className="grid gap-3 rounded-2xl border border-stone-100 bg-stone-50/50 p-3 sm:gap-4 sm:p-5">
        <legend className="text-sm font-semibold text-stone-950">When a rule is broken</legend>
        <div className="grid gap-2 sm:gap-3">
          <BreachOption
            checked={values.onBreachWarn}
            onChange={(v) => update("onBreachWarn", v)}
            available
            label="Send warning"
            description="In-app banner and Telegram (if connected)."
          />
          <BreachOption
            checked={values.onBreachAppLock}
            onChange={(v) => update("onBreachAppLock", v)}
            available
            label="Mark account locked in Guardrail"
            description="Guardian status only — does not block orders placed directly in Tradovate on read-only connections."
          />
        </div>
      </fieldset>

      {/* ── Advanced settings — hidden by default ────────────────────────── */}
      <details className="group rounded-2xl border border-stone-100 bg-stone-50/50 p-3 sm:p-5">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-semibold text-stone-950">
          Advanced
          <span className="text-xs font-normal text-stone-400 transition-transform group-open:rotate-45">+</span>
        </summary>
        <div className="mt-3 grid gap-4 sm:mt-5 sm:gap-5">
          <Field label="Allowed symbols" hint="Comma-separated. Blank allows any symbol.">
            <input
              type="text"
              value={values.allowedSymbols}
              onChange={(e) => update("allowedSymbols", e.target.value)}
              placeholder="ES, NQ, MES, MNQ"
              className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm focus:border-stone-950 focus:outline-none"
            />
          </Field>
          <Field label="Max contracts / position size">
            <NumberInput value={values.maxContracts} onChange={(v) => update("maxContracts", v)} placeholder="2" integer />
          </Field>
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={values.newsLockoutEnabled}
              onChange={(e) => update("newsLockoutEnabled", e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-stone-300 accent-stone-950"
            />
            <span>
              <span className="font-medium text-stone-950">News lockout</span>
              <span className="block text-stone-500">Warn and mark Guardian locked around high-impact economic events.</span>
            </span>
          </label>
          <div className="grid gap-2">
            <p className="text-sm font-medium text-stone-950">Broker actions</p>
            <p className="text-xs text-stone-500">
              {hasBroker
                ? "Not active · requires verified broker write permissions."
                : "Connect a broker to access these."}
            </p>
            <div className="grid gap-2 sm:gap-3">
              <BreachOption
                checked={values.onBreachCancelOrders}
                onChange={(v) => update("onBreachCancelOrders", v)}
                available={false}
                label="Cancel broker orders"
                description="Auto-cancel working orders."
              />
              <BreachOption
                checked={values.onBreachFlatten}
                onChange={(v) => update("onBreachFlatten", v)}
                available={false}
                label="Flatten broker positions"
                description="Auto-close all open positions."
              />
            </div>
          </div>
        </div>
      </details>

      {/* ── Submit ──────────────────────────────────────────────────────── */}
      <div className="grid gap-2 border-t border-stone-100 pt-4 sm:pt-6">
        <p className="text-[11px] text-stone-400">
          Rules target: <span className="font-semibold text-stone-600">Default template</span>
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded-full bg-stone-950 px-5 py-2.5 text-sm font-medium text-stone-50 transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-300"
          >
            {saving ? "Saving..." : "Save rules"}
          </button>
          {savedAt && !pendingMessage && (
            <span className="text-xs text-emerald-700">Saved {savedAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}.</span>
          )}
          {pendingMessage && (
            <span className="text-xs text-amber-700">{pendingMessage}</span>
          )}
          {error && <span className="text-xs text-red-700">{error}</span>}
        </div>
      </div>
    </form>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-medium text-stone-600">{label}</span>
      {children}
      {hint && <span className="text-xs text-stone-400">{hint}</span>}
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

function BreachOption({
  checked,
  onChange,
  available,
  label,
  description,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  available: boolean;
  label: string;
  description: string;
}) {
  return (
    <label
      className={`flex items-start gap-3 rounded-xl border px-4 py-2.5 sm:py-3 ${
        available
          ? "border-stone-200 bg-white"
          : "border-stone-200 bg-stone-50 opacity-70"
      }`}
    >
      <input
        type="checkbox"
        checked={checked && available}
        disabled={!available}
        onChange={(e) => available && onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-stone-300 accent-stone-950 disabled:cursor-not-allowed"
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-stone-950">{label}</span>
          {!available && (
            <span className="rounded-full bg-stone-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-stone-600">
              Not active
            </span>
          )}
        </div>
        <p className="mt-0.5 text-sm text-stone-600">{description}</p>
      </div>
    </label>
  );
}
