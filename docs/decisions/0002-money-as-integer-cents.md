# 2. Money is integer cents, rates are integer basis points

Date: 2026-11-11

## Context

A cashback is a percentage of an order, a referral bonus is a percentage of a cashback, a payout must be a multiple of five euros, and the ledger has to reconcile to the cent across thousands of entries. The amounts come in from network exports as text, in French and in English formats.

## Options considered

1. **Floating-point euros** (`12.99`). Simple to read; `0.1 + 0.2` is not `0.3`, and a sum of a few thousand entries drifts.
2. **A decimal library** (`decimal.js`, `big.js`). Exact, but a dependency in the domain package and in the browser bundle, and an object type in every row and every JSON body.
3. **Integer cents** in every column, body and type, with rates as integer basis points (1 bps = 0.01 %), and one rounding step, half up, where a rate is applied.

## Decision

Option 3. `applyRate(baseCents, rateBps)` is the one place a percentage meets an amount; it is integer arithmetic, `floor((base * bps + 5000) / 10000)`, which is round-half-up of the exact value, and it is checked by property tests to be monotonic, never above the base, and within half a cent of the exact value. Percentages entered by people go through `percentToBps`, which refuses more precision than a basis point. Amounts read from files go through `parseEuros`, which returns null for anything ambiguous rather than guessing; "12.345" is refused because it could be twelve thousand or three decimals.

## Consequences

Every number in the schema is an `integer`, every check constraint is on cents, and the UI formats at the edge with `formatEuros`. Sums are exact, so the reconciliation report can say "equal" and mean it. The cost is that every form and every fixture has to convert at the boundary, which is where the parsing tests live.
