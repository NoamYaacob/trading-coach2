/**
 * Pure logic for the emergency-lockout UI. No React, no I/O — unit-testable
 * without rendering the client island. The component imports these so the
 * typed-confirmation gate has a single source of truth.
 */

/** The word the user must type to enable the confirm button (case-insensitive). */
export const LOCKOUT_CONFIRM_WORD = "LOCKOUT";

/** Pure: does the typed text authorize the emergency lockout? */
export function isLockoutConfirmed(typed: string): boolean {
  return typed.trim().toUpperCase() === LOCKOUT_CONFIRM_WORD;
}
