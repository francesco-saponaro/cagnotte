import { fileClaimBody, listCashbacksQuery, listClaimsQuery, listPayoutsQuery, pageQuery, requestPayoutBody } from "@cagnotte/contracts";
import type { UseCases } from "@cagnotte/domain";
import type { FastifyInstance } from "fastify";
import { role } from "../auth.js";
import { send } from "../reply.js";

type IdParams = { Params: { id: string } };

/** Everything under /me is the signed-in member's own data and nothing else. */
export function meRoutes(app: FastifyInstance, useCases: UseCases): void {
  const member = { config: role("member") };

  app.get("/me/activations", member, async (request, reply) => send(reply, await useCases.listActivations(request.actor, pageQuery.parse(request.query))));
  app.get("/me/cashbacks", member, async (request, reply) => send(reply, await useCases.listCashbacks(request.actor, listCashbacksQuery.parse(request.query))));
  app.get<IdParams>("/me/cashbacks/:id", member, async (request, reply) => send(reply, await useCases.getCashback(request.actor, request.params.id)));
  app.get("/me/wallet", member, async (request, reply) => send(reply, await useCases.getWallet(request.actor, pageQuery.parse(request.query))));

  app.get("/me/payouts", member, async (request, reply) => send(reply, await useCases.listPayouts(request.actor, listPayoutsQuery.parse(request.query))));
  app.post("/me/payouts", member, async (request, reply) => send(reply, await useCases.requestPayout(request.actor, requestPayoutBody.parse(request.body)), 201));

  app.get("/me/claims", member, async (request, reply) => send(reply, await useCases.listClaims(request.actor, listClaimsQuery.parse(request.query))));
  app.post("/me/claims", member, async (request, reply) => send(reply, await useCases.fileClaim(request.actor, fileClaimBody.parse(request.body)), 201));
  app.get<IdParams>("/me/claims/:id", member, async (request, reply) => send(reply, await useCases.getClaim(request.actor, request.params.id)));

  app.get("/me/referrals", member, async (request, reply) => send(reply, await useCases.getReferrals(request.actor)));
}
