/**
 * Advanced broker actions section card.
 *
 * Informational only. Every action listed here either has a code path that
 * is not safely active in production, or has no wired evaluator/trigger at
 * all. Surfacing them in the form gives traders a transparent answer to
 * "can Guardrail do X?" without ever implying that X is live today.
 *
 * Truth model held by this card:
 *   - PDLL action (broker write on daily-loss breach): rule-save broker write
 *     for Daily Loss is verified on Tradovate demo; listener C1 rerun pending;
 *     C2/C3 NO-GO. As a user-facing toggle this is NOT active today.
 *   - PDPT action (broker write on profit-target breach): the dailyProfitAutoLiq
 *     code path exists but is marked LIVE QA REQUIRED. Not active today.
 *   - Liquidate (order/liquidatepositions): callable but unverified on live.
 *   - Liquidate & block: combined flatten + risk lock; depends on Liquidate.
 *
 * This card MUST NOT render any input or toggle that triggers a broker write.
 * It is purely a transparency surface.
 */
import { RuleStatusBadge } from "../rule-status-badge";

type AdvancedAction = {
  name: string;
  detail: string;
};

const ADVANCED_ACTIONS: ReadonlyArray<AdvancedAction> = [
  {
    name: "PDLL action",
    detail:
      "Personal daily loss limit action — when the daily-loss rule fires, ask Tradovate to enforce the limit broker-side. Planned broker action — not active yet for end users.",
  },
  {
    name: "PDPT action",
    detail:
      "Personal daily profit target action — broker-side enforcement of the profit target. The code path is marked live-QA-required and is not safely active in production.",
  },
  {
    name: "Liquidate",
    detail:
      "Close every open position on the connected Tradovate account via the broker API. Endpoint is reachable but not verified on live accounts; not wired to any user trigger today.",
  },
  {
    name: "Liquidate & block",
    detail:
      "Flatten positions and then write the broker-side daily-loss lock so no new orders can open. Depends on Liquidate verification and broker-write opt-in. Planned only.",
  },
];

/**
 * Advanced broker actions — collapsed by default.
 *
 * Informational only. Every action listed is a planned broker action and must
 * never be presented as live. The card renders no input, button, or onClick —
 * source-scan tests enforce this.
 *
 * Collapsed via <details> with the "Planned" status visible in the summary so
 * users can see at a glance there is nothing to configure here today.
 */
export function AdvancedBrokerActionsSection() {
  return (
    <details
      className="group rounded-2xl border border-stone-200 bg-white/70 px-3 py-2.5 sm:px-4 sm:py-3"
      aria-label="Advanced broker actions"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-stone-700">
        <span className="flex items-center gap-2">
          Advanced broker actions
          <RuleStatusBadge variant="planned-broker" text="Planned" />
        </span>
        <span aria-hidden className="text-stone-400 transition-transform group-open:rotate-45">
          +
        </span>
      </summary>
      <div className="mt-3 grid gap-2">
        <p className="text-xs text-stone-500">
          Broker-side actions Guardrail can perform on your Tradovate account.
          These are not active for end users in this beta.
        </p>
        <ul className="grid gap-1.5">
          {ADVANCED_ACTIONS.map(({ name, detail }) => (
            <li
              key={name}
              className="grid gap-0.5 rounded-xl border border-stone-200 bg-white px-3 py-2"
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-semibold text-stone-700">{name}</span>
                <RuleStatusBadge variant="planned-broker" />
              </div>
              <p className="text-xs text-stone-500">{detail}</p>
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-stone-400">
          Cancel orders, flatten positions, and broker-side order blocking are
          not active in this beta.
        </p>
      </div>
    </details>
  );
}
