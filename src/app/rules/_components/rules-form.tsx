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
};

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

export function RulesForm({ initial, hasBroker }: Props) {
  const router = useRouter();
  const [values, setValues] = useState<RulesFormValues>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

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
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to save rules.");
      setSavedAt(new Date());
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save rules.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-8">

      {/* ── Risk budget ─────────────────────────────────────────────────── */}
      <fieldset className="grid gap-4">
        <legend className="text-sm font-semibold text-stone-950">Account &amp; risk budget</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Account size ($)">
            <NumberInput value={values.accountSize} onChange={(v) => update("accountSize", v)} placeholder="50000" />
          </Field>
          <Field label="Daily loss limit ($)">
            <NumberInput value={values.maxDailyLoss} onChange={(v) => update("maxDailyLoss", v)} placeholder="500" />
          </Field>
          <Field label="Daily profit target ($)" hint="Optional. Locks the session when reached.">
            <NumberInput value={values.dailyProfitTarget} onChange={(v) => update("dailyProfitTarget", v)} placeholder="1000" />
          </Field>
          <Field label="Max risk per trade ($)">
            <NumberInput value={values.maxRiskPerTrade} onChange={(v) => update("maxRiskPerTrade", v)} placeholder="200" />
          </Field>
        </div>
      </fieldset>

      {/* ── Trade limits ────────────────────────────────────────────────── */}
      <fieldset className="grid gap-4">
        <legend className="text-sm font-semibold text-stone-950">Trade limits</legend>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Max trades per day">
            <NumberInput value={values.maxTradesPerDay} onChange={(v) => update("maxTradesPerDay", v)} placeholder="5" integer />
          </Field>
          <Field label="Stop after consecutive losses">
            <NumberInput value={values.stopAfterLosses} onChange={(v) => update("stopAfterLosses", v)} placeholder="3" integer />
          </Field>
          <Field label="Max contracts / position size">
            <NumberInput value={values.maxContracts} onChange={(v) => update("maxContracts", v)} placeholder="2" integer />
          </Field>
        </div>
      </fieldset>

      {/* ── Symbols ─────────────────────────────────────────────────────── */}
      <fieldset className="grid gap-4">
        <legend className="text-sm font-semibold text-stone-950">Allowed symbols</legend>
        <Field label="Symbols" hint="Comma-separated. Leave blank to allow any symbol.">
          <input
            type="text"
            value={values.allowedSymbols}
            onChange={(e) => update("allowedSymbols", e.target.value)}
            placeholder="ES, NQ, MES, MNQ"
            className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm focus:border-stone-950 focus:outline-none"
          />
        </Field>
      </fieldset>

      {/* ── Trading window ──────────────────────────────────────────────── */}
      <fieldset className="grid gap-4">
        <legend className="text-sm font-semibold text-stone-950">Trading window</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Session start (UTC hour, 0–23)">
            <NumberInput value={values.sessionStartHour} onChange={(v) => update("sessionStartHour", v)} placeholder="13" integer />
          </Field>
          <Field label="Session end (UTC hour, 0–23)">
            <NumberInput value={values.sessionEndHour} onChange={(v) => update("sessionEndHour", v)} placeholder="20" integer />
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
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={values.newsLockoutEnabled}
            onChange={(e) => update("newsLockoutEnabled", e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-stone-300 accent-stone-950"
          />
          <span>
            <span className="font-medium text-stone-950">News lockout</span>
            <span className="block text-stone-500">Block trading around high-impact economic events (uses your news policy).</span>
          </span>
        </label>
      </fieldset>

      {/* ── On-breach actions ───────────────────────────────────────────── */}
      <fieldset className="grid gap-4">
        <legend className="text-sm font-semibold text-stone-950">On breach — what happens when a limit is hit</legend>
        <p className="text-xs text-stone-500">
          {hasBroker
            ? "Broker connection detected. Order/position actions will activate when broker enforcement ships."
            : "Manual mode: only Warn and App-level lock are available. Connect a broker to access order and position actions when they ship."}
        </p>
        <div className="grid gap-3">
          <BreachOption
            checked={values.onBreachWarn}
            onChange={(v) => update("onBreachWarn", v)}
            available
            label="Warn only"
            description="Send a warning via in-app banner and Telegram (if connected). No further action."
          />
          <BreachOption
            checked={values.onBreachAppLock}
            onChange={(v) => update("onBreachAppLock", v)}
            available
            label="Lock trading for the day (app-level)"
            description="Mark the session stopped in Guardrail. New trades you log are flagged as breaches. Does not block orders at the broker."
          />
          <BreachOption
            checked={values.onBreachCancelOrders}
            onChange={(v) => update("onBreachCancelOrders", v)}
            available={false}
            label="Cancel open orders at broker"
            description="Auto-cancel working orders via broker API."
          />
          <BreachOption
            checked={values.onBreachFlatten}
            onChange={(v) => update("onBreachFlatten", v)}
            available={false}
            label="Flatten open positions (kill switch)"
            description="Auto-close all open positions via broker API."
          />
        </div>
      </fieldset>

      {/* ── Submit ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 border-t border-stone-100 pt-6">
        <button
          type="submit"
          disabled={saving}
          className="rounded-full bg-stone-950 px-5 py-2.5 text-sm font-medium text-stone-50 transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-300"
        >
          {saving ? "Saving..." : "Save rules"}
        </button>
        {savedAt && (
          <span className="text-xs text-emerald-700">Saved {savedAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}.</span>
        )}
        {error && <span className="text-xs text-red-700">{error}</span>}
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
      className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${
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
              Coming soon
            </span>
          )}
        </div>
        <p className="mt-0.5 text-sm text-stone-600">{description}</p>
      </div>
    </label>
  );
}
