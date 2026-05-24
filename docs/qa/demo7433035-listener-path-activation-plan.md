# DEMO7433035 — Listener-Path Daily Loss Enforcement Plan
## Phase C: Real-Time Breach-Time Enforcement

**Account:** DEMO7433035  
**ConnectedAccount.id:** `cmottd1z200020do1knjxq582`  
**externalAccountId:** `47669364`  
**Date of this plan:** 2026-05-24  
**Precondition:** Rule-save path completed (Phase A + Phase B PASS — see `demo7433035-rule-save-activation-plan.md`)

---

## Audit Summary

This document is the output of a read-only code audit of the listener-path enforcement stack.
No code was changed. No env vars were changed. No broker calls were made.

---

## § KEY FINDING: `connected_readonly` Is NOT a Blocker

The concern raised in `demo7433035-rule-save-activation-plan.md §9` is **resolved by code analysis**.

`shouldSkipBrokerEnforcement` in `src/lib/brokers/enforcement-helpers.ts` (line 301) checks
`permissionLevel` BEFORE checking `connectionStatus`:

```typescript
if (opts.permissionLevel === "full_access") {
  return { skip: false };   // ← returns here, never reaches connected_readonly check
}
// Legacy fallback — only reached when permissionLevel is null or "unknown"
if (opts.connectionStatus === "connected_readonly") {
  return { skip: true, lockStatus: "unavailable_read_only", ... };
}
```

Since `permissionLevel=full_access` is confirmed on DEMO7433035 (verified by Phase B live write
success), `shouldSkipBrokerEnforcement` returns `skip=false` without ever reaching the
`connected_readonly` branch.

**`connected_readonly` is acceptable for the listener path when `permissionLevel=full_access`.**

---

## §1 — Listener-Path Execution Chain

Events arrive at the listener worker (`scripts/tradovate-listener-worker.ts`, line 658).
The `onPropsEvent` callback fires on every Tradovate WebSocket props event:

```
onPropsEvent(connectionId):
  ├── writeListenerEventTimestamp()
  ├── if ENFORCEMENT_DRY_RUN=true
  │     └── evaluateDryRunRulesForConnection()       // Phase 2A dry-run audit
  └── if GUARDRAIL_INTERNAL_LOCK_ENABLED=true         // Phase 2B + 2C-E
        └── applyInternalLockForConnection()
              ├── Guardian master switch check (guardianEnabled)
              ├── isActive + protectionStatus="protected" + has LiveSessionState + has AccountRiskRules
              ├── canApplyInternalLock: flagEnabled=true, env=demo, riskState≠STOPPED
              ├── evaluateDryRunRules() — checks maxDailyLoss breach
              ├── if breach: upsert InternalLockEvent + set riskState=STOPPED
              └── returns internalLockEventId (non-null on breach)
                    └── if BROKER_ENFORCEMENT_ENABLED=true AND internalLockEventId≠null
                          └── maybeAttemptBrokerDailyLossLockoutForInternalLock()
                                ├── re-evaluates all 10 gates
                                ├── if allowed: triggerEnforcement(brokerEnforcementMode="lock_only")
                                │     └── applyBrokerDayLockout()
                                │           ├── shouldSkipBrokerEnforcement() → skip=false (full_access)
                                │           ├── decideConsentGate() → allowed (consentValid=true)
                                │           ├── if ENFORCEMENT_DRY_RUN=true → dry_run result
                                │           └── if ENFORCEMENT_DRY_RUN=false → broker write
                                └── writes GuardianIntervention + BrokerRiskSettingsSyncAudit
```

**Critical:** `GUARDRAIL_INTERNAL_LOCK_ENABLED` and `BROKER_ENFORCEMENT_ENABLED` are read from
`process.env` inside the `onPropsEvent` closure — at event time, not at listener start. Changing
these env vars and redeploying the listener-worker service takes effect on the next props event.

---

## §2 — Gate Map: All 10 Broker Enforcement Gates for DEMO7433035

| Gate | What it checks | DEMO7433035 state | Pass? |
|---|---|---|---|
| 1 | `BROKER_ENFORCEMENT_ENABLED=true` on **listener-worker** | `false` (must flip) | ❌ (intentional — not yet) |
| 2 | `TRADOVATE_LISTENER_ENABLE_LIVE=false` | `false` (confirmed) | ✅ |
| 3 | `env=demo` | `demo` | ✅ |
| 4 | account in `BROKER_ENFORCEMENT_DEMO_ACCOUNT_ALLOWLIST` | already in allowlist | ✅ (must confirm on listener-worker env) |
| 5 | `ruleType=daily_loss_limit` | `daily_loss_limit` | ✅ |
| 6 | `isActive=true` and not `missingFromBrokerSince` | verified | ✅ |
| 7 | `connectionStatus` not in NON_LIVE set | `connected_readonly` not in set | ✅ |
| 8 | `permissionLevel=full_access` | confirmed by Phase B | ✅ |
| 9 | active `InternalLockEvent` exists for this account/rule/day | none yet (no breach) | — (created at breach time) |
| 10 | no existing `GuardianIntervention` with this dedupKey | none exists | ✅ (first time) |

**Gates 1 and 4 require the listener-worker service to have the right env vars** — they are
separate from the web/app service.

**Gate 9 is the trigger gate** — it is satisfied automatically when a real loss breach causes
`applyInternalLockForConnection` to create an `InternalLockEvent`. It is NOT a static
prerequisite.

---

## §3 — Internal Lock Prerequisites for DEMO7433035

Before `GUARDRAIL_INTERNAL_LOCK_ENABLED=true` can fire for this account, all of the
following must be true. Verify using **C0 read-only checks** (§6):

| Prerequisite | Where checked | What to verify |
|---|---|---|
| `activeDedupKey` migration applied | `internal-lock-diagnostic` | `activeDedupKeyColumnExists: true` |
| Account `isActive=true` | `internal-lock-diagnostic` | `gates.isActive: true` |
| `protectionStatus="protected"` | `internal-lock-diagnostic` | `gates.protectionStatus: "protected"` |
| `LiveSessionState` row exists | `internal-lock-diagnostic` | `gates.hasSession: true` |
| `AccountRiskRules` row exists | `internal-lock-diagnostic` | `gates.hasRiskRules: true` |
| `maxDailyLoss` on `AccountRiskRules` | `internal-lock-diagnostic` | `gates.maxDailyLossInAccountRules: 40000` |
| Account env = "demo" | `internal-lock-diagnostic` | `gates.env: "demo"` |
| `guardianEnabled=true` | `internal-lock-diagnostic` (indirect) | `wouldCreateLock` (if breach were present) |
| Listener worker is connected | Railway dashboard / `tradovate-listener/status` | `listenerStatus: "connected"` |

**Critical gap to verify:** `AccountRiskRules` vs `RiskRules`. The internal lock evaluator
(`applyInternalLockForConnection`) reads from `account.riskRules` which is the
`AccountRiskRules` relation (per-account override), NOT the user-level `RiskRules` template.
If DEMO7433035 only has user-level rules (no per-account override), the lock won't fire and
`internal-lock-diagnostic` will show `gates.hasRiskRules: false` with skip reason
`"no AccountRiskRules row"`.

When the Daily Loss rule was saved in the Guardrail UI, it should have created an
`AccountRiskRules` row. Confirm via `internal-lock-diagnostic`.

---

## §4 — Env Split by Railway Service

The listener worker (`railway-listener-worker-config/railway.json`) is a **separate Railway
service** from the web/app. Each service has its own env vars.

### Phase C0 — Read-only checks (NO env changes)

| Service | Variable | Value | Notes |
|---|---|---|---|
| Web / App | ALL | unchanged | |
| Listener worker | ALL | unchanged | |
| Cron | ALL | unchanged | |

### Phase C1 — Internal lock dry-run (internal lock only, NO broker writes)

| Service | Variable | Current | Phase C1 | Notes |
|---|---|---|---|---|
| **Listener worker** | `GUARDRAIL_INTERNAL_LOCK_ENABLED` | `false` | **`true`** | ← only change |
| **Listener worker** | `BROKER_ENFORCEMENT_ENABLED` | `false` | `false` (unchanged) | No broker write |
| **Listener worker** | `ENFORCEMENT_DRY_RUN` | `true` | `true` (unchanged) | |
| **Listener worker** | `BROKER_ENFORCEMENT_DEMO_ACCOUNT_ALLOWLIST` | confirm | same as web/app | Must include `cmottd1z200020do1knjxq582` |
| Web / App | ALL | unchanged | unchanged | |
| Cron | ALL | unchanged | unchanged | |

**Effect of Phase C1:** When a Daily Loss breach occurs, `applyInternalLockForConnection`
creates an `InternalLockEvent` and sets `riskState=STOPPED`. Since
`BROKER_ENFORCEMENT_ENABLED=false`, the broker enforcement service is never reached. No
Tradovate write. No GuardianIntervention row. No BrokerRiskSettingsSyncAudit row.

### Phase C2 — Listener broker dry-run (gates evaluated, NO broker write)

Only begin after Phase C1 confirms `InternalLockEvent` rows are created correctly.

| Service | Variable | Phase C1 | Phase C2 | Notes |
|---|---|---|---|---|
| **Listener worker** | `BROKER_ENFORCEMENT_ENABLED` | `false` | **`true`** | ← only change |
| **Listener worker** | `ENFORCEMENT_DRY_RUN` | `true` | `true` (unchanged) | Keeps write safe |
| **Listener worker** | `GUARDRAIL_INTERNAL_LOCK_ENABLED` | `true` | `true` (unchanged) | |
| Web / App | ALL | unchanged | unchanged | |

**Effect of Phase C2:** When a breach occurs: `InternalLockEvent` created → all 10 gates
evaluated → `ENFORCEMENT_DRY_RUN=true` → `GuardianIntervention` row with
`brokerLockStatus=dry_run` + `BrokerRiskSettingsSyncAudit` row with `outcome=dry_run`.
No Tradovate call. Payload is persisted for inspection.

### Phase C3 — One live listener write

Only begin after Phase C2 confirms `outcome=dry_run` with correct `observedAmount`.

| Service | Variable | Phase C2 | Phase C3 | Notes |
|---|---|---|---|---|
| **Listener worker** | `ENFORCEMENT_DRY_RUN` | `true` | **`false`** | ← only change |
| **Listener worker** | `BROKER_ENFORCEMENT_ENABLED` | `true` | `true` (unchanged) | |
| **Listener worker** | `GUARDRAIL_INTERNAL_LOCK_ENABLED` | `true` | `true` (unchanged) | |
| Web / App | ALL | unchanged | unchanged | |

**Effect of Phase C3:** When a breach occurs: `InternalLockEvent` → all 10 gates pass →
`applyBrokerDayLockout(mode="lock_only")` → Tradovate `userAccountAutoLiq/update` (or
`/create`) called → `GuardianIntervention` with `brokerLockStatus=broker_locked` →
`BrokerRiskSettingsSyncAudit` with `outcome=success`.

### Phase C4 — Safety restore

Immediately after Phase C3 confirmation:

| Service | Variable | Phase C3 | Phase C4 | Notes |
|---|---|---|---|---|
| **Listener worker** | `ENFORCEMENT_DRY_RUN` | `false` | **`true`** | Restore |
| **Listener worker** | `BROKER_ENFORCEMENT_ENABLED` | `true` | **`false`** | Restore |
| **Listener worker** | `GUARDRAIL_INTERNAL_LOCK_ENABLED` | `true` | `false` or `true` | Operator choice — `true` continues internal locking without broker writes |

---

## §5 — Verification Steps

### C0 — Read-only readiness checks (no env changes)

Run all snippets in the Guardrail browser console with an authenticated session.

**C0.1 — Internal lock diagnostic**

```js
fetch('/api/debug/internal-lock-diagnostic?accountId=cmottd1z200020do1knjxq582', {
  credentials: 'include',
  headers: { 'x-cron-secret': '<CRON_SECRET>' }
}).then(r => r.json()).then(d => {
  console.log('activeDedupKeyColumnExists:', d.activeDedupKeyColumnExists);
  console.log('activeDedupKeyProbeError:', d.activeDedupKeyProbeError);
  console.log('gates:', d.gates);
  console.log('wouldCreateLock:', d.wouldCreateLock);
  console.log('diagnosisPoints:', d.diagnosisPoints);
});
```

**Expected values (all must be confirmed before proceeding to C1):**

| Field | Expected | Stop if |
|---|---|---|
| `activeDedupKeyColumnExists` | `true` | `false` — migration not applied, stop all |
| `gates.isActive` | `true` | `false` |
| `gates.protectionStatus` | `"protected"` | any other value |
| `gates.hasSession` | `true` | `false` — no LiveSessionState |
| `gates.hasRiskRules` | `true` | `false` — AccountRiskRules missing, internal lock won't fire |
| `gates.maxDailyLossInAccountRules` | `40000` | `null` or `0` |
| `gates.env` | `"demo"` | any other value |
| `gates.skipReasons` | `[]` (empty) | any skip reason |

**C0.2 — Broker enforcement gates (verifies allowlist and env flags)**

```js
fetch('/api/debug/broker-enforcement-gates', {
  credentials: 'include',
  headers: { 'x-cron-secret': '<CRON_SECRET>' }
}).then(r => r.json()).then(d => {
  console.log('brokerEnforcementEnabled (web):', d.brokerEnforcementEnabled);
  console.log('listenerLiveEnabled:', d.listenerLiveEnabled);
  console.log('allowlist:', d.allowlist);
  console.log('activeLockCount:', d.activeLockCount);
  console.log('candidates:', d.candidates);
});
```

**Expected:**

| Field | Expected |
|---|---|
| `brokerEnforcementEnabled` | `false` (web process — should still be off) |
| `listenerLiveEnabled` | `false` |
| `allowlist` | includes `cmottd1z200020do1knjxq582` |
| `activeLockCount` | `0` (no active InternalLockEvents yet) |

**C0.3 — Listener worker status** (confirms listener-worker env var posture)

```js
fetch('/api/debug/tradovate-listener/status', {
  credentials: 'include',
  headers: { 'x-cron-secret': '<CRON_SECRET>' }
}).then(r => r.json()).then(d => {
  console.log('Listener status:', d);
});
```

**Expected:** listener worker connected (`listenerStatus: "connected"`) and
`workerStatus.internalLockEnabled: false` (confirms current C1 not yet applied).

**C0.4 — Enforcement readiness diagnostic**

```js
fetch('/api/debug/daily-loss-enforcement-readiness?accountId=cmottd1z200020do1knjxq582', {
  credentials: 'include',
  headers: { 'x-cron-secret': '<CRON_SECRET>' }
}).then(r => r.json()).then(d => {
  console.log('Phase:', d.activationVerdict.phase);
  console.log('hasGuardrailOwnedWrite:', d.ownershipAndRecovery.hasGuardrailOwnedWrite);
  console.log('connectionStatus:', d.account.connectionStatus);
  console.log('D1 blocked:', d.ownershipAndRecovery.d1Blocked);
});
```

**Expected:**
- `activationVerdict.phase`: `ready_for_demo_activation` (Guardrail owns the write from Phase B)
- `hasGuardrailOwnedWrite`: `true`
- `d1Blocked`: `false`

---

### C1 — Internal lock dry-run

1. On the **listener-worker** Railway service: set `GUARDRAIL_INTERNAL_LOCK_ENABLED=true`.
   Redeploy listener-worker. Confirm healthy.

2. Trigger a Daily Loss breach on DEMO7433035 (trade past the $40,000 threshold, or — if
   operating in a dev context — manually update `LiveSessionState.dailyPnl` to exceed the limit).

3. Wait for the next Tradovate props event to arrive (typically within seconds of any
   account activity).

4. Check for `InternalLockEvent` rows:

```js
fetch('/api/debug/internal-lock-events?accountId=cmottd1z200020do1knjxq582&days=1', {
  credentials: 'include',
  headers: { 'x-cron-secret': '<CRON_SECRET>' }
}).then(r => r.json()).then(d => {
  console.log('activeCount:', d.activeCount);
  console.log('totalCount:', d.totalCount);
  console.log('rows:', d.rows);
  console.log('brokerEnforcements:', d.brokerEnforcements);
});
```

**Expected C1 result:**

| Field | Expected |
|---|---|
| `activeCount` | `1` |
| `rows[0].ruleType` | `daily_loss_limit` |
| `rows[0].clearedAt` | `null` (still active) |
| `brokerEnforcements.count` | `0` (no broker enforcement yet) |
| `brokerEnforcements.hasAnyBrokerLocked` | `false` |

5. Verify `riskState=STOPPED` on the account:

```js
fetch('/api/debug/daily-loss-enforcement-readiness?accountId=cmottd1z200020do1knjxq582', {
  credentials: 'include',
  headers: { 'x-cron-secret': '<CRON_SECRET>' }
}).then(r => r.json()).then(d => {
  console.log('riskState (session):', d.riskState);
});
```

6. After confirming, reset the internal lock (use the reset-session-state debug endpoint or
   the Guardian reset endpoint) before proceeding to C2.

---

### C2 — Listener broker dry-run

1. With `GUARDRAIL_INTERNAL_LOCK_ENABLED=true` still on listener-worker: additionally set
   `BROKER_ENFORCEMENT_ENABLED=true` (keep `ENFORCEMENT_DRY_RUN=true`). Redeploy.
   Confirm `listenerWorkerStatus.brokerEnforcementEnabled=true` via the listener/status endpoint.

2. Trigger another Daily Loss breach (reset the internal lock first).

3. Wait for props event. Check audit rows:

```js
fetch('/api/debug/broker-risk-settings-audits?accountId=cmottd1z200020do1knjxq582&limit=5', {
  credentials: 'include',
  headers: { 'x-cron-secret': '<CRON_SECRET>' }
}).then(r => r.json()).then(d => {
  console.log('Latest audit:', d.audits[0]);
  console.log('hasAnyBrokerWrite:', d.hasAnyBrokerWrite);
});
```

**Expected C2 result (`BrokerRiskSettingsSyncAudit`):**

| Field | Expected |
|---|---|
| `outcome` | `dry_run` |
| `ruleType` | `daily_loss_limit` |
| `dryRun` | `true` |
| `brokerResponseJson` | `null` |
| `gateFailureReason` | `null` (all gates passed) |
| `amount` | observed loss amount (e.g. `-40001` absolute → `40001`) |

4. Check `GuardianIntervention` via the internal-lock-events endpoint:

```js
fetch('/api/debug/internal-lock-events?accountId=cmottd1z200020do1knjxq582&days=1', {
  credentials: 'include',
  headers: { 'x-cron-secret': '<CRON_SECRET>' }
}).then(r => r.json()).then(d => {
  console.log('brokerEnforcements:', d.brokerEnforcements);
});
```

**Expected:**
- `brokerEnforcements.count`: `1`
- `brokerEnforcements.items[0].brokerLockStatus`: `dry_run`
- `brokerEnforcements.hasAnyBrokerLocked`: `false`

5. If any audit row shows `outcome=gate_blocked`, check `gateFailureReason`:

| Failure reason | Cause | Fix |
|---|---|---|
| `broker_enforcement_disabled` | `BROKER_ENFORCEMENT_ENABLED` not set on listener-worker | Set on listener-worker, not web/app |
| `account_not_allowlisted` | `BROKER_ENFORCEMENT_DEMO_ACCOUNT_ALLOWLIST` not set on listener-worker | Set allowlist on listener-worker service |
| `no_active_internal_lock` | internal lock not firing (C1 failed) | Resolve C1 first |
| `duplicate_intervention` | dedup key already exists | Reset the GuardianIntervention row |
| `guardian_disabled` | `guardianEnabled` turned off | Re-enable Guardian |

---

### C3 — One live listener write

Only begin after C2 confirms `outcome=dry_run` with correct `amount`.

1. Set `ENFORCEMENT_DRY_RUN=false` on **listener-worker** (keep everything else unchanged).
   Redeploy. Confirm healthy.

2. Reset internal lock and any existing GuardianIntervention dedup row from C2.

3. Trigger another Daily Loss breach. Wait for props event.

4. Check audit rows:

```js
fetch('/api/debug/broker-risk-settings-audits?accountId=cmottd1z200020do1knjxq582&limit=5', {
  credentials: 'include',
  headers: { 'x-cron-secret': '<CRON_SECRET>' }
}).then(r => r.json()).then(d => {
  const latest = d.audits[0];
  console.log('outcome:', latest.outcome);
  console.log('brokerResponseJson:', latest.brokerResponseJson != null ? 'present' : 'null');
  console.log('gateFailureReason:', latest.gateFailureReason);
});
```

**Expected C3 result:**

| Field | Expected |
|---|---|
| `outcome` | `success` |
| `brokerResponseJson` | present (Tradovate API response) |
| `gateFailureReason` | `null` |
| `flattenStatus` | `not_needed` (mode=lock_only — no flatten) |

5. Confirm in Tradovate UI: Daily Loss Limit ON, Value = observed loss amount,
   Lock risk settings = ON.

6. Apply C4 restore immediately:
   - Set `ENFORCEMENT_DRY_RUN=true` on listener-worker
   - Set `BROKER_ENFORCEMENT_ENABLED=false` on listener-worker
   - Redeploy. Confirm `listenerWorkerStatus.brokerEnforcementEnabled=false`.

---

## §6 — Dedup Key Behavior

The listener-path dedup key format is:
```
${accountId}:${ruleType}:${tradingDay}:broker_enforcement
```

This is a **per-trading-day** key stored as a unique constraint on
`GuardianIntervention.listenerBrokerDedupKey`. It means:

- At most ONE broker write per account per rule type per trading day.
- After a successful write, a second breach on the same day will hit Gate 10
  (`duplicate_intervention`) and produce a `gate_blocked` audit row — not a second write.
- The slot resets automatically on a new trading day (the date component changes).
- Manual reset: delete or update the `GuardianIntervention` row for the same dedupKey.

---

## §7 — Audit Observability Summary

| Outcome type | Table | When produced |
|---|---|---|
| Internal lock fires | `InternalLockEvent` + `LiveSessionState.riskState=STOPPED` | C1+ (GUARDRAIL_INTERNAL_LOCK_ENABLED=true) |
| Broker gate blocked | `BrokerRiskSettingsSyncAudit` (`outcome=gate_blocked`) | Any gate failure in broker service |
| Broker dry-run | `BrokerRiskSettingsSyncAudit` (`outcome=dry_run`) + `GuardianIntervention` (`brokerLockStatus=dry_run`) | C2 (ENFORCEMENT_DRY_RUN=true, all gates pass) |
| Broker write | `BrokerRiskSettingsSyncAudit` (`outcome=success`) + `GuardianIntervention` (`brokerLockStatus=broker_locked`) | C3 (ENFORCEMENT_DRY_RUN=false, all gates pass) |

**No broker action ever produces `GuardianIntervention.flattenStatus` != `not_needed`** for this
account — the listener path uses `brokerEnforcementMode="lock_only"`, which explicitly skips
the `applyFlattenOpenPositions` call.

---

## §8 — Safety Boundaries

| Boundary | Enforcement |
|---|---|
| Demo only | `canApplyInternalLock` gates on `env=demo`; `evaluateBrokerEnforcementGates` gate 3 |
| Single account allowlist | Gate 4 — `BROKER_ENFORCEMENT_DEMO_ACCOUNT_ALLOWLIST` |
| No live accounts | `TRADOVATE_LISTENER_ENABLE_LIVE=false` — never change |
| No flatten / cancel / close | `brokerEnforcementMode="lock_only"` skips `applyFlattenOpenPositions` |
| No order endpoints | `ENABLE_TRADOVATE_ORDER_ACTIONS=false` — never change for this runbook |
| At-most-once per day | `listenerBrokerDedupKey` unique constraint on `GuardianIntervention` |
| Guardian master switch | `isGuardianRuleEvaluationActive` checked before InternalLockEvent creation |
| Consent gate | `decideConsentGate` in `applyBrokerDayLockout` — checked after permission, before dry-run |
| Lock only — no unlock | `doNotUnlock` is intentionally omitted from the payload |

---

## §9 — Rollback Plan

### Immediate rollback (any phase)

On **listener-worker** Railway service:
```
GUARDRAIL_INTERNAL_LOCK_ENABLED = false   ← restore
BROKER_ENFORCEMENT_ENABLED      = false   ← restore
ENFORCEMENT_DRY_RUN             = true    ← restore
```

Redeploy listener-worker. This stops all listener-path enforcement immediately.

### Verify rollback

```js
// After rollback, trigger another props event and confirm no new audit rows:
fetch('/api/debug/internal-lock-events?accountId=cmottd1z200020do1knjxq582&days=1', {
  credentials: 'include',
  headers: { 'x-cron-secret': '<CRON_SECRET>' }
}).then(r => r.json()).then(d => {
  console.log('activeCount after rollback:', d.activeCount); // should be 0
});
```

### Tradovate manual clear (if C3 live write succeeded before rollback)

1. Open Tradovate web → Account → Risk Management → DEMO7433035
2. Clear / remove the `dailyLossAutoLiq` value and unlock
3. Run the read-only recovery probe to confirm cleared state:

```js
fetch('/api/debug/broker-enforcement/daily-loss-recovery-probe?accountId=cmottd1z200020do1knjxq582&mode=read_only', {
  credentials: 'include',
  headers: { 'x-cron-secret': '<CRON_SECRET>' }
}).then(r => r.json()).then(d => {
  console.log('existing after clear:', d.existing ?? d.payloadPreview?.existing);
});
```

---

## §10 — GO / NO-GO

| Phase | Status | Condition |
|---|---|---|
| **C0 (read-only checks)** | **GO** — safe anytime | No prerequisites |
| **C1 (GUARDRAIL_INTERNAL_LOCK_ENABLED=true on listener-worker)** | **CONDITIONAL** | C0 checks all pass: `activeDedupKeyColumnExists=true`, `hasRiskRules=true`, `hasSession=true`, `protectionStatus="protected"` |
| **C2 (BROKER_ENFORCEMENT_ENABLED=true, ENFORCEMENT_DRY_RUN=true on listener-worker)** | **NOT YET** | C1 must confirm InternalLockEvent fires correctly for a real breach |
| **C3 (one live listener write)** | **NOT YET** | C2 must confirm `outcome=dry_run` with correct `amount` |

### Blockers to resolve before C1

1. **Run C0 checks** — especially confirm `activeDedupKeyColumnExists=true` and
   `gates.hasRiskRules=true`. If `hasRiskRules=false`, the internal lock will never fire
   for this account.

2. **Confirm listener-worker env** — `BROKER_ENFORCEMENT_DEMO_ACCOUNT_ALLOWLIST` must include
   `cmottd1z200020do1knjxq582` on the **listener-worker** service (independent from web/app).

3. **Confirm listener-worker is connected** — check `tradovate-listener/status` or the Railway
   dashboard. The listener worker must be running and show `listenerStatus: "connected"` for
   the broker connection.

4. **Plan how to trigger the breach** — a breach requires `LiveSessionState.dailyPnl` to fall
   below `-40000` (the maxDailyLoss threshold). Options:
   - Real trading: take a loss on DEMO7433035 that exceeds $40,000
   - DB manipulation (dev/staging only): update `dailyPnl` directly and wait for a props event

### What must remain disabled

- `TRADOVATE_LISTENER_ENABLE_LIVE` — must stay `false` on all services
- `ENABLE_TRADOVATE_ORDER_ACTIONS` — must stay `false` on all services
- Web/app `BROKER_ENFORCEMENT_ENABLED` — may remain `false` on web/app during C1-C4
  (only the listener-worker service needs it for listener-path enforcement)
- Cron — no changes needed at any phase

### Recommended first step (read-only)

Run C0.1 (`internal-lock-diagnostic`) and confirm all gates pass. This is the
single most important check before enabling `GUARDRAIL_INTERNAL_LOCK_ENABLED=true`.
