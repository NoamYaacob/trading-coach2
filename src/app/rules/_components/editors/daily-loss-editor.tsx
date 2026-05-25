"use client";

/**
 * Daily Loss limit — premium selected-rule editor.
 *
 * This is the showcase editor implementing the design's full Daily Loss view:
 *   - Enforcement explainer card (green broker-backed tint when broker-eligible)
 *   - Threshold input row (USD amount, large mono numeric field)
 *   - "About the limit" disclosure (canonical copy from how-enforcement-works
 *     trimmed to the rule's scope)
 *   - Advanced broker-side raw contract cap toggle (existing, preserved)
 *
 * SAFETY: This component only reads/writes the existing `maxDailyLoss` field
 * via the parent's `update()` function. The submit logic, validation, and
 * broker-write opt-in flow all remain in AccountRulesForm — no new write
 * paths, no new API calls, no schema change.
 *
 * The right-hand "live status" / "When triggered" panels from the design are
 * intentionally NOT shown here yet: those require live-session telemetry the
 * editor doesn't currently receive. Surfacing fake numbers would violate the
 * honesty constraints.
 */
import { RuleStatusBadge } from "../rule-status-badge";
import { NumberInput } from "../sections/field-primitives";

type Props = {
  value: string;
  onChange: (v: string) => void;
  /** Optional "default template has X pending" inline note. */
  pendingNote?: string | null;
  disabled?: boolean;
};

export function DailyLossEditor({ value, onChange, pendingNote, disabled }: Props) {
  const numeric = parseFloat(value);
  const hasValue = value.trim() !== "" && Number.isFinite(numeric);

  return (
    <div className="grid gap-4">
      {/* Header */}
      <header className="grid gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <RuleStatusBadge variant="broker-eligible" />
          <span className="rounded-full border border-stone-200 bg-stone-50 px-2 py-[1px] text-[10px] font-medium uppercase tracking-[0.1em] text-stone-500">
            Capital
          </span>
        </div>
        <h2 className="text-xl font-semibold tracking-tight text-stone-950">
          Daily loss limit
        </h2>
        <p className="max-w-2xl text-xs leading-relaxed text-stone-600">
          Stops trading when today&apos;s realised + unrealised P&amp;L falls below this
          loss. On supported Tradovate connections with full access and consent,
          Guardrail can also write this limit to Tradovate&apos;s own risk settings so
          the broker enforces it directly.
        </p>
      </header>

      {/* Enforcement explainer — broker-backed tint */}
      <div className="grid gap-1.5 rounded-2xl border border-emerald-200/80 bg-emerald-50/40 p-3.5">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-emerald-200 bg-emerald-100/60 text-emerald-700">
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-3.5 w-3.5"
              aria-hidden
            >
              <path d="M8 14s5-2 5-7V3l-5-1.5L3 3v4c0 5 5 7 5 7z" />
            </svg>
          </span>
          <div className="grid gap-0.5">
            <p className="text-xs font-semibold text-stone-900">
              Broker-backed eligible
            </p>
            <p className="text-[11px] text-stone-600">
              Only rule Guardrail can write to Tradovate&apos;s broker-side risk
              settings. Opt-in per account; off by default. Without opt-in, the
              limit is enforced inside Guardrail as an app-level lock.
            </p>
          </div>
        </div>
      </div>

      {/* Threshold input */}
      <section className="grid gap-3 rounded-2xl border border-stone-200/80 bg-white p-4 shadow-[0_1px_4px_rgba(41,37,36,0.05)]">
        <div className="grid gap-0.5">
          <h3 className="text-sm font-semibold text-stone-950">Threshold</h3>
          <p className="text-[11px] text-stone-500">
            Loss is measured against today&apos;s session P&amp;L. Reset at session
            close.
          </p>
        </div>

        <div className="grid gap-1.5">
          <label className="text-[11px] font-medium uppercase tracking-[0.08em] text-stone-500">
            Daily loss limit
          </label>
          <div className="flex h-12 items-stretch overflow-hidden rounded-xl border border-stone-200 bg-white transition focus-within:border-amber-500 focus-within:ring-2 focus-within:ring-amber-200/60">
            <span className="flex items-center border-r border-stone-200 bg-amber-50/40 px-3 text-xs font-medium text-stone-500">
              USD
            </span>
            <input
              type="number"
              inputMode="decimal"
              step="any"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              disabled={disabled}
              placeholder="500"
              aria-label="Daily loss limit in USD"
              className="w-full min-w-0 bg-transparent px-3 text-lg font-semibold tabular-nums text-stone-950 focus:outline-none disabled:cursor-not-allowed disabled:text-stone-500"
            />
          </div>
          <p className="text-[11px] text-stone-400">
            Enter the maximum loss for one trading day. The session resets at
            CME close.
          </p>
        </div>

        {pendingNote && (
          <p className="rounded-lg border border-amber-100 bg-amber-50/60 px-3 py-1.5 text-[11px] font-medium text-amber-700">
            {pendingNote}
          </p>
        )}

        {/* Visual scale — purely illustrative, computed from value */}
        {hasValue && (
          <div className="grid gap-1.5 pt-1">
            <div className="flex items-center justify-between text-[10px] tabular-nums text-stone-400">
              <span>$0</span>
              <span>${Math.round(numeric / 2).toLocaleString("en-US")}</span>
              <span className="font-semibold text-stone-700">
                ${numeric.toLocaleString("en-US")}
              </span>
            </div>
            <div className="relative h-1.5 overflow-hidden rounded-full bg-stone-100">
              <div
                className="h-full rounded-full bg-amber-500/70"
                style={{ width: "100%" }}
                aria-hidden
              />
            </div>
            <p className="text-[10px] text-stone-400">
              Locks at <span className="tabular-nums text-stone-700">${numeric.toLocaleString("en-US")}</span> of loss.
            </p>
          </div>
        )}
      </section>

      {/* What happens when limit is reached */}
      <section className="grid gap-2 rounded-2xl border border-stone-200/80 bg-white p-4 shadow-[0_1px_4px_rgba(41,37,36,0.05)]">
        <div className="grid gap-0.5">
          <h3 className="text-sm font-semibold text-stone-950">
            When the limit is reached
          </h3>
          <p className="text-[11px] text-stone-500">
            What Guardrail does on breach today. Broker-side actions need broker
            integration and are not active.
          </p>
        </div>

        {/* Active actions */}
        <div className="grid gap-px overflow-hidden rounded-xl border border-stone-200 bg-white">
          <div className="flex items-center gap-3 px-3 py-2.5">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-3.5 w-3.5" aria-hidden>
                <rect x="3.5" y="7.5" width="9" height="6" rx="1" />
                <path d="M5.5 7.5V5a2.5 2.5 0 015 0v2.5" />
              </svg>
            </div>
            <div className="min-w-0 grow">
              <div className="flex items-center gap-1.5">
                <p className="text-xs font-semibold text-stone-900">Lock account in Guardrail</p>
                <RuleStatusBadge variant="guardrail-lock" compact />
              </div>
              <p className="text-[11px] text-stone-500">
                Guardrail records an internal lock event. Active.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 border-t border-stone-100 px-3 py-2.5">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-amber-200 bg-amber-50 text-amber-700">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-3.5 w-3.5" aria-hidden>
                <path d="M4 11V7a4 4 0 018 0v4l1 1.5H3z" />
                <path d="M6.5 13.5a1.5 1.5 0 003 0" />
              </svg>
            </div>
            <div className="min-w-0 grow">
              <div className="flex items-center gap-1.5">
                <p className="text-xs font-semibold text-stone-900">Notify in-app + Telegram</p>
                <RuleStatusBadge variant="monitoring-only" compact />
              </div>
              <p className="text-[11px] text-stone-500">
                Breach notice on the dashboard; Telegram if connected.
              </p>
            </div>
          </div>
        </div>

        {/* Planned actions */}
        <div className="mt-1.5">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-400">
            Planned · not active
          </p>
          <div className="grid gap-px overflow-hidden rounded-xl border border-dashed border-stone-300 bg-stone-50/40">
            {[
              { title: "Write broker-side daily-loss lock", sub: "PDLL action — opt-in per account" },
              { title: "Auto-flatten open positions", sub: "Market orders sent via broker" },
              { title: "Cancel pending orders", sub: "Working + GTC orders cancelled" },
            ].map((row, i) => (
              <div
                key={row.title}
                className={`flex items-center gap-3 px-3 py-2 ${i > 0 ? "border-t border-stone-200/60" : ""}`}
              >
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-dashed border-stone-300 bg-white text-stone-400">
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-3 w-3" aria-hidden>
                    <path d="M4 4l8 8" />
                    <path d="M12 4l-8 8" />
                  </svg>
                </div>
                <div className="min-w-0 grow">
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs font-medium text-stone-500">{row.title}</p>
                    <RuleStatusBadge variant="planned-broker" compact />
                  </div>
                  <p className="text-[11px] text-stone-400">{row.sub}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

// Re-export NumberInput so the editor pane doesn't need a second import path.
export { NumberInput };
