# Tradovate Order Actions — Manual QA Guide

Covers `cancelOpenOrdersForAccount()` and `flattenPositionsForAccount()` —
the new safe-by-default Tradovate order action foundation.

**Status:** Dry-run verified by unit tests. Live demo QA required before
wiring to automatic rule breaches.

Related source files:
- `src/lib/brokers/cancel-open-orders.ts`
- `src/lib/brokers/flatten-positions.ts`
- `src/lib/brokers/order-actions-helpers.ts`
- `src/lib/brokers/order-actions-flag.ts`
- `src/lib/brokers/broker-order-action-log.ts`
- `src/app/api/dev/order-actions-debug/route.ts`

Automated test coverage: run `node --experimental-strip-types --test src/lib/brokers/*.test.ts`

---

## Automated test coverage

The following invariants are verified by unit tests. Confirm they still pass
before any deployment touching order actions.

| # | Assertion | File |
|---|-----------|------|
| A.1 | `isTradovateOrderActionsEnabled()` returns `false` unless env is exactly `"true"` | `order-actions-flag.test.ts` |
| A.2 | Flag returns `false` for `"1"`, `"yes"`, `"TRUE"`, `"True"`, empty, unset | same |
| A.3 | `validateAccountForOrderActions` rejects non-Tradovate platform | `cancel-open-orders.test.ts` |
| A.4 | `validateAccountForOrderActions` rejects inactive, archived, missing, disconnected | same |
| A.5 | `canSendLiveOrderActions` returns `false` for `read_only` | same |
| A.6 | `canSendLiveOrderActions` returns `true` for `null` (optimistic — 403 surfaces gap) | same |
| A.7 | `effectiveDryRun` is `true` when flag is off, permission is read-only, or caller forces it | `broker-order-action-log.test.ts` |
| A.8 | Only `flag=true` + `full_access` + no force produces live path | same |
| A.9 | `WriteBrokerOrderActionLogInput` contains no token/secret fields | same |
| A.10 | cancel/flatten request+response summaries contain only IDs, counts, status strings | same |

---

## 1. Preconditions

Complete **every** item before running any test step.

### 1.1 Account selection

- [ ] Use a **demo/sim** Tradovate account only — never a live funded account.
- [ ] Confirm `connectedAccountId` belongs to the demo account:
  ```sql
  SELECT id, label, platform, "externalAccountId", "connectionStatus", "protectionStatus"
  FROM "ConnectedAccount"
  WHERE id = '<connectedAccountId>';
  ```
- [ ] Confirm `platform = 'tradovate'` and `connectionStatus = 'connected_live'`
  (not `expired`, not `not_connected`).
- [ ] Confirm `protectionStatus != 'archived'` and `missingFromBrokerSince IS NULL`.
- [ ] Confirm `externalAccountId` is set (a numeric Tradovate account ID like `1234567`).

### 1.2 OAuth permissions

- [ ] Confirm the Tradovate OAuth token has **Orders: Full Access** scope.
  - Check `BrokerConnection.permissionLevel = 'full_access'` in the DB, or
  - Inspect the `capabilitiesJson` on the `ConnectedAccount` row.
  - If `permissionLevel = 'read_only'`, live tests will auto-downgrade to dry-run.

### 1.3 Environment flags

- [ ] For **dry-run tests (Sections 2–3)**: confirm `ENABLE_TRADOVATE_ORDER_ACTIONS` is
  absent or not `"true"`. Dry-run will engage automatically.
- [ ] For **live demo tests (Sections 4–5)**: set `ENABLE_TRADOVATE_ORDER_ACTIONS=true`
  **only** in your local dev environment or a dedicated demo environment. Never set
  this in production.
- [ ] Confirm `NODE_ENV != "production"` — the `/api/dev/order-actions-debug` route
  returns HTTP 404 in production.

### 1.4 Verify the diagnostic route is accessible

```
GET /api/dev/order-actions-debug?connectedAccountId=<id>
```

Expected response fields (no sensitive data):
```json
{
  "account": { "id": "...", "label": "...", "connectionStatus": "connected_live", "permissionLevel": "full_access" },
  "eligibility": { "ok": true },
  "orderActionsEnvFlag": false,
  "canSendLive": false,
  "effectiveMode": "dry_run (default)",
  "recentLogs": []
}
```

If `eligibility.ok` is `false`, resolve the `code` before proceeding:

| Code | Fix |
|------|-----|
| `UNSUPPORTED_PLATFORM` | Wrong account — must be Tradovate |
| `ACCOUNT_INACTIVE` | Re-activate or choose a different account |
| `ACCOUNT_ARCHIVED` | Cannot use archived accounts |
| `ACCOUNT_UNAVAILABLE` | Account missing from broker — re-sync |
| `CONNECTION_INACTIVE` | Reconnect OAuth |
| `CONNECTION_PENDING` | Wait for webhook/OAuth to complete |
| `NO_EXTERNAL_ACCOUNT_ID` | Run a Tradovate sync to populate the ID |

---

## 2. Dry-run cancel orders

**Precondition:** `ENABLE_TRADOVATE_ORDER_ACTIONS` is NOT set to `"true"`.

### 2.1 Setup

- [ ] Log in to Tradovate demo web UI or mobile app.
- [ ] Place one or more **limit orders** (working orders) on a demo contract
  (e.g., MES, MNQ at a price far from market so they stay Working).
- [ ] Confirm the orders appear as `Working` in Tradovate UI.

### 2.2 Verify eligibility

```
GET /api/dev/order-actions-debug?connectedAccountId=<id>
```

- [ ] `eligibility.ok === true`
- [ ] `orderActionsEnvFlag === false`
- [ ] `effectiveMode === "dry_run (default)"`

### 2.3 Run dry-run cancel

```bash
curl -X POST http://localhost:3000/api/dev/order-actions-debug \
  -H "Content-Type: application/json" \
  -d '{ "connectedAccountId": "<id>", "action": "cancel_orders" }'
```

### 2.4 Expected result

```json
{
  "action": "cancel_orders",
  "liveActionsEnabled": false,
  "result": {
    "dryRun": true,
    "attemptedCount": 2,
    "succeededCount": 0,
    "failedCount": 0,
    "skippedCount": 0,
    "affectedOrderIds": [101234, 101235],
    "skippedOrderIds": [],
    "errors": []
  }
}
```

Verify:
- [ ] `result.dryRun === true`
- [ ] `result.attemptedCount` equals the number of Working orders placed
- [ ] `result.affectedOrderIds` lists those order IDs (dry-run reads orders to show what would be affected)
- [ ] `result.succeededCount === 0` and `result.errors` is empty (no live cancel was sent)
- [ ] Working orders **still appear** in Tradovate UI — nothing was cancelled

### 2.5 Verify audit log was written

```
GET /api/dev/order-actions-debug?connectedAccountId=<id>
```

- [ ] `recentLogs[0].actionType === "cancel_orders"`
- [ ] `recentLogs[0].dryRun === true`
- [ ] `recentLogs[0].success === true`
- [ ] `recentLogs[0].requestSummary` contains `orderCount` and `orderIds` — no tokens
- [ ] `recentLogs[0].responseSummary` contains the result fields — no tokens

---

## 3. Dry-run flatten positions

**Precondition:** `ENABLE_TRADOVATE_ORDER_ACTIONS` is NOT set to `"true"`.

### 3.1 Setup

- [ ] Open a small demo position (e.g., 1 MES long).
- [ ] Confirm the position shows as open in Tradovate UI.

### 3.2 Run dry-run flatten

```bash
curl -X POST http://localhost:3000/api/dev/order-actions-debug \
  -H "Content-Type: application/json" \
  -d '{ "connectedAccountId": "<id>", "action": "flatten_positions" }'
```

### 3.3 Expected result

```json
{
  "action": "flatten_positions",
  "liveActionsEnabled": false,
  "result": {
    "dryRun": true,
    "flattenStatus": "dry_run",
    "flattenMessage": "Dry-run: flatten would be applied but no API call was made."
  }
}
```

Verify:
- [ ] `result.dryRun === true`
- [ ] `result.flattenStatus === "dry_run"`
- [ ] Position **still shows as open** in Tradovate UI — no order was sent

### 3.4 Verify audit log was written

```
GET /api/dev/order-actions-debug?connectedAccountId=<id>
```

- [ ] `recentLogs[0].actionType === "flatten_positions"`
- [ ] `recentLogs[0].dryRun === true`
- [ ] `recentLogs[0].requestSummary` is `{}` (no positions were read in dry-run)
- [ ] `recentLogs[0].responseSummary.flattenStatus === "dry_run"`

---

## 4. Live cancel orders (demo only)

> ⚠ Set `ENABLE_TRADOVATE_ORDER_ACTIONS=true` only in local dev or a dedicated
> demo environment. Remove it again after testing.

### 4.1 Setup

- [ ] `ENABLE_TRADOVATE_ORDER_ACTIONS=true` in local `.env.local` only.
- [ ] Confirm `effectiveMode` in the GET response shows `"live (env flag set)"`.
- [ ] Place 1–2 limit orders in Tradovate demo (far from market, so they stay Working).
- [ ] Note the order IDs from Tradovate UI.

### 4.2 Trigger live cancel via a backend call (not UI)

Use a safe one-off server action or a controlled curl to a test endpoint. Do **not** add a cancel button to any UI at this stage.

Option A — direct function call in a short test script (recommended for initial QA):
```typescript
// scripts/test-cancel-dry-run.ts — run with: npx tsx scripts/test-cancel-dry-run.ts
import { cancelOpenOrdersForAccount } from "@/lib/brokers/cancel-open-orders";
const result = await cancelOpenOrdersForAccount("<connectedAccountId>", {
  triggerReason: "manual_qa",
});
console.log(JSON.stringify(result, null, 2));
```

Option B — POST to diagnostic route (with flag set):
```bash
curl -X POST http://localhost:3000/api/dev/order-actions-debug \
  -H "Content-Type: application/json" \
  -d '{ "connectedAccountId": "<id>", "action": "cancel_orders" }'
```

> Note: the diagnostic route forces `dryRun: true` — to test the live path
> end-to-end use Option A (direct function call) with the env flag set.

### 4.3 Expected result (live path)

```json
{
  "dryRun": false,
  "attemptedCount": 2,
  "succeededCount": 2,
  "failedCount": 0,
  "skippedCount": 0,
  "affectedOrderIds": [101234, 101235],
  "errors": []
}
```

Verify:
- [ ] `result.dryRun === false`
- [ ] `result.succeededCount` equals orders placed
- [ ] `result.failedCount === 0` and `result.errors` is empty
- [ ] Orders disappear from Tradovate UI (status changes to `Cancelled`)
- [ ] **Only the demo account's orders were touched** — verify no orders were affected on any other account in the same OAuth token scope

### 4.4 Verify audit log

- [ ] `dryRun === false`
- [ ] `success === true`
- [ ] `requestSummary.orderCount` matches orders placed
- [ ] `responseSummary.succeededCount` matches
- [ ] Unset `ENABLE_TRADOVATE_ORDER_ACTIONS` after test

---

## 5. Live flatten positions (demo only)

> ⚠ Same environment precaution as Section 4.

### 5.1 Setup

- [ ] `ENABLE_TRADOVATE_ORDER_ACTIONS=true` in local `.env.local` only.
- [ ] Open the **smallest possible** demo position (1 contract of MES or MNQ).
- [ ] Note the position size and direction in Tradovate UI.

### 5.2 Trigger live flatten

```typescript
// Direct function call (recommended)
import { flattenPositionsForAccount } from "@/lib/brokers/flatten-positions";
const result = await flattenPositionsForAccount("<connectedAccountId>", {
  triggerReason: "manual_qa",
});
console.log(JSON.stringify(result, null, 2));
```

### 5.3 Expected results by status

| `flattenStatus` | Meaning | Verify |
|-----------------|---------|--------|
| `flattened` | Read-back confirmed all positions flat | Position netPos = 0 in Tradovate |
| `attempted` | Liquidation order sent, read-back still shows open | A market/IOC exit order is visible and working |
| `not_needed` | No open positions when flatten ran | No position to verify |
| `failed` | Exception during request | See `flattenMessage` for error details |

- [ ] `result.dryRun === false`
- [ ] Status is `flattened`, `attempted`, or `not_needed` (all are non-error outcomes)
- [ ] Position is flat or an exit order is visible in Tradovate UI
- [ ] **No other account was touched** — verify positions on other accounts in the OAuth token are unchanged

### 5.4 Verify audit log

- [ ] `dryRun === false`
- [ ] `success === true` (for `flattened`, `attempted`, or `not_needed`)
- [ ] `responseSummary.flattenStatus` matches
- [ ] Unset `ENABLE_TRADOVATE_ORDER_ACTIONS` after test

---

## 6. Failure scenarios

For each scenario: confirm the function throws or returns the correct result
without touching other accounts or crashing the process.

### 6.1 Validation failures (pre-action, no audit log written)

| Scenario | Expected error code | How to reproduce |
|----------|--------------------|--------------------|
| Account not found | `Error: Connected account not found` | Pass a non-existent ID |
| Non-Tradovate platform | `UNSUPPORTED_PLATFORM` | Pass a `manual` platform account ID |
| Inactive account | `ACCOUNT_INACTIVE` | Set `isActive = false` in DB temporarily |
| Archived account | `ACCOUNT_ARCHIVED` | Set `protectionStatus = 'archived'` in DB temporarily |
| Missing from broker | `ACCOUNT_UNAVAILABLE` | Set `missingFromBrokerSince = now()` in DB temporarily |
| Connection not active | `CONNECTION_INACTIVE` | Set `connectionStatus = 'not_connected'` in DB temporarily |
| Connection pending | `CONNECTION_PENDING` | Set `connectionStatus = 'pending_webhook'` in DB temporarily |
| No external account ID | `NO_EXTERNAL_ACCOUNT_ID` | Set `externalAccountId = null` in DB temporarily |

All of these throw before reaching the broker — no audit log entry is written,
which is correct (nothing was attempted).

### 6.2 Permission downgrade to dry-run

| Scenario | Expected outcome |
|----------|-----------------|
| `permissionLevel = 'read_only'` | `effectiveDryRun = true`; `result.dryRun = true`; audit log written with `dryRun: true` |
| `ENABLE_TRADOVATE_ORDER_ACTIONS` absent or not `"true"` | Same |
| Both conditions | Same |

### 6.3 No open orders (cancel path)

- [ ] Ensure the demo account has **no** Working or Pending orders.
- [ ] Call cancel action.
- [ ] Expected: `attemptedCount: 0`, `affectedOrderIds: []`, `dryRun: false` (or `true` if flag off).
- [ ] Audit log is written with `orderCount: 0`.
- [ ] No error thrown.

### 6.4 No open positions (flatten path)

- [ ] Ensure the demo account is **flat** (no open positions).
- [ ] Call flatten action.
- [ ] Expected: `flattenStatus: "not_needed"`, `dryRun: false` (or `true` if flag off).
- [ ] Audit log written with `success: true`.

### 6.5 Tradovate API error during cancel

- [ ] Simulate with a disconnected/expired token (set `tokenExpiresAt` to the past).
- [ ] Expected: function throws (from `client.initialize()` token refresh failure), or
  individual order cancels populate `errors[]` with the error message.
- [ ] Audit log records the error.
- [ ] No crash to the caller — error is surfaced as a structured result or thrown exception.

### 6.6 Orders: Full Access 403 during cancel

- [ ] If Tradovate returns HTTP 403 on `order/cancelorder`:
  - `skipMarkExpired=true` ensures the connection is NOT marked expired.
  - The cancel returns `{ errorText: "..." }` — `failedCount` increments.
  - Audit log records `success: false` and the errorMessage.

### 6.7 Expired token

- [ ] TradovateClient attempts token refresh automatically.
- [ ] If refresh succeeds, the action proceeds normally.
- [ ] If refresh fails, the function throws — caller sees the error.

---

## 7. Do-not-test rules

These actions are **not permitted** during this QA phase.

- [ ] Do **not** use live funded accounts. Demo/sim only until this guide is fully checked.
- [ ] Do **not** add cancel or flatten buttons to any production UI. The only surface is the
  dev diagnostic route (`/api/dev/order-actions-debug`) and direct function calls.
- [ ] Do **not** wire cancel/flatten to automatic breach events (daily loss limit, trade
  limit, session cutoff) until Sections 2–6 have been manually verified.
- [ ] Do **not** commit `ENABLE_TRADOVATE_ORDER_ACTIONS=true` to any environment file
  or secret store that applies to production.
- [ ] Do **not** leave `ENABLE_TRADOVATE_ORDER_ACTIONS=true` set after completing live
  demo tests.

---

## 8. Safety notes from code review

These are non-blocking observations about the current implementation.

### 8.1 cancel reads orders in dry-run (intentional)

`cancelOpenOrdersForAccount()` calls `client.getOrders()` before the dry-run
branch. This is a **read-only** GET call that shows what would be cancelled. No
write endpoint is called. `flattenPositionsForAccount()` makes zero API calls
in dry-run (client is not even initialized).

### 8.2 tvAccountId null-safety

`TradovateClient.getOrders()` filters to `tvAccountId` after `initialize()`.
If `externalAccountId` in the DB is somehow not parseable as an integer,
`tvAccountId` stays `null` and `getOrders()` returns all Working/Pending orders
across the OAuth token. `validateAccountForOrderActions()` rejects accounts with
a null/empty `externalAccountId` before we ever reach this code path, so this
is only a concern if the DB contains a non-numeric value in that column.

**Mitigation:** Confirm `externalAccountId` is a valid integer string (e.g.
`"1234567"`) before running live tests. The GET diagnostic response shows this.

### 8.3 Partial cancel failure

Cancel iterates orders one by one. If the third order fails, the first two
are already cancelled. `result.failedCount` and `result.errors[]` record the
failure; the caller must decide whether to retry or alert.

### 8.4 flatten read-back is best-effort

`applyFlattenOpenPositions()` returns `"attempted"` if the liquidation order
was accepted but the immediate read-back still shows open positions. The order
may still be working in the market. This is expected behavior for market orders
that haven't yet filled. Poll positions after a short delay if `"attempted"` is
received.

---

## 9. Next implementation gate

**Only proceed to wiring automatic breaches after:**

- [ ] Sections 2 and 3 (dry-run) manually verified ✓
- [ ] Section 4 (live cancel demo) manually verified ✓
- [ ] Section 5 (live flatten demo) manually verified ✓
- [ ] All failure scenarios in Section 6 manually verified ✓
- [ ] `ENABLE_TRADOVATE_ORDER_ACTIONS` unset after live tests ✓

**Next implementation steps (in order):**

1. **Wire cancel open orders to breach actions** (e.g. daily loss limit hit):
   - Call `cancelOpenOrdersForAccount(accountId, { triggerReason: "rule_breach" })` from
     the enforcement pipeline.
   - Keep behind `ENABLE_TRADOVATE_ORDER_ACTIONS` gate.
   - Record the result on the `GuardianIntervention` row or a new linked field.

2. **Wire flatten positions to explicit user-selected cutoff actions** only:
   - `flattenPositionsForAccount(accountId, { triggerReason: "session_cutoff" })`.
   - Do **not** wire flatten to daily loss limit automatically until QA confirms
     cancel-only is stable.

3. **Dashboard indication when a broker action was attempted/succeeded/failed:**
   - Show latest `BrokerOrderActionLog` entries for each account in the command center.
   - Distinguish `dryRun: true` (greyed out) from `dryRun: false + success: true` (green)
     from `dryRun: false + success: false` (amber).

4. **Remove dev diagnostic route from non-production flag** once a proper admin
   surface is built (or keep it behind an explicit `INTERNAL_DEV_TOOLS=true` flag).
