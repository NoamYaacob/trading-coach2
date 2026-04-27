"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type FormState = {
  tradedAt: string;
  symbol: string;
  direction: "LONG" | "SHORT";
  entryPrice: string;
  exitPrice: string;
  stopPrice: string;
  targetPrice: string;
  quantity: string;
  pnl: string;
  riskAmount: string;
  rMultiple: string;
  strategy: string;
  notes: string;
  ruleBreached: boolean;
  breachReason: string;
};

function nowLocalIsoMinute(): string {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 16);
}

function num(v: string): number | null {
  if (v.trim() === "") return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

const INITIAL: FormState = {
  tradedAt: nowLocalIsoMinute(),
  symbol: "",
  direction: "LONG",
  entryPrice: "",
  exitPrice: "",
  stopPrice: "",
  targetPrice: "",
  quantity: "",
  pnl: "",
  riskAmount: "",
  rMultiple: "",
  strategy: "",
  notes: "",
  ruleBreached: false,
  breachReason: "",
};

export function TradeEntryForm() {
  const router = useRouter();
  const [values, setValues] = useState<FormState>(INITIAL);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Derived auto-calc suggestions — only used when user hasn't typed an override.
  const computed = useMemo(() => {
    const entry = num(values.entryPrice);
    const exit = num(values.exitPrice);
    const stop = num(values.stopPrice);
    const qty = num(values.quantity);
    const userPnl = num(values.pnl);
    const userRisk = num(values.riskAmount);

    let suggestedPnl: number | null = null;
    if (entry !== null && exit !== null && qty !== null) {
      const direction = values.direction === "LONG" ? 1 : -1;
      suggestedPnl = (exit - entry) * qty * direction;
    }

    let suggestedRisk: number | null = null;
    if (entry !== null && stop !== null && qty !== null) {
      suggestedRisk = Math.abs(entry - stop) * qty;
    }

    const effectivePnl = userPnl ?? suggestedPnl;
    const effectiveRisk = userRisk ?? suggestedRisk;

    let suggestedR: number | null = null;
    if (effectivePnl !== null && effectiveRisk !== null && effectiveRisk > 0) {
      suggestedR = effectivePnl / effectiveRisk;
    }

    return { suggestedPnl, suggestedRisk, suggestedR };
  }, [
    values.entryPrice,
    values.exitPrice,
    values.stopPrice,
    values.quantity,
    values.direction,
    values.pnl,
    values.riskAmount,
  ]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
    setSuccess(false);
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(false);

    if (!values.symbol.trim()) {
      setError("Symbol is required.");
      setSaving(false);
      return;
    }

    // Use computed values when the user left fields blank.
    const effectivePnl = num(values.pnl) ?? computed.suggestedPnl;
    const effectiveRisk = num(values.riskAmount) ?? computed.suggestedRisk;
    const effectiveR =
      num(values.rMultiple) ??
      (effectivePnl !== null && effectiveRisk !== null && effectiveRisk > 0
        ? effectivePnl / effectiveRisk
        : null);

    const payload = {
      symbol: values.symbol.trim().toUpperCase(),
      direction: values.direction,
      tradedAt: new Date(values.tradedAt).toISOString(),
      entryPrice: num(values.entryPrice),
      exitPrice: num(values.exitPrice),
      stopPrice: num(values.stopPrice),
      targetPrice: num(values.targetPrice),
      quantity: num(values.quantity),
      pnl: effectivePnl,
      riskAmount: effectiveRisk,
      rMultiple: effectiveR,
      strategy: values.strategy.trim() || null,
      notes: values.notes.trim() || null,
      ruleBreached: values.ruleBreached,
      breachReason: values.ruleBreached ? values.breachReason.trim() || null : null,
    };

    try {
      const res = await fetch("/api/journal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) {
        if (res.status === 429) {
          throw new Error("Saving too quickly. Please wait a moment and try again.");
        }
        throw new Error(data.error ?? "Failed to save trade.");
      }
      setSuccess(true);
      setValues({ ...INITIAL, tradedAt: nowLocalIsoMinute() });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save trade.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-6">

      {/* Top: when, what, direction */}
      <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto]">
        <Field label="Trade date / time" required>
          <input
            type="datetime-local"
            required
            value={values.tradedAt}
            onChange={(e) => update("tradedAt", e.target.value)}
            className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm focus:border-stone-950 focus:outline-none"
          />
        </Field>
        <Field label="Symbol" required>
          <input
            type="text"
            required
            value={values.symbol}
            onChange={(e) => update("symbol", e.target.value.toUpperCase())}
            placeholder="ES, NQ, MES..."
            className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm uppercase focus:border-stone-950 focus:outline-none"
          />
        </Field>
        <Field label="Direction">
          <div className="inline-flex rounded-full border border-stone-200 bg-white p-1">
            <button
              type="button"
              onClick={() => update("direction", "LONG")}
              className={`rounded-full px-4 py-1.5 text-xs font-semibold transition ${
                values.direction === "LONG"
                  ? "bg-emerald-600 text-white"
                  : "text-stone-600 hover:text-stone-950"
              }`}
            >
              Long
            </button>
            <button
              type="button"
              onClick={() => update("direction", "SHORT")}
              className={`rounded-full px-4 py-1.5 text-xs font-semibold transition ${
                values.direction === "SHORT"
                  ? "bg-red-600 text-white"
                  : "text-stone-600 hover:text-stone-950"
              }`}
            >
              Short
            </button>
          </div>
        </Field>
      </div>

      {/* Prices */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Entry price">
          <NumberInput value={values.entryPrice} onChange={(v) => update("entryPrice", v)} />
        </Field>
        <Field label="Exit price">
          <NumberInput value={values.exitPrice} onChange={(v) => update("exitPrice", v)} />
        </Field>
        <Field label="Stop price">
          <NumberInput value={values.stopPrice} onChange={(v) => update("stopPrice", v)} />
        </Field>
        <Field label="Target price (optional)">
          <NumberInput value={values.targetPrice} onChange={(v) => update("targetPrice", v)} />
        </Field>
      </div>

      {/* Size + outcome */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Quantity / contracts">
          <NumberInput value={values.quantity} onChange={(v) => update("quantity", v)} />
        </Field>
        <Field
          label="P&L ($)"
          hint={
            computed.suggestedPnl !== null && values.pnl === ""
              ? `Auto: ${computed.suggestedPnl.toFixed(2)}`
              : undefined
          }
        >
          <NumberInput value={values.pnl} onChange={(v) => update("pnl", v)} />
        </Field>
        <Field
          label="Risk amount ($)"
          hint={
            computed.suggestedRisk !== null && values.riskAmount === ""
              ? `Auto: ${computed.suggestedRisk.toFixed(2)}`
              : undefined
          }
        >
          <NumberInput value={values.riskAmount} onChange={(v) => update("riskAmount", v)} />
        </Field>
        <Field
          label="R-multiple"
          hint={
            computed.suggestedR !== null && values.rMultiple === ""
              ? `Auto: ${computed.suggestedR.toFixed(2)}R`
              : undefined
          }
        >
          <NumberInput value={values.rMultiple} onChange={(v) => update("rMultiple", v)} />
        </Field>
      </div>

      {/* Strategy + notes */}
      <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
        <Field label="Strategy (optional)">
          <input
            type="text"
            value={values.strategy}
            onChange={(e) => update("strategy", e.target.value)}
            placeholder="Breakout, mean-reversion..."
            className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm focus:border-stone-950 focus:outline-none"
          />
        </Field>
        <Field label="Notes (optional)">
          <input
            type="text"
            value={values.notes}
            onChange={(e) => update("notes", e.target.value)}
            placeholder="What worked, what didn't..."
            className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm focus:border-stone-950 focus:outline-none"
          />
        </Field>
      </div>

      {/* Rule breach */}
      <div className="grid gap-3 rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={values.ruleBreached}
            onChange={(e) => update("ruleBreached", e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-stone-300 accent-stone-950"
          />
          <span>
            <span className="font-medium text-stone-950">Rule breach</span>
            <span className="block text-stone-500">
              Tag this trade as a rule breach (over-size, over-trading, off-strategy, etc.).
            </span>
          </span>
        </label>
        {values.ruleBreached && (
          <input
            type="text"
            value={values.breachReason}
            onChange={(e) => update("breachReason", e.target.value)}
            placeholder="What rule did this trade break?"
            className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm focus:border-stone-950 focus:outline-none"
          />
        )}
      </div>

      {/* Submit */}
      <div className="flex flex-wrap items-center gap-3 border-t border-stone-100 pt-5">
        <button
          type="submit"
          disabled={saving}
          className="rounded-full bg-stone-950 px-5 py-2.5 text-sm font-medium text-stone-50 transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-300"
        >
          {saving ? "Saving..." : "Save trade"}
        </button>
        {success && <span className="text-xs text-emerald-700">Trade saved.</span>}
        {error && <span className="text-xs text-red-700">{error}</span>}
      </div>
    </form>
  );
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-medium text-stone-600">
        {label}
        {required && <span className="ml-1 text-stone-400">*</span>}
      </span>
      {children}
      {hint && <span className="text-xs text-stone-400">{hint}</span>}
    </label>
  );
}

function NumberInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <input
      type="number"
      step="any"
      inputMode="decimal"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm tabular-nums focus:border-stone-950 focus:outline-none"
    />
  );
}
