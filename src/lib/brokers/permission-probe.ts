/**
 * Permission probe — determines whether a Tradovate connection has the
 * "Account Risk Settings" permission required for broker-side enforcement
 * (userAccountAutoLiq/update + order/liquidatepositions).
 *
 * Why this exists:
 *   Tradovate's OAuth flow does not surface granted scopes in the token
 *   response, and the user's per-feature permissions are configured in the
 *   Tradovate API key permissions screen — independent of the OAuth scope
 *   string we request. Without a probe, we cannot tell from the token alone
 *   whether broker writes will succeed.
 *
 * Probe strategy:
 *   GET userAccountAutoLiq/deps?masterid={tvAccountId}
 *
 *   This is a safe read endpoint. If it returns 200, the user granted
 *   Account Risk Settings access — the same permission gate as the write
 *   endpoints we use for enforcement. If it returns 401/403, the permission
 *   is missing and broker writes will fail; we should treat the connection
 *   as read-only regardless of webhook activity.
 *
 *   This is a pure read — it does not change any settings on the broker.
 */

export type PermissionLevel = "full_access" | "read_only" | "unknown";

export type PermissionProbeResult = {
  level: PermissionLevel;
  /** HTTP status from the probe call when known; null on network error. */
  httpStatus: number | null;
  /** Short reason suitable for audit logs. */
  reason: string;
};

type ProbeError = { statusCode?: number; message?: string } | unknown;

/**
 * Classify a probe outcome from the result of calling
 * `TradovateClient.getUserAccountAutoLiq()`.
 *
 * Pure function: takes the raw outcome (success array or thrown error) and
 * returns the classified result. Kept separate from the network call so it
 * can be unit-tested in isolation.
 */
export function classifyProbeOutcome(
  outcome:
    | { ok: true; rules: unknown[] }
    | { ok: false; error: ProbeError },
): PermissionProbeResult {
  if (outcome.ok) {
    return {
      level: "full_access",
      httpStatus: 200,
      reason:
        "userAccountAutoLiq/deps returned 200 — Account Risk Settings read confirmed.",
    };
  }

  const status = extractStatus(outcome.error);
  if (status === 401 || status === 403) {
    return {
      level: "read_only",
      httpStatus: status,
      reason: `userAccountAutoLiq/deps returned ${status} — Account Risk Settings permission missing.`,
    };
  }

  // Network error, 5xx, or unexpected status — cannot conclude permission level.
  return {
    level: "unknown",
    httpStatus: status,
    reason:
      status != null
        ? `userAccountAutoLiq/deps returned HTTP ${status} — permission level not determinable.`
        : "userAccountAutoLiq/deps probe failed without HTTP status (network error) — permission level not determinable.",
  };
}

function extractStatus(err: ProbeError): number | null {
  if (err && typeof err === "object" && "statusCode" in err) {
    const sc = (err as { statusCode?: unknown }).statusCode;
    if (typeof sc === "number") return sc;
  }
  return null;
}
