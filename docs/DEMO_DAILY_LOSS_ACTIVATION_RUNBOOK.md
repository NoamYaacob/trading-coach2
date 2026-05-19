# Demo Daily Loss Broker Risk-Settings Activation Runbook

**Account in scope:** DEMO7433035 (demo env only)  
**Rule in scope:** Daily Loss (`maxDailyLoss`) — the only broker-eligible rule  
**Path:** Rule-Save Sync (`tradovate-risk-settings-service.ts`) — distinct from breach-time listener enforcement  
**Status at time of writing:** Service wired (commit `c51dc81`), DB audit trail deployed (see §0). Env remains safe — no broker writes active.

---

## §0 — Pre-activation prerequisites (both must be verified before §1)

### §0.1 — Wire-up ✅ COMPLETE

`syncDailyLossRiskSettingToTradovate` is now called from `PATCH /api/accounts/[id]` via  
`src/app/api/accounts/[id]/daily-loss-sync.ts` (`executeDailyLossSync`).  
Call site: successful account-specific rules save when `maxDailyLoss > 0` and `platform=tradovate`.  
All 8 gates are evaluated before any broker client is created.  
Current production env (`BROKER_ENFORCEMENT_ENABLED=false`) means every attempt is `gate_blocked` — **no broker writes**.

### §0.2 — DB audit visibility ✅ COMPLETE

Every sync attempt is written to `BrokerRiskSettingsSyncAudit` via  
`src/lib/brokers/broker-risk-settings-sync-audit-writer.ts`.  
The Safety Console (`/debug/safety-console`) shows the last 20 rows under **"Broker risk settings sync"**.

**Activation gate: at least one `outcome=gate_blocked, gateFailureReason=broker_enforcement_disabled` row must be visible in the Safety Console before any env change is made.** This confirms the wire-up is live, the audit table exists, and gates are working correctly in production.

> DO NOT change Railway env vars until both §0.1 and §0.2 are verified in production.

---

## Railway service map

Three services are deployed. Only the **web service** is involved in the rule-save sync path.

| Railway service | Start command | Relevant to this runbook |
|----------------|---------------|--------------------------|
| **Web / App** | `npm run start:railway` | YES — rules PATCH handler runs here |
| **Listener worker** | `npm run start:listener` | NO — listener-path stays dormant |
| **Cron** | token renewal only | NO |

---

## Env var table

### Web service (the only service requiring changes)

| Variable | Current safe value | Demo activation value | Notes |
|----------|-------------------|----------------------|-------|
| `BROKER_ENFORCEMENT_ENABLED` | `false` | `true` | Gate 1 in service. Must be in web service. |
| `ENFORCEMENT_DRY_RUN` | `true` | `false` | Gate 7 in service. Must be in web service. |
| `BROKER_ENFORCEMENT_DEMO_ACCOUNT_ALLOWLIST` | _(empty or absent)_ | `<internal-account-id>` | Comma-separated internal `connectedAccount.id` values. Look up before activation (see §1.5). |
| `GUARDRAIL_INTERNAL_LOCK_ENABLED` | `false` | **unchanged — keep false** | Phase 2B only. Not part of rule-save sync. |
| `TRADOVATE_LISTENER_ENABLE_LIVE` | `false` | **unchanged — keep false** | Live gating. Not involved in rule-save sync. |
| `ENABLE_TRADOVATE_ORDER_ACTIONS` | `false` | **unchanged — keep false** | Order actions (flatten/cancel). Not part of this runbook. |

### Listener-worker service (no changes)

| Variable | Current safe value | Demo activation value | Notes |
|----------|-------------------|----------------------|-------|
| `BROKER_ENFORCEMENT_ENABLED` | `false` | **unchanged — keep false** | Listener-path enforcement remains dormant. |
| `ENFORCEMENT_DRY_RUN` | `true` | **unchanged — keep true** | |
| `TRADOVATE_LISTENER_ENABLE_LIVE` | `false` | **unchanged — keep false** | |
| `GUARDRAIL_INTERNAL_LOCK_ENABLED` | `false` | **unchanged — keep false** | |
| `BROKER_ENFORCEMENT_DEMO_ACCOUNT_ALLOWLIST` | _(as set)_ | **unchanged** | Listener doesn't participate. |
| `ENABLE_TRADOVATE_ORDER_ACTIONS` | `false` | **unchanged — keep false** | |

> **Key distinction:** The rule-save sync path runs entirely within the web service process. The listener worker does not need any changes for this runbook. All listener-path flags remain at their current safe values.

---

## §1 — Pre-flight checklist

Complete every item. A single NO-GO stops the runbook.

### 1.1 — Code wire-up
- [ ] §0 PR is merged and deployed to production web service
- [ ] Deployment is confirmed healthy (`/api/health` returns 200)
- [ ] No TypeScript errors, all 4722+ unit tests passing in CI

### 1.2 — Safety Console state (before any env change)
- [ ] Open Safety Console (`/debug/safety-console`)
- [ ] `BROKER_ENFORCEMENT_ENABLED` = false ✓
- [ ] `ENFORCEMENT_DRY_RUN` = true ✓
- [ ] `TRADOVATE_LISTENER_ENABLE_LIVE` = false ✓
- [ ] `GUARDRAIL_INTERNAL_LOCK_ENABLED` = false ✓
- [ ] No active enforcement locks shown for DEMO7433035
- [ ] No unexpected warning banners

### 1.3 — Listener status
- [ ] Listener worker is connected (`/api/debug/tradovate-listener/status` → `connected`)
- [ ] No stale reconnect loop (last successful heartbeat < 60s ago)
- [ ] Reconciliation shows success (no `reconciliation_failed` in recent listener logs)
- [ ] Listener is NOT processing live accounts (`TRADOVATE_LISTENER_ENABLE_LIVE=false` confirmed in listener diagnostics)

### 1.4 — Guardian state
- [ ] Guardian is active for the account owner (toggle shows enabled on Rules page)
- [ ] No active cooldown or STOPPED risk state on DEMO7433035
- [ ] `guardianEnabled=true` will resolve correctly when the wire-up code runs

### 1.5 — Account identity
- [ ] Confirm DEMO7433035 is a **demo** env account (`brokerConnection.env = "demo"`)
- [ ] Confirm `permissionLevel = "full_access"` on its broker connection
- [ ] Look up the internal `connectedAccount.id` for DEMO7433035 from the DB:
  ```sql
  SELECT id, label, platform FROM "ConnectedAccount" WHERE label = 'DEMO7433035';
  ```
- [ ] Record the internal ID: `__________________________________`
- [ ] Confirm this ID is NOT already in `BROKER_ENFORCEMENT_DEMO_ACCOUNT_ALLOWLIST`

### 1.6 — Market / position state
- [ ] No open position on DEMO7433035 at time of activation
- [ ] No active trading session in progress (do this at session end / outside RTH)
- [ ] `tradesCount = 0` for today's session (or session has reset) — prevents rule-lock conflict
- [ ] Dry-run violation feed is clean (no pending breach events): `/api/debug/tradovate-listener/dry-run-violations`

### 1.7 — Current rule state (record before any change)
- [ ] Record current `maxDailyLoss` value for DEMO7433035: `$___________`
- [ ] Record current Tradovate `dailyLossAutoLiq` value from broker (manual lookup in Tradovate Risk Settings)
- [ ] Confirm `isActive = true` and `missingFromBrokerSince = null` on the account
- [ ] Confirm connection status is `connected` (not `expired` / `connection_error`)

---

## §2 — Dry-run preview

Run the simulation before touching any env var.

### 2.1 — Simulate via the wire-up code (dry-run mode)
With `ENFORCEMENT_DRY_RUN=true` (current production state), trigger a rule save for the Daily Loss value on DEMO7433035:

1. Navigate to Rules page → select DEMO7433035
2. Confirm the displayed Daily Loss value matches the recorded value from §1.7
3. Save (make no value change, or make a test change then revert)
4. Check the audit trail for a `DailyLossSyncAudit` row with:
   - `synced = false`
   - `auditNote = "dry_run"`
   - `payloadPreview.dailyLossAutoLiq` = expected amount
   - `gateFailureReason = null` (all gates passed except the dry-run override)

### 2.2 — Verify gate passage
- [ ] Dry-run audit row exists
- [ ] `auditNote = "dry_run"` (not `"gate_blocked"`)
- [ ] `payloadPreview` contains correct dollar amount
- [ ] No `gateFailureReason` set (all 8 canSync gates passed)
- [ ] No broker call was made (confirmed by absence of Tradovate API log entry)

**If `auditNote = "gate_blocked"` is returned:** stop, inspect `gateFailureReason`, resolve the blocking gate, repeat §2.1. Do NOT proceed to §3.

---

## §3 — Activation sequence

Only proceed if every §1 item is checked and §2 passed cleanly.

### 3.1 — Set the allowlist in web service
In Railway dashboard → web service → Variables:
```
BROKER_ENFORCEMENT_DEMO_ACCOUNT_ALLOWLIST=<internal-account-id-from-§1.5>
```
- Do NOT change any other variable yet
- Redeploy web service
- Confirm deployment healthy

### 3.2 — Enable enforcement in web service (dry-run still on)
In Railway dashboard → web service → Variables:
```
BROKER_ENFORCEMENT_ENABLED=true
ENFORCEMENT_DRY_RUN=true    ← keep true for now
```
- Redeploy web service
- Open Safety Console — confirm `BROKER_ENFORCEMENT_ENABLED=true` is reflected
- Re-run the §2 dry-run simulation — confirm same `dry_run` result, gates still all pass
- Confirm listener-worker variables are still unchanged

### 3.3 — Approval gate (human sign-off required)
Before flipping `ENFORCEMENT_DRY_RUN=false`, confirm in writing:
- [ ] §2 dry-run audit row verified in §3.2
- [ ] All §1 pre-flights still valid (no state has changed since §1)
- [ ] No open position on DEMO7433035
- [ ] Operator explicitly approves proceeding to live write

### 3.4 — Flip to live write
In Railway dashboard → web service → Variables:
```
ENFORCEMENT_DRY_RUN=false
```
- Redeploy web service only
- Confirm deployment healthy

### 3.5 — Perform the controlled Daily Loss sync
1. Navigate to Rules page → select DEMO7433035
2. Confirm the Daily Loss value (use the same value recorded in §1.7, or the intended new value)
3. Save the rule
4. **Do not navigate away** — wait for the save to complete

### 3.6 — Verify the sync result
- [ ] No error toast or 5xx response on the Rules page save
- [ ] Audit trail shows a `DailyLossSyncAudit` row with:
  - `synced = true`
  - `auditNote = "broker_write_attempted"`
  - `brokerResponse` contains a Tradovate `userAccountAutoLiq/update` confirmation
  - `payloadPreview.changesLocked = true`
- [ ] Tradovate Risk Settings for DEMO7433035 shows updated `dailyLossAutoLiq`
- [ ] Safety Console shows no unexpected alerts
- [ ] Dashboard remains healthy — no new locks, no breach events
- [ ] No order action log entries (no cancel/flatten calls)
- [ ] Listener worker state is unchanged (still processing demo fills in dry-run)

---

## §4 — Restrictions (enforced by service gates; verified by this runbook)

The following are **hard blocks** — the 8-gate service will reject them automatically, and this runbook explicitly prohibits them:

| Action | Status |
|--------|--------|
| Sync to a live account | BLOCKED — Gate 2 (`env=demo` only) |
| Sync to any account other than DEMO7433035 | BLOCKED — not in allowlist |
| Sync profit target | BLOCKED — `assertDailyLossOnly()` throws |
| Sync max trades per day | BLOCKED — `assertDailyLossOnly()` throws |
| Sync stop-after-losses | BLOCKED — `assertDailyLossOnly()` throws |
| Sync max contracts | BLOCKED — `assertDailyLossOnly()` throws |
| Sync session cutoff | BLOCKED — `assertDailyLossOnly()` throws |
| Flatten/cancel orders | BLOCKED — `ENABLE_TRADOVATE_ORDER_ACTIONS=false` |
| Listener-path broker enforcement | BLOCKED — `BROKER_ENFORCEMENT_ENABLED=false` in listener-worker |

---

## §5 — Success criteria

All of the following must be true before closing the activation:

- [ ] Tradovate `dailyLossAutoLiq` for DEMO7433035 matches the saved `maxDailyLoss` value
- [ ] Sync audit row shows `synced=true`, `auditNote=broker_write_attempted`
- [ ] Safety Console shows no error state
- [ ] No order action log entries (no cancel, flatten, liquidate)
- [ ] No `broker_locked` event was triggered during setup
- [ ] Dashboard shows DEMO7433035 in expected state (no unexpected lock)
- [ ] Listener worker is still connected and processing normally
- [ ] All other accounts are unaffected

---

## §6 — Rollback procedure

Execute immediately if any NO-GO signal appears (see §7) or at any point you want to abort.

### 6.1 — Restore env vars in web service
In Railway dashboard → web service → Variables:
```
BROKER_ENFORCEMENT_ENABLED=false
ENFORCEMENT_DRY_RUN=true
BROKER_ENFORCEMENT_DEMO_ACCOUNT_ALLOWLIST=   ← clear (remove the value)
```

### 6.2 — Redeploy web service
- Trigger redeploy of web service only
- Confirm deployment healthy (`/api/health` → 200)
- Do NOT touch listener-worker (it was not changed)

### 6.3 — Verify rollback
- [ ] Safety Console: `BROKER_ENFORCEMENT_ENABLED=false` ✓
- [ ] Safety Console: `ENFORCEMENT_DRY_RUN=true` ✓
- [ ] Safety Console: allowlist empty ✓
- [ ] Trigger a test rule save on DEMO7433035 — confirm audit row shows `auditNote=gate_blocked`, `gateFailureReason=broker_enforcement_disabled`
- [ ] No further broker writes possible — confirmed by gate 1 blocking

### 6.4 — Post-rollback note
- Tradovate Risk Settings may retain the value that was written before rollback. This is expected — Tradovate does not auto-revert. The Daily Loss limit written is still a valid safety value. If the value must be cleared, do so manually in the Tradovate Risk Manager UI.

---

## §7 — NO-GO signals

Stop immediately and execute §6 rollback if any of the following occur at any point:

| Signal | Action |
|--------|--------|
| Any live account (`env=live`) appears in audit logs | STOP — rollback immediately |
| Account other than DEMO7433035 in a sync audit row | STOP — rollback immediately |
| Any rule other than `maxDailyLoss` in a sync request | STOP — rollback immediately |
| `guardianEnabled=false` at sync time | STOP — fix Guardian, re-run from §1 |
| Listener reconciliation fails during activation window | PAUSE — resolve before proceeding to §3.3 |
| `connectionStatus` flips to `expired` or `connection_error` | PAUSE — reconnect, re-verify |
| Unexpected Tradovate API error in `brokerResponse` | STOP — rollback, investigate response |
| Any order action log entry (cancel / flatten / liquidate) | STOP — rollback immediately |
| Safety Console shows unexpected warning banners | PAUSE — investigate before §3.3 |
| Open position detected on DEMO7433035 at §3.4 | PAUSE — wait for flat, re-check §1.6 |

---

## §8 — Reference: the 8-gate service check order

From `canSyncTradovateRiskSettings` — evaluated in order, first failure returns immediately:

| Gate | Field | Failure code |
|------|-------|-------------|
| 1 | `BROKER_ENFORCEMENT_ENABLED=true` | `broker_enforcement_disabled` |
| 2 | `env=demo` | `env_not_demo` |
| 3 | `isActive=true` | `account_inactive` |
| 4 | `missingFromBroker=false` | `account_missing_from_broker` |
| 5 | `connectionStatus` not in expired/error/disconnected set | `connection_not_live` |
| 6 | `permissionLevel=full_access` | `insufficient_permissions` |
| 7 | `accountAllowlisted=true` | `account_not_allowlisted` |
| 8 | `guardianEnabled=true` | `guardian_inactive` |
| Post-gates | `ENFORCEMENT_DRY_RUN=false` | `auditNote=dry_run` |

Any gate failure → `{ synced: false, auditNote: "gate_blocked", gateFailureReason: "<code>" }`. No broker call is made.
