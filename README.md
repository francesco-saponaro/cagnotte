# Cagnotte

A cashback app and the back office behind it. Members activate merchant offers, buy, and watch the cashback go from pending to validated to a pot in euros they can pay out. Support agents work the claims for purchases that never tracked. An operations manager imports the affiliate networks' transaction files, watches what matched no activation, releases payouts and reads the margin.

The part I care most about is the settlement pipeline: matching a network's transactions to the activations behind them, computing each cashback by the rules of the offer at activation time, and keeping a double-entry ledger that reconciles to the cent through validations, reversals, claims, referral bonuses and payouts.

![The wallet: the available balance, the pot as its four buckets, the cashbacks and the latest movements](docs/screenshots/wallet.png)

## Live demo

https://cagnotte-francesco-saponaro.netlify.app

The demo is the web export of the app in demo mode: the same route table, use cases, migration and seed run in the browser on PGlite (PostgreSQL compiled to WebAssembly), so what it shows is the real code path with no server behind it. The first sign-in downloads the engine and loads about 17,000 rows, which takes a few seconds; a reload starts the data over. Sign in as Marie to see the member's side, as Sam for the support queue, as Nadia for the whole back office:

| Account | Role | Password |
| --- | --- | --- |
| `marie@example.com` | member | `cagnotte-demo` |
| `sam@example.com` | support agent | `cagnotte-demo` |
| `nadia@example.com` | operations manager | `cagnotte-demo` |

To run the demo yourself: `pnpm build:web`, then serve `apps/mobile/dist` with any static server that falls back to `index.html` (`pnpm -C apps/mobile exec serve -s dist`).

## Running it

Two ways, same code.

With Docker, which starts PostgreSQL 16, the API on `http://localhost:3001` and the web app on `http://localhost:8080`:

```
cp .env.example .env
docker compose up
```

By hand, with Node 22 and pnpm:

```
pnpm install
pnpm test
pnpm build
DATABASE_URL=postgres://cagnotte:cagnotte@127.0.0.1:5432/cagnotte SEED=1 pnpm -C apps/api dev
EXPO_PUBLIC_API_URL=http://localhost:3001 pnpm -C apps/mobile web
```

The API needs a PostgreSQL to point at (`docker compose up postgres` gives one); the variables and their defaults are in `.env.example`.

The database comes up with the seed loaded: about 17,000 rows of six months of activity, generated from a fixed seed so every run is the same. The demo accounts above work here too.

## What it does

A member browses offers (search, category, sort, server-side pages), opens one to see the rate in force this minute and the boost it comes from, activates it and gets a tracking link. The wallet shows the available balance, the pot drawn as its four buckets (pending, available, reserved, paid out) at their true proportions, the next cashback to validate, the cashbacks filtered on the server and the latest ledger movements. Each cashback says how it was computed. The member can pay the pot out by bank transfer, gift card or donation, file a claim for a purchase that never showed up, and see the referral code with the friends it brought and the bonuses they paid.

An agent gets the support queue. A claim is taken, acknowledged, raised with the network and credited or declined with a reason, with the member's pot, their cashbacks at that shop and the proof beside it.

A manager gets the whole back office. The dashboard has the three queues, the margin by shop (the commission the network paid, the part paid out as cashback, the margin) and the reconciliation report check by check. Imports take a network's export file pasted or chosen from disk and show the batch: rows read, new, updated, matched, unmatched, and the lines that could not be read with their line numbers. The transactions queue holds the sales that matched no click; each one says why, lists the clicks that qualify so it can be matched by hand, or is set aside with a reason, and the cashback it booked can be validated, refused or taken back. The payouts queue checks, sends or fails a request. The catalogue writes offers in percentages and euros, publishes, pauses, resumes and ends them, and adds boosts.

Each role has its own destinations and its own home. On a wide screen the destinations are a top bar; on a phone they are a bottom bar.

![The manager's dashboard: the three queues, the margin by shop, the pot across every member, the reconciliation](docs/screenshots/dashboard.png)

## The settlement pipeline

A manager posts a network's export file to `POST /imports`. The file is parsed (Linkpool sends a CSV, Affinet a JSON document; both become the same row, and a row that cannot be read is reported with its line number), deduplicated against earlier files, and each new transaction is matched to the click its `subId` names, provided the click is at the same merchant, before the order and inside the merchant's attribution window. The cashback is the activation's rate on the order, held under the offer's cap and under the network's commission, and booked as ledger entries in the state the network reports. A file about orders already known applies the changes: an approval validates the cashback, a decline refuses or takes it back, an amount change books the difference. Validations pay the referral bonuses. Transactions nothing names stay in a queue, where a claim or a manager can match them by hand.

A manager's decision and a claim's credit go through the same booking step as the pipeline, so the wallet cannot tell who decided. `GET /reports/reconciliation` recomputes the whole book from the entries and checks it against the cashbacks and payouts. The same checks run in the tests after every step of random histories generated with fast-check. The rules, step by step and with worked examples, are in [`docs/domain.md`](docs/domain.md).

![The transactions queue: the sales that matched no click, waiting for a claim or a match by hand](docs/screenshots/transactions.png)

## The API

Fastify 5, JSON, on `http://localhost:3001`. Sign in, then send the token as a bearer header:

```
curl -s localhost:3001/auth/sign-in -H 'content-type: application/json' \
  -d '{"email":"marie@example.com","password":"cagnotte-demo"}'
curl -s localhost:3001/me/wallet -H "authorization: Bearer $TOKEN"
```

Fifty-three routes, each with the least role it needs, in [`docs/api.md`](docs/api.md). A member sees only their own data; an agent also works the claims queue; a manager also runs the imports, the transactions queue, payouts, decisions, the catalogue and the reports. A wallet is the sum of its ledger entries, computed on each request; there is no balance column to drift. Sessions are opaque tokens stored hashed with an expiry. Every body and query is parsed with a zod schema before a use case sees it, and the same schemas run in the app's forms before sending.

## Stack

TypeScript strict throughout, in a pnpm workspace.

- Expo with Expo Router for the app, because one codebase gives iOS, Android and a static web export, and the web export is the demo. React Native Web renders it in the browser; TanStack Query holds the server state, one hook per route.
- Fastify 5 for the API: fast, small, and its hooks are enough for a bearer check, helmet, CORS and a rate limit on `/auth/*`.
- Drizzle for the schema and queries, because the schema is TypeScript, the migration is committed SQL, and the same code runs over node-postgres and over PGlite.
- PostgreSQL 16 in Docker and PGlite in tests and in the browser. PGlite is the same engine compiled to WebAssembly, so the enums, the checks and the SQL are the same in all three places.
- zod for the request schemas, shared between the API and the app's forms.
- Vitest and Testing Library for the tests, fast-check for the properties, Playwright for the end-to-end runs.

Why each choice was made, and what it cost, is in [`docs/decisions/`](docs/decisions/).

## Architecture

The rules live in `packages/domain`, which imports nothing: entities, money and rates as integers, the seven state machines as transition tables, the settlement pipeline, the ports as interfaces, and the use cases as factories that take their ports. `packages/postgres` implements the ports over Drizzle. `packages/handlers` is the API as a table of fifty-three routes with a dispatcher that finds the route, checks the token and the role, parses and calls the use case. The Fastify server in `apps/api` registers that table; the app in demo mode dispatches on it directly, over PGlite in the page, so the demo is the server's composition root without the server. A screen never calls `fetch` or imports the router: it asks hooks, which ask a client, which asks a transport, and the root layout decides both once. The diagrams, the request traced through both paths and the data model are in [`docs/architecture.md`](docs/architecture.md).

## Layout

```
packages/domain     the rules: money, rates, state machines, the use cases, the ledger; ports as interfaces; no framework, no database
packages/contracts  the request schemas (zod), shared by the API and the app's forms
packages/handlers   the routes as a table: method, path, least role, schema, use case; registered by the server, dispatched by the demo
packages/postgres   the Drizzle schema, migrations, seed generator and the ports over PostgreSQL or PGlite
apps/api            the Fastify server: the bearer hook, the error mapping and the route table registered
apps/mobile         the Expo app for iOS, Android and the web; the web export is the demo
docs/               architecture, domain, API, decision records, screenshots
```

## Tests

```
pnpm test        # unit and integration, on PGlite, no database server needed
pnpm build:web   # the web export in demo mode, which the end-to-end runs open
pnpm test:e2e    # the three main workflows in a real browser against that export
```

The end-to-end runs need a browser the test runner can drive: `pnpm -C apps/mobile exec playwright install chromium` once.

`pnpm test` runs 418 tests. The domain tests include property-based ones: the rounding, the matching rules, the cashback computation, and the ledger invariants over random histories of imports, corrections, decisions, payouts and claims. The API tests run every route against the seed on PGlite, with the access matrix (401 without a session, 403 for every lower role) and the forbidden transitions. The app's tests are component tests: every screen rendered with react-native-web in jsdom against a fake transport, the forms submitted and the API's refusals shown; the demo transport has its own tests on PGlite in the test process. The end-to-end runs walk the three workflows the product exists for, on the demo build with nothing mocked: a member activates an offer and takes money out; a member files a claim that support works to a credited cashback; a manager imports a network's file, matches a sale by hand and validates the cashback it booked. Two network export fixtures shaped like the real files live in `packages/domain/test/fixtures/`.

CI (`.github/workflows/ci.yml`) runs lint, typecheck, the tests, both builds and the end-to-end runs on every push.

## What is real and what is simulated

Real: the database, the migrations, the sign-in, the rules, the ledger, the pipeline. Simulated: the affiliate networks (their exports are files shaped like real ones, posted by hand instead of fetched hourly), the merchants (invented names), the money (no payment is ever taken, no real bank account is ever stored; IBANs are masked before they leave the form), the people (generated).

## Known limits and what comes next

- `POST /imports` takes the file as text in a JSON body; there is no multipart upload. The app reads the file and posts its text.
- An unmatched transaction does not store why it matched nobody; the detail route recomputes it, so the queue cannot be filtered by reason.
- Demo mode has no rate limit, no CORS and no request log; those are Fastify's and stay on the server.
- Expired session rows are refused but never deleted.
- An agent raises a claim without linking the sale, because the transactions queue is the manager's; only a manager links it.

Next: a scheduled fetch from the networks in place of the file upload, a filter by no-match reason on the queue, card-linked offers, and push notifications when a cashback validates.
