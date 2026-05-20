# Phase 2E — Admin Rollout Readiness Controls

## Summary

Phase 2E adds an admin-only **Rollout Readiness** section to `/debug/safety-console`.
It provides a per-account checklist that makes the pre-canary safety state visible,
unambiguous, and audit-ready without changing any enforcement behavior.

**No enforcement was activated. No broker writes were performed. No live accounts were touched.**

---

## Safety Console capabilities after Phase 2E

The `/debug/safety-console` page (admin-only, guarded by `isAdminEmail` + `notFound()`) now shows:

| Section | What it shows |
|---------|---------------|
| **Alerts** | Zero or more severity-ranked alerts (critical / warning / info) |
| **Overall severity** | `safe` / `info` / `warning` / `critical` |
| **Env flags — Web/app runtime** | `BROKER_ENFORCEMENT_ENABLED`, `ENFORCEMENT_DRY_RUN`, etc., read from the web process env |
| **Env flags — Listener-worker** | Same flags, read from the persisted `ListenerWorkerStatus` DB singleton (or "Not exposed" if stale/missing) |
| **Listener health** | Per-connection: `listenerStatus`, `lastCloseCode/Reason` (historical), heartbeat age |
| **Reconciliation** | Per-connection: trigger, status, accounts synced, error (if any) |
| **Rollout readiness** | Per-rollout-relevant account: `ready` / `needs_review` / `blocked` checklist |

The page carries an explicit advisory disclaimer:

> **Readiness is advisory only. It does not enable enforcement or send broker actions.**

---

## Rollout readiness checklist

For each rollout-relevant account (`isRolloutRelevant=true`), the console derives one of three statuses:

| Status | Meaning |
|--------|---------|
| `ready` | All checks pass — safe to proceed with a canary |
| `needs_review` | One or more non-blocking checks fail — review before proceeding |
| `blocked` | One or more blocking checks fail — do not proceed |

### Checks and their blocking tier

| Check | Blocking? | Blocked when |
|-------|-----------|--------------|
| Account in demo allowlist | No | account not in `BROKER_ENFORCEMENT_DEMO_ACCOUNT_ALLOWLIST` |
| Connection env is demo (not live) | **Yes** | `connectionEnv` ≠ `"demo"` |
| Listener-worker env verified | No | `ListenerWorkerStatus` row is missing or stale |
| `BROKER_ENFORCEMENT_ENABLED=false` | **Yes** (if true) | listener-worker reports `brokerEnforcementEnabled=true` |
| `ENFORCEMENT_DRY_RUN=true` | No | listener-worker reports `dryRunEnabled=false` |
| `TRADOVATE_LISTENER_ENABLE_LIVE=false` | **Yes** (if true) | listener-worker reports `listenerLiveEnabled=true` |
| `GUARDRAIL_INTERNAL_LOCK_ENABLED=false` | No | listener-worker reports `internalLockEnabled=true` |
| `listener.status=connected` | **Yes** (if closed/error) | `listenerStatus` is `"closed"` or `"error"` |
| `Reconciliation status=success` | **Yes** (if failed) | `lastReconciliationStatus` is `"failed"` |
| No active internal lock | **Yes** | `activeLockCount > 0` |
| No broker_lock_failed history | **Yes** | any `GuardianIntervention` row has `brokerLockStatus="broker_lock_failed"` for this account |

---

## Verified production-safe state (2026-05-17)

The Safety Console was verified on 2026-05-17 and showed the following state.

### Overall

| Field | Value |
|-------|-------|
| Overall severity | `safe` |
| Active alerts | 0 |

### Listener-worker env flags (verified via `ListenerWorkerStatus` DB singleton)

| Variable | Value |
|----------|-------|
| `BROKER_ENFORCEMENT_ENABLED` | `false` |
| `TRADOVATE_LISTENER_ENABLE_LIVE` | `false` |
| `ENFORCEMENT_DRY_RUN` | `true` |
| `GUARDRAIL_INTERNAL_LOCK_ENABLED` | `false` |

### Rollout target account

| Field | Value |
|-------|-------|
| `accountId` | `cmottd1z200020do1knjxq582` |
| `accountLabel` | `DEMO7433035` |
| `brokerConnectionId` | `cmp56a3kv00020dmedmm5flr1` |
| `env` | `demo` |

### Listener health

| Field | Value |
|-------|-------|
| `listener.status` | `connected` |
| `reconcileTrigger` | `initial_connect` |
| `reconcileStatus` | `success` |
| `reconcileAccounts` | 1 |

### Account safety

| Field | Value |
|-------|-------|
| `activeLockCount` | 0 |
| `historicalEnforcements` | 1 |
| `hasHistoricalBrokerLockOnly` | `true` |
| `latestBrokerLockStatus` | `broker_locked` |
| Risk state | `NORMAL` |

### Rollout readiness

| Account | Status |
|---------|--------|
| DEMO7433035 | **Ready** |

---

## Historical broker audit row clarification

The `GuardianIntervention` row with `brokerLockStatus="broker_locked"` (trading day 2026-05-14,
created during the Phase 2C demo canary) is an **immutable audit record**. It does not represent
an active Guardrail lock.

- `activeCount = 0` — no active internal lock exists.
- `hasHistoricalBrokerLockOnly = true` — the audit row is post-canary history only.
- `broker_lock_failed` history — none; the `"No broker_lock_failed history"` readiness check passes.
- The broker-side `changesLocked` flag set during the canary auto-cleared at the Tradovate session
  open on 2026-05-15 (because `doNotUnlock` was omitted from the canary write).

A future canary on any trading day after 2026-05-14 uses a different dedup key and is not
blocked by this historical row.

---

## Safety rule: required console state before any future canary or rollout

**No broker canary or live rollout may proceed unless the Safety Console shows all of the following:**

1. **Overall severity: `safe`** — zero alerts at any level.
2. **Listener-worker env verified** — `ListenerWorkerStatus` row is fresh (not stale/missing).
3. **`BROKER_ENFORCEMENT_ENABLED=false`** — confirmed in listener-worker env.
4. **`TRADOVATE_LISTENER_ENABLE_LIVE=false`** — confirmed in listener-worker env.
5. **`ENFORCEMENT_DRY_RUN=true`** — confirmed in listener-worker env.
6. **`listener.status=connected`** — for the target account's connection.
7. **`reconcileStatus=success`** — for the target account's connection.
8. **Rollout readiness: `ready`** — for the target account.

Do not proceed if any check shows `blocked`. Investigate any `needs_review` before proceeding.

---

## Carry-forward safety rules

- `TRADOVATE_LISTENER_ENABLE_LIVE=false` must remain unchanged until a live rollout is explicitly
  designed, reviewed, and approved.
- Do not enable `BROKER_ENFORCEMENT_ENABLED=true` without completing a full pre-flight from the
  Phase 2C–D runbook.
- Do not set `ENFORCEMENT_DRY_RUN=false` without human sign-off and Safety Console showing `ready`.
- Do not add flatten, cancel, or order actions without a separate design review.
- The Safety Console is read-only and admin-only — it makes no DB writes and sends no broker actions.

---

## Changed files

| File | Change |
|------|--------|
| `src/lib/safety-console-helpers.ts` | Added `RolloutAccountInput`, `RolloutCheckItem`, `RolloutReadiness`, `RolloutReadinessStatus` types; added `deriveRolloutReadiness` pure function |
| `src/app/debug/safety-console/page.tsx` | Added `connectionByAccountId` and `brokerLockFailedCountByAccount` map computations; added `rolloutReadiness` derivation; added `RolloutReadinessSection` component; added `READINESS_BADGE` constant |
| `src/lib/safety-console-helpers.test.ts` | 20 new tests: all three readiness states, source-scan guard confirming rollout checklist is not exposed in customer `command-center.tsx` |

## Next step — first external beta

When the Safety Console shows `safe` and rollout readiness shows `ready` for the target demo account, the next step is a guided first session with an external beta user.

See `docs/FIRST_EXTERNAL_BETA_RUNBOOK.md` for the full pre-session checklist, customer setup flow, live monitoring checklist, and go/pause criteria.

---

## Related documents

- `docs/PHASE_2C_BROKER_ENFORCEMENT_DESIGN.md` — full canary design and rationale
- `docs/PHASE_2C_D_DEMO_CANARY_RUNBOOK.md` — canary execution log and post-canary safe-mode state
- `docs/PHASE_2D_LISTENER_RELIABILITY.md` — reconnect reconciliation added in Phase 2D
- `docs/FIRST_EXTERNAL_BETA_RUNBOOK.md` — guided first external beta session runbook
