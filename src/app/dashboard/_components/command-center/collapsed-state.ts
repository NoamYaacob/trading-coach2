// Pure helpers for the dashboard accordion's collapsed-groups preference.
//
// The preference lives in localStorage under COLLAPSED_GROUPS_STORAGE_KEY as a
// JSON array of groupIds. An empty / missing / malformed payload means "all
// groups expanded" (the default). React glue lives in command-center.tsx; this
// module is intentionally side-effect-free so it can be unit-tested without a
// DOM.

export const COLLAPSED_GROUPS_STORAGE_KEY = "guardrail:dashboard:collapsed-groups:v1";

/** Parse a localStorage payload into a Set of collapsed groupIds.
 *  Defensive: any malformed/unexpected input yields an empty Set. */
export function parseCollapsedPayload(raw: string | null | undefined): Set<string> {
  if (raw == null || raw === "") return new Set();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return new Set();
  }
  if (!Array.isArray(parsed)) return new Set();
  return new Set(parsed.filter((x): x is string => typeof x === "string" && x.length > 0));
}

/** Serialize a collapsed-groups Set into the JSON array stored in localStorage. */
export function serializeCollapsedPayload(collapsed: ReadonlySet<string>): string {
  return JSON.stringify([...collapsed]);
}

/** Toggle membership of a single groupId, returning a new Set. */
export function toggleCollapsedId(prev: ReadonlySet<string>, groupId: string): Set<string> {
  const next = new Set(prev);
  if (next.has(groupId)) next.delete(groupId);
  else next.add(groupId);
  return next;
}

/** Drop any IDs that aren't in the live group list, so the persisted payload
 *  stays bounded as the user adds/removes broker connections over time. */
export function pruneStaleCollapsedIds(
  collapsed: ReadonlySet<string>,
  validGroupIds: Iterable<string>,
): Set<string> {
  const valid = validGroupIds instanceof Set ? validGroupIds : new Set(validGroupIds);
  const next = new Set<string>();
  for (const id of collapsed) {
    if (valid.has(id)) next.add(id);
  }
  return next;
}
