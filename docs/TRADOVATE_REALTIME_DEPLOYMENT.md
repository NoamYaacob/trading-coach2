# Tradovate Real-Time Listener — Railway Deployment Plan

## Phase 1.5 — Verified Checklist (2026-05-15)

All items below were manually verified in production. Phase 1.5 is complete.

| # | Check | Status |
|---|---|---|
| 1 | Demo listener live | ✓ `cmp56a3kv00020dmedmm5flr1` connected, recent heartbeat |
| 2 | Dashboard shows Live | ✓ DEMO7433035 shows "Live · Xs ago" via direct FK |
| 3 | 1000/Bye recycles handled | ✓ Dashboard stays green through ~30s Tradovate session recycles |
| 4 | Expired accounts isolated | ✓ Expired connections show "Expired — re-authorize" (amber), never borrow Live state |
| 5 | High-confidence reattach done | ✓ DEMO7433035 moved to active connection; old connection `accountCount=0` |
| 6 | Medium-confidence MFFU not applied | ✓ Three MyFundedFutures accounts left as-is (accounts no longer active in Tradovate) |
| 7 | Live listener disabled | ✓ `TRADOVATE_LISTENER_ENABLE_LIVE=false` |
| 8 | Single-connection filter removed | ✓ `TRADOVATE_LISTENER_CONNECTION_ID` unset; all-demo unscoped mode |
| 9 | Worker plan healthy | ✓ `wouldStart=1`, `wouldSkip=3`, `duplicateGroups=1` |
| 10 | Enforcement not started | ✓ No `riskState` writes, no `RuleViolation` rows, no flatten, no Phase 2 |
| 11 | Debug endpoints operational | ✓ `/status`, `/reattach-audit`, `/reattach` all return correct data |
| 12 | All tests pass | ✓ 3838 unit tests, 0 failures |

### Phase 1.5 env-var state (production listener-worker service)

```
TRADOVATE_LISTENER_ENABLE_LIVE=false
# TRADOVATE_LISTENER_CONNECTION_ID — unset (all-demo mode)
# TRADOVATE_LISTENER_DISABLED — unset
```

### Advance to Phase 2B (live enforcement) only when

- [ ] All demo connections show Live on the dashboard (currently 1/1)
- [ ] No `listenerErrorMessage` or `listenerStatus=error` for >24h
- [ ] Phase 2A dry-run violations reviewed and confirmed accurate
- [ ] Enforcement design reviewed and approved for live mode
- [ ] Phase 2B implementation explicitly authorized

---

## Phase 2A — Dry-Run Rule Evaluation (observe-only)

### What Phase 2A does

When `ENFORCEMENT_DRY_RUN=true`, every WebSocket props event causes the worker to evaluate which rules **would** have fired for each protected demo account. The result is written to `DryRunViolation` rows — an audit table with no side-effects.

**Phase 2A never:**
- Locks an account (`riskState=STOPPED`)
- Creates `GuardianIntervention` records
- Flattens positions or cancels orders
- Calls any broker write endpoint
- Changes any enforcement state

### Rules evaluated

| Rule | Evaluated | Notes |
|---|---|---|
| `daily_loss_limit` | ✓ | Breach when `dailyPnl ≤ -maxDailyLoss` |
| `trade_limit` | ✓ | Only when `tradeCountSource=verified` |
| `max_loss_streak` | ✓ | Breach when `consecutiveLosses ≥ stopAfterLosses` |
| `session_hours` | — | Skipped — timezone complexity, insufficient data |

### Files

| File | Purpose |
|---|---|
| `src/lib/guardian-engine/dry-run-rule-evaluator.ts` | Pure evaluation function (no DB, testable) |
| `src/lib/guardian-engine/dry-run-rule-evaluator-db.ts` | DB persistence + connection-level entry point |
| `src/lib/guardian-engine/dry-run-rule-evaluator.test.ts` | 38 unit tests |
| `prisma/schema.prisma` → `DryRunViolation` | Audit table with dedup key |
| `src/app/api/debug/tradovate-listener/dry-run-violations/route.ts` | Inspect recent violations |

### Dedup key

Format: `<accountId>:<ruleType>:<tradingDay>:dry_run`

Ensures at most one row per account per rule per trading day. Subsequent events update `observedAmount`/`observedCount` if the breach worsens, but do not create duplicate rows.

### How to enable

Set in the listener-worker Railway service:

```
ENFORCEMENT_DRY_RUN=true
```

This gate exists in the worker's `onPropsEvent`:

```typescript
if (process.env.ENFORCEMENT_DRY_RUN === "true") {
  void evaluateDryRunRulesForConnection(connectionId);
}
```

### How to inspect violations

```bash
curl -H "x-cron-secret: $CRON_SECRET" \
  "https://your-domain/api/debug/tradovate-listener/dry-run-violations?days=1"
```

Response includes:
```json
{
  "note": "Dry run only — no enforcement action was taken. These records are observe-only.",
  "dryRunEnabled": true,
  "count": 1,
  "violations": [...]
}
```

### Safety gates in force during Phase 2A

| Gate | Value |
|---|---|
| `TRADOVATE_LISTENER_ENABLE_LIVE` | `false` (live accounts skipped) |
| `ENFORCEMENT_DRY_RUN` | `true` (no enforcement actions) |
| `dryRun` field on DryRunViolation | always `true` |
| Live account guard in evaluator-db.ts | `env === "live"` skipped when `ENABLE_LIVE=false` |

### Validation with DEMO7433035

1. Confirm DEMO7433035 has `AccountRiskRules` configured (maxDailyLoss, maxTradesPerDay, or stopAfterLosses)
2. Enable `ENFORCEMENT_DRY_RUN=true` on the listener-worker service
3. After some trading activity, check `/api/debug/tradovate-listener/dry-run-violations`
4. Verify: only `dryRun=true` rows, no `GuardianIntervention` rows, no `riskState` changes

---

This document describes how to deploy the Tradovate user/syncrequest WebSocket
listener as a long-running Railway worker service.

All core building blocks are ready in the codebase:

| Module | Location |
|---|---|
| SockJS protocol | `src/lib/brokers/tradovate-websocket-protocol.ts` |
| Enforcement decision | `src/lib/brokers/tradovate-realtime-enforcement.ts` |
| Listener state machine | `src/lib/brokers/tradovate-user-sync-listener.ts` |
| Listener manager (dedup) | `src/lib/brokers/tradovate-listener-manager.ts` |
| DB heartbeat schema | `prisma/schema.prisma` → `BrokerConnection` |
| Dashboard status component | `src/app/dashboard/_components/broker-listener-status.tsx` |

The next PR wires these together into a runnable worker.

---

## Architecture

```
Railway cron service (existing)        Railway worker service (new)
  └─ /api/cron/* every 5 min             └─ scripts/tradovate-listener-worker.ts
       │                                       │
       └─ DB sync (fallback)                   └─ TradovateListenerManager
                                                    ├─ one listener per healthy BrokerConnection
                                                    ├─ props event → decideRealtimeEnforcement()
                                                    ├─ breach → prisma.connectedAccount.update(riskState=STOPPED)
                                                    └─ heartbeat → prisma.brokerConnection.update(listenerLastHeartbeatAt)
```

The cron sync continues to run as a fallback. The listener worker reduces
detection latency from ~5 minutes to near-instant (sub-second on position events).

---

## Worker Entry Point

`scripts/tradovate-listener-worker.ts` (scaffolded in this PR) starts the
`TradovateListenerManager`, iterates all healthy `BrokerConnection` rows, and
begins listening. On each props event it calls `decideRealtimeEnforcement()`
and writes enforcement outcomes to DB.

Key responsibilities of the worker:
1. **Startup:** query all `BrokerConnection` rows with `status = "active"` and
   `permissionLevel = "full_access"`.
2. **Token retrieval:** call the existing `getDecryptedAccessToken()` helper —
   never log the result.
3. **Start listeners:** `manager.startListener(config)` for each connection.
4. **Props event handler:** on each `onPositionEvent`, call
   `decideRealtimeEnforcement()` with current positions from DB.
5. **Heartbeat handler:** on each `onHeartbeat`, write
   `BrokerConnection.listenerLastHeartbeatAt` and `listenerStatus = "connected"`.
6. **State change handler:** write `BrokerConnection.listenerStatus` on
   every listener state transition.
7. **Periodic re-scan:** every 60 s, re-query DB for new/removed connections
   and call `startListener` / `stopListener` accordingly (dedup guard is safe
   to call repeatedly).
8. **Graceful shutdown:** on `SIGTERM`, call `manager.closeAll()` and exit 0.

---

## Railway Configuration

Add a second service to `railway.json` (separate from the existing cron service):

```json
{
  "services": [
    {
      "name": "web",
      "startCommand": "npm run start:railway"
    },
    {
      "name": "cron",
      "startCommand": "npm run cron:railway",
      "cronSchedule": "*/10 * * * *"
    },
    {
      "name": "listener-worker",
      "startCommand": "node --experimental-strip-types scripts/tradovate-listener-worker.ts",
      "buildCommand": "npm run build",
      "healthcheckPath": null
    }
  ]
}
```

The worker runs as a persistent process (no `cronSchedule`). Railway will
restart it automatically on crash.

### Environment Variables

The worker inherits the same `DATABASE_URL`, `ENCRYPTION_KEY`, and
`TRADOVATE_*` env vars as the web and cron services. No new variables are
needed.

---

## DB Heartbeat Fields

Written by the worker, read by the dashboard:

| Field | Type | Written when |
|---|---|---|
| `listenerStatus` | `String?` | Every state change (connecting / connected / reconnecting / closed) |
| `listenerConnectedAt` | `DateTime?` | When listener first reaches "connected" state |
| `listenerLastEventAt` | `DateTime?` | On every props event from Tradovate |
| `listenerLastHeartbeatAt` | `DateTime?` | On every SockJS "h" heartbeat frame |
| `listenerErrorMessage` | `String?` | On error/close with non-normal code |

The dashboard component (`BrokerListenerStatus`) reads these fields and
renders:
- **"Live · 5s ago"** — listener connected, recent event
- **"Reconnecting…"** — listener recovering
- **"Fallback sync · 3m ago"** — no listener, cron sync recent
- **"Stale · 13m ago"** — no listener, cron sync overdue

---

## Enforcement on Props Events

When the worker receives a Position/Fill/Order props event:

1. Fetch current positions for the account from DB (or from the last known
   snapshot — see optimization note below).
2. Call `decideRealtimeEnforcement({ positions, maxContracts, alreadyStopped, eventContext })`.
3. If `decision.shouldLock`:
   - Write `ConnectedAccount.riskState = "STOPPED"`.
   - If `decision.shouldCreateViolation`, write a `RuleViolation` row.
4. If `decision.shouldFlattenIfGated` and the four flatten gates pass, trigger
   the flatten flow.

**Optimization (next PR):** cache position snapshots in memory, update on
props events, only re-query DB on reconnect. Reduces DB load significantly
for high-frequency traders.

---

## Token Safety

Token values must never be logged. The worker calls `getAccessToken()` (a
closure that reads from DB and decrypts) but never stores the token value in
a variable that could be serialized or logged.

Enforcement from `TradovateListenerManager` source-scan test:

```
manager source does not log token fields ✓
```

---

## Rollout Plan

### Phase 1: Single demo connection (current)

Test with one known-good demo connection before enabling broadly.

```
# Railway env vars (listener-worker service only)
TRADOVATE_LISTENER_ENABLE_LIVE=false
TRADOVATE_LISTENER_CONNECTION_ID=<active-demo-connection-id>
```

The `TRADOVATE_LISTENER_CONNECTION_ID` filter causes the worker to skip every
other connection with reason `single_connection_filter`. This lets you verify
auth, heartbeat, and reconnect behaviour in production without touching live
accounts or other demo connections.

Acceptance before advancing to Phase 2:
- `listenerStatus = "connected"` in DB for the scoped connection
- Dashboard shows **"Live · Xs ago"** for accounts on that connection
- Dashboard stays Live through 1000/Bye recycle cycles (Tradovate recycles
  demo sessions every ~30 s)
- No `listenerErrorMessage` or `listenerStatus = "error"` for 1000/Bye closes
- Debug endpoint (`/api/debug/tradovate-listener/status`) shows `wouldStart=1`

### Phase 2: All healthy demo connections

Remove the single-connection filter once Phase 1 is validated.

```
# Remove TRADOVATE_LISTENER_CONNECTION_ID entirely (or leave unset)
TRADOVATE_LISTENER_ENABLE_LIVE=false
```

The worker will start one listener per healthy `BrokerConnection` with
`env=demo` and `connectionStatus IN (connected_live, connected_readonly)`.
Live connections continue to be skipped.

Acceptance before advancing to Phase 3:
- All demo connections show "Live · Xs ago" on the dashboard
- Debug endpoint shows `wouldStart=N` matching the count of healthy demo connections
- No listener errors that aren't auth-related (token expiry, wrong env token)

### Phase 3: Enable live (intentional opt-in only)

Only after demo is stable across all connections.

```
TRADOVATE_LISTENER_ENABLE_LIVE=true
```

This is a separate opt-in step, not automatic. Live connections carry real money;
validate demo thoroughly before proceeding.

### Ongoing monitoring

- Alert if `listenerLastHeartbeatAt` is >2 min stale for any connection with
  `listenerStatus = "connected"` (indicates worker crash or Tradovate outage).
- The cron sync remains active throughout as a safety net — if the listener is
  down, the dashboard falls back to `lastSyncAt` within 5 min.
- Use `/api/debug/tradovate-listener/status` → `connectionGroups` to identify
  duplicate OAuth grants (old connections that should be cleaned up manually
  after confirming no accounts depend on them).

### Connection cleanup

Old/superseded OAuth grants (same env + brokerUserId, older `createdAt`) can
be identified via the `connectionGroups` section of the status endpoint. Do not
delete them automatically — verify `accountCount = 0` and no active listener
before archiving. When accounts still point to old connections, the dashboard
automatically uses the active connection's listener data via the env-based
fallback in `loadCommandCenterData`.

---

## OAuth Connection Reattach Audit

Accounts may still have their `brokerConnectionId` FK pointing to an old/stale
connection even after a new OAuth grant has been issued. The dashboard's
env-based fallback hides this at display time, but the data integrity issue
should be resolved by updating the FK.

Two endpoints support the reattach workflow:

| Endpoint | Writes? | Purpose |
|---|---|---|
| `GET /api/debug/tradovate-listener/reattach-audit` | Never | Read-only inventory — run first |
| `GET /api/debug/tradovate-listener/reattach` | Only when `apply=true` | Dry-run then apply |

Both require `x-cron-secret` header (always, not just in production for the reattach endpoint).

### Confidence levels

| Level | Meaning |
|---|---|
| `high` | Same `userId + env + brokerUserId` — confident the target is the same physical account |
| `medium` | Same `userId + env` only — brokerUserId not matched on one side |
| `low` | Same `userId + env`, multiple candidates — manual review required |

Only `high` confidence rows are eligible by default. `medium` and `low` require
an explicit `confidence=medium` or `confidence=low` query parameter.

### Safe reattach procedure

**Step 1 — Run the audit**

```
GET /api/debug/tradovate-listener/reattach-audit
Headers: x-cron-secret: <CRON_SECRET>
```

Review the `recommendations` array. For each `high` confidence entry confirm:
- `staleReason` explains why the current connection is unhealthy
- `targetBrokerConnectionId` is the live/healthy connection you expect
- `confidenceReason` mentions the matching `brokerUserId`
- `targetEnv` is `"demo"` (never `"live"` unless you've deliberately set `TRADOVATE_LISTENER_ENABLE_LIVE=true`)

**Step 2 — Run the dry-run reattach**

```
GET /api/debug/tradovate-listener/reattach?apply=false&confidence=high
Headers: x-cron-secret: <CRON_SECRET>
```

`apply=false` is the default — safe to call any number of times. Review:
- `wouldApply` — the accounts that would be moved
- `skippedByConfidence` — medium/low rows that were filtered out
- `skippedLiveGuard` — any rows blocked because the target env is live
- `dryRunPreview` — the exact Prisma calls that would execute

**Step 3 — Apply high-confidence rows only**

Only after the dry-run output matches expectations:

```
GET /api/debug/tradovate-listener/reattach?apply=true&confidence=high
Headers: x-cron-secret: <CRON_SECRET>
```

The only mutation is `ConnectedAccount.brokerConnectionId → targetBrokerConnectionId`.
No BrokerConnection rows are deleted or modified. No token, enforcement, or risk columns are touched.

**Step 4 — Verify**

Re-run the audit to confirm `accountsNeedingReattach = 0` for high-confidence rows.
Check the dashboard shows "Live · Xs ago" for the reattached accounts.

**Medium-confidence rows** require manual investigation before applying. Confirm
the target connection is actually the correct broker account by cross-referencing
`externalAccountId` or `brokerUserId` in the broker portal before applying
`confidence=medium`.

**Do not delete old BrokerConnection rows** — leave them with `accountCount = 0`
for audit history. The status endpoint's `connectionGroups` will show them as
stale/non-duplicate after all accounts have been reattached.
