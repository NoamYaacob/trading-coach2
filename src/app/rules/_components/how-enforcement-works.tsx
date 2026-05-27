/**
 * Top-of-page "How enforcement works" panel — collapsed by default.
 *
 * This is the single home for the long enforcement-truth disclosure that used
 * to be repeated under every input. Section cards below it stay short; users
 * who want the full picture expand this once.
 *
 * Copy must remain truthful against the verified model:
 *   - Daily Loss is the only rule eligible for broker-side backing.
 *   - Max trades per day, Stop after consecutive losses, and Max position size
 *     create a Guardrail app-level lock — no broker writes.
 *   - Cutoff behavior, contract limits by symbol, and PDLL/PDPT broker actions
 *     are not active today.
 *
 * Phase L: grouped-row layout — no long full-width paragraphs.
 * Each enforcement variant is one tight row: chip label + short description.
 */
export function HowEnforcementWorks() {
  return (
    <details className="group text-xs">
      <summary className="inline-flex w-fit cursor-pointer list-none items-center gap-1.5 text-stone-400 underline-offset-2 hover:text-stone-700 hover:underline">
        <span aria-hidden className="flex h-4 w-4 items-center justify-center rounded-full border border-stone-300 text-[9px] font-semibold">
          ?
        </span>
        <span className="font-medium">How enforcement works</span>
      </summary>

      <div className="mt-2 w-fit max-w-lg rounded-xl border border-stone-200 bg-stone-50/70 px-3 py-2.5">
        <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.15em] text-stone-400">
          What each badge means
        </p>

        <div className="grid gap-px overflow-hidden rounded-lg border border-stone-200 bg-stone-200">

          <div className="flex items-start gap-2.5 bg-white px-3 py-2">
            <span className="mt-0.5 shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-emerald-700">
              Broker-backed eligible
            </span>
            <p className="text-[11px] leading-[1.45] text-stone-600">
              Daily Loss only. On supported Tradovate connections, the limit can be written to the broker&apos;s own risk settings. Off by default; opt-in per account.
            </p>
          </div>

          <div className="flex items-start gap-2.5 bg-white px-3 py-2">
            <span className="mt-0.5 shrink-0 rounded-full border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-indigo-700">
              Guardrail lock
            </span>
            <p className="text-[11px] leading-[1.45] text-stone-600">
              Guardrail marks the account locked inside the app — the lock is app-level only. No broker orders are cancelled or blocked.
            </p>
          </div>

          <div className="flex items-start gap-2.5 bg-white px-3 py-2">
            <span className="mt-0.5 shrink-0 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-amber-700">
              Monitoring only
            </span>
            <p className="text-[11px] leading-[1.45] text-stone-600">
              Warning or display behavior — the rule does not lock the account.
            </p>
          </div>

          <div className="flex items-start gap-2.5 bg-white px-3 py-2">
            <span className="mt-0.5 shrink-0 rounded-full border border-stone-200 bg-stone-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-stone-600">
              Saved · Evaluation coming soon
            </span>
            <p className="text-[11px] leading-[1.45] text-stone-600">
              Value is saved. The evaluator ships later — no effect on lock behavior yet.
            </p>
          </div>

          <div className="flex items-start gap-2.5 bg-white px-3 py-2">
            <span className="mt-0.5 shrink-0 rounded-full border border-dashed border-stone-300 bg-white px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-stone-400">
              Planned broker action
            </span>
            <p className="text-[11px] leading-[1.45] text-stone-500">
              Not safely active in production — not used to lock or modify your broker account today.
            </p>
          </div>

        </div>

        <p className="mt-2 text-[10.5px] text-stone-400">
          Cancel orders, flatten positions, and broker-side order blocking are not active in this beta.
        </p>
      </div>
    </details>
  );
}
