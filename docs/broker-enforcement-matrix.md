# Broker enforcement matrix — Trading Plan rules vs Tradovate

This is the canonical view of **which Trading Plan rules actually reach
the broker today** and which remain Guardrail-internal. It is derived
from a code audit of `src/lib/brokers/` and the rule-save / sync paths.

The authoritative in-code source is `ENFORCEMENT_CAPABILITIES` in
`src/lib/brokers/enforcement.ts` — this doc is a human-readable summary.

## Legend

- **Broker-enforced** — Tradovate API call exists and is wired. Live
  reject/lockout behavior **may** still need demo verification (see
  per-row notes).
- **Internal-only** — Guardrail enforces in its own state machine. No
  Tradovate endpoint is called for this rule (or no endpoint exists).
- **Pre-emptive cap** — broker rejects new orders that would breach the
  cap (e.g. position limit).
- **Reactive lock** — broker enters liquidation-only mode after a breach
  threshold is hit.

## Matrix

| Rule (UI label)           | DB field            | Tradovate endpoint                                | Permission                            | Triggered when           | Status                  | Tests                                                 |
| ------------------------- | ------------------- | ------------------------------------------------- | ------------------------------------- | ------------------------ | ----------------------- | ----------------------------------------------------- |
| Daily loss limit          | `maxDailyLoss`      | `userAccountAutoLiq/update` or `/create`          | Account Risk Settings: Full Access    | breach detected in sync  | Broker-enforced (reactive) | `enforcement.test.ts`                                 |
| Daily profit target       | `dailyProfitTarget` | `userAccountAutoLiq/update` or `/create`          | Account Risk Settings: Full Access    | breach detected in sync  | Broker-enforced (reactive) — ⚠ live QA pending | `enforcement.test.ts`                                 |
| Max position size         | `maxContracts`      | `userAccountPositionLimit/create` + `/update`; `userAccountRiskParameter/create` + `/update` | Account Risk Settings: Full Access    | rule SAVE (PATCH)        | Broker-enforced (pre-emptive) — ⚠ live reject pending demo (`docs/ops/tradovate-position-limit-demo.md`) | `tradovate-position-limit.test.ts`                    |
| Max position size (breach response) | `maxContracts` | `order/liquidatepositions` (when wired) | Orders: Full Access | mini-equivalent breach in sync | Internal-only (weighted equivalence is Guardrail-side) | `enforcement.test.ts` |
| Max trades per day        | `maxTradesPerDay`   | (none)                                            | n/a                                   | breach in sync           | Internal-only           | `enforcement.test.ts`                                 |
| Stop after N losses       | `stopAfterLosses`   | (none)                                            | n/a                                   | breach in sync           | Internal-only           | `enforcement.test.ts`                                 |
| Trading day disabled      | `tradingDays`       | (none)                                            | n/a                                   | session-day gate in sync | Internal-only           | `trading-day.test.ts`                                 |
| Daily cutoff (session end)| `sessionEndHour`, `sessionEndTime`, `sessionEndBehavior` | `order/liquidatepositions` (flatten) + `userAccountAutoLiq/update` (lock) | Orders + Account Risk Settings | session end in sync | Internal-only — scheduler not yet wired (`flattenTimestamp` unverified) | `flatten-positions.test.ts` |
| Trading session window    | `sessionStart/EndTime`, `sessionPresets` | (none) | n/a | sync compares session window vs current time | Internal-only | (UI-side validation tests) |

## Why "max position size" appears twice

Two distinct mechanisms target the same user-facing rule:

1. **Pre-emptive cap (this commit)**: `applyMaxPositionSize` writes a
   `userAccountPositionLimit` with `totalBy = "Overall"` and a
   `userAccountRiskParameter.hardLimit = true`. Tradovate is asked to
   reject opening orders that would push net contracts above the cap.
   This is broker-enforced 1:1 (one MNQ counts the same as one NQ for
   purposes of the cap).

2. **Breach-response trigger (`max_position_size` in `ENFORCEMENT_CAPABILITIES`)**:
   Guardrail's app-level monitor computes a **weighted mini-equivalent**
   exposure (NQ + 0.1·MNQ + ES + 0.1·MES + …). When that exceeds the cap,
   Guardrail can fire a flatten via `order/liquidatepositions`. This
   trigger remains `internal_only` because Tradovate's position limit
   API can't express the weighted aggregation.

The two mechanisms are complementary, not redundant: the broker cap
catches simple over-orders pre-fill; the internal monitor catches
weighted-exposure overshoots that the broker can't see.

## Pending verification work

- **Daily profit target**: OpenAPI-confirmed but not live-QA'd.
- **Max position size (pre-emptive cap)**: see
  `docs/ops/tradovate-position-limit-demo.md` for the sign-off checklist.
- **Daily cutoff flatten**: needs a session-end scheduler and verification
  that `userAccountAutoLiq.flattenTimestamp` actually triggers a flatten
  on the live broker.

## Suggested additions (deferred — not implemented yet)

These Tradovate fields exist in the OpenAPI spec but are not yet exposed
in Guardrail's Trading Plan UI. They would expand broker-enforced rule
coverage if surfaced:

- `weeklyLossAutoLiq` — broker-enforceable weekly loss limit.
- `weeklyProfitAutoLiq` — broker-enforceable weekly profit target.
- `trailingMaxDrawdown` / `trailingMaxDrawdownLimit` — for prop-firm
  drawdown tracking. Currently we store `propFirmTrailingDrawdown` in
  Guardrail but do not push it to Tradovate.
- Per-product `maxOpeningOrderQty` — would let users cap individual
  symbols rather than only an overall cap.

Defer until post-demo verification of the existing position-limit
mechanism.
