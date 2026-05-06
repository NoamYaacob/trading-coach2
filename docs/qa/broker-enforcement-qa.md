# Broker-Side Enforcement — Verification Checklist & Manual QA Plan

Covers Tradovate daily-loss lockout via `userAccountAutoLiq`. All unit tests
referenced below live in `src/lib/brokers/enforcement.test.ts` and
`src/app/dashboard/_components/command-center/data.test.ts`.

---

## Automated test coverage (run `npm run test:unit`)

The following invariants are verified by unit tests today. Confirm they
continue to pass before any deployment touching enforcement or the
command-center UI.

### 1. Read-only connection — no broker API call

| # | Assertion | Test |
|---|-----------|------|
| 1.1 | `shouldSkipBrokerEnforcement` returns `skip=true` for `connected_readonly` | `shouldSkipBrokerEnforcement › read-only connection → skip=true with unavailable_read_only` |
| 1.2 | `lockStatus` is `unavailable_read_only` (not `monitoring_only`, not `broker_lock_failed`) | same test |
| 1.3 | Skip means the API is never called — no 401/403 can expire the connection | `shouldSkipBrokerEnforcement › read-only connection NEVER reaches the broker API` |
| 1.4 | UI copy says "connection is read-only" and colour is stone (not amber/emerald) | `deriveBrokerEnforcementCopy › unavailable_read_only → stone colour, mentions read-only` |
| 1.5 | "Broker-side lock active" text is absent for `unavailable_read_only` | `deriveBrokerEnforcementCopy › broker_locked is the ONLY status that says "Broker-side lock active"` |

### 2. Live connection — broker API called and confirmed

| # | Assertion | Test |
|---|-----------|------|
| 2.1 | `shouldSkipBrokerEnforcement` returns `skip=false` for `connected_live + tradovate + daily_loss_limit` | `shouldSkipBrokerEnforcement › returns skip=false for Tradovate + daily_loss_limit + connected_live` |
| 2.2 | Update payload contains `id`, `dailyLossAutoLiq`, `changesLocked=true` — nothing else | `buildAutoLiqUpdatePayload › payload contains exactly the expected keys` |
| 2.3 | Create payload contains `accountId`, `dailyLossAutoLiq`, `changesLocked=true` — nothing else | `buildAutoLiqCreatePayload › payload contains exactly the expected keys` |
| 2.4 | `doNotUnlock` is absent from both payloads | `buildAutoLiqUpdatePayload › does NOT include doNotUnlock` / `buildAutoLiqCreatePayload › does NOT include doNotUnlock` |
| 2.5 | `isAutoLiqConfirmed` returns `true` when response echo matches within 1 cent | `isAutoLiqConfirmed › returns true when response value exactly matches expected` |
| 2.6 | `isAutoLiqConfirmed` returns `false` for null response (field absent) | `isAutoLiqConfirmed › returns false when responseValue is null` |
| 2.7 | `null` response does not set `broker_locked` | `isAutoLiqConfirmed › confirmed=true is required before UI shows broker_locked` |
| 2.8 | UI shows "Broker-side lock active" only for `broker_locked` | `deriveBrokerEnforcementCopy › broker_locked is the ONLY status that says "Broker-side lock active"` |
| 2.9 | `dailyLossAutoLiq` is derived from the account's actual loss, not hardcoded | `computeLossAmountToSet › uses account-specific loss — different amounts produce different thresholds` |

### 3. Permission denied — connection stays valid

| # | Assertion | Test |
|---|-----------|------|
| 3.1 | HTTP 403 → `unavailable_permission` (not `broker_lock_failed`, not `monitoring_only`) | `classifyEnforcementError › HTTP 403 → unavailable_permission` |
| 3.2 | HTTP 403 is distinct from `monitoring_only` | `classifyEnforcementError › HTTP 403 is NOT monitoring_only` |
| 3.3 | HTTP 403 is distinct from `broker_lock_failed` | `classifyEnforcementError › HTTP 403 is NOT broker_lock_failed` |
| 3.4 | 403 failure reason mentions "Account Risk Settings" | `classifyEnforcementError › 403 failure reason mentions Account Risk Settings permission` |
| 3.5 | `skipMarkExpired=true` on risk endpoints (transport-layer guard) | `skipMarkExpired contract › 403 maps to unavailable_permission, not broker_lock_failed` |
| 3.6 | UI copy says "Account Risk Settings permission missing", colour is amber | `deriveBrokerEnforcementCopy › unavailable_permission → amber colour, mentions permission` |

### 4. Multi-account — enforcement scoped to tvAccountId

| # | Assertion | Test |
|---|-----------|------|
| 4.1 | `buildAutoLiqUpdatePayload` uses the provided `existingId`, not a hardcoded value | `buildAutoLiqUpdatePayload › is generic — uses the provided existingId` |
| 4.2 | `buildAutoLiqCreatePayload` uses the provided `tvAccountId`, not a hardcoded value | `buildAutoLiqCreatePayload › is generic — uses the provided tvAccountId` |
| 4.3 | Any Tradovate account ID is accepted — no firm-specific logic | `buildAutoLiqCreatePayload › any Tradovate account ID is accepted` |

### 5. No doNotUnlock (regression guard)

| # | Assertion | Test |
|---|-----------|------|
| 5.1 | `doNotUnlock` absent from update payload | `skipMarkExpired contract › doNotUnlock is absent from both update and create payloads` |
| 5.2 | `doNotUnlock` absent from create payload | same |

---

## Manual QA — Tradovate sim environment

> **Safety first.** All steps below must be performed on a **Tradovate simulator
> account** (`sim.tradovate.com`). Simulator accounts have no real money and
> reset daily. Never test enforcement against a live funded account.

### Prerequisites

- A Tradovate **demo/sim** account (free at [sim.tradovate.com](https://sim.tradovate.com))
- At least **two sim sub-accounts** under the same Tradovate login (create via
  Account → Manage Accounts → Add Demo Account)
- Guardrail connected to the sim environment via OAuth (use the `SIM` base URL
  in `tradovate-env.ts` / env var)
- One Guardrail account for each Tradovate sim sub-account (pair them via the
  account-connection flow)

---

### Scenario A — Read-only connection, daily loss breach

**Setup:**
1. In Guardrail, connect Tradovate with **read-only scope** (no "Account Risk
   Settings: Full Access" permission during OAuth).
2. Set a daily loss rule: e.g. $50 limit.
3. On the sim account, place a trade that loses more than $50.
4. Trigger a sync (or wait for scheduled sync).

**Expected results:**
- `GuardianIntervention.brokerLockStatus` = `unavailable_read_only`
- No `userAccountAutoLiq/update` or `/create` call in server logs
- Dashboard row shows the account as locked
- Broker enforcement note reads: _"Guardrail lock active · Broker-side lock
  unavailable: connection is read-only."_ in stone colour
- The `BrokerConnection` record remains `connected_readonly` — not expired

**Verify in DB:**
```sql
SELECT "brokerLockStatus", "brokerEndpoint", "outcome"
FROM "GuardianIntervention"
WHERE "accountId" = '<your-account-uuid>'
ORDER BY "createdAt" DESC LIMIT 1;
-- Expected: brokerLockStatus = 'unavailable_read_only', brokerEndpoint = null
```

---

### Scenario B — Full-permission connection, successful broker lock

**Setup:**
1. Connect Tradovate with **full scope** (enable "Account Risk Settings: Full
   Access" during OAuth).
2. Set a daily loss rule: e.g. $100 limit.
3. On the sim account, place a trade that loses more than $100.
4. Trigger a sync.

**Expected results:**
- Server logs show two Tradovate calls:
  1. `GET userAccountAutoLiq/deps?masterid={tvAccountId}` → existing rule (or 404)
  2. `POST userAccountAutoLiq/update` (or `/create`) with body:
     ```json
     { "id": <existingId>, "dailyLossAutoLiq": <lossAmount>, "changesLocked": true }
     ```
  3. Read-back `GET userAccountAutoLiq/deps?masterid={tvAccountId}` (if response
     didn't echo `dailyLossAutoLiq`)
- `confirmed = true` (read-back value matches sent value within $0.01)
- `GuardianIntervention.brokerLockStatus` = `broker_locked`
- Dashboard shows: _"Broker-side lock active · Tradovate risk settings applied."_
  in emerald colour
- In Tradovate sim UI: Account → Risk Settings shows the `dailyLossAutoLiq`
  threshold set and `changesLocked` enabled
- **`doNotUnlock` is absent** from the Risk Settings — the account will
  auto-unlock at next session open

**Verify in DB:**
```sql
SELECT "brokerLockStatus", "brokerEndpoint", "brokerPayloadJson",
       "brokerResponseJson"
FROM "GuardianIntervention"
WHERE "accountId" = '<your-account-uuid>'
ORDER BY "createdAt" DESC LIMIT 1;
-- Expected: brokerLockStatus = 'broker_locked'
-- brokerPayloadJson must NOT contain doNotUnlock
-- brokerResponseJson.dailyLossAutoLiq should match sent value
```

---

### Scenario C — Permission denied (403)

**Setup:**
1. Connect Tradovate with a scope that **excludes** "Account Risk Settings:
   Full Access" but includes market-data/read permissions.
2. Set a daily loss rule.
3. Breach the limit.

**Expected results:**
- `POST userAccountAutoLiq/update` (or `/create`) returns HTTP 403
- `classifyEnforcementError` maps it to `unavailable_permission`
- `GuardianIntervention.brokerLockStatus` = `unavailable_permission`
- `BrokerConnection.status` remains unchanged — **not expired, not
  `connection_error`** (verify the connection still syncs market data on the
  next cycle)
- Dashboard enforcement note: _"Guardrail lock active · Broker-side lock
  unavailable: Account Risk Settings permission missing."_ in amber colour

**Verify in DB:**
```sql
SELECT status FROM "BrokerConnection" WHERE id = '<connection-uuid>';
-- Must NOT be 'expired' or 'connection_error'

SELECT "brokerLockStatus" FROM "GuardianIntervention"
WHERE "accountId" = '<your-account-uuid>'
ORDER BY "createdAt" DESC LIMIT 1;
-- Expected: 'unavailable_permission'
```

---

### Scenario D — Multi-account isolation

**Setup:**
1. Connect a Tradovate sim login that has **two sub-accounts** (Account A and
   Account B) — both paired to separate Guardrail accounts under the same
   `BrokerConnection`.
2. Set a daily loss rule on Account A only (e.g. $50 limit).
3. Breach Account A's limit.

**Expected results:**
- `GuardianIntervention` row created for **Account A only**
- Account A's `userAccountAutoLiq/deps?masterid={tvAccountId_A}` is called
- Account B receives **no enforcement call** — no `GuardianIntervention` row,
  no `userAccountAutoLiq` write
- In Tradovate sim: Account A's Risk Settings changed; Account B's Risk Settings
  unchanged
- Dashboard: Account A shows locked; Account B shows allowed/normal

**Verify in DB:**
```sql
-- Only one intervention, for account A
SELECT "accountId", "brokerLockStatus", "brokerEndpoint"
FROM "GuardianIntervention"
ORDER BY "createdAt" DESC LIMIT 5;

-- Account B's autoLiq must be unchanged (or absent) in Tradovate
-- Confirm via GET userAccountAutoLiq/deps?masterid={tvAccountId_B} in logs
```

---

### Scenario E — Read-back mismatch (broker accepted but stored wrong value)

This scenario is hard to trigger in practice but can be simulated by temporarily
mocking `getUserAccountAutoLiq` to return a different value.

**Expected results:**
- `applyDailyLossLock` sets `confirmed = false`
- `brokerLockStatus` = `broker_lock_failed` (not `broker_locked`)
- Dashboard: _"Guardrail lock active · Broker-side lock attempt failed."_ in
  amber colour
- Intervention message in DB explains the mismatch (sent vs read-back values)

---

### Scenario F — doNotUnlock regression check

After any enforcement action (Scenario B), verify in the Tradovate sim UI:

1. Navigate to Account → Risk Settings for the locked sim account.
2. Confirm `dailyLossAutoLiq` is set to the expected threshold.
3. Confirm **"Do Not Unlock"** (or equivalent toggle) is **OFF / unchecked**.
4. At the next trading session open (midnight CT), confirm the account
   auto-unlocks without manual intervention.

If `doNotUnlock` were set, the account would remain locked permanently until
manually unlocked via the Tradovate UI — a critical user impact.

---

## Checklist summary (sign-off before production enforcement)

```
[ ] Scenario A: read-only → unavailable_read_only, no API write, stone UI note
[ ] Scenario B: full-perm → broker_locked after confirmed read-back, emerald UI note
[ ] Scenario C: 403 → unavailable_permission, connection not expired, amber UI note
[ ] Scenario D: account A breach does not touch account B's autoLiq
[ ] Scenario E: unconfirmed write → broker_lock_failed, not broker_locked
[ ] Scenario F: doNotUnlock absent in Tradovate Risk Settings UI after lock
[ ] npm run test:unit passes (802+ tests, 0 failures)
[ ] npx tsc --noEmit clean (no new errors beyond pre-existing playwright spec)
```
