"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  /**
   * BrokerConnection IDs whose accounts need a sync. Calling the connection
   * endpoint runs discovery (marks missing accounts) before syncing accounts.
   * Takes precedence over staleAccountIds for the same accounts.
   */
  staleConnectionIds: string[];
  /**
   * Fallback: ConnectedAccount IDs that have no BrokerConnection (legacy
   * per-account token rows). Uses the per-account sync endpoint.
   */
  staleAccountIds: string[];
};

/**
 * Invisible component that fires a background sync on mount and refreshes the
 * page once all syncs complete.
 *
 * Prefers the connection-level endpoint (/api/brokers/[id]/sync) which runs
 * discovery first — this is what detects accounts that disappeared from
 * the broker's /account/list and marks them missingFromBrokerSince.
 *
 * Uses a ref so the effect only fires once per mount even across React strict-
 * mode double-invocations.
 */
export function AutoSync({ staleConnectionIds, staleAccountIds }: Props) {
  const router = useRouter();
  const triggered = useRef(false);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    if (triggered.current) return;
    if (staleConnectionIds.length === 0 && staleAccountIds.length === 0) return;

    triggered.current = true;
    setSyncing(true);

    const syncAll = async () => {
      await Promise.allSettled([
        ...staleConnectionIds.map((id) =>
          fetch(`/api/brokers/${id}/sync`, { method: "POST" }).catch(() => null),
        ),
        ...staleAccountIds.map((id) =>
          fetch(`/api/accounts/${id}/sync`, { method: "POST" }).catch(() => null),
        ),
      ]);
      setSyncing(false);
      router.refresh();
    };

    void syncAll();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!syncing) return null;

  return (
    <span
      aria-live="polite"
      className="inline-flex items-center gap-1.5 text-[10px] font-medium text-stone-400"
    >
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-stone-300" aria-hidden />
      Updating data…
    </span>
  );
}
