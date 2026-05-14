"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

import {
  DASHBOARD_AUTO_REFRESH_MS,
  shouldSkipRefresh,
} from "@/lib/sync-freshness";

/**
 * Interval-based auto-refresh for the Dashboard.
 *
 * Safety properties:
 *  - Skips when the tab is hidden (document.visibilityState === "hidden").
 *  - Does not overlap: if a request is already in flight the next tick is
 *    dropped rather than queued, preventing double-syncs and cascading load.
 *  - Calls /api/accounts/sync-all (server-side; no broker writes from browser).
 *  - Calls router.refresh() after each successful round-trip to re-run Server
 *    Components and pick up fresh data without a full page reload.
 *
 * The interval is configurable via the NEXT_PUBLIC_DASHBOARD_AUTO_REFRESH_MS
 * env var (build-time; silently clamped to 15 s minimum).
 */
export function useDashboardAutoRefresh(
  intervalMs: number = DASHBOARD_AUTO_REFRESH_MS,
) {
  const router = useRouter();
  const routerRef = useRef(router);
  const inFlightRef = useRef(false);

  // Keep routerRef current without resetting the interval.
  useEffect(() => {
    routerRef.current = router;
  });

  useEffect(() => {
    const tick = async () => {
      if (shouldSkipRefresh(document.hidden, inFlightRef.current)) return;

      inFlightRef.current = true;
      try {
        await fetch("/api/accounts/sync-all", { method: "POST" }).catch(
          () => null,
        );
        routerRef.current.refresh();
      } finally {
        inFlightRef.current = false;
      }
    };

    const id = setInterval(() => void tick(), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]); // eslint-disable-line react-hooks/exhaustive-deps
}
