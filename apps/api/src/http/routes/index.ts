import type { UseCases } from "@cagnotte/domain";
import type { FastifyInstance } from "fastify";
import { authRoutes } from "./auth.js";
import { meRoutes } from "./me.js";
import { offerRoutes } from "./offers.js";
import { opsRoutes } from "./ops.js";

export function registerRoutes(app: FastifyInstance, useCases: UseCases): void {
  authRoutes(app, useCases);
  offerRoutes(app, useCases);
  meRoutes(app, useCases);
  opsRoutes(app, useCases);
}
