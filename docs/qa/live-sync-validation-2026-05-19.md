# Live Trade Sync Validation — DEMO7433035

**Date:** 2026-05-19  
**Branch:** `claude/rule-engine-violation-feed-ioIBS` @ `97f7b64`  
**Account:** DEMO7433035 (Tradovate demo, externalAccountId = 7433035)  
**Type:** First successful live trade sync validation  
**Environment constraints in effect:**

| Flag | Value |
|------|-------|
| `ENFORCEMENT_DRY_RUN` | `true` |
| `BROKER_ENFORCEMENT_ENABLED` | `false` |
| `GUARDRAIL_INTERNAL_LOCK_ENABLED` | `false` |
| `TRADOVATE_LISTENER_ENABLE_LIVE` | `false` |
| `ENABLE_TRADOVATE_ORDER_ACTIONS` | `false` (or absent) |

No broker writes were made. No orders were placed, cancelled, or flattened.

---

## Test Scenario

One real round-trip trade was entered and closed on DEMO7433035 during live market hours. The sync chain was observed from fill detection through LiveSessionState and riskState computation.

---

## Observed Results

### Fill detection (Phase B)

| Field | Value |
|-------|-------|
| `rawFillCount` | 2 |
| `uniqueOrderIds` | 2 |
| `groupedOrderCount` | 2 |
| `derivedEntryTradeCount` | 1 |
| Entry fill | `positionBefore: 0` → detected as trade open |
| Exit fill | `positionBefore: 1, positionAfter: 0` → detected as trade close |
| Account scoping | Not suspect |

The `traceEntryTrades` logic correctly counted one round-trip as one trade (flat → nonflat open only), matching Tradovate's own "# of Trades" definition.

### Report 400 classification (Phase C)

| Field | Value |
|-------|-------|
| `/reports/requestreport` HTTP status | 400 |
| Classification | `broker_report_unavailable` |
| Log key | `[tradovate/trades] broker_report_unavailable` |
| `fallback` | `canonical_db` |
| `note` | `"sync proceeds normally — not a listener_error"` |
| Effect on `SyncResult.errorCode` | None (`null`) |
| Effect on dashboard freshness | None (`lastSyncAt` updated normally) |

### Phase C trade count resolution

| Field | Value |
|-------|-------|
| Canonical DB count | 1 |
| Canonical `rawFillCount` | 2 |
| Phase C `count` | 1 |
| Phase C `source` | `canonical_db` |

### LiveSessionState

| Field | Value |
|-------|-------|
| `tradesCount` | 1 |
| `dailyPnl` effective | −$355.76 |
| `riskStateAtSyncStart` | `NORMAL` |
| `riskStateAtSyncEnd` | `NORMAL` |
| `violationCreated` | `false` |

No configured rule threshold was crossed. The −$355.76 loss did not breach `maxDailyLoss`.

### Broker write negative check

Searched for the following patterns in Railway logs for the sync cycle and in source across all files in the sync/listener/guardian pipeline:

| Pattern | Runtime log result | Source (sync path) |
|---------|-------------------|-------------------|
| `userAccountAutoLiq` | Not present | 0 matches |
| `liquidatepositions` | Not present | 0 matches |
| `broker_locked` | Not present | 0 matches |
| `brokerEndpoint` | Not present | 0 matches |
| `BrokerOrderActionLog` | Not present | 0 matches |

These patterns exist only in `enforcement.ts` and `enforcement-helpers.ts` (Phase 2C), which are unreachable while `BROKER_ENFORCEMENT_ENABLED=false`.

---

## Pass/Fail Summary

| # | Check | Result |
|---|-------|--------|
| 2a | `rawFillCount > 0` | **PASS** — 2 fills |
| 2b | Account scoping not suspect | **PASS** |
| 2c | Entry fill detected (`positionBefore: 0`) | **PASS** |
| 2d | Exit fill detected (`positionBefore: 1, positionAfter: 0`) | **PASS** |
| 3a | `derivedEntryTradeCount = 1` (dedup correct) | **PASS** |
| 4a | `tradesCount` = 1 | **PASS** |
| 4b | `dailyPnl` updated (−$355.76) | **PASS** |
| 4c | `riskState` = NORMAL throughout | **PASS** |
| 4d | `violationCreated = false` | **PASS** |
| 5a | Account sync `ok = true` | **PASS** |
| 6a | Report 400 → `broker_report_unavailable` only | **PASS** |
| 6b | `listener_error` absent | **PASS** |
| 6c | Phase C `source = canonical_db`, `count = 1` | **PASS** |
| 7a | `userAccountAutoLiq` absent from sync cycle | **PASS** |
| 7b | `liquidatepositions` absent from sync cycle | **PASS** |
| 7c | `broker_locked` absent from sync cycle | **PASS** |
| 7d | `brokerEndpoint` absent from sync cycle | **PASS** |
| 7e | `BrokerOrderActionLog` absent from sync cycle | **PASS** |

**Overall: PASS — 18/18 checks.**

---

## Verdict

**GO for continued live observation on DEMO7433035.**

The full sync chain is validated end-to-end with a real trade:

- Listener receives fills correctly.
- Fill dedup (`traceEntryTrades`) counts round-trips as single trades.
- `reports/requestreport` HTTP 400 is handled as a diagnostic-only event with no impact on sync outcome, dashboard freshness, or error state.
- Phase C correctly falls back to `canonical_db` when the Performance Report is unavailable.
- `LiveSessionState` and riskState computation behave correctly under normal (non-breaching) conditions.
- No broker writes occurred. All enforcement gates remain in their configured safe state.
