/**
 * Pure helpers for the Daily Loss recovery probe payload builders.
 *
 * Separate from tradovate-client.ts so the payload-shape contract can be
 * unit-tested without instantiating any TradovateClient or mocking Prisma.
 *
 * The recovery probe NEVER deletes a userAccountAutoLiq record. It only
 * sends `userAccountAutoLiq/update` with one of:
 *
 *   read_only         — no write payload; caller does GET only
 *   raise_threshold   — id + dailyLossAutoLiq=RECOVERY_HIGH_THRESHOLD,
 *                       changesLocked preserved from the existing record
 *   unlock_only       — id + dailyLossAutoLiq preserved from existing,
 *                       changesLocked=false (attempts to lift the mid-session lock)
 *   raise_and_unlock  — id + dailyLossAutoLiq=RECOVERY_HIGH_THRESHOLD +
 *                       changesLocked=false (both)
 *
 * SAFETY INVARIANTS (enforced here, asserted in tests):
 *   - doNotUnlock is NEVER included in any payload.
 *   - dailyProfitAutoLiq is NEVER included — this is Daily Loss only.
 *   - The high-threshold value is a non-negative finite number.
 *   - Every payload includes the existing record id (no /create branch).
 *
 * Why no /create branch:
 *   Recovery only applies when an existing record was previously written.
 *   If no record exists, there is nothing to recover — the route handler
 *   should short-circuit before reaching these builders.
 */

/**
 * Threshold used by "raise_threshold" and "raise_and_unlock" modes.
 *
 * A loss of $999,999,999 is functionally impossible on any prop/sim/funded
 * account, so the auto-liq threshold becomes inert without removing the
 * record. We deliberately do not use Number.MAX_SAFE_INTEGER because
 * Tradovate's API may have its own bounds checks; this value is comfortably
 * within the int32 range a typical risk-management backend accepts.
 */
export const RECOVERY_HIGH_THRESHOLD = 999_999_999;

/**
 * Exact confirmation phrase a caller must supply in the request body
 * when apply=true. Any other value (including casing differences) must
 * cause the route to reject the request.
 */
export const RECOVERY_CONFIRM_PHRASE = "I_UNDERSTAND_THIS_WRITES_TO_TRADOVATE_DEMO";

export type RecoveryMode =
  | "read_only"
  | "raise_threshold"
  | "unlock_only"
  | "raise_and_unlock";

export const RECOVERY_MODES: readonly RecoveryMode[] = [
  "read_only",
  "raise_threshold",
  "unlock_only",
  "raise_and_unlock",
] as const;

export function isRecoveryMode(value: unknown): value is RecoveryMode {
  return typeof value === "string" && (RECOVERY_MODES as readonly string[]).includes(value);
}

export type ExistingAutoLiqRecord = {
  id: number;
  /** Existing stored value, may be null when never set */
  dailyLossAutoLiq: number | null;
  /** Existing lock state, may be null when never set */
  changesLocked: boolean | null;
};

/**
 * Build the POST body for `userAccountAutoLiq/update` for a given recovery
 * mode against an existing record. Returns null for read_only (the route
 * handler must not POST anything in that mode).
 *
 * Throws if the mode is read_only and the caller still asks for a payload.
 */
export function buildRecoveryPayload(
  mode: RecoveryMode,
  existing: ExistingAutoLiqRecord,
): Record<string, unknown> | null {
  if (mode === "read_only") {
    return null;
  }

  // Preserve existing values by default; override only the field(s) this
  // mode targets. Coalesce null to a safe default (0 for threshold, true for
  // lock — the conservative direction) so the payload never sends null.
  const preservedThreshold = existing.dailyLossAutoLiq ?? 0;
  const preservedLock = existing.changesLocked ?? true;

  let dailyLossAutoLiq = preservedThreshold;
  let changesLocked = preservedLock;

  if (mode === "raise_threshold" || mode === "raise_and_unlock") {
    dailyLossAutoLiq = RECOVERY_HIGH_THRESHOLD;
  }
  if (mode === "unlock_only" || mode === "raise_and_unlock") {
    changesLocked = false;
  }

  // Build a fresh object so we can assert exact key set in tests.
  // Order: id, dailyLossAutoLiq, changesLocked — matches the existing
  // payload builders in enforcement-helpers.ts.
  const payload: Record<string, unknown> = {
    id: existing.id,
    dailyLossAutoLiq,
    changesLocked,
  };
  return payload;
}

/**
 * Decide whether a Tradovate read-back response confirms a recovery write.
 *
 * - For raise_threshold:    expect readBack.dailyLossAutoLiq === RECOVERY_HIGH_THRESHOLD
 * - For unlock_only:        expect readBack.changesLocked === false
 * - For raise_and_unlock:   both
 * - For read_only:          confirmed iff readBack is non-null (we just looked at it)
 */
export function isRecoveryReadbackConfirmed(
  mode: RecoveryMode,
  readBack: { dailyLossAutoLiq: number | null; changesLocked: boolean | null } | null,
): boolean {
  if (readBack == null) return false;
  if (mode === "read_only") return true;

  const thresholdOk =
    mode === "unlock_only"
      ? true
      : readBack.dailyLossAutoLiq === RECOVERY_HIGH_THRESHOLD;
  const lockOk =
    mode === "raise_threshold"
      ? true
      : readBack.changesLocked === false;

  return thresholdOk && lockOk;
}
