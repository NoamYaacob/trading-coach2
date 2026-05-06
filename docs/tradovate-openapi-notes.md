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

## Broker-side lockout — required sequence

`broker_locked` status requires **all three steps** to complete
successfully. Setting it after step 1 alone is incorrect.

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

**`doNotUnlock` must never be set.** Omitting it preserves Tradovate's
default auto-unlock at the next session open. Setting it traps the
account permanently until manually unlocked via the Tradovate UI.

All three calls pass `skipMarkExpired=true` internally so a 401/403
scoped to the risk endpoint does not expire the OAuth connection for
other endpoints.

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
