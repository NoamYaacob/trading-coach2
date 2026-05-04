"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  /** IDs of ConnectedAccounts that need a sync on this page load. */
  staleAccountIds: string[];
};

/**
 * Invisible component that fires a background sync for each stale account on
 * mount and refreshes the page once all syncs complete.
 *
 * Uses a ref so the effect only fires once per mount even across React strict-
 * mode double-invocations, and stops re-triggering after router.refresh()
 * because the component is not unmounted/remounted by a server-component
 * refresh.
 */
export function AutoSync({ staleAccountIds }: Props) {
  const router = useRouter();
  const triggered = useRef(false);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    if (triggered.current) return;
    if (staleAccountIds.length === 0) return;

    triggered.current = true;
    setSyncing(true);

    const syncAll = async () => {
      await Promise.allSettled(
        staleAccountIds.map((id) =>
          fetch(`/api/accounts/${id}/sync`, { method: "POST" }).catch(() => null),
        ),
      );
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
