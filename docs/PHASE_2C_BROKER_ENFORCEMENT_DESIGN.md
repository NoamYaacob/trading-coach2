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
