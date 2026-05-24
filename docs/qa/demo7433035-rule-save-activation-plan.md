# DEMO7433035 — Final Rule-Save Activation Plan
## Daily Loss Broker Risk Settings — Controlled Demo Write

**Account:** DEMO7433035  
**ConnectedAccount.id:** `cmottd1z200020do1knjxq582`  
**externalAccountId:** `47669364`  
**Date of this plan:** 2026-05-24  
**Execution date:** 2026-05-24  
**Status:** ✅ COMPLETED — Phase A dry-run PASS · Phase B live write PASS · Safety reset PASS  
**Based on:** Verified readiness diagnostic, cleared AutoLiq state  
**References:** `docs/DEMO_DAILY_LOSS_ACTIVATION_RUNBOOK.md` (original runbook),  
`docs/qa/daily-loss-broker-activation-candidate.md` (candidate guide)

---

## Summary of Current Verified State

| Check | Value | Status |
|---|---|---|
| platform | `tradovate` | ✅ |
| env | `demo` | ✅ |
| permissionLevel | `full_access` | ✅ |
| connectionStatus | `connected_readonly` | ⚠️ see §0 |
| isActive | `true` | ✅ |
| missingFromBrokerSince | `null` | ✅ |
| externalAccountId | `47669364` (valid masterid) | ✅ |
| guardianEnabled | `true` | ✅ |
| consentValid | `true` | ✅ |
| maxDailyLoss | `$40,000` | ✅ |
| D1 block | **none** — AutoLiq manually cleared | ✅ |
| activationVerdict phase | `ready_for_preview_only` | ✅ |
| Only blockers | env flags only (expected) | ✅ |
| allowlisted | `true` (already in `BROKER_ENFORCEMENT_DEMO_ACCOUNT_ALLOWLIST`) | ✅ |

---

## Execution Results — COMPLETED 2026-05-24

### Phase A — Dry-run: PASS

**Env state:** `BROKER_ENFORCEMENT_ENABLED=true`, `ENFORCEMENT_DRY_RUN=true` (web/app only). All other services and vars unchanged.

| Field | Observed | Expected | Match |
|---|---|---|---|
| `ruleType` | `daily_loss_limit` | `daily_loss_limit` | ✅ |
| `outcome` | `dry_run` | `dry_run` | ✅ |
| `amount` | `40000` | `40000` | ✅ |
| `payloadPreviewJson.dailyLossAutoLiq` | `40000` | `40000` | ✅ |
| `payloadPreviewJson.changesLocked` | `true` | `true` | ✅ |
| `payloadPreviewJson.doNotUnlock` | absent | absent | ✅ |
| `brokerResponseJson` | `null` | `null` | ✅ |
| `hasAnyBrokerWrite` | `false` | `false` | ✅ |

All Guardrail gates passed. Payload was correct. No broker call was made.

---

### Phase B — Live write: PASS

**Env state:** `BROKER_ENFORCEMENT_ENABLED=true`, `ENFORCEMENT_DRY_RUN=false` (web/app only). All other services and vars unchanged.

| Field | Observed | Expected | Match |
|---|---|---|---|
| `ruleType` | `daily_loss_limit` | `daily_loss_limit` | ✅ |
| `outcome` | `success` | `success` | ✅ |
| `amount` | `40000` | `40000` | ✅ |
| `brokerResponseJson` | present | present | ✅ |
| `hasAnySuccess` | `true` | `true` | ✅ |
| `hasAnyBrokerWrite` | `true` | `true` | ✅ |
| `gateFailureReason` | `null` | `null` | ✅ |
| `errorMessage` | `null` | `null` | ✅ |

**Tradovate UI confirmed after write:**
- Daily Loss Limit: **ON**
- Value: **40,000**
- Lock risk settings if trading locked: **ON**

**`connected_readonly` concern resolution (see §0):** The OAuth token DID have write scopes. The `connected_readonly` connectionStatus label did not block the write on the rule-save path. Gates passed and the broker call succeeded.

---

### Safety reset — PASS

Applied immediately after Phase B confirmation.

| Service | Variable | Restored to | Confirmed |
|---|---|---|---|
| Web / App | `BROKER_ENFORCEMENT_ENABLED` | `false` | ✅ |
| Web / App | `ENFORCEMENT_DRY_RUN` | `true` | ✅ |
| Listener worker | ALL | unchanged throughout | ✅ |
| Cron | ALL | unchanged throughout | ✅ |

**Posture endpoint confirmed after reset:**

| Field | Value |
|---|---|
| `brokerEnforcementEnabled` | `false` |
| `enforcementDryRun` | `true` |
| `enableTradovateOrderActions` | `false` |
| `tradovateListenerEnableLive` | `false` |
| `guardrailInternalLockEnabled` | `false` |
| `verdict.status` | `GO` |

**Vars confirmed unchanged throughout all phases:**
- `GUARDRAIL_INTERNAL_LOCK_ENABLED` stayed `false`
- `TRADOVATE_LISTENER_ENABLE_LIVE` stayed `false`
- `ENABLE_TRADOVATE_ORDER_ACTIONS` stayed `false`
- No listener-worker changes
- No cron changes
- No live accounts touched
- No flatten / cancel / close actions
- Daily Loss only

---

## §0 — Critical Pre-Check: `connectionStatus = connected_readonly`

The readiness diagnostic reports `connectionStatus: connected_readonly`. This value is
**not** in `NON_LIVE_CONNECTION_STATUSES`, so all rule-save path gates pass. However,
`connected_readonly` causes the **listener path** to explicitly skip enforcement via
`shouldSkipBrokerEnforcement → skip=true`. This means:

- **Rule-save path:** gates pass — write will be attempted at Tradovate API level.
  Success depends on whether the stored OAuth token has write scopes.
- **Listener path:** enforcement is skipped entirely for `connected_readonly`.

**`permissionLevel=full_access` is stored**, which was set when the permission probe
confirmed write access. If the OAuth token has since been refreshed to read-only scopes,
the live write will fail at the Tradovate API level (not at the Guardrail gate level).

**Resolution path:** The dry-run pass in §2 will confirm the Guardrail gates pass.
The live write in §3 will immediately reveal whether the token has write access.
A `failed` outcome in the audit row with a Tradovate 401/403 means re-authentication
is required before proceeding. This is not a regression — it's a safe diagnosis.

---

## §1 — Pre-Activation Checks

Complete all checks before changing any env var. All snippets require the `CRON_SECRET`
header and an authenticated Guardrail session.

### 1.1 — Enforcement readiness diagnostic

```js
fetch('/api/debug/daily-loss-enforcement-readiness?accountId=cmottd1z200020do1knjxq582', {
  credentials: 'include',
  headers: { 'x-cron-secret': '<CRON_SECRET>' }
}).then(r => r.json()).then(d => {
  console.log('Phase:', d.activationVerdict.phase);
  console.log('GO/NO-GO:', d.activationVerdict.goNoGo);
  console.log('Blockers:', d.activationVerdict.blockers);
  console.log('D1 blocked:', d.ownershipAndRecovery.d1Blocked);
  console.log('Existing AutoLiq:', d.existingAutoLiq);
  console.log('Consent valid:', d.currentRules.consentValid);
  console.log('maxDailyLoss:', d.currentRules.maxDailyLoss);
});
```

**Expected values (all must be confirmed before proceeding):**

| Field | Expected | Stop if |
|---|---|---|
| `activationVerdict.phase` | `ready_for_preview_only` | anything other than `ready_for_preview_only` |
| `activationVerdict.blockers` | `["BROKER_ENFORCEMENT_ENABLED_not_true", "account_not_in_allowlist"]` or only env flags | any non-env blocker |
| `ownershipAndRecovery.d1Blocked` | `false` | `true` — do not proceed |
| `existingAutoLiq.changesLocked` | `null` or `false` | `true` with `d1Blocked=true` |
| `currentRules.consentValid` | `true` | `false` |
| `currentRules.maxDailyLoss` | `40000` | `null` or `<= 0` |
| `account.permissionLevel` | `full_access` | anything else |
| `account.validMasterId` | `true` | `false` |

> Note: `account_not_in_allowlist` may or may not appear in blockers — the account IS
> already allowlisted. If the readiness endpoint still shows it as a blocker, that is a
> diagnostic discrepancy to investigate, not ignore.

### 1.2 — Activation candidates scanner

```js
fetch('/api/debug/daily-loss-activation-candidates', {
  credentials: 'include',
  headers: { 'x-cron-secret': '<CRON_SECRET>' }
}).then(r => r.json()).then(d => {
  const acct = d.accounts.find(a => a.id === 'cmottd1z200020do1knjxq582');
  console.log('Account readiness:', acct?.readiness);
  console.log('AutoLiq preview:', acct?.latestAutoLiqPreview);
  console.log('Ownership:', acct?.ownership);
  console.log('Summary:', d.summary);
});
```

**Expected values:**

| Field | Expected |
|---|---|
| `readiness.status` | `candidate` or `preview_required` |
| `readiness.phase` | `candidate_for_demo_activation` or `preview_required` |
| `latestAutoLiqPreview.changesLocked` | `null` or `false` |
| `latestAutoLiqPreview.existingAutoLiqStatus` | `no_existing_autoliq` or `known` (not `unknown_preview_required`) |
| `ownership.hasGuardrailOwnedWrite` | `false` (no prior writes yet) |

### 1.3 — Audit history (confirm no prior live writes)

```js
fetch('/api/debug/broker-risk-settings-audits?accountId=cmottd1z200020do1knjxq582&limit=20', {
  credentials: 'include',
  headers: { 'x-cron-secret': '<CRON_SECRET>' }
}).then(r => r.json()).then(d => {
  console.log('Summary:', d.summary);
  console.log('hasAnyBrokerWrite:', d.hasAnyBrokerWrite);
  console.log('Latest recovery preview:', d.latestRecoveryPreview);
  console.table(d.audits.map(a => ({
    createdAt: a.createdAt,
    ruleType: a.ruleType,
    outcome: a.outcome,
    hasBrokerResponse: a.brokerResponseJson != null,
    gateFailureReason: a.gateFailureReason
  })));
});
```

**Expected values:**

| Field | Expected |
|---|---|
| `hasAnyBrokerWrite` | `false` |
| `summary.success` | `0` |
| `latestRecoveryPreview.changesLocked` | `null` or `false` |

### 1.4 — Market / session state

- Confirm no open positions on DEMO7433035 (check Tradovate demo UI)
- Confirm no active live trading session in progress
- Preferably do this outside regular trading hours (before 9:30 ET or after 4:00 ET)

### 1.5 — Allowlist confirmation

Confirm that `BROKER_ENFORCEMENT_DEMO_ACCOUNT_ALLOWLIST` on the **web service** contains
exactly `cmottd1z200020do1knjxq582` and no other account id. In Railway dashboard →
web service → Variables → search for `BROKER_ENFORCEMENT_DEMO_ACCOUNT_ALLOWLIST`.

If the value already contains `cmottd1z200020do1knjxq582`, no change is needed.
If it is absent or has a different value, update it before proceeding.

---

## §2 — Path Selection: Rule-Save First

**Recommendation: activate rule-save Daily Loss sync first, not listener-path enforcement.**

### Why rule-save is the lower-risk first path

| Dimension | Rule-save path | Listener path |
|---|---|---|
| Trigger | Operator saves a rule in the UI — fully controlled timing | Real loss breach detected by listener — timing not controlled |
| Amount written | Fixed configured `maxDailyLoss` value ($40,000) — known in advance | Observed breach amount — variable, depends on actual P&L |
| Prerequisites | `BROKER_ENFORCEMENT_ENABLED=true` on web service only | Also needs `GUARDRAIL_INTERNAL_LOCK_ENABLED=true`, active `InternalLockEvent`, no dedup collision |
| Tradovate API call | `userAccountAutoLiq/update` (or `/create`) — one call per save | Same endpoint — but triggered mid-session by the listener worker |
| Dry-run test | Simple: save rule → check audit row | Complex: requires creating a lock and simulating a breach |
| Rollback | Clear the value in Tradovate UI, flip env var | Same, plus clear the InternalLockEvent |
| `connected_readonly` effect | Gates pass; write attempted | `shouldSkipBrokerEnforcement` returns skip=true — **no write** |

**Additional reason to go rule-save first:** once a successful rule-save write has been
confirmed, Guardrail OWNS the AutoLiq record (`changesLocked=true`, `brokerResponseJson`
present). Subsequent listener-path enforcement then operates on a Guardrail-owned record,
which is the cleanest and safest state for live enforcement.

**The listener path (GUARDRAIL_INTERNAL_LOCK_ENABLED, breach-time enforcement) must not
be activated in this session.** It requires a separate canary sequence (see
`docs/PHASE_2C_D_DEMO_CANARY_RUNBOOK.md`).

---

## §3 — Railway Env Changes by Service

### Phase A — Dry-run gate verification

| Service | Variable | Current value | Phase A value | Notes |
|---|---|---|---|---|
| **Web / App** | `BROKER_ENFORCEMENT_ENABLED` | `false` / absent | **`true`** | ← only change in Phase A |
| **Web / App** | `ENFORCEMENT_DRY_RUN` | `true` | `true` (unchanged) | Keep true for dry-run |
| **Web / App** | `BROKER_ENFORCEMENT_DEMO_ACCOUNT_ALLOWLIST` | `cmottd1z200020do1knjxq582` | unchanged | Already set |
| **Web / App** | `GUARDRAIL_INTERNAL_LOCK_ENABLED` | `false` | `false` (unchanged) | Rule-save path does not use this |
| **Web / App** | `TRADOVATE_LISTENER_ENABLE_LIVE` | `false` | `false` (unchanged) | Never change |
| **Web / App** | `ENABLE_TRADOVATE_ORDER_ACTIONS` | `false` | `false` (unchanged) | Never change for this runbook |
| **Listener worker** | ALL | unchanged | **ALL unchanged** | Listener path remains dormant |
| **Cron** | ALL | unchanged | **ALL unchanged** | No cron involvement |

Apply Phase A: set `BROKER_ENFORCEMENT_ENABLED=true` on web service only. Redeploy web service. Confirm healthy.

### Phase B — Live write

Only proceed to Phase B after Phase A dry-run confirms `outcome=dry_run` with correct payload.

| Service | Variable | Phase A value | Phase B value | Notes |
|---|---|---|---|---|
| **Web / App** | `ENFORCEMENT_DRY_RUN` | `true` | **`false`** | ← only change in Phase B |
| **Web / App** | `BROKER_ENFORCEMENT_ENABLED` | `true` | `true` (unchanged) | Already enabled |
| All others | ALL | unchanged | **ALL unchanged** | |

Apply Phase B: set `ENFORCEMENT_DRY_RUN=false` on web service only. Redeploy. Confirm healthy.

### Phase C — Restore dry-run after successful write

Immediately after confirming a successful `outcome=success` audit row:

| Service | Variable | Phase B value | Phase C value | Notes |
|---|---|---|---|---|
| **Web / App** | `ENFORCEMENT_DRY_RUN` | `false` | **`true`** | Restore to prevent accidental re-writes |

---

## §4 — First Activation Test: Exact Steps

### Phase A: Dry-run gate verification

**Purpose:** Confirm all 11 Guardrail gates pass without making a broker call.

1. Ensure web service is redeployed with `BROKER_ENFORCEMENT_ENABLED=true`, `ENFORCEMENT_DRY_RUN=true`.

2. In the Guardrail app, navigate to:
   **Rules → DEMO7433035 → Account Rules** (or Default Rules if no per-account override)

3. Confirm the displayed `Max Daily Loss` value is $40,000 (or whatever the current saved value is).

4. Click **Save** (no value change needed — just re-saving triggers the sync).

5. Wait for the save to complete (no 5xx toast).

6. Check the audit row:

```js
fetch('/api/debug/broker-risk-settings-audits?accountId=cmottd1z200020do1knjxq582&limit=5', {
  credentials: 'include',
  headers: { 'x-cron-secret': '<CRON_SECRET>' }
}).then(r => r.json()).then(d => {
  console.log('Most recent audit:', d.audits[0]);
});
```

**Expected dry-run audit row:**

| Field | Expected |
|---|---|
| `outcome` | `dry_run` |
| `ruleType` | `daily_loss_limit` |
| `dryRun` | `true` |
| `gateFailureReason` | `null` (all gates passed) |
| `payloadPreviewJson.dailyLossAutoLiq` | `40000` |
| `payloadPreviewJson.changesLocked` | `true` |
| `brokerResponseJson` | `null` (no broker call made) |

**STOP if `outcome=gate_blocked`** — do not proceed to Phase B. Check `gateFailureReason` and resolve the blocking gate. Common causes:
- `broker_enforcement_disabled` → BROKER_ENFORCEMENT_ENABLED not set correctly on web service
- `account_not_allowlisted` → allowlist variable not set or wrong account id
- `missing_automated_actions_consent` → consent not saved on the rule record
- `connection_not_live` → connectionStatus in the blocked set

### Phase B: Live write

Only begin Phase B after Phase A confirms `outcome=dry_run`.

1. Apply Phase B env change: set `ENFORCEMENT_DRY_RUN=false` on web service. Redeploy.

2. Confirm the deployment is healthy.

3. In the Guardrail app, navigate to Rules → DEMO7433035. Save the rule again.

4. Wait for the save to complete.

5. Check the audit row immediately:

```js
fetch('/api/debug/broker-risk-settings-audits?accountId=cmottd1z200020do1knjxq582&limit=5', {
  credentials: 'include',
  headers: { 'x-cron-secret': '<CRON_SECRET>' }
}).then(r => r.json()).then(d => {
  const latest = d.audits[0];
  console.log('outcome:', latest.outcome);
  console.log('brokerResponseJson:', latest.brokerResponseJson);
  console.log('errorMessage:', latest.errorMessage);
  console.log('gateFailureReason:', latest.gateFailureReason);
});
```

**Expected live write audit row:**

| Field | Expected |
|---|---|
| `outcome` | `success` |
| `ruleType` | `daily_loss_limit` |
| `dryRun` | `false` |
| `brokerResponseJson` | non-null — contains Tradovate API response |
| `gateFailureReason` | `null` |
| `errorMessage` | `null` |

6. Apply Phase C immediately: set `ENFORCEMENT_DRY_RUN=true` on web service. Redeploy.

7. Verify the written state in Tradovate:

```js
fetch('/api/debug/broker-enforcement/daily-loss-recovery-probe?accountId=cmottd1z200020do1knjxq582&mode=read_only', {
  credentials: 'include',
  headers: { 'x-cron-secret': '<CRON_SECRET>' }
}).then(r => r.json()).then(d => {
  console.log('Probe result:', d);
});
```

**Expected probe result after successful write:**

| Field | Expected |
|---|---|
| `existing.dailyLossAutoLiq` | `40000` |
| `existing.changesLocked` | `true` |
| `existing.id` | `47669364` (same record, now updated) |

8. Re-run the activation candidates scanner and confirm `ownership.hasGuardrailOwnedWrite=true`:

```js
fetch('/api/debug/daily-loss-activation-candidates', {
  credentials: 'include',
  headers: { 'x-cron-secret': '<CRON_SECRET>' }
}).then(r => r.json()).then(d => {
  const acct = d.accounts.find(a => a.id === 'cmottd1z200020do1knjxq582');
  console.log('ownership:', acct?.ownership);
  console.log('readiness:', acct?.readiness);
});
```

**If `outcome=failed` in the audit row (Tradovate API returned an error):**

This may indicate the OAuth token lacks write scopes despite `permissionLevel=full_access`.
Steps:
1. Apply Phase C immediately (restore `ENFORCEMENT_DRY_RUN=true`)
2. Check `errorMessage` in the audit row for the specific Tradovate API error
3. If a 401/403 error: reconnect the Tradovate OAuth with "Account Risk Settings: Full Access" explicitly selected, then retry from Phase A
4. Do NOT retry Phase B without understanding the failure

---

## §5 — Safety Boundaries

| Boundary | Enforcement |
|---|---|
| Demo only | Gate 2 (`env=demo` only) blocks all non-demo accounts |
| Single account allowlist | `cmottd1z200020do1knjxq582` only — no other id in the allowlist |
| No live accounts | `TRADOVATE_LISTENER_ENABLE_LIVE=false` — never change |
| No flatten / cancel / close | `ENABLE_TRADOVATE_ORDER_ACTIONS=false` — never change for this runbook |
| Daily Loss only | `assertDailyLossOnly()` throws for any other rule key |
| No listener-path enforcement | `BROKER_ENFORCEMENT_ENABLED=false` on listener-worker — unchanged |
| No other accounts | Allowlist acts as the last hard gate before any broker write |
| No news lockout / session end | Out of scope — listener-worker is dormant |

---

## §6 — Rollback Plan

### Trigger rollback if any of the following occur:
- `outcome=gate_blocked` for a gate other than `broker_enforcement_disabled` (unexpected block)
- `outcome=failed` with a Tradovate API error (unexpected API response)
- Any audit row for an account other than `cmottd1z200020do1knjxq582`
- Any audit row with `ruleType` other than `daily_loss_limit`
- Error toast or 5xx on the Rules page save

### 6.1 — Env rollback (Railway web service)

In Railway dashboard → web service → Variables:

```
BROKER_ENFORCEMENT_ENABLED = false     ← restore
ENFORCEMENT_DRY_RUN = true             ← restore (if it was changed)
```

Redeploy web service. Confirm healthy. Do not change listener-worker or cron.

### 6.2 — Verify rollback

```js
fetch('/api/debug/broker-risk-settings-audits?accountId=cmottd1z200020do1knjxq582&limit=3', {
  credentials: 'include',
  headers: { 'x-cron-secret': '<CRON_SECRET>' }
}).then(r => r.json()).then(d => {
  console.log('Most recent outcome:', d.audits[0]?.outcome);
  // After rollback, saving the rule should produce outcome=gate_blocked,
  // gateFailureReason=broker_enforcement_disabled
});
```

Save the rule once more. Confirm the new audit row shows:
- `outcome=gate_blocked`
- `gateFailureReason=broker_enforcement_disabled`

This confirms the enforcement flag is off and no further writes are possible.

### 6.3 — Tradovate manual clear (if write succeeded before rollback)

If a live write produced `outcome=success` before rollback was triggered:
1. Open Tradovate web → Account → Risk Management → Risk Settings
2. Find `DEMO7433035` → Daily Loss Auto Liquidation
3. Clear / remove the `dailyLossAutoLiq` value and/or unlock the record
4. Save in Tradovate UI
5. Run the read-only recovery probe to confirm the cleared state:

```js
fetch('/api/debug/broker-enforcement/daily-loss-recovery-probe?accountId=cmottd1z200020do1knjxq582&mode=read_only', {
  credentials: 'include',
  headers: { 'x-cron-secret': '<CRON_SECRET>' }
}).then(r => r.json()).then(d => {
  console.log('Existing AutoLiq after manual clear:', d.existing ?? d.payloadPreview?.existing);
});
```

---

## §7 — GO / NO-GO

### Current state assessment

| Gate | State | GO? |
|---|---|---|
| D1 (no locked unowned AutoLiq) | ✅ Cleared | GO |
| env=demo | ✅ | GO |
| permissionLevel=full_access | ✅ | GO |
| isActive + not missing | ✅ | GO |
| validMasterId | ✅ (47669364) | GO |
| guardianEnabled | ✅ | GO |
| consentValid | ✅ | GO |
| maxDailyLoss=40000 | ✅ | GO |
| connectionStatus | ⚠️ `connected_readonly` | Conditional — see §0 |
| BROKER_ENFORCEMENT_ENABLED | Not set on web service | Operator action required |
| ENFORCEMENT_DRY_RUN | `true` (safe) | GO for dry-run |

### ✅ COMPLETED — All phases PASSED

| Phase | Result | Evidence |
|---|---|---|
| Phase A dry-run | **PASS** | `outcome=dry_run`, `payloadPreviewJson.dailyLossAutoLiq=40000`, `brokerResponseJson=null` |
| Phase B live write | **PASS** | `outcome=success`, `brokerResponseJson` present, Tradovate UI confirmed value=40000 |
| Safety reset | **PASS** | Posture endpoint confirmed `brokerEnforcementEnabled=false`, `verdict.status=GO` |

**The rule-save path is fully verified end-to-end for DEMO7433035.**

See "Execution Results" section above for complete field-by-field evidence.

### Evidence required for a future rerun

If the rule-save path must be repeated (e.g., after manual clearing of the AutoLiq value in Tradovate), the sequence from §1–§4 applies in full. Key evidence gates before proceeding:

1. **Pre-run:** `ownershipAndRecovery.hasGuardrailOwnedWrite=true` AND `d1Blocked=false` (Guardrail owns the record — D1 will not block)
2. **Phase A confirms:** `outcome=dry_run`, `payloadPreviewJson.dailyLossAutoLiq=<current maxDailyLoss>`, `changesLocked=true`
3. **Phase B confirms:** `outcome=success`, `brokerResponseJson` non-null
4. **Safety reset confirms:** posture endpoint `verdict.status=GO`, `brokerEnforcementEnabled=false`

### What must remain disabled

These were not activated in this session and must remain off until a separate canary sequence is approved:
- `GUARDRAIL_INTERNAL_LOCK_ENABLED` — listener-path enforcement
- `BROKER_ENFORCEMENT_ENABLED` on the listener-worker service
- `TRADOVATE_LISTENER_ENABLE_LIVE`
- `ENABLE_TRADOVATE_ORDER_ACTIONS`

See §9 for the next recommended phase.

---

## §8 — Current Guardrail Ownership State (post-Phase B)

After the successful Phase B write, Guardrail now owns the DEMO7433035 AutoLiq record:

| Field | State |
|---|---|
| `changesLocked` | `true` (Tradovate confirmed) |
| `hasGuardrailOwnedWrite` | `true` |
| D1 guard | Satisfied — `blocked_existing_locked_autoliq` will not fire because `hasGuardrailOwnedWrite=true` |
| `doNotUnlock` | absent — Guardrail does not prevent future manual clearing |
| `dailyLossAutoLiq` | `40000` |

**This is the ideal pre-listener state.** The listener-path enforcement, when eventually activated, will operate on a Guardrail-owned record with a known value. No D1 contention.

To verify the current ownership state at any time (read-only, safe):

```js
fetch('/api/debug/daily-loss-enforcement-readiness?accountId=cmottd1z200020do1knjxq582', {
  credentials: 'include',
  headers: { 'x-cron-secret': '<CRON_SECRET>' }
}).then(r => r.json()).then(d => {
  console.log('Phase:', d.activationVerdict.phase);
  console.log('hasGuardrailOwnedWrite:', d.ownershipAndRecovery.hasGuardrailOwnedWrite);
  console.log('connectionStatus:', d.account.connectionStatus);
  console.log('D1 blocked:', d.ownershipAndRecovery.d1Blocked);
  console.log('existingAutoLiq:', d.existingAutoLiq);
});
```

**Expected post-write values:**

| Field | Expected |
|---|---|
| `activationVerdict.phase` | `ready_for_demo_activation` |
| `ownershipAndRecovery.hasGuardrailOwnedWrite` | `true` |
| `existingAutoLiq.changesLocked` | `true` |
| `existingAutoLiq.dailyLossAutoLiq` | `40000` |
| `ownershipAndRecovery.d1Blocked` | `false` |

---

## §9 — Next Recommended Phase: Listener-Path Planning Only

### What this phase is NOT

Do not activate the listener path without a separate approved canary plan. Specifically, do not:
- Set `GUARDRAIL_INTERNAL_LOCK_ENABLED=true`
- Set `BROKER_ENFORCEMENT_ENABLED=true` on the listener-worker service
- Simulate a loss breach to trigger listener enforcement
- Flip `TRADOVATE_LISTENER_ENABLE_LIVE`

### What listener-path activation requires (planning reference)

| Prerequisite | Current state | Notes |
|---|---|---|
| `GUARDRAIL_INTERNAL_LOCK_ENABLED` | `false` | Needs `true` on web/app only, dry-run first |
| `InternalLockEvent` record | none | Created only when a loss breach reaches the threshold |
| `connected_readonly` on listener path | `shouldSkipBrokerEnforcement` returns skip=true | **Must resolve before listener activation — see below** |
| `TRADOVATE_LISTENER_ENABLE_LIVE` | `false` | Do not change |
| Listener-worker `BROKER_ENFORCEMENT_ENABLED` | `false` | Separate decision from web service |
| Canary runbook | `docs/PHASE_2C_D_DEMO_CANARY_RUNBOOK.md` | Read before planning |

### Open question: `connected_readonly` on the listener path

The rule-save path succeeded despite `connected_readonly` — write scopes were present in the OAuth token. However, the listener path calls `shouldSkipBrokerEnforcement`, which **explicitly returns skip=true for `connected_readonly`**. Listener-path enforcement will be silently skipped even with all env flags set correctly.

**Resolution options (planning only — no action now):**
1. Re-fetch the account after the write and check whether `connectionStatus` changed from `connected_readonly` to `connected`
2. If still `connected_readonly`: investigate whether re-authenticating the Tradovate OAuth with "Account Risk Settings: Full Access" selected changes the status
3. Consider whether `shouldSkipBrokerEnforcement` should be updated to pass `connected_readonly` when `permissionLevel=full_access` (code change — separate PR)
4. Do not activate listener-path enforcement until this is resolved and a plan is documented

### Immediate safe next step (read-only, no env changes)

Run the readiness diagnostic to confirm post-write state and check whether `connectionStatus` has changed:

```js
fetch('/api/debug/daily-loss-enforcement-readiness?accountId=cmottd1z200020do1knjxq582', {
  credentials: 'include',
  headers: { 'x-cron-secret': '<CRON_SECRET>' }
}).then(r => r.json()).then(d => {
  console.log('Phase:', d.activationVerdict.phase);
  console.log('GO/NO-GO:', d.activationVerdict.goNoGo);
  console.log('connectionStatus:', d.account.connectionStatus);
  console.log('hasGuardrailOwnedWrite:', d.ownershipAndRecovery.hasGuardrailOwnedWrite);
  console.log('D1 blocked:', d.ownershipAndRecovery.d1Blocked);
  console.log('existingAutoLiq:', d.existingAutoLiq);
});
```

If `activationVerdict.phase` returns `ready_for_demo_activation` and `connectionStatus` is no longer `connected_readonly`, the `shouldSkipBrokerEnforcement` concern is resolved and listener-path planning can begin.
