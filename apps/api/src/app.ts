import Fastify, { type FastifyInstance } from "fastify";
import type { Db } from "@cagnotte/postgres";

export interface AppOptions {
  db: Db;
  webOrigin: string | null;
}

/**
 * The HTTP server. This file and the route files next to it are the only places a Fastify object
 * exists; the use cases take plain arguments, so the browser demo can call them without a server.
 */
export function buildApp(options: AppOptions): FastifyInstance {
  const app = Fastify({ logger: false });
  app.decorate("db", options.db);

  app.get("/health", async () => ({ ok: true }));

  return app;
}

declare module "fastify" {
  interface FastifyInstance {
    db: Db;
  }
}
