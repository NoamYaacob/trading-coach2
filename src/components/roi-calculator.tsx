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
      <div className="grid gap-5 sm:gap-8 sm:grid-cols-2">
        <div>
          <div className="mb-2 flex items-baseline justify-between sm:mb-3">
            <span className="text-sm font-medium" style={{ color: "var(--gr-text-mid)" }}>Rule breaks per month</span>
            <span className="text-xl font-bold tabular-nums" style={{ color: "var(--gr-ink)" }}>{breaks}</span>
          </div>
          <input
            type="range"
            min={1}
            max={20}
            value={breaks}
            onChange={(e) => setBreaks(Number(e.target.value))}
            className="w-full accent-[var(--gr-ink)]"
            aria-label="Rule breaks per month"
          />
          <div className="mt-1.5 flex justify-between text-xs" style={{ color: "var(--gr-text-mute)" }}>
            <span>1</span>
            <span>20</span>
          </div>
        </div>
        <div>
          <div className="mb-2 flex items-baseline justify-between sm:mb-3">
            <span className="text-sm font-medium" style={{ color: "var(--gr-text-mid)" }}>Average loss per break</span>
            <span className="text-xl font-bold tabular-nums" style={{ color: "var(--gr-ink)" }}>${avgLoss.toLocaleString()}</span>
          </div>
          <input
            type="range"
            min={25}
            max={2000}
            step={25}
            value={avgLoss}
            onChange={(e) => setAvgLoss(Number(e.target.value))}
            className="w-full accent-[var(--gr-ink)]"
            aria-label="Average loss per rule break"
          />
          <div className="mt-1.5 flex justify-between text-xs" style={{ color: "var(--gr-text-mute)" }}>
            <span>$25</span>
            <span>$2,000</span>
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-2xl px-4 py-4 sm:mt-6 sm:px-6 sm:py-6" style={{ background: "var(--gr-ink)" }}>
        <div className="grid gap-2 sm:gap-6 sm:grid-cols-3" style={{ borderColor: "rgba(255,255,255,0.1)" }}>
          <div className="text-center sm:border-r" style={{ borderColor: "rgba(255,255,255,0.12)" }}>
            <p className="font-mono text-[10px] uppercase tracking-[0.22em]" style={{ color: "rgba(243,236,224,0.45)" }}>Monthly damage</p>
            <p className="mt-1 text-3xl font-bold tabular-nums sm:mt-2 sm:text-4xl" style={{ color: "var(--gr-bg)" }}>${monthlyDamage.toLocaleString()}</p>
          </div>
          <div className="text-center sm:border-r sm:pl-6" style={{ borderColor: "rgba(255,255,255,0.12)" }}>
            <p className="font-mono text-[10px] uppercase tracking-[0.22em]" style={{ color: "rgba(243,236,224,0.45)" }}>Yearly damage</p>
            <p className="mt-1 text-3xl font-bold tabular-nums sm:mt-2 sm:text-4xl" style={{ color: "var(--gr-copper-light, #e06d30)" }}>${yearlyDamage.toLocaleString()}</p>
          </div>
          <div className="text-center sm:pl-6">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em]" style={{ color: "rgba(243,236,224,0.45)" }}>Guardrail</p>
            <p className="mt-1 text-3xl font-bold tabular-nums sm:mt-2 sm:text-4xl" style={{ color: "rgba(243,236,224,0.45)" }}>
              $25<span className="text-lg font-normal sm:text-xl" style={{ color: "rgba(243,236,224,0.3)" }}>/mo</span>
            </p>
          </div>
        </div>
        <p className="mt-3 text-center text-sm sm:mt-5" style={{ color: "rgba(243,236,224,0.45)" }}>
          At $25/month,{" "}
          <span style={{ color: "rgba(243,236,224,0.75)" }}>one prevented rule break can cover Guardrail</span>
          {monthlySavings > 0 && (
            <> — and save{" "}
              <span className="font-semibold" style={{ color: "#4ade80" }}>~${monthlySavings.toLocaleString()}</span>
              {" "}every month after that
            </>
          )}
          .
        </p>
      </div>
    </div>
  );
}
