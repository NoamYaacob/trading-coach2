/**
 * BrokerListenerStatus — displays the real-time WebSocket listener freshness
 * for a connected Tradovate broker account.
 *
 * Replaces generic "Last sync Xm ago" with a listener-aware label:
 *   "Live · 5s ago"              — listener connected, recent event
 *   "Live · waiting…"            — listener connected, no events yet
 *   "Reconnecting…"              — listener is recovering after a disconnect
 *   "Fallback sync · 3m ago"     — no listener, showing last cron sync
 *   "Stale · 13m ago"            — no listener, cron sync overdue
 *
 * Enforcement framing (shown below the freshness label when relevant):
 *   If the account has max_position_size configured:
 *   - Standard-equivalent mode: explains detection-response model
 *   - Raw broker mode: warns that this is a raw contract count
 *
 * This component is display-only. It receives pre-computed data from the
 * server component (BrokerConnection listener fields + lastSyncAt).
 */

"use client";

import {
  computeListenerFreshness,
  type BrokerListenerStatusData,
} from "./broker-listener-status-logic.ts";

export type { BrokerListenerStatusData } from "./broker-listener-status-logic.ts";
export { computeListenerFreshness } from "./broker-listener-status-logic.ts";

// ── Component ────────────────────────────────────────────────────────────────

export function BrokerListenerStatus({ data }: { data: BrokerListenerStatusData }) {
  const freshness = computeListenerFreshness(data);

  return (
    <div className="flex flex-col gap-0.5 text-right">
      {/* Freshness label */}
      <span
        className={[
          "text-xs font-medium",
          freshness.isLive ? "text-emerald-600" : freshness.isStale ? "text-amber-600" : "text-stone-400",
        ].join(" ")}
      >
        {freshness.isLive && (
          <span
            className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-emerald-500"
            aria-hidden
          />
        )}
        {freshness.label}
      </span>

      {/* Enforcement mode note — only when max position size is configured */}
      {data.hasMaxPositionSize && (
        <span className="text-[10px] text-stone-400">
          {data.rawBrokerHardLimitEnabled
            ? "Raw broker reject · counts all contracts equally"
            : "Standard-equiv detection-response · not pre-trade"}
        </span>
      )}
    </div>
  );
}
