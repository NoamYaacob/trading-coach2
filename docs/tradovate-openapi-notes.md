# Tradovate API — Endpoint Rules (Source of Truth)

Verified against `docs/tradovate-openapi.json` (May 2026).
Update this file whenever a `/deps` endpoint is added or changed.

---

## `/deps?masterid` parent-entity rules

Every `/deps` endpoint returns children of a **specific parent entity**.
The `masterid` query parameter must be the ID of that parent — passing
any other ID silently returns wrong data (usually an empty array).

| Endpoint | `masterid` = | Correct usage |
|---|---|---|
| `order/deps` | **Account** entity ID | `order/deps?masterid={tvAccountId}` ✅ |
| `userAccountAutoLiq/deps` | **Account** entity ID | `userAccountAutoLiq/deps?masterid={tvAccountId}` ✅ |
| `fill/deps` | **Order** entity ID | `fill/deps?masterid={orderId}` — never pass `tvAccountId` here |
| `fillPair/deps` | **Position** entity ID | `fillPair/deps?masterid={positionId}` — never pass `tvAccountId` here |

**`fill/deps` and `fillPair/deps` are order/position-scoped, not
account-scoped.** Passing a Tradovate account ID to either returns fills
or fill-pairs for a coincidental order/position that happens to share
that numeric ID — not the account's fills. Do not use them to get
account-level trade data.

---

## Trade count — source authority levels

```
1. broker_report         POST /v1/reports/requestreport    → trustLevel: "verified"
2. account_scoped_orders GET  order/deps?masterid={acctId} → trustLevel: "verified"
3. fills_unscoped_estimated GET fill/list (filtered)       → trustLevel: "estimated"
4. unavailable           (all sources failed)              → trustLevel: "unavailable"
```

**`fill/list` is never authoritative for multi-account trade count.**
It returns all fills for the OAuth token regardless of sub-account, and
per-row `accountId`/`accountSpec` fields are absent on some environments.
When used as a fallback, the result is always marked `estimated` and
trade-limit enforcement is skipped.

`trustLevel: "verified"` can only come from `broker_report` or
`account_scoped_orders`. No other source may set it.

---

## Broker enforcement routing (per trigger)

| Trigger | Broker-enforced? | Field | Status |
|---|---|---|---|
| `daily_loss_limit` | ✅ Yes | `dailyLossAutoLiq` | VERIFIED |
| `profit_target` | ✅ Yes | `dailyProfitAutoLiq` | VERIFIED by OpenAPI; ⚠ LIVE QA REQUIRED on demo/sim |
| `trade_limit` | ❌ No | — | No matching field in userAccountAutoLiq |
| `consecutive_losses` | ❌ No | — | No matching field in userAccountAutoLiq |
| `trading_day_disabled` | ❌ No | — | No matching field in userAccountAutoLiq |
| `session_end` | ❌ Not yet | `flattenTimestamp`? | Needs scheduler + live test |
| `manual` | ❌ No | — | Guardrail-internal only |

**`applyBrokerDayLockout` uses an explicit switch on trigger.** A default
branch returns `monitoring_only` without calling any broker endpoint, so a
trigger added to the type without a corresponding case cannot accidentally
invoke `applyDailyLossLock` or `applyProfitTargetLock`.

**⚠ `profit_target` LIVE QA REQUIRED:** `dailyProfitAutoLiq` is confirmed
present in the Tradovate OpenAPI schema and the read-back confirmation logic
is in place, but the live broker behavior (immediate liq-only lock vs. soft
alert) has not been validated against a real demo or sim account. Validate
on a demo/sim account before treating this as fully production-ready.

---

## `userAccountAutoLiq` field audit (May 2026)

Verified against `docs/tradovate-openapi.json`. All fields are present in
`UserAccountAutoLiq` schema and echoed in `/create`, `/update`, and `/deps`
response bodies.

| Field | Type | Description | Safe to write? |
|---|---|---|---|
| `dailyLossAutoLiq` | number | Daily loss threshold for auto-liq | ✅ Yes |
| `dailyProfitAutoLiq` | number | Daily profit threshold for auto-liq | ✅ Yes |
| `changesLocked` | boolean | Lock settings until next session | ✅ Yes |
| `doNotUnlock` | boolean | Prevent auto-unlock after liq | ❌ NEVER — traps account permanently |
| `weeklyLossAutoLiq` | number | Weekly loss threshold | Not currently used |
| `weeklyProfitAutoLiq` | number | Weekly profit threshold | Not currently used |
| `flattenTimestamp` | string | Session-end flatten time | Not currently used (needs scheduler) |
| `trailingMaxDrawdown` | number | Trailing drawdown limit | Not currently used |

**`doNotUnlock` must never be set.** Omitting it preserves Tradovate's
default auto-unlock at the next session open. Setting it traps the
account permanently until manually unlocked via the Tradovate UI.

---

## Broker-side lockout — required sequence

`broker_locked` status requires **all three steps** to complete
successfully. Setting it after step 1 alone is incorrect.

### Daily loss lock (`daily_loss_limit` trigger)

```
Step 1 (read)   GET  userAccountAutoLiq/deps?masterid={tvAccountId}
                → find existing record id (or null for create path)

Step 2 (write)  POST userAccountAutoLiq/update  { id, dailyLossAutoLiq, changesLocked: true }
                  or
                POST userAccountAutoLiq/create  { accountId: tvAccountId, dailyLossAutoLiq, changesLocked: true }

Step 3 (confirm) check response.dailyLossAutoLiq ≈ sent value (ε = $0.01)
                 if absent: GET userAccountAutoLiq/deps?masterid={tvAccountId} again
                 → set broker_locked ONLY when confirmed = true
                 → set broker_lock_failed when confirmed = false
```

### Profit target lock (`profit_target` trigger)

```
Step 1 (read)   GET  userAccountAutoLiq/deps?masterid={tvAccountId}
                → find existing record id (or null for create path)

Step 2 (write)  POST userAccountAutoLiq/update  { id, dailyProfitAutoLiq, changesLocked: true }
                  or
                POST userAccountAutoLiq/create  { accountId: tvAccountId, dailyProfitAutoLiq, changesLocked: true }

Step 3 (confirm) check response.dailyProfitAutoLiq ≈ sent value (ε = $0.01)
                 if absent: GET userAccountAutoLiq/deps?masterid={tvAccountId} again
                 → set broker_locked ONLY when confirmed = true
                 → set broker_lock_failed when confirmed = false
```

**Key rule:** never mix loss and profit fields in the same payload.
A profit lock payload must contain `dailyProfitAutoLiq` only (not `dailyLossAutoLiq`),
and vice versa.

All steps pass `skipMarkExpired=true` internally so a 401/403 scoped to
the risk endpoint does not expire the OAuth connection for other endpoints.

---

## Position flatten — endpoint audit

Flatten runs **before** day lockout for `daily_loss_limit` and `profit_target`
triggers only. A failed flatten does **not** block the subsequent lockout.

### Endpoint reference

| Endpoint | Method | `masterid` / body | Account-scoped? | Notes |
|---|---|---|---|---|
| `position/deps` | GET | `?masterid={tvAccountId}` (Account entity ID) | ✅ Yes (server-side) | Use this — never `position/list` |
| `order/liquidatepositions` | POST | `{ positions: int64[], admin: boolean }` | ✅ Yes (position IDs are account-scoped) | Atomically flattens multiple positions |
| `order/liquidateposition` | POST | `{ accountId, contractId, admin }` | ✅ Yes | Single-position fallback; not currently used |
| `order/cancelorder` | POST | `{ orderId }` | Account-implicit | Not used for flatten; listed for completeness |

**`position/list` must not be used for flatten.** It returns all positions for
the OAuth token across all sub-accounts. Passing `tvAccountId` to
`position/deps?masterid=` uses a server-side filter — the only safe approach.

### Required flatten sequence (`daily_loss_limit` / `profit_target`)

```
Step 1 (read)    GET  position/deps?masterid={tvAccountId}
                 → filter positions where netPos !== 0 and netPos !== null
                 → if empty: return flattenStatus = "not_needed" (no open positions)

Step 2 (write)   POST order/liquidatepositions  { positions: [positionIds], admin: false }
                 → body must include `admin: false` (required field)
                 → positions array = entity IDs from Step 1 (NOT contractId)
                 → 403 response → flattenStatus = "unavailable_permission"

Step 3 (confirm) GET  position/deps?masterid={tvAccountId}  (same as Step 1)
                 → if all netPos === 0 | null: flattenStatus = "flattened"
                 → if any netPos !== 0:        flattenStatus = "attempted"
                 → if Step 3 throws:           keep flattenStatus = "attempted"
```

**`admin` is required.** Omitting it may cause a Tradovate validation error.
Use `false` — this is an automated system action, not an admin override.

**Position IDs, not contract IDs.** `liquidatepositions` takes position entity
IDs (the `id` field from the Position object). Passing `contractId` silently
targets the wrong resource.

### Permission caveat

A 403 from `order/liquidatepositions` means the OAuth token is missing the
**Orders: Full Access** scope. This is mapped to
`flattenStatus = "unavailable_permission"` via `classifyFlattenError`. The
`skipMarkExpired=true` flag prevents the connection from being marked expired
(same pattern as the autoLiq write endpoints).

Read-only connections (`enforcement_mode = "broker_readonly"`) skip flatten
entirely and return `flattenStatus = "unavailable_read_only"` before any
network call is made.

### Dry-run behavior

When `ENFORCEMENT_DRY_RUN=true`, no network reads or writes occur.
`flattenStatus` is set to `"dry_run"` with an intended-payload description:

```json
{ "positions": ["(open position IDs from position/deps read)"], "admin": false }
```

The combined UI copy for dry-run lockout with flatten is:
> "Dry run · Position exit and broker-side lockout were simulated. No Tradovate write was sent."

### Flatten trigger gate

| Trigger | Flatten? |
|---|---|
| `daily_loss_limit` | ✅ Yes |
| `profit_target` | ✅ Yes |
| `trade_limit` | ❌ No |
| `consecutive_losses` | ❌ No |
| `trading_day_disabled` | ❌ No |
| `session_end` | ❌ No |
| `manual` | ❌ No |

**⚠ LIVE QA REQUIRED:** Live broker flatten behavior must be validated on a
Tradovate demo/sim account before marketing this as fully broker-enforced.
Confirm that `liquidatepositions` atomically closes all open positions and that
the read-back check (`position/deps` re-fetch) consistently reflects `netPos = 0`
before relying on `flattenStatus = "flattened"` as a guarantee.

---

## Adding a new `/deps` endpoint

Before calling any new `/deps` endpoint:

1. Look it up in `docs/tradovate-openapi.json`:
   ```
   .paths["/yourEntity/deps"].get.parameters
   ```
2. Confirm the `masterid` description (e.g. "id of Account entity" vs
   "id of Order entity").
3. Add a row to the table above.
4. Pass the correct parent entity ID — not `tvAccountId` unless the spec
   explicitly says Account entity.
