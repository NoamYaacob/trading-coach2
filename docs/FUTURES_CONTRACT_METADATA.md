# Futures Contract Metadata Registry

Source of truth: `src/lib/futures/contracts.ts`

This module is the single authoritative registry for all futures contract metadata used by Guardrail. It is a pure module — no I/O, no broker calls, no DB access.

---

## What the registry provides

- **Standard-equivalent exposure calculations** — converts micro/mini contract quantities to their parent-contract equivalents for position-size limit enforcement
- **Position-size limit enforcement** — app-side and (optionally) broker-side enforcement decisions
- **UI copy and debug endpoints** — contract names, tick values, asset classes
- **Future broker-side per-product enforcement decisions** — the metadata is designed to support product-specific broker limits when Tradovate verifies the API

---

## The 10-micro = 1-standard model

Guardrail implements the Apex Trader Funding position-sizing model as its default:

> **Ten (10) micro contracts equal one (1) standard contract.**

This is expressed in the registry as `exposureRatioToParent = 0.1` for supported micro equity index pairs.

### Example

| What you hold | Standard-equivalent exposure |
|---------------|------------------------------|
| 1 NQ | 1.0 NQ-equivalent |
| 10 MNQ | 1.0 NQ-equivalent |
| 5 MNQ | 0.5 NQ-equivalent |
| 1 ES | 1.0 ES-equivalent |
| 10 MES | 1.0 ES-equivalent |

If your `maxContracts` limit is 2 (NQ-equivalent), you can hold up to 20 MNQ, or 2 NQ, or 10 MNQ + 1 NQ, etc.

---

## Apex-supported equity index pairs

These pairs are used for standard-equivalent position sizing in Apex evaluations and funded accounts:

| Standard | Micro | Ratio | Exchange | Asset Class |
|----------|-------|-------|----------|-------------|
| NQ | MNQ | 10:1 | CME | equity_index |
| ES | MES | 10:1 | CME | equity_index |
| YM | MYM | 10:1 | CBOT | equity_index |
| RTY | M2K | 10:1 | CME | equity_index |

---

## Other registered contracts

The registry also includes:

| Category | Contracts |
|----------|-----------|
| Energy | CL (crude oil), MCL (micro crude oil) |
| Metals | GC (gold), MGC (micro gold), SI (silver), SIL (micro silver) |
| European equity index | FDAX (DAX), FDXM (Mini DAX) |
| FX | 6E, 6B, 6J, 6A, 6C, 6S, M6E, M6B, M6A |
| Agriculture | ZC (corn), ZS (soybeans), ZW (wheat), ZL, ZM, etc. |
| Crypto | MBT (micro Bitcoin), MET (micro Ether) |

---

## Broker enforcement note

Tradovate's `UserAccountPositionLimit` (`totalBy="Overall"`) enforces a single raw contract count across ALL open positions simultaneously. It **cannot** express standard-equivalent weighting.

> **Warning:** Setting `rawBrokerHardLimitEnabled=true` with `maxContracts=1` will incorrectly reject 2 MNQ (which is 0.2 NQ-equivalent, well within any reasonable limit).

This is why Guardrail defaults to **app-side-only** standard-equivalent detection. The raw broker hard limit is an opt-in feature and should only be used when the user understands the implications.

---

## Unknown products fail safe

If a contract is not found in the registry:

- Position-size enforcement treats it as 0 standard-equivalent exposure (conservative: unrecognized contracts are excluded from the limit calculation, not granted unlimited exposure)
- The UI shows the raw contract count without conversion
- A warning is logged for ops visibility

The registry is designed to never throw on unknown symbols — callers receive a `null` or `0` result, never an exception.

---

## What's coming (already in registry, not yet enforced)

- CL/MCL energy pair enforcement — metadata exists, enforcement not yet wired
- GC/MGC metals pair enforcement — metadata exists, enforcement not yet wired
- FDAX/FDXM EUREX pair — metadata exists, not Apex-verified
- Per-product broker limits (`totalBy="PerProduct"`) — not yet verified against live Tradovate accounts
