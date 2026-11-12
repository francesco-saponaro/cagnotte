import { addBoostBody, createOfferBody, listOffersQuery, updateOfferBody } from "@cagnotte/contracts";
import type { UseCases } from "@cagnotte/domain";
import type { FastifyInstance } from "fastify";
import { role } from "../auth.js";
import { send } from "../reply.js";

type IdParams = { Params: { id: string } };

export function offerRoutes(app: FastifyInstance, useCases: UseCases): void {
  // Members browse live offers; a manager may ask for every status with `all=1`.
  app.get("/offers", { config: role("member") }, async (request, reply) => send(reply, await useCases.listOffers(request.actor, listOffersQuery.parse(request.query))));
  app.get<IdParams>("/offers/:id", { config: role("member") }, async (request, reply) => send(reply, await useCases.getOffer(request.actor, request.params.id)));
  app.post<IdParams>("/offers/:id/activate", { config: role("member") }, async (request, reply) => send(reply, await useCases.activateOffer(request.actor, request.params.id), 201));

  // The catalogue, for managers.
  app.post("/offers", { config: role("manager") }, async (request, reply) => send(reply, await useCases.createOffer(request.actor, createOfferBody.parse(request.body)), 201));
  app.patch<IdParams>("/offers/:id", { config: role("manager") }, async (request, reply) => send(reply, await useCases.updateOffer(request.actor, request.params.id, updateOfferBody.parse(request.body))));
  app.post<IdParams>("/offers/:id/publish", { config: role("manager") }, async (request, reply) => send(reply, await useCases.publishOffer(request.actor, request.params.id)));
  app.post<IdParams>("/offers/:id/pause", { config: role("manager") }, async (request, reply) => send(reply, await useCases.pauseOffer(request.actor, request.params.id)));
  app.post<IdParams>("/offers/:id/resume", { config: role("manager") }, async (request, reply) => send(reply, await useCases.resumeOffer(request.actor, request.params.id)));
  app.post<IdParams>("/offers/:id/end", { config: role("manager") }, async (request, reply) => send(reply, await useCases.endOffer(request.actor, request.params.id)));
  app.post<IdParams>("/offers/:id/boosts", { config: role("manager") }, async (request, reply) => send(reply, await useCases.addBoost(request.actor, request.params.id, addBoostBody.parse(request.body)), 201));
}
