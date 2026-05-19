# Tradovate Risk Settings Sync

**Phase 2C — Rule-Save Sync path**

This document describes `tradovate-risk-settings-service.ts` and how it differs from the listener-path enforcement.

---

## What this service does

The Risk Settings Sync service proactively writes a user's saved daily loss rule to Tradovate's `userAccountAutoLiq` risk settings API when the user saves their rule configuration. This is a **rule-save sync**, not a breach enforcement.

The goal is to keep Tradovate's built-in risk engine in sync with the user's Guardrail daily loss limit so that, when broker permissions allow, the exchange itself will enforce the limit — independent of Guardrail's app layer.

---

## Which rules are broker-backed vs. monitored

| Rule | Broker-backed? | How enforced |
|------|---------------|--------------|
| `maxDailyLoss` | **YES** — `broker_synced` | Written to Tradovate `userAccountAutoLiq.dailyLossAutoLiq` |
| `dailyProfitTarget` | NO — `guardrail_monitored` | Guardrail notifies; broker ignores |
| `maxTradesPerDay` | NO — `guardrail_lockable` | Guardrail internal account lock only |
| `stopAfterLosses` | NO — `guardrail_lockable` | Guardrail internal account lock only |
| `maxContracts` | NO — `guardrail_monitored` | Guardrail flags; no broker write |
| `sessionEndHour` | NO — `advisory_only` | Saved; not yet acted on |
| `sessionEndBehavior` | NO — `advisory_only` | Saved; not yet acted on |

**Only `maxDailyLoss` may ever reach the Tradovate API through this service.** Calling the service with any other rule key causes `assertDailyLossOnly()` to throw immediately.

---

## Gate descriptions

Gates are evaluated in order. The first gate that fails returns `{ allowed: false, skipReason }` immediately. All gates must pass for a broker write to be attempted.

| # | Gate | Field | `gateFailureReason` when blocked |
|---|------|-------|----------------------------------|
| 1 | `BROKER_ENFORCEMENT_ENABLED` flag | `brokerEnforcementEnabled` | `broker_enforcement_disabled` |
| 2 | Environment | `env` | `env_not_demo` |
| 3 | Account active | `isActive` | `account_inactive` |
| 4 | Account present in broker | `missingFromBroker` | `account_missing_from_broker` |
| 5 | Connection liveness | `connectionStatus` | `connection_not_live` |
| 6 | Permission level | `permissionLevel` | `insufficient_permissions` |
| 7 | Account allowlist | `accountAllowlisted` | `account_not_allowlisted` |
| 8 | Guardian active | `guardianEnabled` | `guardian_inactive` |

Each failure returns `{ allowed: false, skipReason: string, gateFailureReason: string }`. Callers should record `gateFailureReason` in their audit log.

### What is NOT required here (unlike the listener path)

- **InternalLockEvent** — the listener path (breach enforcement) requires an active lock event as a precondition. Rule-save sync does not, because it fires at save time, not breach time.
- **Dedup key** — the listener path uses a `GuardianIntervention` dedup key to prevent duplicate broker writes for the same breach event. Rule-save sync callers handle idempotency at the DB layer.

---

## Dry-run behavior

The service has two independent dry-run mechanisms:

### `simulateTradovateRiskSettingsSync(input)`

This function **never calls TradovateClient** regardless of any flag or environment variable. Use it to:

- Validate that all gates would pass for a given account/connection state
- Preview the exact payload that would be sent to Tradovate
- Confirm a specific configuration is sync-eligible before attempting a live write

```ts
const result = await simulateTradovateRiskSettingsSync({
  brokerEnforcementEnabled: true,
  env: "demo",
  isActive: true,
  missingFromBroker: false,
  connectionStatus: "connected",
  permissionLevel: "full_access",
  accountAllowlisted: true,
  guardianEnabled: true,
  maxDailyLoss: 500,
});
// result.attempted === true
// result.dryRun === true
// result.payloadPreview === { dailyLossAutoLiq: 500, changesLocked: true }
// No broker call was made.
```

### `ENFORCEMENT_DRY_RUN=true` env var

When `syncDailyLossRiskSettingToTradovate` is called (the live function), it checks `process.env.ENFORCEMENT_DRY_RUN`. If set to `"true"`, all gates are still evaluated, but the broker call is skipped and the result includes `auditNote: "dry_run"` with a populated `payloadPreview`.

This allows full end-to-end testing of the rule-save code path without any actual broker writes.

---

## How to validate without broker writes

1. **Simulate only (safest)** — call `simulateTradovateRiskSettingsSync` in your test or diagnostic code. This function has a hard guarantee in its implementation: it never references `TradovateClient` directly. The test suite verifies this with a source-level scan.

2. **Dry-run mode** — set `ENFORCEMENT_DRY_RUN=true` in the environment, then call `syncDailyLossRiskSettingToTradovate`. The function will evaluate all gates, build the payload preview, but skip the actual `client.applyDailyLossLock` call.

3. **Gate check only** — call `canSyncTradovateRiskSettings(input)` directly. Returns `{ allowed, skipReason, gateFailureReason }` with zero side effects.

---

## How this differs from the listener-path enforcement

| Aspect | Rule-Save Sync (this service) | Listener-Path Enforcement |
|--------|------------------------------|--------------------------|
| **When it fires** | When a user saves their daily loss rule | When the Guardian listener detects a breach |
| **Source files** | `tradovate-risk-settings-service.ts` | `broker-enforcement-gate.ts`, `broker-enforcement-service.ts` |
| **InternalLockEvent required?** | No | Yes (gate 9) |
| **Account allowlist required?** | Yes (gate 7, `accountAllowlisted`) | Yes (gate 4, `BROKER_ENFORCEMENT_DEMO_ACCOUNT_ALLOWLIST`) |
| **Guardian active required?** | Yes (gate 8, `guardianEnabled`) | Yes (implied by listener active) |
| **Dedup check?** | No (caller handles idempotency) | Yes (gate 10, `GuardianIntervention` dedup key) |
| **Trigger** | User action | Automated breach detection |
| **Purpose** | Keep Tradovate in sync with the user's saved rule | Enforce the breach at the exchange level |

These two paths are intentionally kept independent. `tradovate-risk-settings-service.ts` must not import from `broker-enforcement-gate.ts` or `broker-enforcement-service.ts`.

---

## Safety invariants

1. `assertDailyLossOnly(ruleKey)` throws for any rule key other than `"maxDailyLoss"`. This is called as a defense-in-depth guard at the entry point of any function that would write broker risk settings.
2. `BROKER_INELIGIBLE_RULE_KEYS` is an exported constant listing all rules that must never reach Tradovate: `dailyProfitTarget`, `maxTradesPerDay`, `stopAfterLosses`, `maxContracts`, `sessionEndHour`, `sessionEndBehavior`.
3. `simulateTradovateRiskSettingsSync` contains no reference to `TradovateClient` in its implementation. The test suite verifies this with a source scan.
4. All live broker writes require `BROKER_ENFORCEMENT_ENABLED=true` AND `env="demo"` — both must be true simultaneously.
5. `ENFORCEMENT_DRY_RUN=true` overrides the live write at the function level, independent of all other flags.
6. `accountAllowlisted=true` is required — accounts not in the explicit allowlist are blocked at gate 7 and never reach the broker call.
7. `guardianEnabled=true` is required — if Guardian is inactive, gate 8 blocks the write. This prevents broker-side changes when Guardrail's own monitoring is not running.
