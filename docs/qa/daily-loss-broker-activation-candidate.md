# Daily Loss Broker Activation — Candidate Account Discovery Runbook

**Purpose:** Step-by-step operator guide for identifying a clean Tradovate demo account
that is safe to use for Daily Loss broker enforcement activation. Covers account
connection requirements, verification flow, diagnostic snippets, decision table, and
acceptance criteria.

**Safety boundaries in effect for this entire runbook:**

- `BROKER_ENFORCEMENT_ENABLED` must remain absent or `false` throughout
- Never run recovery probe with `apply=true`
- Never add the account to `BROKER_ENFORCEMENT_DEMO_ACCOUNT_ALLOWLIST` until Section 6
- Never test against a live (non-demo) account
- Never run `raise_threshold` or any write mode on an AutoLiq record Guardrail did not create
- D1 gate must not be bypassed — if `blocked_existing_locked_autoliq`, do not proceed

---

## 1. What Kind of Account We Need

### Required

| Property | Required value | Why |
|---|---|---|
| Platform | `tradovate` | Only platform with a `userAccountAutoLiq` API |
| Env | `demo` | Live enforcement not implemented in Phase 2C |
| OAuth permission | `Account Risk Settings: Full Access` | Required to write `userAccountAutoLiq` |
| Guardrail `permissionLevel` | `full_access` | Gate 6 on both paths |
| `connectionStatus` | live (not expired / error / not_connected) | Gate 5/7 on both paths |
| `externalAccountId` | valid positive integer Tradovate masterid | Gate 10 (rule-save) / masterid parse |
| Guardian enabled | `true` | Gate 8 rule-save path |
| Automated-actions consent | stamped + version-matched | Gate 9 rule-save path |
| `maxDailyLoss` rule | `> 0` | Gate 11 / no rule means nothing to enforce |

### Strongly preferred (reduces risk)

| Property | Preferred | Reason |
|---|---|---|
| Existing AutoLiq state | No prior `userAccountAutoLiq` record, OR `changesLocked=false` | Avoids D1 gate block |
| Account origin | Personal Tradovate demo (not prop-firm evaluation) | Prop-firm accounts often have locked AutoLiq set by the firm |
| Account age | Fresh / recently provisioned | Less likely to have externally-managed risk settings |

### Why DEMO7433035 is not suitable

DEMO7433035's recovery probe preview shows `dailyLossAutoLiq=1618.04, changesLocked=true`.
Guardrail has no `outcome=success` audit row with a `brokerResponseJson` for this account,
which means the record was not written by Guardrail. The D1 gate blocks any `apply=true`
write to protect against clobbering a prop-firm or Tradovate-managed risk setting.

---

## 2. Step-by-Step Operator Flow

### Step 1 — Connect the account in Guardrail

1. In the Guardrail app, go to **Settings → Broker Connections**.
2. Connect a Tradovate **demo** account via OAuth.
3. When prompted for OAuth scopes, ensure **"Account Risk Settings: Full Access"** is
   selected. If the permission prompt does not offer this scope, the account cannot be
   used as a candidate.
4. Complete the OAuth flow. Guardrail will store the connection and sync the account.

### Step 2 — Verify the account appears correctly

Run the connected-accounts diagnostic (snippet in Section 3) and confirm:

- `platform: "tradovate"`
- `env: "demo"`
- `permissionLevel: "full_access"`
- `connectionStatus` is **not** in `{expired, connection_error, not_connected, pending_webhook, oauth_pending_storage}`
- `externalAccountId` is a non-null string that looks like a positive integer (e.g. `"47669364"`)
- `isActive: true`
- `missingFromBrokerSince: null`
- `canUseForRecoveryProbePreview: true` (all sub-conditions must pass)

If any of the above fail, resolve the connection issue before proceeding.

### Step 3 — Note the account's internal id

From the connected-accounts response, copy the `id` field (the internal Guardrail
`ConnectedAccount.id`, e.g. `cmottd1z200020do1knjxq582`). This is the `accountId` used
in all subsequent diagnostic calls.

### Step 4 — Save a Daily Loss rule with consent

In the Guardrail app for the account:

1. Open **Trading Plan** → **Account Rules** (or default rules if no per-account override).
2. Set **Max Daily Loss** to a positive dollar amount (e.g. $500 for a demo test).
3. Check the **"I understand that Guardrail may automatically lock this account..."**
   automated-actions consent checkbox.
4. Save. This stamps `automatedActionsConsentAt` and `automatedActionsConsentVersion`
   on the `AccountRiskRules` row.
5. Confirm **Guardian is enabled** for the user (toggle in Guardian settings).

### Step 5 — Run the activation candidates scanner

Run the scanner (snippet in Section 3). Check this account's entry:

- If `readiness.status = "candidate"` → skip to Section 6 acceptance check.
- If `readiness.status = "preview_required"` → continue to Step 6.
- If `readiness.status = "blocked"` → consult the decision table in Section 4.

### Step 6 — Run a read-only recovery preview (if preview_required)

If the account shows `preview_required`, the AutoLiq state at Tradovate is unknown.
Run the read-only recovery probe (snippet in Section 3, **no `apply=true`**) to
populate the audit row. Then re-run the scanner (Step 5).

Expected outcomes after the read-only preview:

| Preview result | Scanner status | Next action |
|---|---|---|
| No existing AutoLiq (`existing=null`) | `candidate` | Proceed to Section 6 |
| Existing AutoLiq, `changesLocked=false` | `candidate` | Proceed to Section 6 |
| Existing AutoLiq, `changesLocked=true`, Guardrail owns it | `candidate` | Proceed to Section 6 |
| Existing AutoLiq, `changesLocked=true`, no Guardrail ownership | `blocked_existing_locked_autoliq` | Do not use — find a different account |

### Step 7 — Run the readiness diagnostic (final confirmation)

Run the readiness endpoint (snippet in Section 3) for the account. Confirm:

- `activationVerdict.goNoGo` is `"GO"` or `"NO_GO"` only due to env/allowlist flags
  (i.e., `BROKER_ENFORCEMENT_ENABLED_not_true` and `account_not_in_allowlist` are the
  only blockers — those are expected and correct at this stage)
- `ownershipAndRecovery.d1Blocked` is `false`
- `existingAutoLiq.changesLocked` is `false` or `null`

If all of the above pass: **this account is a clean candidate**.

---

## 3. Browser Console Snippets

Replace `<CRON_SECRET>` with your actual `CRON_SECRET` value in all snippets.
Replace `<ACCOUNT_ID>` with the internal `ConnectedAccount.id` from the scanner.

**None of these snippets write to the broker or mutate any DB row.**

### 3a — List all connected accounts

```js
fetch('/api/debug/connected-accounts', {
  credentials: 'include',
  headers: { 'x-cron-secret': '<CRON_SECRET>' }
}).then(r => r.json()).then(d => {
  console.table(d.accounts.map(a => ({
    id: a.id,
    label: a.label,
    externalAccountId: a.externalAccountId,
    env: a.env,
    permissionLevel: a.permissionLevel,
    connectionStatus: a.brokerConnectionStatus,
    isActive: a.isActive,
    canUse: a.canUseForRecoveryProbePreview,
    reasons: a.reasons?.join('; ') ?? ''
  })));
});
```

### 3b — Run the activation candidates scanner

```js
fetch('/api/debug/daily-loss-activation-candidates', {
  credentials: 'include',
  headers: { 'x-cron-secret': '<CRON_SECRET>' }
}).then(r => r.json()).then(d => {
  console.log('Summary:', d.summary);
  console.table(d.accounts.map(a => ({
    id: a.id,
    label: a.label,
    status: a.readiness.status,
    phase: a.readiness.phase,
    blockers: a.readiness.blockers.join(', '),
    nextSafeAction: a.readiness.nextSafeAction,
    changesLocked: a.latestAutoLiqPreview.changesLocked,
    autoLiqStatus: a.latestAutoLiqPreview.existingAutoLiqStatus
  })));
});
```

### 3c — Run the read-only recovery probe (no write, no apply)

Only run this when the scanner shows `preview_required` for an account.
This call is **read-only** — it reads the Tradovate AutoLiq record and stores the
result as an audit `outcome=preview` row. It does not write to Tradovate.

```js
fetch('/api/debug/broker-enforcement/daily-loss-recovery-probe' +
  '?accountId=<ACCOUNT_ID>&mode=read_only', {
  credentials: 'include',
  headers: { 'x-cron-secret': '<CRON_SECRET>' }
}).then(r => r.json()).then(d => {
  console.log('Probe outcome:', d.outcome ?? d.result ?? d);
  console.log('Existing AutoLiq:', d.existing ?? d.payloadPreview?.existing ?? null);
});
```

> **Note:** `mode=read_only` never writes to Tradovate. Do not add `apply=true` or
> any other parameter to this call.

### 3d — Run the full readiness diagnostic for one account

```js
fetch('/api/debug/daily-loss-enforcement-readiness?accountId=<ACCOUNT_ID>', {
  credentials: 'include',
  headers: { 'x-cron-secret': '<CRON_SECRET>' }
}).then(r => r.json()).then(d => {
  console.log('Verdict:', d.activationVerdict);
  console.log('D1 blocked:', d.ownershipAndRecovery.d1Blocked);
  console.log('Existing AutoLiq:', d.existingAutoLiq);
  console.log('Rule-save gates:');
  console.table(d.ruleSaveGates);
  console.log('Listener gates:');
  console.table(d.listenerGates);
});
```

### 3e — View audit history for one account

```js
fetch('/api/debug/broker-risk-settings-audits?accountId=<ACCOUNT_ID>&limit=20', {
  credentials: 'include',
  headers: { 'x-cron-secret': '<CRON_SECRET>' }
}).then(r => r.json()).then(d => {
  console.log('Summary:', d.summary);
  console.log('hasAnyBrokerWrite:', d.hasAnyBrokerWrite);
  console.log('latestRecoveryPreview:', d.latestRecoveryPreview);
  console.table(d.audits.map(a => ({
    id: a.id.slice(0, 8),
    createdAt: a.createdAt,
    ruleType: a.ruleType,
    outcome: a.outcome,
    hasBrokerResponse: a.brokerResponseJson != null
  })));
});
```

---

## 4. Candidate Decision Table

| Scanner `readiness.phase` | Status | Action |
|---|---|---|
| `candidate_for_demo_activation` | `candidate` | All gates pass. Account is eligible. Proceed to Section 6 acceptance check. |
| `preview_required` | `preview_required` | AutoLiq state unknown. Run the read-only recovery probe (Section 3c), then re-run scanner. |
| `blocked_existing_locked_autoliq` | `blocked` | Existing Tradovate AutoLiq has `changesLocked=true` and Guardrail has no ownership evidence. **Do not use this account.** Find a different demo account. |
| `blocked_not_full_access` | `blocked` | OAuth permission is insufficient. Disconnect and re-authenticate with "Account Risk Settings: Full Access" selected. |
| `blocked_connection_not_live` | `blocked` | OAuth token expired or connection broken. Go to Settings → Broker Connections, reconnect / refresh OAuth. |
| `blocked_missing_consent` | `blocked` | Automated-actions consent missing or version-mismatched. Open Trading Plan, check the consent checkbox, and save the rule. |
| `blocked_no_daily_loss_rule` | `blocked` | `maxDailyLoss` is null or zero. Save a positive Daily Loss rule for this account. |
| `blocked_guardian_inactive` | `blocked` | Guardian is disabled for this user. Enable Guardian in settings. |
| `blocked_invalid_external_account_id` | `blocked` | `externalAccountId` is not a valid Tradovate masterid (null, non-numeric, or zero). Re-sync the account; if the problem persists, do not use this account. |
| `blocked_not_demo` | `blocked` | Account is not a Tradovate demo account (wrong platform or live env). Do not use for enforcement testing. |
| `blocked_account_inactive` | `blocked` | Account is deactivated in Guardrail. Reactivate it or use a different account. |
| `blocked_missing_from_broker` | `blocked` | Account is no longer returned by Tradovate. Reconnect or provision a fresh demo account. |

---

## 5. Safety Boundaries

These boundaries apply for the entirety of candidate discovery and must not be
relaxed until a human operator sign-off at the real canary step (see
`docs/PHASE_2C_D_DEMO_CANARY_RUNBOOK.md`).

| Boundary | Rule |
|---|---|
| `BROKER_ENFORCEMENT_ENABLED` | Must remain absent or `false`. Do not set to `true` during candidate discovery. |
| `apply=true` | Never pass to the recovery probe or any diagnostic endpoint. |
| Allowlist | Do not add any account to `BROKER_ENFORCEMENT_DEMO_ACCOUNT_ALLOWLIST` until a clean candidate is confirmed and a canary has been scheduled. |
| Live accounts | Never connect or scan a live (non-demo) Tradovate account for enforcement testing. |
| D1 gate | Never bypass or disable Gate D1 (`preexisting_locked_autoliq_not_guardrail_owned`). If the gate blocks, find a different account. |
| `raise_threshold` / `create` modes | Never use any write mode (`raise_threshold`, `lower_threshold`, `create`) on an account whose AutoLiq record Guardrail did not create. |
| Prop-firm accounts | Treat any account with a non-round `dailyLossAutoLiq` or `changesLocked=true` as potentially prop-firm-managed. Apply D1 rule strictly. |

---

## 6. Final Acceptance Criteria for a Clean Candidate

An account passes all acceptance criteria when **all** of the following are true:

### 6.1 Scanner acceptance

```
readiness.status === "candidate"
```

or, if the only blockers are env/allowlist flags:

```
readiness.phase === "preview_required"
  AND latestAutoLiqPreview.existingAutoLiqStatus !== "unknown_preview_required"
  (i.e., a preview has been run — account has no locked unowned AutoLiq)
```

### 6.2 Readiness endpoint acceptance

From `GET /api/debug/daily-loss-enforcement-readiness?accountId=<id>`:

| Field | Required value |
|---|---|
| `ownershipAndRecovery.d1Blocked` | `false` |
| `existingAutoLiq.changesLocked` | `false`, `null`, or the record is Guardrail-owned |
| `activationVerdict.blockers` | Empty, or contains only `BROKER_ENFORCEMENT_ENABLED_not_true` and/or `account_not_in_allowlist` |
| `currentRules.consentValid` | `true` |
| `currentRules.maxDailyLoss` | `> 0` |
| `account.validMasterId` | `true` |
| `envPosture.enforcementDryRun` | Confirm current value; must be `true` until real canary |

### 6.3 Audit history acceptance

From `GET /api/debug/broker-risk-settings-audits?accountId=<id>`:

| Check | Expected |
|---|---|
| `hasAnyBrokerWrite` | `false` (no prior live writes) — OR — `true` but all prior writes were made by Guardrail |
| `summary.success` | `0` or only Guardrail-owned rows |
| `latestRecoveryPreview` | Not null (confirms a preview was run) |

### 6.4 AutoLiq state acceptance (from recovery preview)

| AutoLiq state | Acceptable? |
|---|---|
| `existing=null` (no record at Tradovate) | Yes — clean slate |
| `existing.changesLocked=false` | Yes — Guardrail can write freely |
| `existing.changesLocked=true` + Guardrail has prior `outcome=success` | Yes — Guardrail already owns the record |
| `existing.changesLocked=true` + no Guardrail ownership | **No** — D1 blocks; find another account |

---

## 7. Diagnostic Endpoint Reference

| Endpoint | Purpose |
|---|---|
| `GET /api/debug/connected-accounts` | List all user accounts with eligibility flags |
| `GET /api/debug/daily-loss-activation-candidates` | Scan all accounts; get per-account status + phase |
| `GET /api/debug/daily-loss-enforcement-readiness?accountId=<id>` | Full gate matrix for one account (8 sections) |
| `GET /api/debug/broker-risk-settings-audits?accountId=<id>` | Audit history + ownership evidence for one account |
| `GET /api/debug/broker-enforcement/daily-loss-recovery-probe?accountId=<id>&mode=read_only` | Read-only AutoLiq state lookup (populates preview audit row) |

All endpoints require:
- Authenticated Guardrail session (browser cookie)
- `x-cron-secret` header matching `CRON_SECRET` env var
- No Tradovate write endpoints are called by any of the above
