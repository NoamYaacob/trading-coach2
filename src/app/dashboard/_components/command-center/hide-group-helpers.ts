import type { CommandCenterFirmGroup } from "./types";

// Pure helpers powering the dashboard "Hide group" feature. No DOM, no fetch
// — kept side-effect-free so they can be unit-tested without a React renderer.
//
// Hiding is a UI-only preference. None of these helpers touch sync, webhooks,
// trade counts, enforcement, or any account identity — they only partition
// the existing groups array into "visible" and "hidden" buckets.

export function applyHide(hiddenIds: readonly string[], groupId: string): string[] {
  if (hiddenIds.includes(groupId)) return [...hiddenIds];
  return [...hiddenIds, groupId];
}

export function applyUnhide(hiddenIds: readonly string[], groupId: string): string[] {
  return hiddenIds.filter((id) => id !== groupId);
}

export function partitionGroups(
  groups: readonly CommandCenterFirmGroup[],
  hiddenIds: ReadonlySet<string>,
): { visible: CommandCenterFirmGroup[]; hidden: CommandCenterFirmGroup[] } {
  const visible: CommandCenterFirmGroup[] = [];
  const hidden: CommandCenterFirmGroup[] = [];
  for (const group of groups) {
    if (hiddenIds.has(group.groupId)) hidden.push(group);
    else visible.push(group);
  }
  return { visible, hidden };
}

// Build the request shape for the hide/unhide endpoints. Returning a struct
// rather than calling fetch directly lets tests verify the wire contract.
export function buildHideRequest(groupId: string) {
  return {
    method: "POST" as const,
    url: "/api/dashboard/hidden-groups",
    body: { groupId },
  };
}

export function buildUnhideRequest(groupId: string) {
  return {
    method: "DELETE" as const,
    url: `/api/dashboard/hidden-groups?groupId=${encodeURIComponent(groupId)}`,
    body: null,
  };
}
