# Changelog

## 2026-11-15

- `apps/mobile`: the member's app. An API client over a transport (HTTP today, the in-browser use cases for demo mode next), a session store that keeps the opaque token in storage and drops it on a 401, one query hook per route with TanStack Query, and navigation behind an interface so the screens never import the router. The shell: a top bar with the destinations on a wide screen, a bottom bar on a phone, Geist loaded on every platform.
- Screens: sign-in with the three demo accounts; the offers list with server-side search, category, sort and paging; the offer with the rate in force, its boost and conditions, Activate, the tracking link out, and the member's own activations of it; the wallet with the available balance, the pot's four buckets drawn at their true proportions, the next cashback to validate, the cashbacks filtered on the server and the latest ledger movements; the cashback with how it was computed and every move of its money; the payout form (transfer, gift card, donation) with the IBAN masked before it is sent; the claims list, the claim form over the offers the member activated, the claim with where it stands and why it was declined; the referrals with the code, the friends and the bonuses paid.
- Forms validate with the schemas from `packages/contracts` before sending and show the API's own words when a rule refuses the request after.
- The web export's HTML shell now writes the bundle scripts (the earlier shell left them out, so the exported pages rendered nothing).
- Component tests for every screen with react-native-web in jsdom against a fake transport; the seed's claim proof text names the customer instead of their email.
- Decision record 7 (screens behind a transport and a navigation interface).

## 2026-11-14

- `packages/domain`: the settlement pipeline. Two parsers for the networks' export formats (CSV and JSON) with line-level errors and in-file deduplication; matching by click reference under the merchant, time and attribution-window rules, with the reason kept when there is no match; the cashback computation with the minimum spend, the new-customer rule, the cap and the margin rule; booking into the ledger in the state the network reports; updates from later files (approvals, declines, returns, amount corrections); the referral bonuses on validation; the transactions queue with match-by-hand and ignore; the claim credit; the reconciliation report. Manual decisions go through the same booking step, so they pay the referral bonus too, and a later network file leaves them alone.
- Property-based tests on matching and computation, and on the ledger invariants over random histories, which found and fixed a case where two orders on one click booked two cashbacks.
- `packages/postgres`: the ports the pipeline needs over Drizzle, including the whole-book sums the reconciliation reads; the contract test covers them on PGlite.
- `apps/api`: `POST /imports`, `GET /imports`, `GET /imports/:id`, `GET /transactions`, `GET /transactions/:id`, `POST /transactions/:id/match`, `POST /transactions/:id/ignore`, `POST /claims/:id/credit`, `GET /reports/reconciliation`, in the access matrix and the integration tests.
- `docs/domain.md`; decision records 5 (a ledger of entries, not a balance column) and 6 (match by the click reference, keep the rest for claims).

## 2026-11-12

- `packages/domain`: the entities, the seven transition tables, the ports as interfaces with an in-memory implementation, and the use cases: sign-up and sign-in with opaque hashed sessions, offers and activations, the wallet, payouts through their queue, claims through theirs, manual decisions on a cashback, the catalogue with boosts, the overview and margin reports, the audit log. Every transition writes an audit row inside the same unit of work.
- `packages/contracts`: the request schemas as zod, shared by the API and the app's forms.
- `packages/postgres`: the ports over Drizzle, run through the same contract test as the in-memory adapters, plus the margin report checked against the seed.
- `apps/api`: every route of the plan but the settlement pipeline's, with role checks before parsing, one error shape, a shared rate limit on `/auth/*`, and integration tests for every route on PGlite over the seed.
- `docs/api.md`; decision records 3 (opaque sessions, not JWT) and 4 (validation shared between API and app).

## 2026-11-11

- Workspace: pnpm, TypeScript strict, ESLint, Vitest, a CI workflow, `docker compose` with PostgreSQL 16, the API and the web app, `.env.example`.
- `packages/domain`: money as integer cents and basis points (`applyRate`, `percentToBps`, `parseEuros`, `formatEuros`), the rate in force on an offer with boosts, scrypt password hashing and the password rule.
- `packages/postgres`: the fourteen tables as a Drizzle schema with enums, foreign keys, unique and check constraints; the first migration; `connect` over node-postgres and `connectPglite` in memory; a seed generator that produces about 17,000 coherent rows from a fixed seed, with tests for determinism, constraints, matching, computation and the ledger.
- `apps/api`: the server skeleton with its configuration and a health route.
- `apps/mobile`: the Expo app shell with Expo Router and the web export.
- Decision records 1 (layers and packages) and 2 (money as integer cents).
