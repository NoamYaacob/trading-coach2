"use client";

import { useState } from "react";

function Counter({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  prefix = "",
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  prefix?: string;
}) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-stone-50/60 px-5 py-4">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">{label}</p>
      <div className="mt-3 flex items-center gap-4">
        <button
          type="button"
          onClick={() => onChange(Math.max(min, value - step))}
          disabled={value <= min}
          aria-label={`Decrease ${label}`}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-stone-200 bg-white text-lg font-medium text-stone-700 transition hover:border-stone-400 hover:text-stone-950 disabled:opacity-40"
        >
          −
        </button>
        <p className="min-w-[5rem] text-center text-2xl font-bold tabular-nums text-stone-950">
          {prefix}{value.toLocaleString()}
        </p>
        <button
          type="button"
          onClick={() => onChange(Math.min(max, value + step))}
          disabled={value >= max}
          aria-label={`Increase ${label}`}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-stone-200 bg-white text-lg font-medium text-stone-700 transition hover:border-stone-400 hover:text-stone-950 disabled:opacity-40"
        >
          +
        </button>
      </div>
    </div>
  );
}

export function RoiCalculator() {
  const [breaks, setBreaks] = useState(4);
  const [avgLoss, setAvgLoss] = useState(150);

  const monthlyLoss = breaks * avgLoss;
  const annualLoss = monthlyLoss * 12;
  const subscriptionCost = 49;
  const monthlySavings = Math.max(0, monthlyLoss - subscriptionCost);
  const breaksToPayOff = Math.ceil(subscriptionCost / avgLoss);

  return (
    <div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Counter
          label="Rule breaks per month"
          value={breaks}
          onChange={setBreaks}
          min={1}
          max={20}
        />
        <Counter
          label="Average loss per break"
          value={avgLoss}
          onChange={setAvgLoss}
          min={25}
          max={2000}
          step={25}
          prefix="$"
        />
      </div>

      <div className="mt-5 rounded-2xl bg-stone-950 px-6 py-6 text-center">
        <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-stone-400">
          You&rsquo;re losing per month
        </p>
        <p className="mt-2 text-5xl font-bold tabular-nums text-stone-50 sm:text-6xl">
          ${monthlyLoss.toLocaleString()}
        </p>
        <p className="mt-2 text-sm text-stone-400">
          ${annualLoss.toLocaleString()} a year from trades you knew you shouldn&rsquo;t take.
        </p>
      </div>

      <div className="mt-4 rounded-2xl border border-stone-100 bg-stone-50 px-5 py-4 text-sm leading-6 text-stone-600">
        Guardrail costs{" "}
        <span className="font-semibold text-stone-950">$49/month</span>. At your numbers, it
        pays for itself after{" "}
        <span className="font-semibold text-amber-700">
          {breaksToPayOff} prevented rule break{breaksToPayOff !== 1 ? "s" : ""}
        </span>
        {monthlySavings > 0 && (
          <>
            {" "}— and saves you{" "}
            <span className="font-semibold text-emerald-700">
              ~${monthlySavings.toLocaleString()}
            </span>{" "}
            every month after that
          </>
        )}
        .
      </div>
    </div>
  );
}
