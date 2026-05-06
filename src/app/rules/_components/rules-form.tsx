"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cmeHourToLocalHour, SESSION_WINDOW_TIMEZONE } from "@/lib/trading-day";
import { SESSION_WINDOW_COPY } from "./session-window-copy";
import { MAX_POSITION_SIZE_COPY } from "./position-size-copy";

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
};

type Props = {
  initial: RulesFormValues;
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

const SESSION_END_BEHAVIOR_OPTIONS = [
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

export function RulesForm({ initial, timezone }: Props) {
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
      sessionEndHour: intOrNull(values.sessionEndHour),
      sessionEndBehavior: values.sessionEndBehavior || null,
      onBreachWarn: values.onBreachWarn,
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
    <form onSubmit={handleSubmit} className="grid gap-6">

      {/* ── Money limits ────────────────────────────────────────────────── */}
      <div role="group" aria-label="Money limits" className="grid gap-4 rounded-2xl border border-stone-100 bg-stone-50/50 p-5">
        <p className="text-sm font-semibold text-stone-950">Money limits</p>
        <div className="grid gap-4 sm:grid-cols-2">
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
          <Field label="Max risk per trade ($)" hint="Saved for reference. Guardrail does not enforce this limit — use daily loss limit for automated enforcement.">
            <NumberInput value={values.maxRiskPerTrade} onChange={(v) => update("maxRiskPerTrade", v)} placeholder="200" />
          </Field>
        </div>
      </div>

      {/* ── Trading limits ──────────────────────────────────────────────── */}
      <div role="group" aria-label="Trading limits" className="grid gap-4 rounded-2xl border border-stone-100 bg-stone-50/50 p-5">
        <p className="text-sm font-semibold text-stone-950">Trading limits</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Max trades per day">
            <NumberInput value={values.maxTradesPerDay} onChange={(v) => update("maxTradesPerDay", v)} placeholder="5" integer />
          </Field>
          <Field label="Stop after consecutive losses">
            <NumberInput value={values.stopAfterLosses} onChange={(v) => update("stopAfterLosses", v)} placeholder="3" integer />
          </Field>
        </div>
      </div>

      {/* ── Daily cutoff ─────────────────────────────────────────────────── */}
      <div role="group" aria-label="Daily cutoff" className="grid gap-4 rounded-2xl border border-stone-100 bg-stone-50/50 p-5">
        <div>
          <p className="text-sm font-semibold text-stone-950">{SESSION_WINDOW_COPY.legend}</p>
          <p className="mt-1 text-xs text-stone-500">{SESSION_WINDOW_COPY.helperText}</p>
        </div>
        <Field label={SESSION_WINDOW_COPY.endLabel} hint="At this time, Guardrail will lock the account for the rest of the trading day. If a position is open, your selected cutoff behavior applies.">
          <NumberInput value={values.sessionEndHour} onChange={(v) => update("sessionEndHour", v)} placeholder="16" integer />
        </Field>
        {(() => {
          const e = intOrNull(values.sessionEndHour);
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
            <span className="mt-0.5 block text-stone-500">Planned — Guardrail will use this setting when in-app and Telegram alert delivery is enabled.</span>
          </span>
        </label>
      </div>

      {/* ── Advanced settings — hidden by default ────────────────────────── */}
      <details className="group rounded-2xl border border-stone-100 bg-stone-50/50 p-5">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-semibold text-stone-950">
          Advanced
          <span className="text-xs font-normal text-stone-400 transition-transform group-open:rotate-45">+</span>
        </summary>
        <div className="mt-4 grid gap-4">
          <Field label={MAX_POSITION_SIZE_COPY.label} hint={MAX_POSITION_SIZE_COPY.hint}>
            <NumberInput value={values.maxContracts} onChange={(v) => update("maxContracts", v)} placeholder="2" integer />
          </Field>
        </div>
      </details>

      {/* ── Submit ──────────────────────────────────────────────────────── */}
      <div className="grid gap-2 border-t border-stone-100 pt-6">
        <p className="text-[11px] text-stone-400">
          Rules target: <span className="font-semibold text-stone-600">Default template</span>
        </p>
        <p className="text-[11px] text-stone-500">
          Protection rules may trigger automatic lockout according to the limits you set. For accounts with full broker permissions, Guardrail may also attempt to close open positions.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center justify-center whitespace-nowrap rounded-full bg-stone-950 px-5 py-2.5 text-sm font-medium text-stone-50 transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-300"
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

