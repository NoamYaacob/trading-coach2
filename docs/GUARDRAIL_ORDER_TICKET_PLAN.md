# Guardrail Order Ticket — Pre-Trade Checking Architecture

This document describes the architecture for a Guardrail-native order ticket
that can perform **true pre-trade enforcement** before an order reaches
Tradovate.

This is a future milestone. Current Guardrail enforcement is detection-response
(post-fill). The real-time listener (this PR) reduces detection latency to
near-instant but cannot intercept orders in flight.

---

## Why a Guardrail Order Ticket?

The current model:
```
User → Tradovate platform order ticket → Tradovate executes → Guardrail detects breach
```

A Guardrail order ticket changes this to:
```
User → Guardrail order ticket → Guardrail checks rules → Tradovate API (if approved)
                                        ↓ (if breach)
                                    Reject with explanation
```

This gives true pre-trade enforcement: orders that would breach `max_position_size`
are blocked before any fill occurs.

---

## What Pre-Trade Can Check

| Check | Can do pre-trade | Notes |
|---|---|---|
| Max position size (standard-equiv) | Yes | Compare pending order to current net exposure |
| Max position size (raw broker) | Already done | Tradovate rejects at broker level |
| Max daily loss | Yes | Compare P&L running total to daily loss limit |
| Trading day / time window | Yes | Block orders outside allowed session |
| Allowed contracts/symbols | Yes | Reject disallowed instruments |
| Consent / account locked (riskState=STOPPED) | Yes | Block all orders when account is locked |

What pre-trade cannot easily check without Tradovate data:
- Fills that happened outside Guardrail in the same session (requires sync)
- Positions from other connected accounts (cross-account netting)

---

## Architecture Overview

### Option A: Web-Based Order Ticket (Recommended for V1)

A page at `/trade` or embedded in the dashboard. The user places orders through
Guardrail's UI, which calls Tradovate's REST API (`/order/placeorder`) after
pre-trade checks pass.

```
Browser → POST /api/trade/place-order
              ├─ load account rules + current positions from DB
              ├─ decideRealtimeEnforcement(proposed order + current exposure)
              │    ├─ PASS → forward to Tradovate /order/placeorder
              │    └─ FAIL → return 422 with explanation
              └─ return order result or rejection reason
```

Advantages:
- No browser extension required
- Works on any device
- Guardrail controls the full order flow
- Can show the user exactly why an order was rejected

Disadvantages:
- Requires users to place orders through Guardrail (behavioral change)
- Does not intercept orders placed in the Tradovate platform directly

### Option B: Browser Extension (Intercepts Tradovate Web Platform)

A browser extension that intercepts `fetch` / `XMLHttpRequest` calls to
`live.tradovateapi.com` or `demo.tradovateapi.com` before they leave the
browser, checks rules against Guardrail's API, and either allows or blocks.

Advantages:
- Transparent to the user — they use Tradovate's own platform
- True interception of all orders, regardless of source

Disadvantages:
- Requires extension install (Mac/Windows Chrome/Firefox)
- Extension maintenance burden
- Tradovate may change their API or add protections

### Option C: Raw Broker Hard Limit (Already Implemented)

`rawBrokerHardLimitEnabled = true` writes a `totalBy="Overall"` cap to
Tradovate, which rejects orders at the broker level. This is pre-trade but
counts all contracts equally (1 MNQ counts the same as 1 NQ).

Suitable for: simple single-instrument accounts where raw counting is
acceptable.

Not suitable for: mixed micro/standard positions where standard-equivalent
counting is required.

---

## Recommended V1 Scope: Web Order Ticket

The web order ticket is the lowest-friction path to true pre-trade checking.

### Phase 1: Basic Order Placement

- `/trade` page with contract search, side (Buy/Sell), qty, order type
- `POST /api/trade/place-order` route:
  1. Validate user session + account ownership
  2. Load `AccountRiskRules.maxContracts` and current positions from DB
  3. Compute proposed exposure: current net + order qty (sign-aware)
  4. If proposed exposure > `maxContracts` (standard-equiv): reject 422
  5. If account `riskState = "STOPPED"`: reject 422
  6. Call Tradovate `/order/placeorder` with decrypted access token
  7. Return order ID or Tradovate error

### Phase 2: Live Position Feed Integration

Once the real-time listener is deployed (this PR's next PR milestone), the
order route can use in-memory position snapshots instead of DB queries,
giving sub-100ms pre-trade checks even during fast position changes.

### Phase 3: Mobile App

A React Native (Expo) app wrapping the order ticket API. Same server-side
enforcement, native UX.

---

## Key Constraint: Standard-Equivalent Calculation Must Match

The pre-trade check MUST use the same `computeStandardEquivalentExposure()`
function used by the real-time listener enforcement decision module
(`src/lib/brokers/tradovate-realtime-enforcement.ts`). Any divergence between
pre-trade and post-trade enforcement creates inconsistent user experience.

The function lives in `src/lib/brokers/tradovate-realtime-enforcement.ts` and
is covered by comprehensive tests including the critical cases:
- 1 NQ = 1.0 standard-equiv (same limit as 10 MNQ)
- 2 MNQ = 0.2 standard-equiv (well under a 1-contract limit)
- Mixed positions are summed by symbol root

---

## User Copy: What to Say About Each Mode

| Mode | Correct description | Do NOT say |
|---|---|---|
| Detection-response (default) | "Guardrail detects breaches after fills and locks your account" | "Pre-trade reject" |
| Raw broker hard limit | "Tradovate rejects orders at the broker before execution. Counts all contracts equally." | "Standard-equivalent" |
| Guardrail order ticket | "Orders placed through Guardrail are checked before reaching Tradovate." | Implies Tradovate-platform orders are also intercepted (they are not) |

The `BrokerListenerStatus` component enforces this copy at the dashboard level
(tests in `broker-listener-status.test.ts`).
