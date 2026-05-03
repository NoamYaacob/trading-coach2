"use client";

import { useState } from "react";

export function RoiCalculator() {
  const [breaks, setBreaks] = useState(4);
  const [avgLoss, setAvgLoss] = useState(150);

  const monthlyDamage = breaks * avgLoss;
  const yearlyDamage = monthlyDamage * 12;
  const monthlySavings = Math.max(0, monthlyDamage - 25);

  return (
    <div>
      <div className="grid gap-8 sm:grid-cols-2">
        <div>
          <div className="mb-3 flex items-baseline justify-between">
            <span className="text-sm font-medium text-stone-700">Rule breaks per month</span>
            <span className="text-xl font-bold tabular-nums text-stone-950">{breaks}</span>
          </div>
          <input
            type="range"
            min={1}
            max={20}
            value={breaks}
            onChange={(e) => setBreaks(Number(e.target.value))}
            className="w-full accent-stone-950"
            aria-label="Rule breaks per month"
          />
          <div className="mt-1.5 flex justify-between text-xs text-stone-400">
            <span>1</span>
            <span>20</span>
          </div>
        </div>
        <div>
          <div className="mb-3 flex items-baseline justify-between">
            <span className="text-sm font-medium text-stone-700">Average loss per break</span>
            <span className="text-xl font-bold tabular-nums text-stone-950">${avgLoss.toLocaleString()}</span>
          </div>
          <input
            type="range"
            min={25}
            max={2000}
            step={25}
            value={avgLoss}
            onChange={(e) => setAvgLoss(Number(e.target.value))}
            className="w-full accent-stone-950"
            aria-label="Average loss per rule break"
          />
          <div className="mt-1.5 flex justify-between text-xs text-stone-400">
            <span>$25</span>
            <span>$2,000</span>
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-2xl bg-stone-950 px-6 py-6">
        <div className="grid gap-6 sm:grid-cols-3 sm:divide-x sm:divide-stone-800">
          <div className="text-center">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-stone-400">Monthly damage</p>
            <p className="mt-2 text-4xl font-bold tabular-nums text-stone-50">${monthlyDamage.toLocaleString()}</p>
          </div>
          <div className="text-center sm:pl-6">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-stone-400">Yearly damage</p>
            <p className="mt-2 text-4xl font-bold tabular-nums text-amber-400">${yearlyDamage.toLocaleString()}</p>
          </div>
          <div className="text-center sm:pl-6">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-stone-400">Guardrail</p>
            <p className="mt-2 text-4xl font-bold tabular-nums text-stone-400">
              $25<span className="text-xl font-normal text-stone-600">/mo</span>
            </p>
          </div>
        </div>
        <p className="mt-5 text-center text-sm text-stone-400">
          At $25/month,{" "}
          <span className="text-stone-200">one prevented rule break can cover Guardrail</span>
          {monthlySavings > 0 && (
            <> — and save{" "}
              <span className="font-semibold text-emerald-400">~${monthlySavings.toLocaleString()}</span>
              {" "}every month after that
            </>
          )}
          .
        </p>
      </div>
    </div>
  );
}
