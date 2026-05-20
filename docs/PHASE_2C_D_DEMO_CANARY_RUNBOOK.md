# Phase 2C-D: Demo Canary Runbook — First Real Broker Write

**Status: FIRST CANARY COMPLETE (2026-05-15). `brokerLockStatus=broker_locked` confirmed. Rollback clean. See Section 10 for full result. Re-canary on a new trading day requires fresh rehearsal (Section 3) and human sign-off (Section 4).**

**Phase 2C-E fix (2026-05-15):** `applyInternalLockForConnection` now returns the existing active InternalLockEvent ID when `riskState` is already `STOPPED`. Previously, a pre-existing lock (created before `BROKER_ENFORCEMENT_ENABLED` was enabled) caused `internalLockEventId=null` in the result, silently bypassing `maybeAttemptBrokerDailyLossLockoutForInternalLock`. Fixed in commit `35a5b8a`; the broker enforcement service's `listenerBrokerDedupKey @unique` dedup gate prevents duplicate writes.

**Safety boundaries in effect:**
- `BROKER_ENFORCEMENT_ENABLED` must remain absent/false until the checkpoint in Section 4
- `TRADOVATE_LISTENER_ENABLE_LIVE=false` — unchanged throughout, live accounts never touched
- No flatten, no order cancellation, no order placement
- Only account `cmottd1z200020do1knjxq582` (demo) is eligible for this canary
- Abort immediately on any abort condition in Section 7

---

## 1. Env Vars by Railway Service

### listener-worker service — rest state (current)

These are the values the listener-worker runs with at rest. Do not change any of these until the canary sequence explicitly requires it.

| Var | Rest value | Notes |
|---|---|---|
| `TRADOVATE_LISTENER_ENABLE_LIVE` | `false` | **Never change.** Gate 2. |
| `ENFORCEMENT_DRY_RUN` | `true` | Broker writes are simulated. Must stay `true` until the real canary step. |
| `GUARDRAIL_INTERNAL_LOCK_ENABLED` | `false` | Off at rest. Set to `true` only during rehearsal and real canary. |
| `BROKER_ENFORCEMENT_ENABLED` | absent or `false` | Off at rest. Set to `true` only at the real canary checkpoint. |
| `BROKER_ENFORCEMENT_DEMO_ACCOUNT_ALLOWLIST` | `cmottd1z200020do1knjxq582` | Already set. Gate 4. |

### listener-worker service — rehearsal state (Section 3)

| Var | Rehearsal value | Change from rest |
|---|---|---|
| `GUARDRAIL_INTERNAL_LOCK_ENABLED` | `true` | Set temporarily to create a test lock |
| `BROKER_ENFORCEMENT_ENABLED` | `false` or absent | **Unchanged** |
| `ENFORCEMENT_DRY_RUN` | `true` | **Unchanged** |
| `TRADOVATE_LISTENER_ENABLE_LIVE` | `false` | **Unchanged** |
| `BROKER_ENFORCEMENT_DEMO_ACCOUNT_ALLOWLIST` | `cmottd1z200020do1knjxq582` | **Unchanged** |

### listener-worker service — real canary state (Section 4 checkpoint only)

Set all of these together in one Railway redeploy, only after human sign-off:

| Var | Real canary value | Change from rest |
|---|---|---|
| `BROKER_ENFORCEMENT_ENABLED` | `true` | ← The final switch |
| `ENFORCEMENT_DRY_RUN` | `false` or remove | ← Required for real HTTP call |
| `GUARDRAIL_INTERNAL_LOCK_ENABLED` | `true` | Set if not already from rehearsal |
| `TRADOVATE_LISTENER_ENABLE_LIVE` | `false` | **Unchanged** |
| `BROKER_ENFORCEMENT_DEMO_ACCOUNT_ALLOWLIST` | `cmottd1z200020do1knjxq582` | **Unchanged** |

### listener-worker service — rollback state (Section 6)

Set all of these together immediately on abort:

| Var | Rollback value |
|---|---|
| `BROKER_ENFORCEMENT_ENABLED` | `false` or remove |
| `ENFORCEMENT_DRY_RUN` | `true` |
| `GUARDRAIL_INTERNAL_LOCK_ENABLED` | `false` |
| `TRADOVATE_LISTENER_ENABLE_LIVE` | `false` |

### web / app service (trading-coach2) — unchanged throughout

| Var | Value | Notes |
|---|---|---|
| `BROKER_ENFORCEMENT_SIMULATION_ENABLED` | `true` | Enables `/api/debug/broker-enforcement-simulation`. Web process only. |
| `CRON_SECRET` | existing value | Required for all debug endpoint `x-cron-secret` calls |

### ENFORCEMENT_DRY_RUN note

`ENFORCEMENT_DRY_RUN` is checked inside `applyBrokerDayLockout` after all 10 gate checks pass. When `true`:
- `riskState` still becomes `STOPPED` (internal lock fires normally)
- A `GuardianIntervention` row is written with `brokerLockStatus = "dry_run"`
- **No HTTP request is made to Tradovate**

A `"dry_run"` result is not a canary success. For the first real broker write, both `BROKER_ENFORCEMENT_ENABLED=true` AND `ENFORCEMENT_DRY_RUN=false` (or absent) must be set together at the real canary checkpoint.

---

## 2. Pre-Flight Checks

Run all checks at baseline — before changing any env var, before creating a test lock. All must pass. **Do not proceed to the rehearsal (Section 3) if any check fails.**

All endpoints require an authenticated session cookie and `x-cron-secret: $CRON_SECRET` header.

### 2A. Listener is connected

```bash
curl -s -H "x-cron-secret: $CRON_SECRET" \
  "$BASE_URL/api/debug/tradovate-listener/status" \
  | jq '{connectionStatus: .activeDemo.connectionStatus, listenerStatus: .activeDemo.listener.status}'
```

Expected:
```json
{
  "connectionStatus": "connected_readonly",
  "listenerStatus": "connected"
}
```

`listenerStatus` may also be `"reconnecting"` if a heartbeat was received recently (within the last 30 seconds) — check freshness. Abort if `connectionStatus` is in `{expired, connection_error, not_connected, pending_webhook, oauth_pending_storage}` or if `listenerStatus` is `"error"` or `"disconnected"`.

### 2B. Account is clean — no active locks, no broker enforcement for today's trading day

```bash
curl -s -H "x-cron-secret: $CRON_SECRET" \
  "$BASE_URL/api/debug/internal-lock-events?accountId=cmottd1z200020do1knjxq582" \
  | jq '{activeCount, brokerEnforcements}'
```

Expected:
```json
{
  "activeCount": 0,
  "brokerEnforcements": { "count": 0, "hasAnyBrokerLocked": false, "items": [] }
}
```

**After the 2026-05-15 canary:** `brokerEnforcements.count` may be `1` (historical row for 2026-05-14). This is expected and does not block a new canary.

Abort if:
- `activeCount > 0` — an active internal lock exists
- Any `brokerEnforcements.items` entry has a `dedupKey` matching **today's** trading day (`<YYYY-MM-DD>`) — that would mean enforcement already ran today and cannot be repeated via the dedup gate

### 2C. Gate baseline — allowlist, env, permissionLevel confirmed clean

```bash
curl -s -H "x-cron-secret: $CRON_SECRET" \
  "$BASE_URL/api/debug/broker-enforcement-gates" \
  | jq '{brokerEnforcementEnabled, listenerLiveEnabled, allowlist, activeLockCount, candidates}'
```

Expected:
```json
{
  "brokerEnforcementEnabled": false,
  "listenerLiveEnabled": false,
  "allowlist": ["cmottd1z200020do1knjxq582"],
  "activeLockCount": 0,
  "candidates": []
}
```

Abort if: `listenerLiveEnabled: true`, `allowlist` is empty or missing `cmottd1z200020do1knjxq582`, any candidate with `env != "demo"`.

### 2D. riskState is NORMAL

```bash
curl -s -H "x-cron-secret: $CRON_SECRET" \
  "$BASE_URL/api/debug/internal-lock-diagnostic?accountId=cmottd1z200020do1knjxq582" \
  | jq '{sessionRiskState: .gates.sessionRiskState}'
```

Expected: `{ "sessionRiskState": "NORMAL" }`.

Abort if `"STOPPED"`. Reset with `POST /api/debug/accounts/cmottd1z200020do1knjxq582/reset-session-state`, then re-verify.

### 2E. Dedup key slot is free

```bash
curl -s -H "x-cron-secret: $CRON_SECRET" \
  "$BASE_URL/api/debug/internal-lock-events?accountId=cmottd1z200020do1knjxq582" \
  | jq '.brokerEnforcements.items'
```

Expected: `[]`. Abort if any item has a `listenerBrokerDedupKey` matching today's date (`<YYYY-MM-DD>`).

### 2F. Record rules baseline before modifying

```bash
curl -s -H "x-cron-secret: $CRON_SECRET" \
  "$BASE_URL/api/debug/rule-baseline-state?accountId=cmottd1z200020do1knjxq582" \
  | jq '{maxDailyLoss, maxTradesPerDay, stopAfterLosses}'
```

**Write down the returned values.** You will restore them exactly in rollback Step R3.

---

## 3. Rehearsal — Gate Verification Without Broker Write

Run this section in full before the real canary. It confirms the wiring and all gates work correctly while `BROKER_ENFORCEMENT_ENABLED` remains false and no broker write can occur.

### R-Step 1 — Set GUARDRAIL_INTERNAL_LOCK_ENABLED=true on listener-worker

In the listener-worker Railway service, set:
```
GUARDRAIL_INTERNAL_LOCK_ENABLED=true
```
Leave all other vars at rest state. Redeploy the listener-worker.

Verify it reconnects:
```bash
curl -s -H "x-cron-secret: $CRON_SECRET" \
  "$BASE_URL/api/debug/tradovate-listener/status" \
  | jq '.activeDemo.listener.status'
```
Expected: `"connected"` (or `"reconnecting"` with a recent heartbeat). Wait and retry if still reconnecting.

### R-Step 2 — Set maxDailyLoss low to trigger a violation

Set `AccountRiskRules.maxDailyLoss` for `cmottd1z200020do1knjxq582` to `$5.00` (or another small value that will be exceeded by the account's current session P&L). Use the app's risk rules UI or admin endpoint.

Verify:
```bash
curl -s -H "x-cron-secret: $CRON_SECRET" \
  "$BASE_URL/api/debug/rule-baseline-state?accountId=cmottd1z200020do1knjxq582" \
  | jq '.maxDailyLoss'
```
Expected: `5`.

### R-Step 3 — Trigger a P&L update that breaches the threshold

Cause `dailyPnl` to go below `-maxDailyLoss` so `evaluateDryRunRules` returns a `daily_loss_limit` violation. Options:
- Place a small losing trade on the demo account
- Use `/api/debug/fire-test-event` to inject a props update with a negative `pnl` below threshold

Verify the violation is detected:
```bash
curl -s -H "x-cron-secret: $CRON_SECRET" \
  "$BASE_URL/api/debug/internal-lock-diagnostic?accountId=cmottd1z200020do1knjxq582" \
  | jq '{violations, wouldCreateLock}'
```
Expected: `violations` contains one entry with `ruleType: "daily_loss_limit"`, `wouldCreateLock: true`.

### R-Step 4 — Wait for InternalLockEvent to be created

With `GUARDRAIL_INTERNAL_LOCK_ENABLED=true`, the next props event triggers `applyInternalLockForConnection`. Wait up to 30 seconds, then verify:

```bash
curl -s -H "x-cron-secret: $CRON_SECRET" \
  "$BASE_URL/api/debug/internal-lock-events?accountId=cmottd1z200020do1knjxq582" \
  | jq '{activeCount, items: [.items[] | {id, ruleType, tradingDay, clearedAt}]}'
```

Expected: `activeCount: 1`, one item with `ruleType: "daily_loss_limit"`, `clearedAt: null`.

Record the `InternalLockEvent.id` — needed for rollback if cleanup is required after this step.

### R-Step 5 — Confirm gate check: only BROKER_ENFORCEMENT_ENABLED is blocking

```bash
curl -s -H "x-cron-secret: $CRON_SECRET" \
  "$BASE_URL/api/debug/broker-enforcement-gates" \
  | jq '{
      brokerEnforcementEnabled,
      candidates: [.candidates[] | {
        accountId,
        inAllowlist,
        env,
        permissionLevel,
        gateResult: { allowed: .gateResult.allowed, skipReason: .gateResult.skipReason }
      }]
    }'
```

**Rehearsal passes if and only if ALL of the following are true:**

- `brokerEnforcementEnabled: false`
- `candidates.length == 1`
- `candidates[0].accountId == "cmottd1z200020do1knjxq582"`
- `candidates[0].inAllowlist == true`
- `candidates[0].env == "demo"`
- `candidates[0].permissionLevel == "full_access"`
- `candidates[0].gateResult.allowed == false`
- `candidates[0].gateResult.skipReason` mentions only `BROKER_ENFORCEMENT_ENABLED` (no other gate)

Abort the rehearsal if `skipReason` references any other gate — diagnose before proceeding.

### R-Step 6 — Confirm no broker write occurred

```bash
curl -s -H "x-cron-secret: $CRON_SECRET" \
  "$BASE_URL/api/debug/internal-lock-events?accountId=cmottd1z200020do1knjxq582" \
  | jq '.brokerEnforcements'
```

Expected: `{ "count": 0, "hasAnyBrokerLocked": false, "items": [] }`.

If `count > 0`: something bypassed gate 1 — stop immediately, check logs, do not proceed.

### R-Step 7 — Rehearsal cleanup

Reset the internal lock and restore rules:

```bash
# Clear riskState and InternalLockEvent
curl -s -X POST -H "x-cron-secret: $CRON_SECRET" \
  "$BASE_URL/api/debug/accounts/cmottd1z200020do1knjxq582/reset-session-state"

# Verify clean
curl -s -H "x-cron-secret: $CRON_SECRET" \
  "$BASE_URL/api/debug/internal-lock-events?accountId=cmottd1z200020do1knjxq582" \
  | jq '{activeCount}'
```

Expected: `{ "activeCount": 0 }`.

Then restore `maxDailyLoss` to the value recorded in pre-flight check 2F.

On the listener-worker Railway service:
```
Set GUARDRAIL_INTERNAL_LOCK_ENABLED=false   ← back to rest state
```
Redeploy.

---

## 4. Real Canary — First Actual Broker Write

Do not execute this section until the full rehearsal (Section 3) has passed and a human confirms the checkpoint below.

### C-Step 1 — Set maxDailyLoss low to trigger violation

Same as R-Step 2. Set `AccountRiskRules.maxDailyLoss` to `$5.00`. Verify the rule is saved.

### C-Step 2 — Trigger P&L breach

Same as R-Step 3. Cause `dailyPnl` to go below `-maxDailyLoss`.

Verify via `/api/debug/internal-lock-diagnostic`: `wouldCreateLock: true`.

### C-Step 3 — Verify simulation payload before enabling enforcement

```bash
curl -s -H "x-cron-secret: $CRON_SECRET" \
  "$BASE_URL/api/debug/broker-enforcement-simulation" \
  | jq '.candidates[0] | {brokerEligible, simulatedPayloadPreview}'
```

Expected:
```json
{
  "brokerEligible": true,
  "simulatedPayloadPreview": {
    "dailyLossAutoLiq": <positive number equal to |dailyPnl|>,
    "changesLocked": true
  }
}
```

**Abort if `simulatedPayloadPreview.doNotUnlock` is present.** That field must never appear.

---

### ⚠️ Human Confirmation Checkpoint ⚠️

Before C-Step 4, a named person must confirm all of the following in writing:

- [ ] Rehearsal (Section 3) completed and passed — `candidates[0].gateResult.skipReason` referenced only `BROKER_ENFORCEMENT_ENABLED`
- [ ] Pre-flight checks 2A–2F all passed
- [ ] `wouldCreateLock: true` confirmed for `daily_loss_limit`
- [ ] `brokerEligible: true` confirmed in simulation
- [ ] `simulatedPayloadPreview.doNotUnlock` absent
- [ ] `simulatedPayloadPreview.dailyLossAutoLiq` is the correct positive dollar value
- [ ] Original `maxDailyLoss` rule value recorded for rollback
- [ ] Rollback procedure (Section 6) understood and ready
- [ ] No live accounts in scope — `listenerLiveEnabled: false` confirmed

**Do not change any env var without this sign-off.**

---

### C-Step 4 — Enable broker enforcement (listener-worker service only)

In the **listener-worker** Railway service, set all of the following in one deploy:

```
BROKER_ENFORCEMENT_ENABLED=true
ENFORCEMENT_DRY_RUN=false           ← remove or set to false
GUARDRAIL_INTERNAL_LOCK_ENABLED=true
TRADOVATE_LISTENER_ENABLE_LIVE=false  ← confirm unchanged
BROKER_ENFORCEMENT_DEMO_ACCOUNT_ALLOWLIST=cmottd1z200020do1knjxq582  ← confirm unchanged
```

Redeploy the listener-worker.

**The real Tradovate HTTP call occurs on the first props event for account `cmottd1z200020do1knjxq582` after the listener reconnects.**

### C-Step 5 — Verify within 60 seconds

Wait for the listener to reconnect, then on the next props event:

```bash
curl -s -H "x-cron-secret: $CRON_SECRET" \
  "$BASE_URL/api/debug/internal-lock-events?accountId=cmottd1z200020do1knjxq582" \
  | jq '.brokerEnforcements'
```

Expected:
```json
{
  "count": 1,
  "hasAnyBrokerLocked": true,
  "items": [{
    "brokerLockStatus": "broker_locked",
    "listenerBrokerDedupKey": "cmottd1z200020do1knjxq582:daily_loss_limit:<YYYY-MM-DD>:broker_enforcement"
  }]
}
```

| `brokerLockStatus` value | Meaning | Action |
|---|---|---|
| `"broker_locked"` | Tradovate confirmed the write via read-back | Canary success |
| `"dry_run"` | `ENFORCEMENT_DRY_RUN` was still `true` — write was simulated | Rollback, fix env, retry |
| `"broker_lock_failed"` | POST accepted by Tradovate but read-back did not confirm value | Rollback immediately |
| Row absent after 60s | Props event may not have fired yet | Wait one more cycle or trigger manually |

---

## 5. Expected Broker Write

### Endpoint sequence

```
Step 1 (read):    GET  userAccountAutoLiq/deps?masterid={tvAccountId}
                  → determine if record exists (update path) or must be created (create path)

Step 2 (write):   POST userAccountAutoLiq/update  { id, dailyLossAutoLiq, changesLocked: true }
                    or
                  POST userAccountAutoLiq/create  { accountId: tvAccountId, dailyLossAutoLiq, changesLocked: true }

Step 3 (confirm): check response.dailyLossAutoLiq ≈ sent value (tolerance: $0.01)
                  if absent in response: GET userAccountAutoLiq/deps?masterid={tvAccountId} again
                  → brokerLockStatus = "broker_locked" only when confirmed
                  → brokerLockStatus = "broker_lock_failed" when value not confirmed
```

### Update payload (record already exists)

```json
{
  "id": <existing-record-id>,
  "dailyLossAutoLiq": <Math.max(0, Math.abs(dailyPnl))>,
  "changesLocked": true
}
```

### Create payload (no record exists)

```json
{
  "accountId": <tradovate-numeric-account-id>,
  "dailyLossAutoLiq": <Math.max(0, Math.abs(dailyPnl))>,
  "changesLocked": true
}
```

### Required fields

| Field | Value |
|---|---|
| `dailyLossAutoLiq` | `Math.max(0, Math.abs(dailyPnl))` — sets broker threshold at current loss so Tradovate enforces immediately |
| `changesLocked` | `true` — prevents removal mid-session |

### Fields that must never appear in the payload

| Field | Reason |
|---|---|
| `doNotUnlock` | Traps account permanently — Tradovate will not auto-unlock at next session open |
| `weeklyLossAutoLiq` | Not used in Phase 2C — adds unintended weekly constraint |
| `flattenTimestamp` | Session-end scheduler not implemented |
| `trailingMaxDrawdown` | Not used |
| `dailyProfitAutoLiq` | Wrong rule — only for `profit_target`, not `daily_loss_limit` |

### What `changesLocked: true` does and does NOT do

- **Does:** prevents changes to `userAccountAutoLiq` settings until the next session open (~5:00 PM CT, CME futures).
- **Does NOT:** prevent position exits, manual trades, or account access.
- **Auto-clears:** Tradovate auto-unlocks at next session open since `doNotUnlock` is omitted.

---

## 6. Rollback

Run in order. Safe to run at any abort condition, even if the canary was never fully executed.

### R1 — Disable broker enforcement (listener-worker service)

In the listener-worker Railway service, set all of the following in one deploy:

```
BROKER_ENFORCEMENT_ENABLED=false   (or remove)
ENFORCEMENT_DRY_RUN=true
GUARDRAIL_INTERNAL_LOCK_ENABLED=false
TRADOVATE_LISTENER_ENABLE_LIVE=false
```

Redeploy. Gate 1 now fails on every props event. No further broker enforcement calls occur.

### R2 — Verify listener reconnects

```bash
curl -s -H "x-cron-secret: $CRON_SECRET" \
  "$BASE_URL/api/debug/tradovate-listener/status" \
  | jq '.activeDemo.listener.status'
```

Expected: `"connected"`. If crashing, check Railway deploy logs.

### R3 — Reset internal app lock

```bash
curl -s -X POST -H "x-cron-secret: $CRON_SECRET" \
  "$BASE_URL/api/debug/accounts/cmottd1z200020do1knjxq582/reset-session-state"
```

This sets `riskState = NORMAL`, zeros session P&L/trades/losses, and nulls `activeDedupKey` on all active InternalLockEvent rows.

Verify:
```bash
curl -s -H "x-cron-secret: $CRON_SECRET" \
  "$BASE_URL/api/debug/internal-lock-events?accountId=cmottd1z200020do1knjxq582" \
  | jq '{activeCount}'
```

Expected: `{ "activeCount": 0 }`.

### R4 — Restore original risk rules

Set `AccountRiskRules.maxDailyLoss` back to the value recorded in pre-flight check 2F.

Verify:
```bash
curl -s -H "x-cron-secret: $CRON_SECRET" \
  "$BASE_URL/api/debug/rule-baseline-state?accountId=cmottd1z200020do1knjxq582" \
  | jq '.maxDailyLoss'
```

Expected: original value from 2F.

### R5 — Clear broker-side lock (if `brokerLockStatus = "broker_locked"` was written)

`changesLocked: true` prevents changes to `userAccountAutoLiq` until the next session open.

**Option A (preferred):** Wait for the next Tradovate session open (~5:00 PM CT). `changesLocked` auto-clears because `doNotUnlock` was omitted. Verify the following trading day:
```
GET userAccountAutoLiq/deps?masterid={tvAccountId}
```
`changesLocked` should be absent or `false`.

**Option B (same session, admin required):** Use the Tradovate Risk Manager UI to manually clear `changesLocked` and reset `dailyLossAutoLiq`. This requires Account Risk Settings: Full Access in the Tradovate portal.

> **Do NOT send `POST userAccountAutoLiq/update { changesLocked: false }` from this app while `changesLocked: true` is in effect.** Tradovate rejects the request — `changesLocked` prevents all setting changes, including unlocking itself via the API.

### R6 — Final verification

```bash
curl -s -H "x-cron-secret: $CRON_SECRET" \
  "$BASE_URL/api/debug/broker-enforcement-gates" \
  | jq '{brokerEnforcementEnabled, activeLockCount, candidates}'
```

Expected after full rollback:
```json
{
  "brokerEnforcementEnabled": false,
  "activeLockCount": 0,
  "candidates": []
}
```

---

## 7. Abort Conditions

Stop immediately and execute rollback (Section 6) if any of the following occur at any point.

| Condition | Why |
|---|---|
| Any candidate has `env != "demo"` | Live account in scope — never permitted |
| `candidates.length > 1` | More than one account eligible — canary must be single-account |
| `listenerLiveEnabled: true` at any check | Gate 2 would be bypassed |
| `allowlist` empty or missing `cmottd1z200020do1knjxq582` | Gate 4 would not protect other accounts |
| `candidates[0].inAllowlist != true` | Account not gated — stop |
| `gateResult.skipReason` references any gate other than `BROKER_ENFORCEMENT_ENABLED` during rehearsal R-Step 5 | An unexpected prerequisite is not met |
| `simulatedPayloadPreview.doNotUnlock` present | Code regression — would permanently trap account |
| `brokerEnforcements.count > 0` at end of rehearsal R-Step 6 | Broker write occurred while flag was false — investigate |
| `ENFORCEMENT_DRY_RUN=true` confirmed in listener env after C-Step 4 restart | Real write cannot have occurred — dry-run was still in effect |
| Listener does not reconnect within 90 seconds of C-Step 4 restart | Worker may be crashing — check Railway logs before proceeding |
| `brokerLockStatus = "broker_lock_failed"` | Tradovate accepted write but read-back failed — account may be partially locked |
| `brokerLockStatus = "dry_run"` after C-Step 4 | `ENFORCEMENT_DRY_RUN` was not cleared — write was simulated |
| More than one `GuardianIntervention` row with same dedup key | DB unique constraint should prevent this — stop if observed |
| `candidates[0].permissionLevel != "full_access"` | Write would fail at broker layer |
| Listener `connectionStatus` not `"connected_readonly"` during pre-flight | Connection not healthy |

---

## 8. Reference: Debug Endpoints

All require an authenticated session cookie and `x-cron-secret: $CRON_SECRET` header.

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/debug/tradovate-listener/status` | GET | Listener WebSocket status and connection state |
| `/api/debug/broker-enforcement-gates` | GET | Per-lock gate evaluation; `inAllowlist`, `env`, `permissionLevel`, `gateResult` |
| `/api/debug/broker-enforcement-simulation` | GET | Broker eligibility simulation (requires `BROKER_ENFORCEMENT_SIMULATION_ENABLED=true` in web service) |
| `/api/debug/internal-lock-events?accountId=<id>` | GET | Active locks + `brokerEnforcements` audit rows |
| `/api/debug/internal-lock-diagnostic?accountId=<id>` | GET | Full gate trace for `applyInternalLockForConnection` |
| `/api/debug/rule-baseline-state?accountId=<id>` | GET | Current `maxDailyLoss` and other risk rule values |
| `/api/debug/accounts/<accountId>/reset-session-state` | POST | Set `riskState=NORMAL`, clear active locks, zero session P&L |

---

## 9. Key Invariants That Must Hold Throughout

1. **At most one active `InternalLockEvent`** per `(accountId, ruleType, tradingDay)` — enforced by `activeDedupKey @unique`.
2. **At most one `GuardianIntervention`** per `listenerBrokerDedupKey` — enforced by `listenerBrokerDedupKey @unique`.
3. **`brokerLockStatus = "broker_locked"` only when Tradovate read-back confirms** the stored value matches the sent value (tolerance $0.01).
4. **`doNotUnlock` never appears in any payload** — omitting it preserves Tradovate's default auto-unlock at next session open.
5. **`changesLocked: true` auto-clears** at Tradovate session open since `doNotUnlock` is absent.
6. **`TRADOVATE_LISTENER_ENABLE_LIVE=false` is never changed** — live account enforcement is not implemented.
7. **`ENFORCEMENT_DRY_RUN=true` at rest** — broker writes are simulated until the real canary checkpoint. A `"dry_run"` `GuardianIntervention` row is not a canary success.
8. **Pre-existing active locks are surfaced on every props event** — when `riskState` is already `STOPPED`, `applyInternalLockForConnection` queries for the existing active `InternalLockEvent` (`clearedAt=null`, `activeDedupKey IS NOT NULL`, newest first) and returns its ID. This ensures `BROKER_ENFORCEMENT_ENABLED` can be flipped on at any time and the broker enforcement service will be called on the next props event, even if the internal lock predates the flag change. Dedup is handled by the `GuardianIntervention.listenerBrokerDedupKey @unique` constraint inside the service — not by the caller.

---

## 10. First Demo Canary Result — 2026-05-15

**Status: COMPLETED. Rollback clean. No further canary without fresh review.**

### Outcome

| Field | Value |
|---|---|
| Account | `cmottd1z200020do1knjxq582` (DEMO7433035) |
| Rule type | `daily_loss_limit` |
| Trading day | `2026-05-14` |
| InternalLockEvent id | `cmp79yy0e00010onn9wl1sthv` |
| GuardianIntervention id | `cmp7a2hlw00000on41irjkb1c` |
| `listenerBrokerDedupKey` | `cmottd1z200020do1knjxq582:daily_loss_limit:2026-05-14:broker_enforcement` |
| `brokerLockStatus` | `broker_locked` |
| `brokerEnforcements.count` | 1 |
| `hasAnyBrokerLocked` | `true` |

### Rollback

| Step | Result |
|---|---|
| `reset-session-state` | succeeded |
| `previousRiskState` | `STOPPED` |
| `newRiskState` | `NORMAL` |
| `activeCount` after reset | 0 |
| `brokerEnforcements.count` after reset | 1 (historical — GuardianIntervention is immutable) |
| `hasHistoricalBrokerLockOnly` | `true` (expected — audit row remains, no active internal lock) |
| Live accounts | none touched |
| Flatten / cancel / orders | none |

### Post-canary env state (all services)

| Var | Value |
|---|---|
| `BROKER_ENFORCEMENT_ENABLED` | `false` or absent |
| `ENFORCEMENT_DRY_RUN` | `true` |
| `GUARDRAIL_INTERNAL_LOCK_ENABLED` | `false` |
| `TRADOVATE_LISTENER_ENABLE_LIVE` | `false` |

### Notes

**Broker-side lock auto-clears:** The canary write set `changesLocked: true` on trading day 2026-05-14. Because `doNotUnlock` was omitted, Tradovate auto-clears `changesLocked` at the next session open (~5:00 PM CT). Since the canary was on 2026-05-14, the broker-side lock has auto-cleared by 2026-05-15.

**Historical row is not an active lock:** After `reset-session-state`, `activeCount=0` but `brokerEnforcements.count=1`. The debug endpoint now includes `hasHistoricalBrokerLockOnly: true` to make this distinction explicit. A future canary on a new trading day uses a different dedup key and is not blocked by this historical row.

**Root cause of first silent failure (fixed before success):** The first canary attempt produced `brokerEnforcements.count=0` because `applyInternalLockForConnection` returned `internalLockEventId=null` for the already-STOPPED account. Fixed in commit `35a5b8a` — see design doc Section 16.

---

## 11. Final Status — Phase 2C Complete (2026-05-15)

**The Phase 2C demo canary is complete. All services are back in safe mode. No further enforcement action is in progress.**

### Safe-mode env state (confirmed post-canary)

**listener-worker:**

| Variable | Value |
|---|---|
| `BROKER_ENFORCEMENT_ENABLED` | `false` or absent |
| `ENFORCEMENT_DRY_RUN` | `true` |
| `GUARDRAIL_INTERNAL_LOCK_ENABLED` | `false` |
| `TRADOVATE_LISTENER_ENABLE_LIVE` | `false` |
| `BROKER_ENFORCEMENT_DEMO_ACCOUNT_ALLOWLIST` | `cmottd1z200020do1knjxq582` |

**web/app (trading-coach2):**

| Variable | Value |
|---|---|
| `BROKER_ENFORCEMENT_SIMULATION_ENABLED` | `true` |

### Customer UI status

The Manage Connection page for DEMO7433035 shows:

```
Broker protection status                    [No active Guardrail lock]
Demo broker protection test completed.
No active Guardrail lock right now.
```

No technical audit fields are shown to the customer. The dashboard shows "Allowed to trade" and "Risk state: Normal". Full audit data remains available at `/api/debug/internal-lock-events`.

### Carry-forward safety rules

- Do not run another canary without completing the Section 4 pre-flight from scratch.
- Do not enable live enforcement (`TRADOVATE_LISTENER_ENABLE_LIVE=false` must remain unchanged).
- Do not add flatten, cancel, or order actions without a separate design review.
- The `GuardianIntervention` row (`broker_locked`, trading day 2026-05-14) is an immutable audit record — it does not represent an active lock and does not block future canaries on different trading days.
- Full canary facts and design rationale: `docs/PHASE_2C_BROKER_ENFORCEMENT_DESIGN.md` Section 17.

**Next canary:** Re-run full rehearsal (Section 3), verify today's `brokerEnforcements.count=0`, confirm fresh `activeCount>0`, human sign-off, then C-Step 4.
