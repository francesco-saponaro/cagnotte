# Changelog

## 2026-11-17

- `docs/architecture.md`: the packages and what each may import, a payout request traced through the server and through the demo, the data model, the state machines, the settlement pipeline as a flow, how demo mode opens PostgreSQL in the page, and the tests by layer.
- Screenshots of the demo build in `docs/screenshots/`: the wallet, the dashboard, the transactions queue, the support queue, the wallet on a phone.
- The README in its final form: the live demo and its accounts, both ways to run it, what each role gets, the pipeline, the stack and why each piece is there, the architecture in a paragraph, the tests, what is real and what is simulated, the known limits and what comes next.
- Published: the public repository and the demo on Netlify.

## 2026-11-16

- `packages/handlers`: the routes as a table (method, path, least role, schema, use case, success status) with a dispatcher free of any server; the Fastify app registers the table and keeps its bearer hook and error mapping.
- Demo mode: with `EXPO_PUBLIC_API_URL` empty the app dispatches the same table on the use cases over PGlite in the page. The build copies PGlite's WebAssembly module, data bundle and the committed migration into the export; the first request compiles the engine, applies the migration and loads the seed. A session kept across a reload is written back into the new database. The sign-in screen says so.
- Decision record 8 (demo mode runs PostgreSQL in the page).
- The back office, as a second route group for agents and managers, each role with its own destinations and home. Support: the claims queue filtered on the server by status, assignee and search, and the case with the proof, the member's pot and their cashbacks at that shop, worked through its state machine (take, acknowledge, raise with the unmatched sale that carries the same order reference, credit, decline with a reason from the list). Payouts: the queue by status with check, send and fail with a reason.
- The client reads a 400's field path as the API writes it (joined with dots), so a refused field lands under its input.
- Imports: the batches with their counts, the form that takes a network's file pasted or chosen from disk, and the batch with its lines to fix and the sales it holds. The transactions queue filtered by match status and network; the sale with why it matched nobody in words, the clicks that qualify with match by hand, set aside with a reason, and the cashback it booked with the manager's validate, refuse and cancel, each with a reason.
- The catalogue with every status, a form for a new offer that speaks in percentages and euros and sends basis points and cents, the offer's moves (publish, pause, resume, end) and its boosts. The dashboard: the three queues as links, the margin by shop drawn as the share of each commission paid out as cashback, the pot across every member, and the reconciliation report check by check.
- Two fixes the demo build showed: the demo transport carries the query as text, as a URL would, so a flag sent as a number is read (the catalogue was empty in the demo); a claim's order day is read as the end of that day, capped at now, so a click made earlier the same day counts.
- End-to-end runs with Playwright on the demo build: a member earns and takes money out; a claim goes from the member's form to a credited cashback through support; a manager imports a file, matches a sale by hand and validates the cashback. `pnpm build:web` then `pnpm test:e2e`; CI runs them.
- Headers: the API answers with helmet's set (no framing, no sniffing, a policy that lets nothing run, no referrer); the static demo gets a content policy that allows the WebAssembly engine and the router's one inline line by its hash, through `public/_headers`, and `public/_redirects` serves the app on every route; the web container's nginx sends the plain headers. A moderate advisory in a build-time dependency of the Expo tooling is closed with an override.

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
