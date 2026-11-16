import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { cryptoIdGeneratorCreator, systemClock, useCasesCreator, type Clock, type IdGenerator, type UseCases } from "@cagnotte/domain";
import { invalidResponse, routesCreator } from "@cagnotte/handlers";
import { drizzlePortsCreator, type Db } from "@cagnotte/postgres";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { authPlugin } from "./auth.js";
import { errorBody, statusOf } from "./reply.js";
import { registerRoutes } from "./routes.js";

export interface AppOptions {
  db: Db;
  /** The web app's origin for CORS; null means same origin only. */
  webOrigin: string | null;
  sessionHours: number;
  clock?: Clock;
  ids?: IdGenerator;
  /** How many requests one address may make to `/auth/*` per window. */
  authRateLimit?: { max: number; timeWindow: string };
}

/**
 * The composition root of the server. This folder is the only place a Fastify request or reply
 * exists. The routes themselves are the table in `packages/handlers`: the browser demo dispatches
 * on the same table over PGlite and skips this file entirely.
 */
export function buildApp(options: AppOptions): FastifyInstance {
  const { ports, unitOfWork } = drizzlePortsCreator(options.db);
  const useCases = useCasesCreator({ ports, unitOfWork, clock: options.clock ?? systemClock, ids: options.ids ?? cryptoIdGeneratorCreator(), sessionHours: options.sessionHours });

  const app = Fastify({ logger: false });
  app.decorate("useCases", useCases);

  app.register(cors, { origin: options.webOrigin ?? false, methods: ["GET", "POST", "PATCH", "OPTIONS"] });
  // One counter per address across every /auth route, so a brute force cannot split itself between sign-in and sign-up.
  const authRateLimit = options.authRateLimit ?? { max: 20, timeWindow: "1 minute" };
  app.register(rateLimit, { ...authRateLimit, allowList: (request) => !request.url.startsWith("/auth/") });
  app.register(authPlugin);

  app.setNotFoundHandler((_req, reply) => reply.status(404).send(errorBody("not_found", "no such route")));
  app.setErrorHandler((error: unknown, _req, reply) => {
    if (error instanceof ZodError) {
      const invalid = invalidResponse(error);
      return reply.status(invalid.status).send(invalid.body);
    }
    const status = (error as { statusCode?: number }).statusCode;
    if (status === 429) return reply.status(429).send(errorBody("rate_limited", "too many requests, try again in a minute"));
    if (status && status >= 400 && status < 500) return reply.status(status).send(errorBody("invalid", (error as Error).message));
    app.log.error(error);
    return reply.status(statusOf("internal")).send(errorBody("internal", "something went wrong on our side"));
  });

  app.get("/health", async () => ({ ok: true }));
  app.register(async (scope) => registerRoutes(scope, routesCreator(useCases)));

  return app;
}

declare module "fastify" {
  interface FastifyInstance {
    useCases: UseCases;
  }
}
