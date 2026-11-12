# Cagnotte

A cashback app and the back office behind it. Members activate merchant offers, buy, and watch the cashback go from pending to validated to a pot in euros they can pay out. Support agents work the claims for purchases that never tracked. An operations manager imports the affiliate networks' transaction files, watches what matched no activation, releases payouts and reads the margin.

The part I care most about is the settlement pipeline: matching a network's transactions to the activations behind them, computing each cashback by the rules of the offer at activation time, and keeping a double-entry ledger that reconciles to the cent through validations, reversals, claims, referral bonuses and payouts.

This is the second evening of six. What exists today is the data model and the seed, the rules and use cases, and the API with every route but the settlement pipeline's; the pipeline and the screens follow over the week. The sections below are filled in as the parts land.

## Live demo

Coming at the end of the week. The demo is the web export of the app in demo mode: the same use cases, migration and seed run in the browser on PGlite, so what it shows is the real code path with no server behind it.

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

## The API

The server starts on `http://localhost:3001` (`pnpm -C apps/api dev` by hand, or with `docker compose up`). Sign in, then send the token as a bearer header:

```
curl -s localhost:3001/auth/sign-in -H 'content-type: application/json' \
  -d '{"email":"marie@example.com","password":"cagnotte-demo"}'
curl -s localhost:3001/me/wallet -H "authorization: Bearer $TOKEN"
```

Every route, its role and its errors are in `docs/api.md`. Three roles: a member sees only their own data; an agent also works the claims queue; a manager also runs payouts, decisions, the catalogue and the reports. A wallet is the sum of its ledger entries, computed on each request; there is no balance column to drift.

## Layout

```
packages/domain     the rules: money, rates, state machines, the use cases, the ledger; ports as interfaces; no framework, no database
packages/contracts  the request schemas (zod), shared by the API and the app's forms
packages/postgres   the Drizzle schema, migrations, seed generator and the ports over PostgreSQL or PGlite
apps/api            the Fastify server, the only place HTTP exists
apps/mobile         the Expo app for iOS, Android and the web; the web export is the demo
docs/               architecture, domain, API, decision records, screenshots
```

## Stack

TypeScript strict throughout, in a pnpm workspace. Expo with Expo Router for the app. Fastify 5 for the API, Drizzle for the schema and queries, PostgreSQL 16 in Docker and PGlite (PostgreSQL compiled to WebAssembly) in tests and in the browser. Vitest and fast-check for the tests, Playwright for the end-to-end runs. Why each piece is there is in `docs/decisions/`.

## Tests

```
pnpm test        # unit and integration, on PGlite, no database server needed
```

## What is real and what is simulated

Real: the database, the migrations, the sign-in, the rules, the ledger. Simulated: the affiliate networks (their exports are files shaped like real ones), the merchants (invented names), the money (no payment is ever taken, no real bank account is ever stored), the people (generated).

## Status

Evening 2 of 6. See `CHANGELOG.md`.
