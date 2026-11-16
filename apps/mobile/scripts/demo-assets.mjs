import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/*
 * Copies what demo mode fetches at runtime into `public/demo/`, which the web export serves as
 * static files: PGlite's WebAssembly module and data bundle from the installed package, and the
 * committed migration from `packages/postgres`. Run before `expo export`; the folder is not
 * committed.
 */

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
// The package exports only its entry points, so the dist folder is found from the entry itself.
const pgliteDist = dirname(require.resolve("@electric-sql/pglite"));
const migrations = join(here, "../../../packages/postgres/drizzle");
const out = join(here, "../public/demo");

mkdirSync(out, { recursive: true });
for (const [from, name] of [
  [join(pgliteDist, "pglite.wasm"), "pglite.wasm"],
  [join(pgliteDist, "pglite.data"), "pglite.data"],
  [join(pgliteDist, "initdb.wasm"), "initdb.wasm"],
  [join(migrations, "0000_tables.sql"), "0000_tables.sql"],
]) {
  copyFileSync(from, join(out, name));
}
console.log(`demo assets copied to ${out}`);
