import type { Route } from "@cagnotte/handlers";
import type { FastifyInstance } from "fastify";
import { role } from "./auth.js";
import { send } from "./reply.js";

/**
 * The route table from `packages/handlers`, registered one by one. Fastify's part is the bearer
 * hook (`auth.ts`), the parsing of the URL and the JSON, and the reply; the handler itself is the
 * same function the browser demo calls.
 */
export function registerRoutes(app: FastifyInstance, routes: Route[]): void {
  for (const route of routes) {
    app.route<{ Params: Record<string, string>; Querystring: Record<string, unknown> }>({
      method: route.method,
      url: route.path,
      config: route.role ? role(route.role) : {},
      handler: async (request, reply) => {
        const result = await route.handle({ params: request.params, query: request.query, body: request.body, actor: route.role ? request.actor : null, token: route.role ? request.token : null });
        return send(reply, result, route.status);
      },
    });
  }
}
