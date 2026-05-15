# Phase 2C — Broker Enforcement Design

**Status: DESIGN ONLY — Not implemented. No broker writes. No code activation.**

Phase 2B (internal app lock) is verified complete. Phase 2C adds broker-side
enforcement: Guardrail writes Tradovate's Account Risk Settings so the broker itself
blocks new opening orders when a rule fires — independent of whether Guardrail's
own process is running.

---

## 0. Context: What Already Exists

The enforcement infrastructure is already fully built. Phase 2C is primarily
**wiring + gating**, not new logic.

| Component | Location | Status |
|---|---|---|
| `triggerEnforcement()` | `src/lib/brokers/enforcement.ts:633` | ✓ Implemented |
| `applyBrokerDayLockout()` | `src/lib/brokers/enforcement.ts:236` | ✓ Implemented |
| `GuardianIntervention` audit model | `prisma/schema.prisma` | ✓ Exists |
| Dry-run simulation (`ENFORCEMENT_DRY_RUN=true`) | `enforcement-helpers.ts:96` | ✓ Implemented |
| Consent gate | `automated-actions-consent.ts` | ✓ Implemented |
| Permission level gate (read-only skip) | `enforcement.ts:289` | ✓ Implemented |
| Cron-path enforcement | `tradovate-sync.ts:756` | ✓ Already fires |
| Listener-path enforcement | `tradovate-listener-worker.ts` | ✗ Not wired |

`triggerEnforcement` is currently called only from the **cron sync path**
(`tradovate-sync.ts`). Phase 2C wires it into the **realtime listener** with
additional gates that the cron path does not require.

---

## 1. Enforcement Types

### 1.1 `daily_loss_limit` — Broker Risk Settings Write

| Attribute | Value |
|---|---|
| Tradovate endpoint | `POST userAccountAutoLiq/update` (or `/create` if no existing record) |
| Payload | `{ id, dailyLossAutoLiq: currentLoss, changesLocked: true }` |
| Required permission | Account Risk Settings: Full Access (`permissionLevel = "full_access"`) |
| Mechanism | Sets `dailyLossAutoLiq` to the current loss so the account is immediately at/past the threshold. Tradovate's risk engine enters liquidation-only mode for the rest of the session. |
| `changesLocked: true` | Prevents mid-session manual removal of the broker-side limit. **Do NOT set `doNotUnlock=true`** — that would trap the account permanently across sessions. |
| Reversibility | Auto-reverses at next Tradovate session open (broker resets limits daily). Manual reversal: remove `dailyLossAutoLiq` via a separate `userAccountAutoLiq/update` call. |
| Risk level | **Medium.** Broker-side write is real and immediate. Failure modes: 403 (missing permission), 4xx/5xx network errors, read-back mismatch. |
| Failure modes | `broker_lock_failed`: broker accepted the request but read-back didn't confirm; `unavailable_permission`: 403; network timeout. Guardrail internal lock remains active regardless. |
| Demo first | Yes — must validate on a demo account before any live use. |
| Allow on live | Potentially, after explicit `TRADOVATE_LISTENER_ENABLE_LIVE=true` authorization and a dedicated live-only design review. **Not in Phase 2C MVP.** |
| Codebase note | Already implemented; `applyDailyLossLock()` in `TradovateClient`. Read-back confirms the stored value before returning `broker_locked`. |

### 1.2 `trade_limit` — Internal Only

| Attribute | Value |
|---|---|
| Tradovate endpoint | None — `userAccountAutoLiq` has no trade-count field. |
| Mechanism | Guardrail internal lock only (`riskState = "STOPPED"`). |
| Broker enforcement | **NOT POSSIBLE** with current Tradovate API. `userAccountRiskParameter.maxOpeningOrderQty` is per-contract, not account-wide. Order cancellation would require Orders Full Access (currently probed as Read Only). |
| Allow in Phase 2C | No. Internal lock only, same as Phase 2B. |

### 1.3 `max_loss_streak` (consecutive_losses) — Internal Only

| Attribute | Value |
|---|---|
| Tradovate endpoint | None — no Tradovate API field maps to consecutive loss streaks. |
| Broker enforcement | **NOT POSSIBLE** with current Tradovate API. |
| Allow in Phase 2C | No. Internal lock only. |

### 1.4 Flatten Open Positions (`order/liquidatepositions`)

| Attribute | Value |
|---|---|
| Tradovate endpoint | `POST order/liquidatepositions` |
| Required permission | Orders Full Access (distinct from Account Risk Settings) |
| Mechanism | Forces market close of all open positions. Irreversible — positions are gone. |
| Risk level | **High.** Slippage risk, partial fill risk, cannot be undone. Broker fills at market. |
| Reversibility | Zero — once submitted, positions close at market prices. |
| Current trigger | Runs as a pre-step for `daily_loss_limit` and `profit_target` in `applyBrokerDayLockout`. |
| Allow in Phase 2C MVP | **No.** Flatten requires a separate explicit feature flag and a dedicated safety review. Do not include in the initial broker enforcement rollout. |
| Codebase note | `TradovateClient.applyFlattenOpenPositions()` exists. Gate: separate `GUARDRAIL_FLATTEN_ENABLED` flag — absent = never flatten. |

### 1.5 Cancel Open Orders

| Attribute | Value |
|---|---|
| Tradovate endpoint | `DELETE order/cancelorder` or bulk cancel |
| Required permission | Orders Full Access (currently probed as Read Only on most connections) |
| Risk level | **Medium.** Cancels pending orders; does not close positions. Less destructive than flatten. |
| Allow in Phase 2C MVP | **No.** Requires Orders Full Access, which is not the current permission target. |

### 1.6 Block New Orders (position limit write)

| Attribute | Value |
|---|---|
| Tradovate endpoint | `userAccountRiskParameter` or `UserAccountPositionLimit` |
| Mechanism | Sets per-contract or overall position limit to zero to block new opening orders. |
| Risk level | **Medium–High.** `totalBy='Overall'` is product-blind and cannot express standard-equivalent exposure (1 NQ = 10 MNQ). Setting `exposedLimit=1` would incorrectly reject 2 MNQ (only 0.2 NQ-equivalent). |
| Allow in Phase 2C MVP | **No.** `applyBrokerDayLockout` via `userAccountAutoLiq` is the safer, verified mechanism. Position limit writes have open correctness questions for multi-product accounts. |

### 1.7 Internal-Only Lock Fallback

The internal lock (`riskState = "STOPPED"`, `InternalLockEvent` row) remains
active regardless of whether the broker write succeeds or fails. It is the
safety net, not the primary enforcement. A `broker_lock_failed` outcome
does not remove the internal lock.

---

## 2. Recommended Phase 2C MVP

**Single trigger: `daily_loss_limit` only. Demo only. No flatten. No cancel.**

Rationale:
- `daily_loss_limit` is the only trigger with a verified, confirmed Tradovate
  endpoint that can be safely set and auto-reverses daily.
- Flatten and cancel require separate, higher-risk authorization.
- `trade_limit` and `max_loss_streak` have no Tradovate API equivalent.
- Demo-only validates the full stack before touching live capital.

MVP scope:

```
BROKER_ENFORCEMENT_ENABLED=true       ← new flag, default false
ENFORCEMENT_DRY_RUN=true              ← keep on during initial demo testing
TRADOVATE_LISTENER_ENABLE_LIVE=false  ← unchanged
GUARDRAIL_FLATTEN_ENABLED=            ← absent = no flatten in Phase 2C
```

MVP sequencing: run `ENFORCEMENT_DRY_RUN=true` + `BROKER_ENFORCEMENT_ENABLED=true`
first (dry-run broker writes simulated, payloads logged to `GuardianIntervention`)
before turning off `ENFORCEMENT_DRY_RUN`.

---

## 3. Required Gates

All gates must pass before a broker write is attempted. Ordered by check cost
(cheapest first):

| # | Gate | Check | Fail outcome |
|---|---|---|---|
| 1 | Feature flag | `BROKER_ENFORCEMENT_ENABLED === "true"` | Skip — no broker call |
| 2 | Listener-level live guard | `TRADOVATE_LISTENER_ENABLE_LIVE !== "true"` OR `env === "demo"` | Skip live accounts |
| 3 | Account env | `account.brokerConnection.env === "demo"` | Skip — internal lock only |
| 4 | Trigger capability | `ENFORCEMENT_CAPABILITIES[trigger].capability === "broker_enforced"` | Skip — internal lock only |
| 5 | Permission level | `permissionLevel === "full_access"` | Return `unavailable_read_only` or `unavailable_permission` |
| 6 | Explicit allowlist | `accountId ∈ PHASE_2C_DEMO_ALLOWLIST` (env var, comma-separated IDs) | Skip — not yet enrolled |
| 7 | Internal lock prerequisite | `riskState === "STOPPED"` AND active `InternalLockEvent` exists | Skip — must have Phase 2B lock first |
| 8 | Idempotency | No `GuardianIntervention` for this `accountId + tradingDay + trigger` with status `broker_locked` or `dry_run` | Skip — already enforced today |
| 9 | Consent gate | `decideConsentGate(...)` returns `allowed: true` | Return `unavailable_consent_missing` |
| 10 | Account active | `!missingFromBrokerSince`, `connectionStatus !== "expired"` | Skip — stale/inactive account |
| 11 | Connection status | `permissionLevel` probe completed (not null) | Skip — capability unknown |

Gate 7 (internal lock prerequisite) is the key ordering constraint:
Phase 2B must have fired and set `riskState = "STOPPED"` before Phase 2C
attempts any broker write. This prevents broker calls for accounts that have
not yet been evaluated by the full rule engine.

Gate 8 (idempotency) is the critical **listener-specific addition** not needed
by the cron path. The cron fires once every ~5 min and naturally transitions
`prevRiskState !== "STOPPED"` only once per breach. The listener fires on
every props event (potentially many per minute). Without gate 8, the listener
would call `userAccountAutoLiq/update` repeatedly on every WebSocket event
while the account remains breached.

### Dedup key format for broker enforcement

```
${accountId}:${trigger}:${tradingDay}:broker_enforcement
```

This is distinct from the Phase 2A dry-run dedup key (`...dry_run`), allowing
both rows to coexist for the same account/trigger/day during the transition
from dry-run to live enforcement.

---

## 4. Data Model / Audit Trail

`GuardianIntervention` is **already the correct model** and does not need to be
replaced or extended significantly. All required fields exist. Two small additions
are recommended:

### Existing fields (no change needed)

| Field | Purpose |
|---|---|
| `accountId` | Links to `ConnectedAccount` |
| `userId` | Ownership filter |
| `triggerType` | Which rule fired (`daily_loss_limit`, etc.) |
| `outcome` | Human-readable result |
| `brokerEndpoint` | Exact endpoint path called |
| `brokerPayloadJson` | Exact JSON sent (no secrets — contains only amounts and IDs) |
| `brokerResponseJson` | Raw broker response |
| `brokerLockStatus` | Structured outcome enum |
| `flattenStatus` | Position-exit outcome |
| `flattenPayloadJson` | Exact flatten payload |
| `flattenResponseJson` | Raw flatten response |
| `createdAt` | Timestamp |

### Proposed new fields (schema addition, Phase 2C only)

```prisma
model GuardianIntervention {
  // ... existing fields ...

  /// FK to InternalLockEvent that preceded this broker enforcement.
  /// Null when Phase 2B was not active (cron-path enforcement).
  internalLockEventId  String?
  internalLockEvent    InternalLockEvent? @relation(...)

  /// Dedup key preventing duplicate broker writes from the realtime listener.
  /// Format: "${accountId}:${triggerType}:${tradingDay}:broker_enforcement"
  /// Unique constraint prevents concurrent writes even under race conditions.
  listenerBrokerDedupKey  String?  @unique

  /// Trading day (YYYY-MM-DD) the violation occurred on — needed for per-day
  /// dedup without parsing timestamps.
  tradingDay  String?
}
```

The `listenerBrokerDedupKey` unique constraint is the race-condition guard.
Even if two props events arrive simultaneously before either completes, the DB
`UNIQUE` constraint ensures at most one `GuardianIntervention` is created.

The `internalLockEventId` FK links the broker enforcement record to the
Phase 2B internal lock that preceded it, giving a complete audit chain:
`DryRunViolation` → `InternalLockEvent` → `GuardianIntervention`.

### What the audit model does NOT store

- Plaintext tokens or credentials (never logged)
- The actual user's positions or trade history (not relevant to the enforcement record)
- Any field that could re-execute the enforcement if re-read

---

## 5. UI Copy

All copy must pass two tests:
1. Never implies positions were flattened unless `flattenStatus = "flattened"`.
2. Never implies broker enforcement was sent unless `brokerLockStatus = "broker_locked"`.

### Enforcement states and exact copy

| State | `brokerLockStatus` | Display copy | Color |
|---|---|---|---|
| Dry-run active | `dry_run` | "Protection test mode · Position exit and broker-side lockout were simulated. No Tradovate write was sent." | blue |
| Broker lock confirmed | `broker_locked` | "Broker-side lock active · Tradovate risk settings applied." | emerald |
| Broker lock failed | `broker_lock_failed` | "Guardrail lock active · Broker-side lock attempt failed. Internal lock remains." | amber |
| Permission missing | `unavailable_permission` | "Guardrail lock active · Broker-side lock unavailable: Account Risk Settings permission missing." | amber |
| Read-only connection | `unavailable_read_only` | "Guardrail lock active · Broker-side lock unavailable: connection is read-only." | stone |
| Internal lock only | `monitoring_only` | "Guardrail lock active · Broker-side blocking not applicable for this rule." | stone |
| Phase 2B lock | `internalLockActive = true` | "Guardrail internal lock active · Broker enforcement is not active · No Tradovate action was sent." | stone |
| Consent missing | `unavailable_consent_missing` | "Guardrail lock active · Automated actions consent required. Open Trading Plan to confirm." | amber |

### Copy rules (hard constraints)

- `"Broker-side lock active"` appears ONLY when `brokerLockStatus === "broker_locked"`.
- `"Tradovate risk settings applied"` appears ONLY when `brokerLockStatus === "broker_locked"`.
- `"positions flattened"` or any flatten language appears ONLY when `flattenStatus === "flattened"`.
- `"No Tradovate action was sent"` appears when `internalLockActive = true` and no `GuardianIntervention`.
- Phase 2C dry-run: use existing `"dry_run"` status path — no new copy needed.

### Copy that must NEVER appear unless confirmed

- "Your positions have been closed" (implies flatten, requires `flattenStatus = "flattened"`)
- "Tradovate has been notified" (implies broker write, requires `broker_locked`)
- "Risk settings updated" (same)

---

## 6. Rollback / Recovery

### 6.1 Disable broker enforcement globally

```
BROKER_ENFORCEMENT_ENABLED=false  (or unset)
```

No worker restart required — checked at runtime. Disabling the flag stops
future broker writes but does NOT reverse existing `userAccountAutoLiq` settings
already written to Tradovate. Accounts with `broker_locked` status retain the
broker-side limit until Tradovate auto-resets it at next session open.

### 6.2 Reset Guardrail internal lock

```bash
POST /api/debug/accounts/{accountId}/reset-session-state
```

Sets `riskState = "NORMAL"`, stamps `clearedAt` on `InternalLockEvent` rows.
Does NOT touch Tradovate broker settings. Does NOT delete `GuardianIntervention` history.

### 6.3 Reset broker-side Tradovate limit (manual)

If a `broker_locked` account needs to trade again before the session resets:

1. Call `userAccountAutoLiq/update` with `dailyLossAutoLiq = 0` (or remove the
   limit entirely) via the Tradovate web UI or a separate admin endpoint.
2. Call the Guardrail reset endpoint to clear `riskState`.
3. Optionally: record the manual override in `GuardianIntervention.outcome`.

Note: `changesLocked: true` in the enforcement payload prevents the user from
removing the limit themselves during the session. An operator-level API call
(with full permissions) can still override it.

### 6.4 Partial broker write failure

`applyBrokerDayLockout` already handles this:
- Flatten step failure → logs `broker_lock_failed` for flatten, continues to lockout step.
- Lockout step accepted but not read-back confirmed → returns `broker_lock_failed`.
- Network timeout → returns `broker_lock_failed`.

In all failure cases:
- Guardrail internal lock (`riskState = "STOPPED"`) **remains active**.
- `GuardianIntervention` is written with the failure status and error.
- Dashboard shows `"broker_lock_failed"` copy (amber, actionable).
- No retry is attempted automatically — operators can investigate via
  `GET /api/debug/tradovate-listener/status` and the `GuardianIntervention` record.

**No dangerous auto-retry.** A failed broker write is logged, not re-queued.
The internal lock keeps the account protected at the Guardrail level.

### 6.5 What to show the user when the broker API fails

Dashboard: amber "Guardrail lock active · Broker-side lock attempt failed. Internal lock remains."

This copy clarifies:
- The account is still locked within Guardrail.
- The broker-side limit may not be active.
- No positions were automatically closed.

---

## 7. Test Plan

These tests must pass before Phase 2C can be enabled on any account.

### Safety invariants (no broker write unless all gates pass)

| Test | Expected outcome |
|---|---|
| `BROKER_ENFORCEMENT_ENABLED=false` | No broker API call, no `GuardianIntervention` with `broker_locked` |
| `env === "live"` while `TRADOVATE_LISTENER_ENABLE_LIVE=false` | Skip — no broker write |
| Account not in `PHASE_2C_DEMO_ALLOWLIST` | Skip — no broker write |
| `permissionLevel !== "full_access"` | Returns `unavailable_read_only` or `unavailable_permission` |
| `riskState !== "STOPPED"` (no Phase 2B lock) | Skip — Phase 2B must fire first |
| `consent` not recorded | Returns `unavailable_consent_missing` |
| `ENFORCEMENT_DRY_RUN=true` | Simulated payload logged to `GuardianIntervention`, no actual Tradovate call |
| Account `missingFromBrokerSince != null` | Skip — account unavailable |
| `connectionStatus === "expired"` | Skip — stale OAuth |

### Idempotency

| Test | Expected outcome |
|---|---|
| Two props events arrive before `riskState = "STOPPED"` write completes | DB unique constraint on `listenerBrokerDedupKey` ensures exactly one `GuardianIntervention` created |
| Props event fires after `riskState = "STOPPED"` already set | Gate 7 (internal lock prerequisite) prevents second broker write |
| Same `accountId + trigger + tradingDay` combination on day N+1 | Different `tradingDay` = different dedup key = new enforcement allowed |

### Audit completeness

| Test | Expected outcome |
|---|---|
| Broker call succeeds | `GuardianIntervention.brokerLockStatus = "broker_locked"`, `brokerPayloadJson` non-null, `brokerResponseJson` non-null |
| Broker call fails (simulated 403) | `GuardianIntervention.brokerLockStatus = "unavailable_permission"`, `brokerResponseJson` contains error |
| Flatten NOT enabled (`GUARDRAIL_FLATTEN_ENABLED` absent) | `flattenStatus = "not_needed"` on all Phase 2C records |
| `internalLockEventId` FK | Points to the `InternalLockEvent` that preceded this enforcement |

### Dashboard copy

| Test | Expected outcome |
|---|---|
| `brokerLockStatus = "broker_locked"` | Shows "Broker-side lock active · Tradovate risk settings applied." |
| `brokerLockStatus = "broker_lock_failed"` | Shows "Guardrail lock active · Broker-side lock attempt failed. Internal lock remains." |
| `internalLockActive = true`, no `GuardianIntervention` | Shows "Guardrail internal lock active · Broker enforcement is not active · No Tradovate action was sent." |
| `internalLockActive = false`, `status !== "locked"` | No broker enforcement note shown |
| Any state | Copy never mentions "positions flattened" unless `flattenStatus = "flattened"` |

---

## 8. Step-by-Step Rollout Plan

### Step 1 — Design review (current step)

Review this document. No code changes. Validate the gate list, audit model,
and copy requirements against operator expectations.

### Step 2 — Schema addition (migration only, no feature activation)

Add `listenerBrokerDedupKey` and `internalLockEventId` to `GuardianIntervention`.
Apply migration to production. Verify existing rows are unaffected (both fields nullable).
No code changes to enforcement path.

### Step 3 — Dry-run broker-write simulation from listener

Wire `triggerEnforcement` into the listener worker's `onPropsEvent` behind ALL
gates (flag, demo, allowlist, Phase 2B prerequisite, idempotency) while keeping
`ENFORCEMENT_DRY_RUN=true`. This causes the listener to log simulated
`GuardianIntervention` rows with `brokerLockStatus = "dry_run"` and the intended
payload — without calling any Tradovate endpoint.

Validate:
- `GuardianIntervention` row created on listener trigger.
- `brokerPayloadJson` contains the correct `dailyLossAutoLiq` value.
- `listenerBrokerDedupKey` unique constraint prevents duplicate rows.
- `internalLockEventId` correctly links to the Phase 2B `InternalLockEvent`.
- No actual Tradovate API call made (check via Tradovate API logs).

### Step 4 — Demo allowlist single account

Add one demo account to `PHASE_2C_DEMO_ALLOWLIST`. Keep `ENFORCEMENT_DRY_RUN=true`.
Trigger the daily loss limit manually (temporarily lower `maxDailyLoss`). Confirm
the simulated payload is correct for that specific account.

### Step 5 — Real demo broker write

Set `ENFORCEMENT_DRY_RUN=false` for the allowlisted demo account only.
(Alternatively: turn off `ENFORCEMENT_DRY_RUN` globally — demo is the only
account in the allowlist, so the practical effect is identical.)

Verify:
- `GuardianIntervention.brokerLockStatus = "broker_locked"` (not `dry_run`).
- `brokerResponseJson` contains Tradovate's confirmation.
- Read-back value matches the sent `dailyLossAutoLiq`.
- Account appears in Tradovate's risk settings as locked (check via Tradovate UI).
- Account auto-unlocks at next Tradovate session open (verify next day).
- Reset endpoint clears Guardrail internal lock (`InternalLockEvent.clearedAt` stamped).

### Step 6 — Observe 24–72 hours

Monitor:
- No unexpected additional broker writes (idempotency confirmed).
- No `broker_lock_failed` outcomes (permission confirmed stable).
- Tradovate auto-unlock happens at session open (no permanent trapping).
- Dashboard copy is correct throughout the lifecycle.

### Step 7 — Live design (not activation)

Only after Step 6 is fully validated:

Write a separate `LIVE_ENFORCEMENT_DESIGN.md` covering:
- Explicit `TRADOVATE_LISTENER_ENABLE_LIVE=true` gate and what authorizes it.
- Live-specific risk controls (tighter allowlist, separate feature flag).
- Incident response plan if a live account is locked incorrectly.
- Rollback SLA (max time to restore a live account).

**Live enforcement is NOT part of Phase 2C. It requires a separate authorization.**

---

## 9. Enforcement Capability Reference

Current Tradovate API capabilities as audited (see `ENFORCEMENT_CAPABILITIES`
in `src/lib/brokers/enforcement.ts`):

| Rule | Broker-Enforced? | Endpoint | Notes |
|---|---|---|---|
| `daily_loss_limit` | ✓ Yes | `userAccountAutoLiq/update` | Verified working |
| `profit_target` | ✓ Yes (with caveat) | `userAccountAutoLiq/update` | OpenAPI confirmed, live QA still needed |
| `trade_limit` | ✗ Internal only | — | No Tradovate trade-count field |
| `max_loss_streak` | ✗ Internal only | — | No Tradovate consecutive-loss field |
| `max_position_size` | ✗ Flatten possible | `order/liquidatepositions` | Position-blind lock not safe; flatten separate flag |
| `session_end` | ✗ Internal only | — | Needs scheduler; `flattenTimestamp` unverified |
| `trading_day_disabled` | ✗ Internal only | — | No day-of-week API field |
| `manual` | ✗ Internal only | — | Operator action only |

---

## 10. Safety Invariants Summary

These properties must hold throughout Phase 2C and cannot be overridden by
any single feature flag:

1. **Demo-only while `TRADOVATE_LISTENER_ENABLE_LIVE=false`** — live accounts
   are never touched by the listener enforcement path.
2. **Internal lock prerequisite** — broker writes only happen when Phase 2B
   has already set `riskState = "STOPPED"`. Broker enforcement amplifies a
   confirmed internal lock, never fires standalone.
3. **One broker write per account per trading day** — enforced by the
   `listenerBrokerDedupKey` unique DB constraint.
4. **No flatten in Phase 2C** — `GUARDRAIL_FLATTEN_ENABLED` flag is absent
   (absent = never flatten). Flatten requires a separate design review and flag.
5. **Audit trail always written** — `GuardianIntervention` is created for
   every enforcement attempt, success or failure. If the DB write fails, the
   broker write is not attempted (transaction ordering).
6. **Internal lock survives broker failure** — `riskState = "STOPPED"` is not
   cleared if the broker API returns an error.
7. **`changesLocked: true`, not `doNotUnlock: true`** — sessions auto-unlock
   at next Tradovate session open. `doNotUnlock=true` would permanently trap
   the account and must never be sent.

---

## 11. Phase 2C-A Implementation Status

**Status: Audit/idempotency foundation — complete. Broker writes still not wired.**

### What was added (Phase 2C-A)

| Item | File | Status |
|------|------|--------|
| Schema fields | `prisma/schema.prisma` | ✓ Done |
| Migration | `prisma/migrations/20260521000000_add_guardian_intervention_dedup_fields/` | ✓ Done |
| Dedup key helper | `src/lib/guardian-engine/broker-enforcement-dedup.ts` | ✓ Done |
| Debug route update | `src/app/api/debug/internal-lock-events/route.ts` | ✓ Done |
| Tests | `src/lib/guardian-engine/broker-enforcement-dedup.test.ts` | ✓ Done |

**Schema fields added to `GuardianIntervention`:**
- `internalLockEventId String?` — FK to `InternalLockEvent` (SET NULL on delete)
- `listenerBrokerDedupKey String? @unique` — prevents duplicate broker writes under concurrent props events
- `tradingDay String?` — YYYY-MM-DD of the violation, needed for per-day dedup display

**Debug route (`GET /api/debug/internal-lock-events`) now returns:**
```json
{
  "brokerEnforcements": {
    "count": 0,
    "hasAnyBrokerLocked": false,
    "items": []
  }
}
```
Items include `interventionId`, `internalLockEventId`, `dedupKey`, `lockStatus` per linked `GuardianIntervention` row.

### What is NOT done (intentional — no enforcement activation)

- Listener does **not** call `triggerEnforcement()` or `applyBrokerDayLockout()`
- Listener does **not** call `userAccountAutoLiq/update`
- `BROKER_ENFORCEMENT_ENABLED` remains absent/false
- `TRADOVATE_LISTENER_ENABLE_LIVE` remains false

---

## 12. Phase 2C-B Implementation Status

**Status: Broker enforcement simulation — complete. Broker writes still not wired.**

### What was added (Phase 2C-B)

| Item | File | Status |
|------|------|--------|
| Pure simulation helper | `src/lib/guardian-engine/broker-enforcement-simulation.ts` | ✓ Done |
| Read-only debug endpoint | `src/app/api/debug/broker-enforcement-simulation/route.ts` | ✓ Done |
| Tests | `src/lib/guardian-engine/broker-enforcement-simulation.test.ts` | ✓ Done |

**Simulation helper gates (evaluated in order):**
1. `env === "demo"` — live accounts always skipped
2. `ruleType ∈ BROKER_ELIGIBLE_RULES` — only `daily_loss_limit`; `trade_limit` and `max_loss_streak` skipped with explicit reason
3. `connectionStatus` not in `NON_LIVE_CONNECTION_STATUSES`
4. `permissionLevel === "full_access"`

**Debug endpoint (`GET /api/debug/broker-enforcement-simulation`):**
- Auth: session + x-cron-secret
- Feature flag: `BROKER_ENFORCEMENT_SIMULATION_ENABLED=true` (default false)
- Reads active `InternalLockEvent` rows (clearedAt IS NULL)
- Calls the pure simulation helper for each
- Returns `{ simulationEnabled, brokerEnforcementEnabled: false, activeLockCount, eligibleCount, skippedCount, candidates[] }`
- Each candidate: `{ accountId, internalLockEventId, ruleType, brokerEligible, wouldBrokerActionType, skipReason, listenerBrokerDedupKey, simulatedPayloadPreview, brokerActionTaken: false, simulationOnly: true }`
- **No DB writes. No broker calls. No GuardianIntervention rows created.**

**Sample eligible candidate response:**
```json
{
  "accountId": "clxxx",
  "internalLockEventId": "clyyy",
  "ruleType": "daily_loss_limit",
  "brokerEligible": true,
  "wouldBrokerActionType": "userAccountAutoLiq/update (or /create)",
  "skipReason": null,
  "listenerBrokerDedupKey": "clxxx:daily_loss_limit:2026-05-15:broker_enforcement",
  "simulatedPayloadPreview": {
    "accountId": 123456,
    "dailyLossAutoLiq": 250.5,
    "changesLocked": true,
    "_note": "Simulation preview only — no Tradovate request was sent."
  },
  "brokerActionTaken": false,
  "simulationOnly": true
}
```

**Sample skipped candidate (trade_limit):**
```json
{
  "ruleType": "trade_limit",
  "brokerEligible": false,
  "skipReason": "Rule type 'trade_limit' has no applicable Tradovate API — internal lock only.",
  "simulatedPayloadPreview": null,
  "brokerActionTaken": false,
  "simulationOnly": true
}
```

### What is NOT done (intentional — no enforcement activation)

- No GuardianIntervention rows created (simulation is read-only)
- Listener does **not** call `triggerEnforcement()` or `applyBrokerDayLockout()`
- `BROKER_ENFORCEMENT_ENABLED` remains absent/false
- `TRADOVATE_LISTENER_ENABLE_LIVE` remains false

### Next step (Phase 2C-C, not yet authorized)

Wire listener → `triggerEnforcement()` behind all 11 gates from Section 3, for demo accounts only, `daily_loss_limit` rule only, with `BROKER_ENFORCEMENT_ENABLED=true` feature flag gating the entire path. Creates real `GuardianIntervention` rows with `listenerBrokerDedupKey` + `internalLockEventId` fields. All safety invariants from Section 10 must pass a pre-ship test run before enabling.

### Previous next step (Phase 2C-B, now done)
~~Wire listener → `triggerEnforcement()` behind all 11 gates from Section 3...~~
Implemented as a simulation/audit-only layer. See above.

---

## 13. Phase 2B Critical Bug Fix — InternalLockEvent Duplicate Rows

**Status: Fixed. Deployed. No broker enforcement involved.**

### Bug description

During Phase 2C-B `daily_loss_limit` simulation validation, the internal lock endpoint showed:
- `activeCount: 11` — 11 duplicate active `InternalLockEvent` rows for the same account/rule/day
- All rows: same `accountId`, same `ruleType: "daily_loss_limit"`, same `tradingDay: 2026-05-14`, same `thresholdAmount: 100`
- `brokerActionTaken: false` on all rows — no broker action was taken

### Root cause

`applyInternalLockForConnection` used `internalLockEvent.create()` — a plain INSERT with no dedup. The only idempotency guard was `canApplyInternalLock(riskState !== "STOPPED")`. Under rapid concurrent props events, multiple async calls read `riskState = NORMAL` before the first transaction committed, passed the gate, and each independently created a new row.

`InternalLockEvent` had `@@index([accountId, tradingDay])` — not a `@@unique` constraint — so multiple rows with the same values were silently allowed.

### Fix

| Component | Change |
|---|---|
| Schema | Added `activeDedupKey String? @unique` to `InternalLockEvent` |
| Migration | `20260522000000_add_internal_lock_event_dedup_key` |
| Pure helper | `buildInternalLockDedupKey(accountId, ruleType, tradingDay)` → `"${accountId}:${ruleType}:${tradingDay}:internal_lock"` |
| `applyInternalLockForConnection` | Switched `create` → `upsert({ where: { activeDedupKey } })` |
| Reset endpoint | Added `activeDedupKey: null` to `updateMany` so the slot can be reused after reset |
| Tests | 18 new tests across 4 suites |

**How the fix works:**
- Active lock: `activeDedupKey = "${accountId}:${ruleType}:${tradingDay}:internal_lock"` — DB unique constraint allows only one row with this value
- Concurrent upsert race: second concurrent transaction hits the unique conflict and updates `observedAmount/updatedAt` on the existing row instead of creating a duplicate
- Cleared lock: `activeDedupKey = null` — multiple NULLs are allowed by both PostgreSQL and SQLite, so cleared history rows coexist safely
- After manual reset: `activeDedupKey` is set to `null`, allowing re-lock for the same trading day if the violation persists

### Idempotency guarantee (after fix)

> **At most one active `InternalLockEvent` row exists per `(accountId, ruleType, tradingDay)` at any time.** This is enforced at the DB level by the unique constraint on `activeDedupKey`, not only at the application level.

---

## 14. Phase 2C-C Foundation — Broker Write Path Implemented, Disabled by Default

**Status: Foundation implemented. Broker writes remain disabled. `BROKER_ENFORCEMENT_ENABLED` is absent/false.**

### What was implemented

All infrastructure for listener-path broker enforcement is in place. Nothing is wired into the listener worker yet.

| Component | File | Purpose |
|---|---|---|
| Pure gate helper | `src/lib/guardian-engine/broker-enforcement-gate.ts` | 10 ordered gates, pure computation, no I/O |
| Gate tests | `src/lib/guardian-engine/broker-enforcement-gate.test.ts` | All gates, happy path, source-scans |
| Service layer | `src/lib/guardian-engine/broker-enforcement-service.ts` | Fetches DB state, calls gate helper, calls triggerEnforcement |
| EnforcementContext extension | `src/lib/brokers/enforcement.ts` | Added `internalLockEventId?`, `listenerBrokerDedupKey?`, `tradingDay?` |
| triggerEnforcement update | `src/lib/brokers/enforcement.ts` | Persists optional listener-path fields in GuardianIntervention |
| Debug endpoint | `src/app/api/debug/broker-enforcement-gates/route.ts` | Read-only gate evaluation for all active locks |

### 10 gates (evaluated in order — first failure short-circuits)

1. `BROKER_ENFORCEMENT_ENABLED === "true"` — master feature flag, **must remain false/absent**
2. `TRADOVATE_LISTENER_ENABLE_LIVE !== "true"` — live listener not supported in Phase 2C
3. `env === "demo"` — demo-only enforcement
4. `accountId` in `BROKER_ENFORCEMENT_DEMO_ACCOUNT_ALLOWLIST` — explicit per-account opt-in
5. `ruleType === "daily_loss_limit"` — only rule with a proven Tradovate API endpoint
6. `isActive === true && missingFromBrokerSince == null` — account must be available
7. `connectionStatus` not in `{expired, connection_error, not_connected, pending_webhook, oauth_pending_storage}` — live connection required
8. `permissionLevel === "full_access"` — Account Risk Settings write requires it
9. Active `InternalLockEvent` exists for this account/rule/day — Phase 2B precondition
10. No existing `GuardianIntervention` with this `listenerBrokerDedupKey` — at-most-once enforcement

### What remains disabled

- `BROKER_ENFORCEMENT_ENABLED` is absent from all `.env` files — gate 1 fails for every call
- The service function `maybeAttemptBrokerDailyLossLockoutForInternalLock` is not called from the listener worker
- No real broker write has been made in Phase 2C-C

### Env vars required before any broker enforcement can run

```
BROKER_ENFORCEMENT_ENABLED=true                              # Currently absent/false — DO NOT SET until canary validated
BROKER_ENFORCEMENT_DEMO_ACCOUNT_ALLOWLIST=<account-id>      # Comma-separated demo account IDs
TRADOVATE_LISTENER_ENABLE_LIVE=false                         # Already false — must remain false
```

### Rollout checklist (before setting BROKER_ENFORCEMENT_ENABLED=true)

1. Confirm all Phase 2B locks are creating correctly (check `/api/debug/internal-lock-diagnostic`)
2. Confirm simulation endpoint shows `brokerEligible: true` for target account (`/api/debug/broker-enforcement-simulation`)
3. Confirm gate debug endpoint shows `eligibleCount > 0` for target account (`/api/debug/broker-enforcement-gates`)
4. Add target demo account ID to `BROKER_ENFORCEMENT_DEMO_ACCOUNT_ALLOWLIST`
5. Deploy with `BROKER_ENFORCEMENT_ENABLED=true` to a single demo environment
6. Verify one `GuardianIntervention` row is created with `brokerLockStatus = "broker_locked"` and `listenerBrokerDedupKey` set
7. Verify no duplicate `GuardianIntervention` rows (unique constraint on `listenerBrokerDedupKey`)
8. Verify Tradovate demo account is in liquidation-only mode

### Rollback procedure

1. Set `BROKER_ENFORCEMENT_ENABLED=false` (or remove it) — gate 1 fails immediately, no further broker writes
2. Restart listener worker
3. No DB writes to undo — `GuardianIntervention` rows are audit-only, not operational state
4. To re-enable: repeat rollout checklist

### Safety invariants maintained

- `TRADOVATE_LISTENER_ENABLE_LIVE=false` — unchanged, live enforcement not implemented
- `ENFORCEMENT_DRY_RUN=true` — unchanged at the cron/sync path level
- No flatten, no order cancellation, no order placement
- Listener worker not modified — service not wired in
- All existing tests continue to pass

---

## 15. Phase 2C-E: Listener Wiring — Dormant While BROKER_ENFORCEMENT_ENABLED=false

**Status: Wiring complete. Broker enforcement still disabled. No broker write executed.**

### What changed

`applyInternalLockForConnection` now returns `InternalLockResult[]` instead of `void`. Each element carries:

| Field | Type | Purpose |
|---|---|---|
| `accountId` | `string` | Which account the result is for |
| `createdOrUpdated` | `boolean` | True when a lock row was upserted this cycle |
| `internalLockEventId` | `string \| null` | ID to pass to the broker enforcement service |
| `ruleType` | `string \| null` | Primary rule that fired |
| `skipReason` | `string \| null` | Why the account was skipped (null when lock applied) |

The listener worker now chains `.then(results => { ... })` on `applyInternalLockForConnection`. Inside the `.then`, it checks `BROKER_ENFORCEMENT_ENABLED !== "true"` and returns early — so while the flag is absent or false, **zero broker enforcement calls occur**. When the flag is true and a result has a non-null `internalLockEventId`, `maybeAttemptBrokerDailyLossLockoutForInternalLock` is called, which re-evaluates all 10 gates before any broker write.

### Call path (when BROKER_ENFORCEMENT_ENABLED=true in future)

```
onPropsEvent(connectionId)
  └── applyInternalLockForConnection(connectionId)   [GUARDRAIL_INTERNAL_LOCK_ENABLED=true]
        └── returns InternalLockResult[]
              └── for each result where internalLockEventId != null:
                    └── maybeAttemptBrokerDailyLossLockoutForInternalLock(id)  [BROKER_ENFORCEMENT_ENABLED=true]
                          └── evaluateBrokerEnforcementGates() — all 10 gates
                                └── triggerEnforcement()  [only when all gates pass]
```

### Current state (BROKER_ENFORCEMENT_ENABLED absent/false)

The `.then()` handler runs and returns immediately on the second line:
```typescript
if (process.env.BROKER_ENFORCEMENT_ENABLED !== "true") return;
```
No call to `maybeAttemptBrokerDailyLossLockoutForInternalLock` is ever made. Behavior is identical to Phase 2C-C from the user's perspective.

### Tests added

- 8 new source-scan tests on `internal-lock-evaluator-db.ts` — verify `InternalLockResult[]` return type, structured fields, lock event ID capture from upsert
- 5 new source-scan tests on `tradovate-listener-worker.ts` — verify import present, `BROKER_ENFORCEMENT_ENABLED` guard, `internalLockEventId` null-check, no direct `triggerEnforcement` import, guard precedes call site
- Total: 4219 tests pass (13 new)
