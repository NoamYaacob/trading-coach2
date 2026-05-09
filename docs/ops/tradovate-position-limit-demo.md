# Tradovate broker-side Max Position Size — demo verification plan

## Why this doc exists

`TradovateClient.applyMaxPositionSize` writes a `userAccountPositionLimit`
with `totalBy = "Overall"`, `active = true` and an attached
`userAccountRiskParameter` with `hardLimit = true`. The OpenAPI spec
indicates Tradovate's risk engine should reject any opening order that
would push net open contracts above `exposedLimit`, but **we have not
yet observed this rejection on a live (demo/sim) account**.

Until the steps below are checked off and Tradovate's response shape is
captured, the UI must not claim the cap is "verified" or "guaranteed" —
only that it is "synced as a broker-side position limit when permission
is available."

## Prerequisites

1. A Tradovate **demo / sim** account (NOT live).
2. The account is connected through Guardrail's OAuth flow with
   **Account Risk Settings: Full Access** granted.
3. The account has the user's CME data subscription active so contracts
   can actually be ordered.

## Verification steps

### 1. Apply a tight cap via Guardrail

- Open the account-specific Trading Plan rules form.
- Set **Max position size = 1**.
- Save.
- Confirm in server logs:
  ```
  [tradovate/positionLimit] applying max position size {…, action: "created", maxContracts: 1}
  [tradovate/positionLimit] risk parameter applied {…, riskParamAction: "created"}
  [accounts/patch] broker max position size synced {action: "created", endpoints: [...]}
  ```

### 2. Confirm broker-side state

Either via Tradovate's web UI (`Risk Settings` → account selector → look
for an entry described "Guardrail Max Position Size") **or** by hitting
the diagnostic endpoint with the correct masterid:

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "https://demo.tradovateapi.com/v1/userAccountPositionLimit/deps?masterid=$TV_ACCOUNT_ID"
```

Expected response shape (record):

```json
[
  {
    "id": <number>,
    "accountId": <tvAccountId>,
    "exposedLimit": 1,
    "totalBy": "Overall",
    "active": true,
    "description": "Guardrail Max Position Size"
  }
]
```

And:

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "https://demo.tradovateapi.com/v1/userAccountRiskParameter/deps?masterid=<positionLimitId>"
```

Expected:

```json
[
  { "id": <number>, "userAccountPositionLimitId": <id>, "hardLimit": true }
]
```

### 3. Place an order that breaches the cap

- In the Tradovate trader (web/desktop):
  - Pick a liquid product (e.g. MNQ on demo).
  - Place a **market** order for `qty = 2` (one greater than `exposedLimit`).
  - Capture:
    - The order placement response (HTTP body, error text, status code).
    - Whether the order was **rejected**, **partially filled**, or **fully filled**.

### 4. Repeat under edge conditions

- `qty = 1` → expected to fill (within limit).
- After 1 contract is open, try `qty = 1` for the same product → expected
  to be rejected (would bring net to 2).
- After 1 long contract is open, try a 1-contract short close → expected
  to fill (reduces net to 0, not opening).
- After 1 long contract is open in NQ, try `qty = 1` in MNQ → expected
  outcome: rejected, because `totalBy = "Overall"` aggregates 1:1 across
  products. **CONFIRM ON DEMO** — if Tradovate aggregates by lots not
  notional, this is the actual behavior we'll see.

### 5. Test cap removal

- In Guardrail, clear `Max position size` (set to empty/null) and save.
- Confirm logs:
  ```
  [tradovate/positionLimit] deactivating Guardrail limit {…, limitId: …}
  ```
- Re-fetch `userAccountPositionLimit/deps` → record should still exist
  but `active = false`.
- Place `qty = 5` on demo → should fill (no Guardrail-active cap).

### 6. Test "do not touch user-created limits"

- Manually create a `userAccountPositionLimit` in Tradovate's UI with a
  description like `"My personal cap"` (description ≠ "Guardrail Max
  Position Size").
- In Guardrail, set `Max position size = 3` and save.
- Confirm via `userAccountPositionLimit/deps` that:
  - The user-created limit is **untouched** (`description = "My personal cap"`, `exposedLimit` unchanged).
  - The Guardrail limit is created/updated alongside it.

## Outputs to capture

For each verification run, attach to this doc:

1. The exact `userAccountPositionLimit/deps` response BEFORE the save.
2. The exact `userAccountPositionLimit/create` or `/update` request payload.
3. The exact response body Tradovate returned.
4. The exact `userAccountRiskParameter` create/update response.
5. The order rejection response (HTTP status, error text) from step 3 / 4.
6. Screenshot of Tradovate's Risk Settings UI showing the active cap.

## Sign-off criteria

The cap can be advertised as "verified broker-enforced" only when **all**
of the following are true:

- [ ] `qty = 2` order is rejected pre-fill on a demo account with
      `exposedLimit = 1`.
- [ ] Cross-product aggregation behavior is documented (NQ + MNQ case).
- [ ] Cap removal (set to null) returns the account to unrestricted
      ordering on demo.
- [ ] User-created limits are demonstrably untouched by Guardrail's
      sync.
- [ ] Rejection error shape is captured and a corresponding UI error
      branch is wired in `accounts/[id]/route.ts` if the response shape
      differs from what we assume.

Until then the UI hint must read:

> "Synced to Tradovate as a broker-side position limit when Account Risk
> Settings permission is available. Otherwise enforced by Guardrail at
> the app level only."

(See `src/app/rules/_components/position-size-copy.ts`.)
