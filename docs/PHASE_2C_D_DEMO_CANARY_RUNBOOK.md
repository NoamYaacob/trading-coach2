# Phase 2C-D: Demo Canary Runbook — First Real Broker Write

**Status: PLANNING ONLY. No broker write has been sent. Do not execute until all pre-flight checks pass and a human confirms the checkpoint in Step 5.**

**Safety boundaries in effect:**
- `BROKER_ENFORCEMENT_ENABLED` must remain absent/false until Step 5 checkpoint
- `TRADOVATE_LISTENER_ENABLE_LIVE=false` — unchanged throughout, live accounts never touched
- No flatten, no order cancellation, no order placement
- Only account `cmottd1z200020do1knjxq582` (demo) is eligible for this canary
- Abort immediately on any abort condition in Section 6

---

## 1. Env Vars Required

These must be set in the **listener-worker process only** (not the web process, not the cron process) before the canary step that enables enforcement. All other env vars remain unchanged.

### Must be set before canary

```
BROKER_ENFORCEMENT_ENABLED=true
BROKER_ENFORCEMENT_DEMO_ACCOUNT_ALLOWLIST=cmottd1z200020do1knjxq582
GUARDRAIL_INTERNAL_LOCK_ENABLED=true
```

### Must already be set (verify, do not change)

```
TRADOVATE_LISTENER_ENABLE_LIVE=false      # gate 2 — must remain false
ENFORCEMENT_DRY_RUN=false                 # see note below
```

### ENFORCEMENT_DRY_RUN note

`ENFORCEMENT_DRY_RUN` is checked inside `applyBrokerDayLockout` **after** all connection/permission gates pass. When `ENFORCEMENT_DRY_RUN=true`, the broker write is fully simulated — `riskState` still becomes `STOPPED`, a `GuardianIntervention` row is written with `brokerLockStatus = "dry_run"`, but **no HTTP call is made to Tradovate**. This is the current state.

For the first real broker write, `ENFORCEMENT_DRY_RUN` must be `false` (or absent). Confirm the current value:

```bash
# In the listener-worker process environment:
echo $ENFORCEMENT_DRY_RUN   # must be empty or "false"
```

If `ENFORCEMENT_DRY_RUN=true` is set, the broker write will be silently skipped and `GuardianIntervention.brokerLockStatus` will read `"dry_run"` — not `"broker_locked"`. That is not a canary success.

---

## 2. Pre-Flight Checks

Run all checks before touching any env var. All must pass. **Do not proceed if any check fails.**

### 2A. Account is clean — no active locks, no existing enforcements

```bash
# Check 1: no active InternalLockEvents for the canary account
curl -s -H "x-cron-secret: $CRON_SECRET" \
  "$BASE_URL/api/debug/internal-lock-events?accountId=cmottd1z200020do1knjxq582" \
  | jq '{activeCount, brokerEnforcements}'
```

Expected:
```json
{
  "activeCount": 0,
  "brokerEnforcements": { "count": 0, "hasAnyBrokerLocked": false }
}
```

Abort if `activeCount > 0` or `brokerEnforcements.count > 0`.

### 2B. Account connection state — permissionLevel, env, connectionStatus

```bash
# Check 2: account has full_access, demo env, live connection
curl -s -H "x-cron-secret: $CRON_SECRET" \
  "$BASE_URL/api/debug/broker-enforcement-gates" \
  | jq '{brokerEnforcementEnabled, listenerLiveEnabled, allowlist, activeLockCount, candidates}'
```

Expected at this stage (before creating the trigger lock):
```json
{
  "brokerEnforcementEnabled": false,
  "listenerLiveEnabled": false,
  "allowlist": ["cmottd1z200020do1knjxq582"],
  "activeLockCount": 0,
  "candidates": []
}
```

If the endpoint returns any candidate with `env != "demo"`, `permissionLevel != "full_access"`, or `connectionStatus` in the non-live set — abort.

### 2C. Account riskState is NORMAL

```bash
# Check 3: riskState must be NORMAL before the test
curl -s -H "x-cron-secret: $CRON_SECRET" \
  "$BASE_URL/api/debug/internal-lock-diagnostic?accountId=cmottd1z200020do1knjxq582" \
  | jq '{gates: {sessionRiskState: .gates.sessionRiskState}}'
```

Expected:
```json
{ "gates": { "sessionRiskState": "NORMAL" } }
```

Abort if `sessionRiskState` is `"STOPPED"`. Run `POST /api/debug/accounts/cmottd1z200020do1knjxq582/reset-session-state` to clear, then re-verify.

### 2D. No live-env accounts eligible

```bash
# Check 4: confirm no live accounts appear in broker-enforcement-gates
curl -s -H "x-cron-secret: $CRON_SECRET" \
  "$BASE_URL/api/debug/broker-enforcement-gates" \
  | jq '[.candidates[] | select(.env != "demo")] | length'
```

Expected: `0`. Abort if any non-demo account appears.

### 2E. Dedup key slot is free

Compute the expected dedup key: `cmottd1z200020do1knjxq582:daily_loss_limit:<YYYY-MM-DD>:broker_enforcement`
(where `<YYYY-MM-DD>` is today's trading day in the session).

Verify no `GuardianIntervention` exists with this key:
```bash
# Check 5: the dedup key slot must be empty
curl -s -H "x-cron-secret: $CRON_SECRET" \
  "$BASE_URL/api/debug/internal-lock-events?accountId=cmottd1z200020do1knjxq582" \
  | jq '.brokerEnforcements.items'
```

Expected: `[]`. Abort if any item has a `listenerBrokerDedupKey` matching today's date.

### 2F. Rules baseline — record current values before modifying

```bash
# Check 6: record baseline risk rules before the canary
curl -s -H "x-cron-secret: $CRON_SECRET" \
  "$BASE_URL/api/debug/rule-baseline-state?accountId=cmottd1z200020do1knjxq582" \
  | jq '{maxDailyLoss, maxTradesPerDay, stopAfterLosses}'
```

**Write down the returned values.** You will restore them exactly in the rollback step.

---

## 3. Canary Steps

Execute in order. Do not skip steps. Do not proceed past Step 5 without human confirmation.

### Step 1 — Set Max Daily Loss low enough to trigger immediately

Set `AccountRiskRules.maxDailyLoss` to a small amount (e.g., `$5.00`) so that the next filled tick puts the account over the limit without requiring a real losing trade.

Do this via the app's risk rules UI or the appropriate admin endpoint. Confirm the rule is saved:

```bash
curl -s -H "x-cron-secret: $CRON_SECRET" \
  "$BASE_URL/api/debug/rule-baseline-state?accountId=cmottd1z200020do1knjxq582" \
  | jq '.maxDailyLoss'
```

Expected: `5` (or whatever small value was set).

### Step 2 — Simulate a daily loss that exceeds the threshold

Trigger a P&L update that puts `dailyPnl` below `-maxDailyLoss` so `evaluateDryRunRules` returns a `daily_loss_limit` violation. This can be done by:
- Simulating a small losing trade on the demo account, or
- Using the fire-test-event debug endpoint to inject a props update with a negative `pnl` field below the threshold

Verify the violation is detected:
```bash
curl -s -H "x-cron-secret: $CRON_SECRET" \
  "$BASE_URL/api/debug/internal-lock-diagnostic?accountId=cmottd1z200020do1knjxq582" \
  | jq '{violations, wouldCreateLock}'
```

Expected: `violations` contains one entry with `ruleType: "daily_loss_limit"`, `wouldCreateLock: true`.

### Step 3 — Wait for GUARDRAIL_INTERNAL_LOCK_ENABLED=true to create the InternalLockEvent

With `GUARDRAIL_INTERNAL_LOCK_ENABLED=true` set in the listener worker, the next props event for the account will cause `applyInternalLockForConnection` to run. This creates an `InternalLockEvent` row and sets `riskState = STOPPED`.

Verify:
```bash
curl -s -H "x-cron-secret: $CRON_SECRET" \
  "$BASE_URL/api/debug/internal-lock-events?accountId=cmottd1z200020do1knjxq582" \
  | jq '{activeCount, items: [.items[] | {id, ruleType, tradingDay, clearedAt}]}'
```

Expected: `activeCount: 1`, one item with `ruleType: "daily_loss_limit"`, `clearedAt: null`.

Record the `InternalLockEvent.id` — you will need it for rollback.

### Step 4 — Verify gateResult.allowed=true before enabling the broker write

With `BROKER_ENFORCEMENT_ENABLED=false` still set, call the gate debug endpoint:

```bash
curl -s -H "x-cron-secret: $CRON_SECRET" \
  "$BASE_URL/api/debug/broker-enforcement-gates" \
  | jq '.candidates[0].gateResult'
```

Expected:
```json
{
  "allowed": false,
  "skipReason": "BROKER_ENFORCEMENT_ENABLED is not true — broker writes are disabled...",
  "dedupKey": "cmottd1z200020do1knjxq582:daily_loss_limit:<YYYY-MM-DD>:broker_enforcement",
  "brokerActionType": null,
  "payloadPreview": null
}
```

This confirms: all other 9 gates pass. The only gate blocking the write is gate 1 (the feature flag). The candidate count must be exactly 1.

**Abort if `candidates.length != 1` or if `skipReason` references any gate other than `BROKER_ENFORCEMENT_ENABLED`.**

Also verify the simulation endpoint agrees:
```bash
curl -s -H "x-cron-secret: $CRON_SECRET" \
  "$BASE_URL/api/debug/broker-enforcement-simulation" \
  | jq '.candidates[0] | {brokerEligible, skipReason, simulatedPayloadPreview}'
```

Expected: `brokerEligible: true`, `simulatedPayloadPreview.changesLocked: true`, `simulatedPayloadPreview.dailyLossAutoLiq >= 0`.

**The `simulatedPayloadPreview.dailyLossAutoLiq` value is the exact dollar amount that will be written to Tradovate. Confirm it is the absolute value of the account's current daily loss, and that `doNotUnlock` is not present.**

---

## ⚠️ Checkpoint — Human Confirmation Required Before Continuing ⚠️

Before proceeding to Step 5, a human must confirm all of the following in writing:

- [ ] Pre-flight checks 2A–2F all passed
- [ ] `activeLockCount = 1`, `candidates.length = 1`
- [ ] The single candidate is `cmottd1z200020do1knjxq582`
- [ ] `env = "demo"` for the candidate
- [ ] `gateResult.skipReason` references only `BROKER_ENFORCEMENT_ENABLED`
- [ ] `simulatedPayloadPreview.doNotUnlock` is absent
- [ ] `ENFORCEMENT_DRY_RUN` is false or absent
- [ ] `TRADOVATE_LISTENER_ENABLE_LIVE=false` confirmed in listener env
- [ ] Rollback procedure (Section 5) is understood and ready

**Do not set `BROKER_ENFORCEMENT_ENABLED=true` without this confirmation.**

---

### Step 5 — Enable BROKER_ENFORCEMENT_ENABLED and trigger enforcement

Set `BROKER_ENFORCEMENT_ENABLED=true` in the **listener-worker process environment only**. Restart the listener worker.

The next props event for account `cmottd1z200020do1knjxq582` will cause `maybeAttemptBrokerDailyLossLockoutForInternalLock` to be called (once it is wired into the listener — see note below). All 10 gates will pass, and `triggerEnforcement` will call `applyBrokerDayLockout` → `applyDailyLossLock`.

> **Note (updated Phase 2C-E):** The listener wiring is now complete. `maybeAttemptBrokerDailyLossLockoutForInternalLock` is imported and called from the `onPropsEvent` handler, but only when `BROKER_ENFORCEMENT_ENABLED=true`. While the flag is absent or false, the `.then()` handler returns immediately and no broker service call is made. Setting `BROKER_ENFORCEMENT_ENABLED=true` is the only remaining step required to activate enforcement. No code changes are needed.

The real broker write moment: when `applyBrokerDayLockout` reaches the `case "daily_loss_limit":` branch inside `TradovateClient.applyDailyLossLock()` and POSTs to `userAccountAutoLiq/update` (or `/create`).

---

## 4. Expected Broker Write

### Endpoint sequence

```
Step 1 (read):    GET  userAccountAutoLiq/deps?masterid={tvAccountId}
                  → determine if record exists (update path) or must be created (create path)

Step 2 (write):   POST userAccountAutoLiq/update  (if record exists)
                    or
                  POST userAccountAutoLiq/create  (if no record)

Step 3 (confirm): check response.dailyLossAutoLiq ≈ sent value (tolerance: $0.01)
                  if absent: GET userAccountAutoLiq/deps?masterid={tvAccountId} again
                  → brokerLockStatus = "broker_locked" only when confirmed
                  → brokerLockStatus = "broker_lock_failed" when unconfirmed
```

### Update payload (when record already exists)

```json
{
  "id": <existing-record-id>,
  "dailyLossAutoLiq": <absolute-value-of-current-daily-loss>,
  "changesLocked": true
}
```

### Create payload (when no record exists)

```json
{
  "accountId": <tradovate-numeric-account-id>,
  "dailyLossAutoLiq": <absolute-value-of-current-daily-loss>,
  "changesLocked": true
}
```

### What the payload must contain

| Field | Value | Why |
|---|---|---|
| `dailyLossAutoLiq` | `Math.max(0, Math.abs(dailyPnl))` | Sets loss threshold at current loss — Tradovate immediately enforces |
| `changesLocked` | `true` | Prevents the setting from being removed mid-session |

### What must NOT be in the payload

| Field | Reason |
|---|---|
| `doNotUnlock` | Traps account permanently — Tradovate will not auto-unlock at next session open |
| `weeklyLossAutoLiq` | Not used in Phase 2C — would add an unintended weekly constraint |
| `flattenTimestamp` | Session-end scheduler not implemented — would trigger unexpected position exit |
| `trailingMaxDrawdown` | Not used — would add an unintended drawdown constraint |
| `dailyProfitAutoLiq` | Wrong rule — only set for `profit_target` trigger, not `daily_loss_limit` |

### What `changesLocked: true` does and does NOT do

- **Does:** prevents changes to `userAccountAutoLiq` settings until the next session open (approximately 5:00 PM CT for CME futures).
- **Does NOT:** prevent position exits, manual trades, or account access.
- **Auto-clears:** Tradovate auto-unlocks `changesLocked` at the next session open, since `doNotUnlock` is omitted.

### How to verify from the Tradovate side

After the write completes, verify by calling the read endpoint:

```
GET userAccountAutoLiq/deps?masterid={tvAccountId}
```

The response must show:
- `dailyLossAutoLiq` ≈ the sent value (within $0.01)
- `changesLocked: true`

This is done automatically by the code (Step 3 of the three-step pattern). If the code returns `broker_locked`, the read-back confirmed it. If it returns `broker_lock_failed`, the value was not confirmed — see abort/rollback.

### Verify from the GuardianIntervention audit row

```bash
curl -s -H "x-cron-secret: $CRON_SECRET" \
  "$BASE_URL/api/debug/internal-lock-events?accountId=cmottd1z200020do1knjxq582" \
  | jq '.brokerEnforcements'
```

Expected after a successful canary:
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

If `brokerLockStatus` is `"dry_run"`, `ENFORCEMENT_DRY_RUN` was still `true` — the write was simulated, not real.
If `brokerLockStatus` is `"broker_lock_failed"`, the POST succeeded but the read-back did not confirm — see abort/rollback.

---

## 5. Rollback

Run these steps in order immediately after the canary, or at any abort condition.

### Step R1 — Disable broker enforcement flag

```
Set BROKER_ENFORCEMENT_ENABLED=false (or remove it entirely)
Restart listener worker
```

Gate 1 now fails for every call. No further broker writes will occur regardless of InternalLockEvent state.

### Step R2 — Reset internal app lock (riskState and InternalLockEvent)

```bash
curl -s -X POST -H "x-cron-secret: $CRON_SECRET" \
  "$BASE_URL/api/debug/accounts/cmottd1z200020do1knjxq582/reset-session-state"
```

This:
- Sets `riskState = NORMAL`
- Sets `LiveSessionState.dailyPnl = 0`, `tradesCount = 0`, `consecutiveLosses = 0`
- Clears all active `InternalLockEvent` rows for the account (`clearedAt = now`, `activeDedupKey = null`)

Verify:
```bash
curl -s -H "x-cron-secret: $CRON_SECRET" \
  "$BASE_URL/api/debug/internal-lock-events?accountId=cmottd1z200020do1knjxq582" \
  | jq '{activeCount}'
```

Expected: `{ "activeCount": 0 }`

### Step R3 — Restore original risk rules

Set `AccountRiskRules.maxDailyLoss` back to the value recorded in pre-flight check 2F. Use the app's risk rules UI or admin endpoint.

Verify:
```bash
curl -s -H "x-cron-secret: $CRON_SECRET" \
  "$BASE_URL/api/debug/rule-baseline-state?accountId=cmottd1z200020do1knjxq582" \
  | jq '.maxDailyLoss'
```

Expected: the original value from check 2F.

### Step R4 — Clear the broker-side lock (if broker write was sent)

`changesLocked: true` prevents changes to `userAccountAutoLiq` **until the next session open** (approximately 5:00 PM CT). The lock auto-clears at session open because `doNotUnlock` was not set.

**Option A (preferred): wait for session open.** The lock auto-clears at the next Tradovate session open. No manual action needed. Verify via Tradovate UI or `GET userAccountAutoLiq/deps?masterid={tvAccountId}` the following trading day — `changesLocked` should be absent or `false`.

**Option B (if clearing before session close is required):** Contact Tradovate support or use the Tradovate Risk Manager UI (available to account admins) to manually set `changesLocked: false` and `dailyLossAutoLiq` back to its pre-canary value. This requires Account Risk Settings: Full Access permission in the Tradovate portal.

> **Do NOT attempt to unlock by sending `POST userAccountAutoLiq/update { changesLocked: false }` from this app while `changesLocked: true` is in effect.** Tradovate will reject the update — `changesLocked` prevents any setting changes, including unlocking itself. The Tradovate Risk Manager UI bypasses this restriction.

### Step R5 — Verify no active broker lock remains

After session open (or after manual UI unlock):
```
GET userAccountAutoLiq/deps?masterid={tvAccountId}
```

Confirm:
- `changesLocked` is absent, `false`, or `null`
- `dailyLossAutoLiq` has been cleared or reset to the intended value

---

## 6. Abort Conditions

Stop immediately and execute rollback (Section 5) if any of the following occur at any point.

| Condition | Why |
|---|---|
| Any candidate has `env != "demo"` | Live account would be touched — never permitted |
| `candidates.length > 1` | More than one account eligible — canary must be single-account |
| `allowlist` is empty or does not contain `cmottd1z200020do1knjxq582` | Gate 4 would not protect other accounts |
| `listenerLiveEnabled: true` | Live listener enabled — gate 2 would not block live path |
| Dedup key already exists in `GuardianIntervention` | A previous attempt was made — investigate before retrying |
| `permissionLevel != "full_access"` | Write would fail at broker layer |
| `gateResult.skipReason` references any gate other than `BROKER_ENFORCEMENT_ENABLED` (in Step 4) | An unexpected gate is blocking — diagnose before enabling the flag |
| Simulation `payloadPreview` contains `doNotUnlock` | Would permanently trap account — code regression |
| `ENFORCEMENT_DRY_RUN=true` confirmed in listener env | Real broker write cannot occur — must be false |
| `candidates[0].skipReason` contains "live" after enabling the flag | Live path somehow activated |
| Listener worker restarts unexpectedly during canary | Possible props event duplication — check duplicate GuardianIntervention rows |
| `brokerLockStatus` = `"broker_lock_failed"` after write | API accepted but read-back failed — account may be partially locked, rollback required |
| Any error from `triggerEnforcement` propagates | Unexpected exception — check logs, rollback |

---

## 7. Reference: Relevant Debug Endpoints

All require `Authorization: session` (authenticated user) and `x-cron-secret` header.

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/debug/broker-enforcement-gates` | GET | Per-lock gate evaluation; shows which gate blocks or allows |
| `/api/debug/broker-enforcement-simulation` | GET | Simulation of broker eligibility (gated on `BROKER_ENFORCEMENT_SIMULATION_ENABLED=true`) |
| `/api/debug/internal-lock-events?accountId=<id>` | GET | Active locks + `brokerEnforcements` audit rows |
| `/api/debug/internal-lock-diagnostic?accountId=<id>` | GET | Full gate trace for `applyInternalLockForConnection` |
| `/api/debug/accounts/<accountId>/reset-session-state` | POST | Reset `riskState=NORMAL`, clear active locks, zero session P&L |

---

## 8. Key Invariants That Must Hold Throughout

1. **At most one active `InternalLockEvent`** per `(accountId, ruleType, tradingDay)` — enforced by `activeDedupKey @unique`.
2. **At most one `GuardianIntervention`** per `listenerBrokerDedupKey` — enforced by `listenerBrokerDedupKey @unique`.
3. **`brokerLockStatus = "broker_locked"` only when Tradovate read-back confirms** the stored value matches the sent value (tolerance $0.01).
4. **`doNotUnlock` never appears in any payload** — omitting it preserves Tradovate's default auto-unlock at next session open.
5. **`changesLocked: true` auto-clears** at Tradovate session open (since `doNotUnlock` is absent).
6. **`TRADOVATE_LISTENER_ENABLE_LIVE=false` is never changed** — live account enforcement is not implemented.
