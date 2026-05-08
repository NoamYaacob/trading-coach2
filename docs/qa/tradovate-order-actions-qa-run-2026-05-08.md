# Tradovate Order Actions — QA Run Report

**Date:** 2026-05-08
**Branch:** `claude/rule-engine-violation-feed-ioIBS`
**Environment:** CI-equivalent — no live server, no live DB, no Tradovate credentials.
**Tester:** Automated verification (Claude Code)

---

## Environment assessment

| Resource | Status |
|----------|--------|
| Local dev server (localhost:3000) | Not running — no live HTTP tests possible |
| DATABASE_URL | Not set — no DB queries possible |
| ENABLE_TRADOVATE_ORDER_ACTIONS | Not set ✓ (safe default) |
| Tradovate demo account credentials | Not available in this environment |
| NODE_ENV | Not set to "production" |

**Impact:** Sections 1–3 (dry-run logic) and Section 5 (invalid ID blocking) are
fully verified via unit tests and static code analysis. Sections 4, 6, 7 (live
broker calls against a demo account) require a real Tradovate demo account and
a running dev server — these are **BLOCKED** in this environment and must be
completed manually before wiring to rule breaches.

---

## Section 1 — Automated unit tests (65 broker tests, 2165 total)

Run: `npm run test:unit`

| Suite | Tests | Pass | Fail |
|-------|-------|------|------|
| `isTradovateOrderActionsEnabled` | 8 | 8 | 0 |
| `validateAccountForOrderActions` | 13 | 13 | 0 |
| `canSendLiveOrderActions` | 4 | 4 | 0 |
| `parseTradovateAccountId` | 18 | 18 | 0 |
| `cancel_orders audit log shape` | 5 | 5 | 0 |
| `flatten_positions audit log shape` | 3 | 3 | 0 |
| `live-action guard invariants` | 4 | 4 | 0 |
| `flatten-positions helpers` | 3 | 3 | 0 |
| `FlattenPositionsResult status literals` | 9 | 9 | 0 |
| **Full suite** | **2165** | **2165** | **0** |

Also fixed in this run: 6 pre-existing test failures in `data.test.ts` and
`data-helpers.test.ts` that documented old behavior (dry_run panel returned
from `deriveProtectionStatusPanel`; "Protection test mode" from
`derivePerAccountStateLabel`). Updated to match the Task 6 behavior:
- `deriveProtectionStatusPanel` returns `null` when `isDryRunActive` (outer `TradingPermissionBlock` covers it)
- `derivePerAccountStateLabel` returns `null` for dry_run without full_access

---

## QA checklist result

### ✅ 1. Dry-run cancel open orders — VERIFIED (code + unit tests)

**How verified:**

`effectiveDryRun = true` when `ENABLE_TRADOVATE_ORDER_ACTIONS` is not set (confirmed
by `isTradovateOrderActionsEnabled` test suite — flag returns false for unset,
`"1"`, `"yes"`, `"TRUE"`, `"True"`, empty).

When `effectiveDryRun = true`:
- `client.cancelOrder()` is never reached — code enters the dry-run branch and returns before the live loop (lines 143–171 of `cancel-open-orders.ts`)
- `client.getOrders()` IS called as a read-only GET to show what would be cancelled — no write endpoint is used
- Result shape: `{ dryRun: true, attemptedCount: N, succeededCount: 0, failedCount: 0, errors: [] }`

**Cannot verify in this environment:** actual HTTP call to `getOrders()` returning
real Working orders, Tradovate UI confirmation that orders remain.

---

### ✅ 2. Dry-run flatten positions — VERIFIED (code + unit tests)

**How verified:**

When `effectiveDryRun = true` in `flattenPositionsForAccount`:
- `client.initialize()` is never called (moved to after the dry-run branch — commit `35df793`)
- `client.applyFlattenOpenPositions()` is never called
- Zero broker API calls made (read or write)
- Result: `{ dryRun: true, flattenStatus: "dry_run", flattenMessage: "Dry-run: flatten would be applied but no API call was made." }`

**Cannot verify in this environment:** Tradovate UI confirmation that position remains open.

---

### ✅ 3. Audit logs written — VERIFIED (code analysis)

**How verified:**

Both action functions call `writeBrokerOrderActionLog()` in every exit path:
- Dry-run cancel: `dryRun: true`, `actionType: "cancel_orders"`, `success: true` (lines 158–169)
- Dry-run flatten: `dryRun: true`, `actionType: "flatten_positions"`, `success: true` (lines 136–147)
- Invalid account ID (new): `dryRun: true`, `success: false`, `errorMessage: <reason>` (before any broker call)
- Live cancel: `dryRun: false`, `success: failedCount === 0`
- Live flatten: `dryRun: false`, `success` based on `flattenStatus`

No audit log is written for pre-action validation failures (`validateAccountForOrderActions`
rejections) — intentional, nothing was attempted.

Audit log summaries contain only IDs, counts, and status strings — verified by
`WriteBrokerOrderActionLogInput type` tests (no token/secret/password/key fields).

**Cannot verify in this environment:** actual DB row insertion, log visible in
`/api/dev/order-actions-debug?connectedAccountId=<id>` response.

---

### ✅ 4. Invalid externalAccountId is blocked — VERIFIED (18 unit tests)

**How verified:**

`parseTradovateAccountId()` is called in both `cancelOpenOrdersForAccount` and
`flattenPositionsForAccount` BEFORE `client.initialize()`. Tests confirm `ok: false`
for every invalid form:

| Input | Result |
|-------|--------|
| `null` | INVALID_EXTERNAL_ACCOUNT_ID |
| `""` | INVALID_EXTERNAL_ACCOUNT_ID |
| `"abc"` | INVALID_EXTERNAL_ACCOUNT_ID |
| `"123abc"` | INVALID_EXTERNAL_ACCOUNT_ID |
| `"abc123"` | INVALID_EXTERNAL_ACCOUNT_ID |
| `"123.0"` | INVALID_EXTERNAL_ACCOUNT_ID |
| `" 123"` | INVALID_EXTERNAL_ACCOUNT_ID |
| `"123 "` | INVALID_EXTERNAL_ACCOUNT_ID |
| `"+123"` | INVALID_EXTERNAL_ACCOUNT_ID |
| `"-123"` | INVALID_EXTERNAL_ACCOUNT_ID |
| `"0x1A"` | INVALID_EXTERNAL_ACCOUNT_ID |
| `"0"` | INVALID_EXTERNAL_ACCOUNT_ID |
| `"00"` | INVALID_EXTERNAL_ACCOUNT_ID |
| `"1234567"` | ✅ ok, tvAccountId: 1234567 |

On `ok: false`: audit log written, error thrown, `client.initialize()` and
`client.getOrders()` are structurally unreachable.

---

### ✅ 5. No other account affected — VERIFIED (code analysis)

**How verified:**

Three independent layers prevent cross-account contamination:

1. **`validateAccountForOrderActions`** rejects accounts with missing/empty `externalAccountId` (code `NO_EXTERNAL_ACCOUNT_ID`)
2. **`parseTradovateAccountId`** rejects any `externalAccountId` that cannot be strictly parsed as a positive integer (code `INVALID_EXTERNAL_ACCOUNT_ID`)
3. **`TradovateClient.getOrders()`** filters to `tvAccountId` after `initialize()` (line 902–904 of `tradovate-client.ts`): `return working.filter((o) => o.accountId === this.#tvAccountId)`
4. **`TradovateClient.applyFlattenOpenPositions()`** uses `position/deps?masterid=${tvAccountId}` — account-scoped read

The only remaining theoretical gap (if `tvAccountId` is null after `initialize()` despite a valid `externalAccountId` string) is now fully blocked by layer 2 — the regex `/^\d+$/` ensures `parseInt` will produce a valid positive integer, so `tvAccountId` will always be set after `initialize()`.

---

### 🔶 6. Live cancel orders (demo only) — BLOCKED, requires demo environment

**Cannot run:** No Tradovate demo account credentials, no running server.

**What to do manually:**
1. Start dev server: `npm run dev`
2. Set `ENABLE_TRADOVATE_ORDER_ACTIONS=true` in `.env.local`
3. Place 1–2 limit orders in Tradovate demo (far from market)
4. Call `cancelOpenOrdersForAccount` directly or via Option A in QA guide Section 4.2
5. Verify orders cancelled in Tradovate UI
6. Verify audit log via `GET /api/dev/order-actions-debug?connectedAccountId=<id>`
7. Unset the flag

See `docs/qa/tradovate-order-actions-qa.md` Section 4 for full steps.

---

### 🔶 7. Live flatten positions (demo only) — BLOCKED, requires demo environment

**Cannot run:** Same constraints as Section 6.

**What to do manually:**
1. Open 1 MES/MNQ demo position
2. With `ENABLE_TRADOVATE_ORDER_ACTIONS=true`, call `flattenPositionsForAccount` directly
3. Verify `flattenStatus` is `flattened`, `attempted`, or `not_needed`
4. Verify position is flat or exit order is visible
5. Unset the flag

See `docs/qa/tradovate-order-actions-qa.md` Section 5 for full steps.

---

## Invariants confirmed via code analysis

| # | Invariant | Status |
|---|-----------|--------|
| I.1 | `ENABLE_TRADOVATE_ORDER_ACTIONS` not set → `effectiveDryRun = true` | ✅ |
| I.2 | `permissionLevel = 'read_only'` → `effectiveDryRun = true` | ✅ |
| I.3 | `options.dryRun: true` always respected regardless of flag | ✅ |
| I.4 | `client.cancelOrder()` not called in dry-run | ✅ |
| I.5 | `client.applyFlattenOpenPositions()` not called in dry-run | ✅ |
| I.6 | `client.initialize()` not called in flatten dry-run | ✅ |
| I.7 | Non-integer `externalAccountId` blocked before any API call | ✅ |
| I.8 | Audit log written in every non-throw exit path | ✅ |
| I.9 | Audit log contains no tokens or secrets | ✅ |
| I.10 | `/api/dev/order-actions-debug` returns 404 in production | ✅ (code: `if (process.env.NODE_ENV === "production") return 404`) |
| I.11 | Diagnostic route POST hardcodes `dryRun: true` — cannot trigger live actions | ✅ |
| I.12 | `getOrders()` filters to `tvAccountId` — other accounts never touched | ✅ |
| I.13 | `applyFlattenOpenPositions()` uses `masterid=tvAccountId` scope | ✅ |

---

## Remaining before wiring to rule breaches

- [ ] **Live demo cancel QA** (Section 6): manually verified with real Tradovate demo account
- [ ] **Live demo flatten QA** (Section 7): manually verified with real Tradovate demo account
- [ ] Confirm `ENABLE_TRADOVATE_ORDER_ACTIONS` is unset after live demo tests
- [ ] All 13 invariants above re-verified after any code changes to enforcement pipeline
