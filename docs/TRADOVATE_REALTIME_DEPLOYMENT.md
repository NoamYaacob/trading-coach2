# Tradovate Real-Time Listener — Railway Deployment Plan

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
be identified via the `connectionGroups` section of the debug endpoint. Do not
delete them automatically — verify `accountCount = 0` and no active listener
before archiving. When accounts still point to old connections, the dashboard
automatically uses the active connection's listener data via the env-based
fallback in `loadCommandCenterData`.
