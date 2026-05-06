"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export type StaticCheck = {
  label: string;
  pass: boolean;
  detail: string;
};

type ActivatedEvent = {
  eventType: string;
  occurredAt: string;
};

const EVENT_TYPE_LABEL: Record<string, string> = {
  trade_closed: "Trade closed",
  trade_opened: "Trade opened",
  daily_pnl_updated: "P&L update",
};

function shortDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

type Props = {
  accountId: string;
  staticChecks: StaticCheck[];
};

export function ConnectionPoller({ accountId, staticChecks }: Props) {
  const router = useRouter();
  const [activated, setActivated] = useState(false);
  const [activatedEvent, setActivatedEvent] = useState<ActivatedEvent | null>(null);

  // Synchronous guard: prevents double-activation if two concurrent poll
  // responses both resolve with a lastEvent before React batches state.
  const activatedRef = useRef(false);
  // Stored so the pending refresh can be cancelled if the component unmounts
  // before the 3.5 s window elapses (e.g. user navigates away).
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const poll = useCallback(async () => {
    if (activatedRef.current) return;
    try {
      const res = await fetch(`/api/accounts/${accountId}/connection-status`);
      if (!res.ok) return;
      const data = (await res.json()) as {
        lastEvent: { eventType: string; occurredAt: string } | null;
      };
      if (data.lastEvent && !activatedRef.current) {
        // Mark synchronously so any concurrent in-flight poll sees it immediately.
        activatedRef.current = true;
        setActivatedEvent(data.lastEvent);
        setActivated(true);
        // Give the user a moment to see the activation state, then let the
        // server-rendered panel take over with a full refresh.
        refreshTimerRef.current = setTimeout(() => router.refresh(), 3_500);
      }
    } catch {
      // Network error — silently retry on next interval.
    }
  }, [accountId, router]);

  useEffect(() => {
    if (activated) return;
    // Poll immediately on mount in case an event arrived since the server render,
    // then continue every 5 seconds.
    void poll();
    const intervalId = setInterval(poll, 5_000);
    return () => {
      clearInterval(intervalId);
      if (refreshTimerRef.current !== null) {
        clearTimeout(refreshTimerRef.current);
      }
    };
  }, [activated, poll]);

  const eventTypeLabel = activatedEvent
    ? (EVENT_TYPE_LABEL[activatedEvent.eventType] ??
        activatedEvent.eventType.replace(/_/g, " "))
    : null;

  const brokerEventsCheck: StaticCheck =
    activated && activatedEvent
      ? {
          label: "Broker events received",
          pass: true,
          detail: `${eventTypeLabel} · ${shortDate(activatedEvent.occurredAt)}`,
        }
      : {
          label: "Broker events received",
          pass: false,
          detail: "Watching...",
        };

  const allChecks = [...staticChecks, brokerEventsCheck];

  const border = activated ? "border-emerald-200" : "border-amber-200";
  const bg = activated ? "bg-emerald-50" : "bg-amber-50";
  const badgeBg = activated ? "bg-emerald-100" : "bg-amber-100";
  const badgeText = activated ? "text-emerald-700" : "text-amber-700";
  const status = activated ? "Account is now live" : "Webhook pending";
  const description = activated
    ? "First event received. Protection rules are now active for this account."
    : "Account ID and rules are configured — watching for the first broker event.";
  const badgeLabel = activated ? "Active" : "Pending";

  return (
    <div className={`rounded-[1.75rem] border ${border} ${bg} p-6 transition-colors duration-500`}>
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">
            Connection readiness
          </p>
          <p className="mt-1 text-lg font-semibold text-stone-950">{status}</p>
          <p className="mt-1 text-sm text-stone-600">{description}</p>
        </div>
        <span
          className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${badgeBg} ${badgeText} transition-colors duration-500`}
        >
          {badgeLabel}
        </span>
      </div>

      <div className="grid gap-2">
        {allChecks.map((check) => {
          const isPendingBroker = check.label === "Broker events received" && !activated;
          return (
            <div key={check.label} className="flex items-baseline gap-3 text-sm">
              <span
                className={`shrink-0 font-semibold transition-colors duration-300 ${
                  check.pass
                    ? "text-emerald-600"
                    : isPendingBroker
                      ? "text-stone-400"
                      : "text-red-500"
                }`}
              >
                {check.pass ? "✓" : isPendingBroker ? "○" : "✗"}
              </span>
              <span className="text-stone-700">
                <span className="font-medium">{check.label}</span>
                <span className="text-stone-500"> — {check.detail}</span>
              </span>
            </div>
          );
        })}
      </div>

      {!activated && (
        <p className="mt-4 flex items-center gap-2 text-xs text-amber-600">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
          Checking every 5 seconds
        </p>
      )}
    </div>
  );
}
