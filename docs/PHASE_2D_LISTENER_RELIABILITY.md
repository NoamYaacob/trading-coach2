# Phase 2D — Listener Reconnect Reliability

## Problem

The Tradovate WebSocket listener (`TradovateUserSyncListener`) can disconnect due to:
- Normal broker-side close (code 1000, "Bye")
- Abnormal closure (code 1006)
- Token expiry triggering a forced reconnect
- Worker process restart

During any gap, fills/trades may be posted to Tradovate but not observed by the listener. Without recovery, the app's `NormalizedTradeEvent` table would silently miss those fills, causing incorrect PnL and rule-evaluation state.

## Solution

After every listener reconnect (and on initial connect after a worker restart), a REST reconciliation is automatically triggered. It calls `syncTradovateAccount` for every active account on the connection — the same idempotent sync path used on initial account connection. Duplicate fills are never created because `syncTradovateAccount` checks for existing `NormalizedTradeEvent` rows before inserting.

## Safety constraints (unchanged)

- `BROKER_ENFORCEMENT_ENABLED` remains false/absent.
- `ENFORCEMENT_DRY_RUN=true` remains enabled.
- `TRADOVATE_LISTENER_ENABLE_LIVE=false` remains unchanged.
- No broker write actions (no flatten, cancel, order, liquidate).
- No calls to `maybeAttemptBrokerDailyLossLockoutForInternalLock`.

## Changed files

| File | Change |
|------|--------|
| `src/lib/brokers/tradovate-user-sync-listener.ts` | Added `onReady?: (info: { isReconnect: boolean }) => void` config callback; fires after sync-request succeeds, capturing `isReconnect` before resetting `#reconnectAttempt` |
| `src/lib/brokers/tradovate-listener-manager.ts` | Added `onReady` to `ManagedListenerConfig`; passes through with `connectionId` bound |
| `src/lib/brokers/tradovate-listener-reconciliation.ts` | New module: `reconcileConnectionAccounts` (calls `syncTradovateAccount` for all active accounts) and `writeReconciliationResult` (persists result to `BrokerConnection`) |
| `scripts/tradovate-listener-worker.ts` | Added `reconcileAndPersist`; wired `onReady` callback to call it |
| `prisma/schema.prisma` | Added 5 reconciliation fields to `BrokerConnection` |
| `prisma/migrations/20260524000000_add_reconciliation_fields_to_broker_connection/migration.sql` | Migration for those 5 fields |
| `src/app/debug/safety-console/page.tsx` | Added reconciliation fields to BrokerConnection query and per-connection reconciliation display |

## New BrokerConnection fields

| Field | Type | Description |
|-------|------|-------------|
| `lastReconciliationAt` | `DateTime?` | When the last reconciliation completed |
| `lastReconciliationTrigger` | `String?` | `"initial_connect"` or `"reconnect"` |
| `lastReconciliationStatus` | `String?` | `"success"`, `"skipped"`, or `"failed"` |
| `lastReconciliationError` | `String?` | Error message(s), truncated to first 3, semicolon-joined |
| `lastReconciledAccountCount` | `Int?` | Number of accounts processed |

## Reconciliation status semantics

- **`skipped`** — connection has no active accounts; nothing to sync.
- **`success`** — all accounts synced, or at least one succeeded (partial success counts).
- **`failed`** — every account in the connection failed to sync.

## Safety Console

`/debug/safety-console` (admin-only, `isAdminEmail` guard) shows reconciliation per connection:
- `reconciledAt` — timestamp of last reconciliation
- `reconcileTrigger` — `initial_connect` or `reconnect`
- `reconcileStatus` — highlighted amber if `failed`
- `reconcileAccounts` — number of accounts processed
- `reconcileError` — error details when status is `failed`

## Testing

- `tradovate-user-sync-listener.test.ts` — `onReady` fires with `isReconnect=false` (initial), `isReconnect=true` (reconnect), and does not fire when closed before ready
- `tradovate-listener-manager.test.ts` — source scan: `onReady` is declared in config and forwarded
- `tradovate-listener-reconciliation.test.ts` — source scan: no broker writes, calls `syncTradovateAccount`, exports correct functions, skips on empty account list, fails only when all accounts fail, truncates errors, writes correct DB fields
