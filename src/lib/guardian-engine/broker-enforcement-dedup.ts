/**
 * Phase 2C: pure dedup key helpers for listener-path broker enforcement.
 *
 * Safety contract:
 *   - Pure computation only; no Prisma, no DB, no broker calls
 *   - These keys are used as the listenerBrokerDedupKey unique constraint on
 *     GuardianIntervention — they prevent duplicate broker writes when multiple
 *     WebSocket props events arrive before the first enforcement completes
 *
 * Key format: "${accountId}:${trigger}:${tradingDay}:broker_enforcement"
 *
 * The ":broker_enforcement" suffix deliberately differs from the Phase 2A
 * dry-run key suffix (":dry_run") so both can coexist for the same
 * account/trigger/day during transition from dry-run to live enforcement.
 */

/**
 * Build the unique dedup key for a listener-path broker enforcement attempt.
 *
 * One key per account per trigger per trading day — the DB unique constraint
 * on GuardianIntervention.listenerBrokerDedupKey enforces at-most-once semantics
 * even under concurrent props events.
 */
export function buildListenerBrokerDedupKey(
  accountId: string,
  trigger: string,
  tradingDay: string,
): string {
  return `${accountId}:${trigger}:${tradingDay}:broker_enforcement`;
}
