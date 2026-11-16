import { PGlite } from "@electric-sql/pglite";
import { generateSeed, seedDatabase } from "@cagnotte/postgres/seed";
import * as schema from "@cagnotte/postgres/schema";
import type { Db } from "@cagnotte/postgres/db";
import { drizzle } from "drizzle-orm/pglite";

/*
 * PostgreSQL in the page. The build copies PGlite's WebAssembly module, its data bundle and the
 * committed migration into the export's `demo/` folder; this file fetches them, starts the engine
 * in memory, applies the same migration the Docker database runs, and loads the same seed. The
 * handles that the bundler would otherwise have to find next to its own scripts are passed in,
 * so nothing in PGlite's loader has to guess a URL. The database lives until the page is closed,
 * so the demo starts clean on every visit.
 */

export const DEMO_ASSETS_URL = "/demo";

export interface DemoAssets {
  pgliteWasmModule: WebAssembly.Module;
  initdbWasmModule: WebAssembly.Module;
  fsBundle: Blob;
  migration: string;
}

async function fetchOk(url: string): Promise<Response> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response;
}

export async function fetchDemoAssets(base = DEMO_ASSETS_URL): Promise<DemoAssets> {
  const [pglite, initdb, data, migration] = await Promise.all([
    fetchOk(`${base}/pglite.wasm`).then((r) => r.arrayBuffer()),
    fetchOk(`${base}/initdb.wasm`).then((r) => r.arrayBuffer()),
    fetchOk(`${base}/pglite.data`).then((r) => r.blob()),
    fetchOk(`${base}/0000_tables.sql`).then((r) => r.text()),
  ]);
  const [pgliteWasmModule, initdbWasmModule] = await Promise.all([WebAssembly.compile(pglite), WebAssembly.compile(initdb)]);
  return { pgliteWasmModule, initdbWasmModule, fsBundle: data, migration };
}

/** The engine with the schema applied and the seed loaded: the state `docker compose up` starts from. */
export async function openDemoDatabase(assets: DemoAssets): Promise<Db> {
  const client = new PGlite({ pgliteWasmModule: assets.pgliteWasmModule, initdbWasmModule: assets.initdbWasmModule, fsBundle: assets.fsBundle });
  await client.waitReady;
  await client.exec(assets.migration);
  const db = drizzle(client, { schema });
  await seedDatabase(db, await generateSeed());
  return db;
}
