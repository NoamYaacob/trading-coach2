"use client";

import { useDashboardAutoRefresh } from "./use-dashboard-auto-refresh";

/**
 * Invisible component that keeps Dashboard data fresh while the tab is open.
 * Only rendered when there are active broker accounts to refresh.
 *
 * Does NOT replace the one-shot AutoSync (which fires immediately on load for
 * stale data); this fires every ~30 s and skips when the tab is hidden.
 */
export function DashboardAutoRefresh() {
  useDashboardAutoRefresh();
  return null;
}
