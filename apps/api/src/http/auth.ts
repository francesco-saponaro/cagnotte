import { hasRole, type Actor, type UserRole } from "@cagnotte/domain";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { errorBody } from "./reply.js";

/*
 * `Authorization: Bearer <token>` → the actor, before any parsing or lookup. Each route declares
 * the least role it needs in its config; a lower role is refused with 403 before the handler runs,
 * so a member cannot probe which ids exist behind a staff route.
 */

export function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  return scheme?.toLowerCase() === "bearer" && token ? token : null;
}

export const authPlugin: FastifyPluginAsync = fp(async (app) => {
  app.decorateRequest("actor");
  app.decorateRequest("token");

  app.addHook("preHandler", async (request: FastifyRequest, reply: FastifyReply) => {
    const role = (request.routeOptions.config as { role?: UserRole }).role;
    if (!role) return;
    const token = bearerToken(request);
    const auth = token ? await app.useCases.authenticate(token) : null;
    if (!token || !auth || !auth.ok) return reply.status(401).send(errorBody("unauthorized", "sign in first"));
    if (!hasRole(auth.value.actor, role)) return reply.status(403).send(errorBody("forbidden", `${role} role required`));
    request.actor = auth.value.actor;
    request.token = token;
  });
});

/** The route config that turns the hook on: `{ config: role("agent") }`. */
export const role = (least: UserRole) => ({ role: least });

declare module "fastify" {
  interface FastifyRequest {
    actor: Actor;
    token: string;
  }
  interface FastifyContextConfig {
    role?: UserRole;
  }
}
