"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import {
  calculateFuturesPnl,
  calculateFuturesRisk,
  getInstrumentSpec,
  isValidFuturesQuantity,
  isValidTickPrice,
  type FuturesSpec,
} from "@/lib/instruments";
import { getProfile } from "@/lib/program-rules";
import {
  getSymbolStatus,
  validateSymbolForProgram,
  validateTradeTime,
  type ProductValidation,
} from "@/lib/product-validation";

type ValidationWarning = {
  field: keyof FormState;
  message: string;
  severity: "warning" | "error";
};

type FormState = {
  tradedAt: string;
  symbol: string;
  direction: "LONG" | "SHORT";
  entryPrice: string;
  exitPrice: string;
  stopPrice: string;
  targetPrice: string;
  quantity: string;
  netPnl: string;
  fees: string;
  riskAmount: string;
  rMultiple: string;
  strategy: string;
  notes: string;
  ruleBreached: boolean;
  breachReason: string;
  overrideCalculated: boolean;
};

function fmtDollar(n: number): string {
  const abs = Math.abs(n);
  const formatted = Number.isInteger(abs)
    ? abs.toLocaleString("en-US")
    : abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `−$${formatted}` : `$${formatted}`;
}

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

// Formats "YYYY-MM-DDTHH:MM" as "Apr 29, 2026 · 8:59 AM" using en-US locale,
// bypassing the device locale that causes Hebrew/RTL rendering on iOS.
function formatDateForDisplay(isoStr: string): string {
  if (!isoStr) return "";
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return isoStr;
  const datePart = new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", year: "numeric",
  }).format(d);
  const timePart = new Intl.DateTimeFormat("en-US", {
    hour: "numeric", minute: "2-digit",
  }).format(d);
  return `${datePart} · ${timePart}`;
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
  netPnl: "",
  fees: "",
  riskAmount: "",
  rMultiple: "",
  strategy: "",
  notes: "",
  ruleBreached: false,
  breachReason: "",
  overrideCalculated: false,
};

const INPUT_CLS =
  "w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm focus:border-stone-950 focus:outline-none";

export function TradeEntryForm({
  tradeId,
  initialValues,
  onSaved,
  onCancel,
}: {
  tradeId?: string;
  initialValues?: Partial<FormState>;
  onSaved?: () => void;
  onCancel?: () => void;
} = {}) {
  const router = useRouter();
  const [values, setValues] = useState<FormState>({ ...INITIAL, ...initialValues });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const isEditMode = Boolean(tradeId);

  const computed = useMemo(() => {
    const symbolUpper = values.symbol.trim().toUpperCase();
    const spec = getInstrumentSpec(symbolUpper);
    const futuresSpec: FuturesSpec | null = spec?.kind === "futures" ? spec : null;

    const entry = num(values.entryPrice);
    const exit = num(values.exitPrice);
    const stop = num(values.stopPrice);
    const qty = num(values.quantity);
    const userNetPnl = num(values.netPnl);
    const userRisk = num(values.riskAmount);
    const fees = num(values.fees) ?? 0;
    const overrideCalculated = values.overrideCalculated;

    const warnings: ValidationWarning[] = [];

    // Program-aware product/time validation. Default profile is "generic
    // futures" until the user picks a prop-firm profile elsewhere.
    const profile = getProfile(null);
    const symbolStatus = getSymbolStatus(symbolUpper);
    const programValidations: ProductValidation[] = symbolUpper === ""
      ? []
      : validateSymbolForProgram(symbolUpper, profile);
    const productForTime = symbolStatus.kind === "recognized_with_specs" || symbolStatus.kind === "recognized_no_specs"
      ? symbolStatus.product
      : null;
    const tradedAtDate = (() => {
      if (!values.tradedAt) return null;
      const d = new Date(values.tradedAt);
      return Number.isNaN(d.getTime()) ? null : d;
    })();
    const timeValidations: ProductValidation[] = tradedAtDate
      ? validateTradeTime(tradedAtDate, productForTime, profile)
      : [];

    const symbolHint = (() => {
      if (symbolUpper === "") return undefined;
      if (symbolStatus.kind === "recognized_with_specs" && futuresSpec) {
        return `${futuresSpec.name} · $${futuresSpec.pointValue}/pt · ${futuresSpec.tickSize} tick`;
      }
      // For other states, fall back to the most relevant program validation
      // message so we don't double up with the banner.
      const first = programValidations[0];
      return first?.message;
    })();

    if (futuresSpec) {
      if (entry !== null && !isValidTickPrice(entry, futuresSpec.tickSize)) {
        warnings.push({ field: "entryPrice", message: `Must be a multiple of ${futuresSpec.tickSize} (${futuresSpec.symbol} tick).`, severity: "error" });
      }
      if (exit !== null && !isValidTickPrice(exit, futuresSpec.tickSize)) {
        warnings.push({ field: "exitPrice", message: `Must be a multiple of ${futuresSpec.tickSize} (${futuresSpec.symbol} tick).`, severity: "error" });
      }
      if (stop !== null && !isValidTickPrice(stop, futuresSpec.tickSize)) {
        warnings.push({ field: "stopPrice", message: `Must be a multiple of ${futuresSpec.tickSize} (${futuresSpec.symbol} tick).`, severity: "error" });
      }
      if (qty !== null && !isValidFuturesQuantity(qty)) {
        warnings.push({ field: "quantity", message: "Futures contracts must be a positive whole number.", severity: "error" });
      }
    }

    // Gross P&L = raw contract math (always tick-aligned for known futures)
    let grossPnl: number | null = null;
    if (entry !== null && exit !== null && qty !== null) {
      if (futuresSpec) {
        grossPnl = calculateFuturesPnl({ spec: futuresSpec, direction: values.direction, entryPrice: entry, exitPrice: exit, quantity: qty });
      } else {
        const sign = values.direction === "LONG" ? 1 : -1;
        grossPnl = (exit - entry) * qty * sign;
      }
    }

    // Expected net P&L = gross − fees (fees default to 0 when blank)
    const suggestedPnl = grossPnl !== null ? grossPnl - fees : null;

    let suggestedRisk: number | null = null;
    if (entry !== null && stop !== null && qty !== null) {
      if (futuresSpec) {
        suggestedRisk = calculateFuturesRisk({ spec: futuresSpec, entryPrice: entry, stopPrice: stop, quantity: qty });
      } else {
        suggestedRisk = Math.abs(entry - stop) * qty;
      }
    }

    const pnlMismatch = futuresSpec !== null && userNetPnl !== null && suggestedPnl !== null && Math.abs(userNetPnl - suggestedPnl) > 0.01;
    const riskMismatch = futuresSpec !== null && userRisk !== null && suggestedRisk !== null && Math.abs(userRisk - suggestedRisk) > 0.01;

    if (pnlMismatch) {
      const feesPart = fees !== 0 ? ` after ${fmtDollar(fees)} fees` : "";
      warnings.push({
        field: "netPnl",
        message: `Expected net P&L is ${fmtDollar(suggestedPnl!)}${feesPart}. You entered ${fmtDollar(userNetPnl!)}.`,
        severity: overrideCalculated ? "warning" : "error",
      });
    }

    if (riskMismatch) {
      warnings.push({
        field: "riskAmount",
        message: `Expected risk from entry, stop, and quantity is ${fmtDollar(suggestedRisk!)}. You entered ${fmtDollar(userRisk!)}.`,
        severity: overrideCalculated ? "warning" : "error",
      });
    }

    // R uses net P&L (after fees) so the trader sees actual return on risk
    const effectivePnl = userNetPnl ?? suggestedPnl;
    const effectiveRisk = userRisk ?? suggestedRisk;

    let suggestedR: number | null = null;
    if (effectivePnl !== null && effectiveRisk !== null && effectiveRisk > 0) {
      suggestedR = effectivePnl / effectiveRisk;
    }

    const hasBlockingError = warnings.some((w) => w.severity === "error");
    const showOverride = pnlMismatch || riskMismatch;
    const feesHint = pnlMismatch && fees === 0
      ? "Net P&L can differ from gross P&L only if fees or manual adjustments are entered."
      : undefined;

    return {
      grossPnl,
      suggestedPnl,
      suggestedRisk,
      suggestedR,
      warnings,
      symbolHint,
      hasBlockingError,
      showOverride,
      feesHint,
      isFutures: futuresSpec !== null,
      programValidations,
      timeValidations,
    };
  }, [
    values.symbol,
    values.entryPrice,
    values.exitPrice,
    values.stopPrice,
    values.quantity,
    values.direction,
    values.netPnl,
    values.fees,
    values.riskAmount,
    values.overrideCalculated,
    values.tradedAt,
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

    const effectivePnl = num(values.netPnl) ?? computed.suggestedPnl;
    const effectiveRisk = num(values.riskAmount) ?? computed.suggestedRisk;
    const effectiveR =
      num(values.rMultiple) ??
      (effectivePnl !== null && effectiveRisk !== null && effectiveRisk > 0
        ? effectivePnl / effectiveRisk
        : null);

    const pnlSourceVal: string | null =
      effectivePnl === null
        ? null
        : num(values.netPnl) !== null
          ? values.overrideCalculated ? "override" : "manual"
          : "calculated";

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
      fees: num(values.fees),
      grossPnl: computed.grossPnl,
      pnlSource: pnlSourceVal,
      riskAmount: effectiveRisk,
      rMultiple: effectiveR,
      strategy: values.strategy.trim() || null,
      notes: values.notes.trim() || null,
      ruleBreached: values.ruleBreached,
      breachReason: values.ruleBreached ? values.breachReason.trim() || null : null,
    };

    try {
      const url = isEditMode ? `/api/journal/${tradeId}` : "/api/journal";
      const method = isEditMode ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
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
      if (isEditMode) {
        router.refresh();
        onSaved?.();
      } else {
        setValues({ ...INITIAL, tradedAt: nowLocalIsoMinute() });
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save trade.");
    } finally {
      setSaving(false);
    }
  }

  function fieldWarning(field: keyof FormState): ValidationWarning | undefined {
    return computed.warnings.find((w) => w.field === field);
  }

  const pnlHint =
    computed.suggestedPnl !== null && values.netPnl === ""
      ? `Auto: ${computed.suggestedPnl.toFixed(2)}`
      : "After commissions and fees.";
  const riskHint =
    computed.suggestedRisk !== null && values.riskAmount === ""
      ? `Auto: ${computed.suggestedRisk.toFixed(2)}`
      : undefined;
  const rHint =
    computed.suggestedR !== null && values.rMultiple === ""
      ? `Auto: ${computed.suggestedR.toFixed(2)}R`
      : undefined;

  return (
    <form onSubmit={handleSubmit} className="grid gap-4 sm:gap-6">

      {/* Row 1: date/time + symbol + direction — same on all screen sizes */}
      <div className="grid gap-3 sm:gap-4 sm:grid-cols-[1fr_1fr_auto]">
        <Field label="Trade date / time" required>
          {/* Mobile: display div is the visual base; opacity-0 absolute input sits
              on top to intercept touches and open the native picker without showing
              any iOS/Hebrew-locale-formatted text (opacity:0 suppresses all native
              rendering, unlike color:transparent which iOS bypasses). */}
          <div className="relative md:hidden">
            <div className={`${INPUT_CLS} select-none`} aria-hidden="true">
              {formatDateForDisplay(values.tradedAt)}
            </div>
            <input
              type="datetime-local"
              dir="ltr"
              required
              value={values.tradedAt}
              onChange={(e) => update("tradedAt", e.target.value)}
              className="absolute inset-0 w-full cursor-pointer opacity-0"
            />
          </div>
          {/* Desktop: standard datetime-local, unchanged */}
          <input
            type="datetime-local"
            dir="ltr"
            required
            value={values.tradedAt}
            onChange={(e) => update("tradedAt", e.target.value)}
            className={`${INPUT_CLS} hidden md:block`}
          />
        </Field>
        <Field label="Symbol" required hint={computed.symbolHint}>
          <input
            type="text"
            required
            value={values.symbol}
            onChange={(e) => update("symbol", e.target.value.toUpperCase())}
            placeholder="ES, NQ, MES..."
            className={`${INPUT_CLS} uppercase`}
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

      {/* ── Mobile layout ────────────────────────────────────────────────── */}

      {/* Mobile required: quantity + net P&L */}
      <div className="grid grid-cols-2 gap-3 md:hidden">
        <Field label="Quantity / contracts" warning={fieldWarning("quantity")}>
          <NumberInput value={values.quantity} onChange={(v) => update("quantity", v)} />
        </Field>
        <Field label="Net P&L ($)" hint={pnlHint} warning={fieldWarning("netPnl")}>
          <NumberInput value={values.netPnl} onChange={(v) => update("netPnl", v)} />
        </Field>
      </div>

      {/* Mobile: fees visible immediately for known futures (affects P&L validation) */}
      {computed.isFutures && (
        <div className="md:hidden">
          <Field label="Fees / commissions" hint={computed.feesHint}>
            <NumberInput value={values.fees} onChange={(v) => update("fees", v)} placeholder="e.g. 6.00" />
          </Field>
        </div>
      )}

      {/* Mobile optional: collapsible More trade details */}
      <details className="group rounded-2xl border border-stone-100 bg-stone-50/60 px-4 py-3 md:hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-medium text-stone-700">
          More trade details
          <span className="text-xs text-stone-400 transition-transform group-open:rotate-45">+</span>
        </summary>
        <div className="mt-4 grid gap-4">

          {/* Prices 2×2 */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Entry price" warning={fieldWarning("entryPrice")}>
              <NumberInput value={values.entryPrice} onChange={(v) => update("entryPrice", v)} />
            </Field>
            <Field label="Exit price" warning={fieldWarning("exitPrice")}>
              <NumberInput value={values.exitPrice} onChange={(v) => update("exitPrice", v)} />
            </Field>
            <Field label="Stop price" warning={fieldWarning("stopPrice")}>
              <NumberInput value={values.stopPrice} onChange={(v) => update("stopPrice", v)} />
            </Field>
            <Field label="Target price">
              <NumberInput value={values.targetPrice} onChange={(v) => update("targetPrice", v)} />
            </Field>
          </div>

          {/* Fees (in collapsible for non-futures; for futures it's shown above the collapsible) */}
          {!computed.isFutures && (
            <Field label="Fees / commissions">
              <NumberInput value={values.fees} onChange={(v) => update("fees", v)} placeholder="e.g. 6.00" />
            </Field>
          )}

          {/* Risk + R */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Risk ($)" hint={riskHint} warning={fieldWarning("riskAmount")}>
              <NumberInput value={values.riskAmount} onChange={(v) => update("riskAmount", v)} />
            </Field>
            <Field label="R-multiple" hint={rHint}>
              <NumberInput value={values.rMultiple} onChange={(v) => update("rMultiple", v)} />
            </Field>
          </div>

          {/* Strategy + notes */}
          <Field label="Strategy">
            <input
              type="text"
              value={values.strategy}
              onChange={(e) => update("strategy", e.target.value)}
              placeholder="Breakout, mean-reversion..."
              className={INPUT_CLS}
            />
          </Field>
          <Field label="Notes">
            <input
              type="text"
              value={values.notes}
              onChange={(e) => update("notes", e.target.value)}
              placeholder="What worked, what didn't..."
              className={INPUT_CLS}
            />
          </Field>

          {/* Rule breach */}
          <div className="grid gap-3 rounded-2xl border border-stone-200 bg-white px-4 py-3">
            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                checked={values.ruleBreached}
                onChange={(e) => update("ruleBreached", e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-stone-300 accent-stone-950"
              />
              <span>
                <span className="font-medium text-stone-950">Rule breach</span>
                <span className="block text-stone-500">Tag this trade as a rule breach.</span>
              </span>
            </label>
            {values.ruleBreached && (
              <input
                type="text"
                value={values.breachReason}
                onChange={(e) => update("breachReason", e.target.value)}
                placeholder="What rule did this trade break?"
                className={INPUT_CLS}
              />
            )}
          </div>

        </div>
      </details>

      {/* ── Desktop layout ─────────────────────────────────────────────────── */}
      <div className="hidden md:grid gap-6">

        {/* Prices */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Entry price" warning={fieldWarning("entryPrice")}>
            <NumberInput value={values.entryPrice} onChange={(v) => update("entryPrice", v)} />
          </Field>
          <Field label="Exit price" warning={fieldWarning("exitPrice")}>
            <NumberInput value={values.exitPrice} onChange={(v) => update("exitPrice", v)} />
          </Field>
          <Field label="Stop price" warning={fieldWarning("stopPrice")}>
            <NumberInput value={values.stopPrice} onChange={(v) => update("stopPrice", v)} />
          </Field>
          <Field label="Target price (optional)">
            <NumberInput value={values.targetPrice} onChange={(v) => update("targetPrice", v)} />
          </Field>
        </div>

        {/* Size + outcome */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Quantity / contracts" warning={fieldWarning("quantity")}>
            <NumberInput value={values.quantity} onChange={(v) => update("quantity", v)} />
          </Field>
          <Field label="Net P&L ($)" hint={pnlHint} warning={fieldWarning("netPnl")}>
            <NumberInput value={values.netPnl} onChange={(v) => update("netPnl", v)} />
          </Field>
          <Field label="Fees / commissions" hint={computed.feesHint}>
            <NumberInput value={values.fees} onChange={(v) => update("fees", v)} placeholder="e.g. 6.00" />
          </Field>
          <Field label="Risk amount ($)" hint={riskHint} warning={fieldWarning("riskAmount")}>
            <NumberInput value={values.riskAmount} onChange={(v) => update("riskAmount", v)} />
          </Field>
          <Field label="R-multiple" hint={rHint}>
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
              className={INPUT_CLS}
            />
          </Field>
          <Field label="Notes (optional)">
            <input
              type="text"
              value={values.notes}
              onChange={(e) => update("notes", e.target.value)}
              placeholder="What worked, what didn't..."
              className={INPUT_CLS}
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
              className={INPUT_CLS}
            />
          )}
        </div>

      </div>

      {/* Program / time advisories — only the program validations not already
          surfaced as the symbol hint, plus any time-based warnings. */}
      <ProgramAdvisories
        programValidations={
          // The symbol hint already shows the first program validation; skip it.
          computed.programValidations.slice(computed.symbolHint ? 1 : 0)
        }
        timeValidations={computed.timeValidations}
      />

      {/* Override calculated values — appears only when a futures mismatch is detected */}
      {computed.showOverride && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={values.overrideCalculated}
              onChange={(e) => update("overrideCalculated", e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-stone-300 accent-stone-950"
            />
            <span>
              <span className="font-medium text-stone-950">Override calculated values</span>
              <span className="block text-stone-500">
                Use only if broker fees, commissions, or manual adjustments make the calculated values different.
              </span>
            </span>
          </label>
        </div>
      )}

      {/* Submit */}
      <div className="flex flex-wrap items-center gap-3 border-t border-stone-100 pt-4 sm:pt-5">
        <button
          type="submit"
          disabled={saving || computed.hasBlockingError}
          className="rounded-full bg-stone-950 px-5 py-2.5 text-sm font-medium text-stone-50 transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-300"
        >
          {saving ? "Saving..." : isEditMode ? "Update trade" : "Save trade"}
        </button>
        {isEditMode && onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full border border-stone-200 px-5 py-2.5 text-sm font-medium text-stone-600 transition hover:bg-stone-50"
          >
            Cancel
          </button>
        )}
        {success && <span className="text-xs text-emerald-700">{isEditMode ? "Trade updated." : "Trade saved."}</span>}
        {error && <span className="text-xs text-red-700">{error}</span>}
      </div>
    </form>
  );
}

function ProgramAdvisories({
  programValidations,
  timeValidations,
}: {
  programValidations: ProductValidation[];
  timeValidations: ProductValidation[];
}) {
  const items = [...programValidations, ...timeValidations];
  if (items.length === 0) return null;
  const tone = (level: ProductValidation["level"]) =>
    level === "error"
      ? "border-red-200 bg-red-50 text-red-700"
      : level === "warning"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-stone-200 bg-stone-50 text-stone-600";
  return (
    <div className="grid gap-2">
      {items.map((v, i) => (
        <div key={`${v.code}-${i}`} className={`rounded-xl border px-3 py-2 text-xs ${tone(v.level)}`}>
          {v.message}
        </div>
      ))}
    </div>
  );
}

function Field({
  label,
  hint,
  warning,
  required,
  children,
}: {
  label: string;
  hint?: string;
  warning?: ValidationWarning;
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
      {warning ? (
        <span className={`text-xs ${warning.severity === "error" ? "text-red-600" : "text-amber-600"}`}>
          {warning.message}
        </span>
      ) : hint ? (
        <span className="text-xs text-stone-400">{hint}</span>
      ) : null}
    </label>
  );
}

function NumberInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="number"
      step="any"
      inputMode="decimal"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm tabular-nums focus:border-stone-950 focus:outline-none"
    />
  );
}
