# Changelog

## 2026-11-11

- Workspace: pnpm, TypeScript strict, ESLint, Vitest, a CI workflow, `docker compose` with PostgreSQL 16, the API and the web app, `.env.example`.
- `packages/domain`: money as integer cents and basis points (`applyRate`, `percentToBps`, `parseEuros`, `formatEuros`), the rate in force on an offer with boosts, scrypt password hashing and the password rule.
- `packages/postgres`: the fourteen tables as a Drizzle schema with enums, foreign keys, unique and check constraints; the first migration; `connect` over node-postgres and `connectPglite` in memory; a seed generator that produces about 17,000 coherent rows from a fixed seed, with tests for determinism, constraints, matching, computation and the ledger.
- `apps/api`: the server skeleton with its configuration and a health route.
- `apps/mobile`: the Expo app shell with Expo Router and the web export.
- Decision records 1 (layers and packages) and 2 (money as integer cents).
