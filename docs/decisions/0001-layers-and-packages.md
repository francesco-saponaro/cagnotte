# 1. Three layers, four packages, one composition root per entry point

Date: 2026-11-11

## Context

Cagnotte has to run in two places with the same code: as a Fastify server over PostgreSQL under `docker compose`, and inside the browser for the demo, where the same use cases run on PGlite with the seed loaded. It also has a mobile app that must call the same rules for form validation that the API enforces. If the rules lived in route handlers, neither would be possible.

## Options considered

1. **One package, framework code everywhere.** Routes call Drizzle directly, the app calls the routes. Fastest to write; the demo would need a second implementation of every rule, and the app could not share validation.
2. **Domain, application and infrastructure as three concentric layers, with ports as interfaces and adapters chosen in a composition root.** The domain imports nothing, the application layer imports only the domain, and the infrastructure (Drizzle adapters, Fastify routes, the browser's demo wiring) imports both. The server and the demo are two composition roots over the same use cases.
3. **A dependency-injection framework** to wire the layers.

## Decision

Option 2, without a framework (option 3). The packages:

- `packages/domain`: entities, pure rules (money, rates, the settlement computation, the ledger invariants, the transition tables), ports as TypeScript interfaces, and use cases as factories that take their ports as arguments. No framework, no database, no I/O.
- `packages/postgres`: the Drizzle schema, the migrations, the seed generator, and the repository adapters that implement the ports over a Drizzle handle, which is node-postgres on the server and PGlite in tests and in the browser.
- `apps/api`: the Fastify composition root and the HTTP handlers, the only place a request or reply object exists.
- `apps/mobile`: the Expo app, which talks to the API over HTTP, and in demo mode wires the same use cases to the PGlite adapters in the browser.

Adapters are factories with a `Creator` suffix, use cases are factories, errors inside the domain are returned as values rather than thrown, and tests default to the in-memory or PGlite adapter so `pnpm test` needs no database server.

## Consequences

More files and some interfaces that have a single implementation. Two composition roots to keep in step, which the end-to-end tests on the demo build check. In return, every rule is written once, tested once, and runs unchanged on the server, in the browser and in the app's forms.
