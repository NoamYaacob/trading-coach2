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
 */
export function HowEnforcementWorks() {
  return (
    <details className="group rounded-xl border border-stone-200 bg-stone-50/70 px-4 py-3 text-xs">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold text-stone-700">
        How enforcement works
        <span className="font-normal text-stone-400 transition-transform group-open:rotate-45">
          +
        </span>
      </summary>
      <div className="mt-3 grid gap-2.5 text-pretty text-stone-600">
        <p>
          Guardrail evaluates every rule against your live session and chooses one
          of four states per rule. Each rule on the form below is tagged with the
          state it actually has — no hidden assumptions.
        </p>
        <ul className="grid gap-1.5">
          <li>
            <span className="font-medium text-emerald-700">Broker-backed eligible</span> —
            Daily Loss only. On supported Tradovate connections with full API access,
            the limit can be written to Tradovate&apos;s own risk settings so the broker
            enforces it directly. Off by default; opt-in per account.
          </li>
          <li>
            <span className="font-medium text-red-700">Guardrail lock</span> —
            When the rule breaches, Guardrail marks the account locked inside the app
            and records a lock event. No broker orders are cancelled, blocked, or
            flattened — the lock is app-level only.
          </li>
          <li>
            <span className="font-medium text-stone-700">Monitoring only</span> —
            Warning or display behavior. The rule does not lock the account.
          </li>
          <li>
            <span className="font-medium text-sky-700">Saved · Evaluation coming soon</span> —
            Your value is saved with the plan, but the evaluator that uses it ships
            later. Setting it today has no effect on lock behavior yet.
          </li>
          <li>
            <span className="font-medium text-amber-700">Planned broker action</span> —
            The integration exists but is not safely active in production. Surfaced
            for transparency; not used to lock or modify your broker account today.
          </li>
        </ul>
        <p className="mt-1 text-stone-500">
          Cancel orders, flatten positions, and broker-side order blocking are not
          active in this beta. Telegram alerts and in-app notices are delivered when
          configured. Read-only connections support monitoring and alerts only.
        </p>
      </div>
    </details>
  );
}
