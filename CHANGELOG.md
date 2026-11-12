# Changelog

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
