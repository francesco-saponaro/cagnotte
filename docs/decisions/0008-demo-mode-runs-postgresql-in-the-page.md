# 8. Demo mode runs PostgreSQL in the page, through the API's own route table

Date: 2026-11-16

## Context

The live demo is a static site with no server. It has to show the real product: sign-in against hashed passwords, the settlement pipeline on a real import, the ledger reconciling, every role's screens. A mock API would show none of that, and a hosted API would be a second deployment to keep alive. The app is built with Expo, whose bundler (Metro) does not know `import.meta.url`, which is how PGlite's loader finds its WebAssembly module and its data bundle next to its own script.

## Options considered

1. **Mock the transport with fixture rows.** Cheap and fast to load; nothing it shows is real, the forms would need their own refusals, and the pipeline could not be demonstrated at all.
2. **Load PGlite's own ESM build at runtime with a dynamic `import(url)` the bundler cannot see**, from a folder copied into the export, and alias the package to a shim for the bundle. Keeps PGlite out of Metro entirely, at the price of a second module graph the bundler cannot type, check or split, and a shim that must track the driver's imports.
3. **Bundle PGlite with Metro and hand it its files.** PGlite accepts the compiled WebAssembly modules and the data bundle as options (`pgliteWasmModule`, `initdbWasmModule`, `fsBundle`), so its loader never has to compute a URL. The build copies those three files and the committed migration into the export's `demo/` folder; the app fetches them, compiles the modules and starts the engine in memory. Metro resolves the Node modules PGlite reaches for in branches the browser never runs (`fs`, `zlib`, `util`, `node:module`) to empty modules in the browser bundle, and keeps them for the static render of the routes, which runs in Node. The database module is imported lazily on the first request, so the bundle that paints the sign-in screen does not carry the engine.
4. **A worker in `public/` that owns PGlite** and answers query messages. The fallback if 3 failed; it did not.

## Decision

Option 3, over the route table of decision 1's second composition root. The routes were pulled out of the Fastify server into `packages/handlers` as data (method, path, least role, the schema from `packages/contracts`, the use case, the success status) with a dispatcher that does what the server's hooks do: find the route, check the token and the role before any lookup, parse, call, map the result to a status. The server registers the table; demo mode is `demoTransportCreator`: the same dispatcher over `drizzlePortsCreator` on the in-page database. Bodies go through `JSON.parse(JSON.stringify(...))` so a screen receives what the wire would carry, with dates as ISO strings, and the same test suite that checks the dispatcher checks that.

The engine starts empty on every page load, so the migration the Docker database runs is applied and the seed generator (the same one `SEED=1` runs on the API) loads about 17,000 rows; about five seconds on a laptop, said on the sign-in screen. Because the database is new on each load while the browser still holds the token from before a reload, the demo writes that token back as a session row (hashed and dated like the real one) when it opens the database, so a reload keeps the member signed in. Nothing else about sessions differs.

## Consequences

The demo is the real code path: the forms are refused by the same zod schemas and the same use cases, an import books the same ledger entries, the reconciliation report is computed from them. What it lacks is the server's rate limit on `/auth/*`, CORS and the request log, which are Fastify's and are documented as such. The export carries 15 MB of PGlite files that the browser downloads once per visit; the data is gone on reload by design, so the demo always starts from the seed. The demo transport, the loader and the session restore are the only files that know PGlite is in the page; a screen cannot tell.
