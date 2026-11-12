import { signInBody, signUpBody } from "@cagnotte/contracts";
import type { UseCases } from "@cagnotte/domain";
import type { FastifyInstance } from "fastify";
import { role } from "../auth.js";
import { send } from "../reply.js";

/** Sign-up, sign-in and sign-out share one rate limit per address (see app.ts). */
export function authRoutes(app: FastifyInstance, useCases: UseCases): void {
  app.post("/auth/sign-up", async (request, reply) => send(reply, await useCases.signUp(signUpBody.parse(request.body)), 201));

  app.post("/auth/sign-in", async (request, reply) => send(reply, await useCases.signIn(signInBody.parse(request.body))));

  app.post("/auth/sign-out", { config: role("member") }, async (request, reply) => send(reply, await useCases.signOut(request.token), 204));

  app.get("/me", { config: role("member") }, async (request, reply) => send(reply, await useCases.me(request.actor)));
}
