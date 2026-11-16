# Cagnotte

A cashback app and the back office behind it. Members activate merchant offers, buy, and watch the cashback go from pending to validated to a pot in euros they can pay out. Support agents work the claims for purchases that never tracked. An operations manager imports the affiliate networks' transaction files, watches what matched no activation, releases payouts and reads the margin.

The part I care most about is the settlement pipeline: matching a network's transactions to the activations behind them, computing each cashback by the rules of the offer at activation time, and keeping a double-entry ledger that reconciles to the cent through validations, reversals, claims, referral bonuses and payouts.

This is the fifth evening of six. What exists today is the data model and the seed, the rules and use cases, the settlement pipeline, the whole API, the member's app, the back office for support and operations, demo mode, and the end-to-end runs. The architecture notes, the screenshots and the published demo follow on the last evening.

## Live demo

Published at the end of the week. The demo is the web export of the app in demo mode: the same route table, use cases, migration and seed run in the browser on PGlite (PostgreSQL compiled to WebAssembly), so what it shows is the real code path with no server behind it. The first sign-in loads the engine and about 17,000 rows and takes a few seconds; a reload starts the data over. Sign in as Marie to see the member's side, as Sam for the support queue, as Nadia for the whole back office.

To run it that way yourself: `pnpm build:web`, then serve `apps/mobile/dist` with any static server that falls back to `index.html` (`pnpm -C apps/mobile exec serve -s dist`).

## Running it

Two ways, same code.

With Docker, which starts PostgreSQL 16, the API and the web app:

```
cp .env.example .env
docker compose up
```

By hand:

```
pnpm install
pnpm test
pnpm build
```

The database comes up with the seed loaded: about 17,000 rows of six months of activity, generated from a fixed seed so every run is the same. Demo accounts: `marie@example.com` (member), `sam@example.com` (support agent), `nadia@example.com` (operations manager), all with the password `cagnotte-demo`.

## The app

One Expo app for iOS, Android and the web. A member gets offers to browse and activate, the wallet, claims and referrals. An agent gets the support queue, where a claim is taken, acknowledged, raised with the network and credited or declined, with the member's pot and the proof beside it. A manager gets the whole back office: the dashboard with the three queues, the margin by shop and the reconciliation report; the imports, where a network's file is dropped in and its batch read; the transactions queue, where a sale that matched no click is matched by hand or set aside and the cashback it booked is validated, refused or taken back; the payouts queue; and the catalogue, where offers are written, published, paused, ended and boosted. Each role has its own destinations and its own home. The web export at desktop width shows the screens in a centred column with the destinations in a top bar; on a phone they are a bottom bar.

A screen asks hooks (`useOffers`, `useWallet`, `useMoveClaim`) that go through one client over a transport, and navigates through a small interface the root layout implements with the router; nothing in a screen calls `fetch` or imports the router. Over HTTP the transport is `fetch`; in demo mode it is the API's own route table (`packages/handlers`) dispatched on the use cases over PGlite in the page, with the bodies serialised as the wire would carry them, so a screen cannot tell the two apart. The screens are tested as components: the real screens rendered with react-native-web in jsdom against a fake transport that answers with fixture rows or with the API's own error shape.

The wallet draws the pot as its four buckets, pending, available, reserved and paid out, as one bar at their true proportions. A balance is a sum of ledger entries, so the bar is the ledger seen from above; available is the one coloured segment because it is the money that is really the member's.

Forms validate with the same zod schemas the API parses with, before sending; what the API still refuses (a transfer under 20 €, a claim three months late) comes back as a 422 and the form shows the API's own sentence.

## The API

The server starts on `http://localhost:3001` (`pnpm -C apps/api dev` by hand, or with `docker compose up`). Sign in, then send the token as a bearer header:

```
curl -s localhost:3001/auth/sign-in -H 'content-type: application/json' \
  -d '{"email":"marie@example.com","password":"cagnotte-demo"}'
curl -s localhost:3001/me/wallet -H "authorization: Bearer $TOKEN"
```

Every route, its role and its errors are in `docs/api.md`. Three roles: a member sees only their own data; an agent also works the claims queue; a manager also runs the imports, the transactions queue, payouts, decisions, the catalogue and the reports. A wallet is the sum of its ledger entries, computed on each request; there is no balance column to drift.

## The settlement pipeline

A manager posts a network's export file to `POST /imports`. The file is parsed (Linkpool sends a CSV, Affinet a JSON document; both become the same row, and a row that cannot be read is reported with its line number), deduplicated against earlier files, and each new transaction is matched to the click its `subId` names, provided the click is at the same merchant, before the order and inside the merchant's attribution window. The cashback is the activation's rate on the order, held under the offer's cap and under the network's commission, and booked as ledger entries in the state the network reports. A file about orders already known applies the changes: an approval validates the cashback, a decline refuses or takes it back, an amount change books the difference. Validations pay the referral bonuses. Transactions nothing names stay in a queue, where a claim or a manager can match them by hand.

`GET /reports/reconciliation` recomputes the whole book from the entries and checks it against the cashbacks and payouts. The same checks run in the tests after every step of random histories generated with fast-check. The rules, step by step and with worked examples, are in `docs/domain.md`.

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

## Stack

TypeScript strict throughout, in a pnpm workspace. Expo with Expo Router for the app. Fastify 5 for the API, Drizzle for the schema and queries, PostgreSQL 16 in Docker and PGlite (PostgreSQL compiled to WebAssembly) in tests and in the browser. Vitest and fast-check for the tests, Playwright for the end-to-end runs. Why each piece is there is in `docs/decisions/`.

## Tests

```
pnpm test        # unit and integration, on PGlite, no database server needed
pnpm build:web   # the web export in demo mode, which the end-to-end runs open
pnpm test:e2e    # the three main workflows in a real browser against that export
```

The end-to-end runs need a browser the test runner can drive: `pnpm -C apps/mobile exec playwright install chromium` once.

The app's tests are component tests: every screen rendered with react-native-web against a fake transport, with the forms submitted and the API's refusals shown. The demo transport has its own tests on PGlite in the test process. The end-to-end runs walk the three workflows the product exists for, on the demo build with nothing mocked: a member activates an offer and takes money out; a member files a claim that support works to a credited cashback; a manager imports a network's file, matches a sale by hand and validates the cashback it booked.

The domain tests include property-based ones: the rounding, the matching rules, the cashback computation, and the ledger invariants over random histories of imports, corrections, decisions, payouts and claims. The API tests run every route against the seed on PGlite. Two network export fixtures shaped like the real files live in `packages/domain/test/fixtures/`.

## What is real and what is simulated

Real: the database, the migrations, the sign-in, the rules, the ledger. Simulated: the affiliate networks (their exports are files shaped like real ones), the merchants (invented names), the money (no payment is ever taken, no real bank account is ever stored), the people (generated).

## Status

Evening 5 of 6. See `CHANGELOG.md`.
