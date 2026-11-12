import { assignClaimBody, auditQuery, createMerchantBody, declineClaimBody, decisionBody, failPayoutBody, listCashbacksQuery, listClaimsQuery, listPayoutsQuery, marginQuery, pageQuery, raiseClaimBody } from "@cagnotte/contracts";
import type { UseCases } from "@cagnotte/domain";
import type { FastifyInstance } from "fastify";
import { role } from "../auth.js";
import { send } from "../reply.js";

type IdParams = { Params: { id: string } };

/** The back office: the claims queue for agents; payouts, decisions, merchants, reports and the audit log for managers. */
export function opsRoutes(app: FastifyInstance, useCases: UseCases): void {
  const agent = { config: role("agent") };
  const manager = { config: role("manager") };

  app.get("/claims", agent, async (request, reply) => send(reply, await useCases.listClaims(request.actor, listClaimsQuery.parse(request.query))));
  app.get<IdParams>("/claims/:id", agent, async (request, reply) => send(reply, await useCases.getClaim(request.actor, request.params.id)));
  app.post<IdParams>("/claims/:id/assign", agent, async (request, reply) => send(reply, await useCases.assignClaim(request.actor, request.params.id, assignClaimBody.parse(request.body))));
  app.post<IdParams>("/claims/:id/acknowledge", agent, async (request, reply) => send(reply, await useCases.acknowledgeClaim(request.actor, request.params.id)));
  app.post<IdParams>("/claims/:id/raise", agent, async (request, reply) => send(reply, await useCases.raiseClaim(request.actor, request.params.id, raiseClaimBody.parse(request.body ?? {}))));
  app.post<IdParams>("/claims/:id/decline", agent, async (request, reply) => send(reply, await useCases.declineClaim(request.actor, request.params.id, declineClaimBody.parse(request.body))));

  app.get<IdParams>("/users/:id/wallet", agent, async (request, reply) => send(reply, await useCases.getWalletOf(request.actor, request.params.id, pageQuery.parse(request.query))));
  app.get<IdParams>("/users/:id/cashbacks", agent, async (request, reply) => send(reply, await useCases.listCashbacksOf(request.actor, request.params.id, listCashbacksQuery.parse(request.query))));

  app.get("/merchants", agent, async (request, reply) => send(reply, await useCases.listMerchants(request.actor)));
  app.post("/merchants", manager, async (request, reply) => send(reply, await useCases.createMerchant(request.actor, createMerchantBody.parse(request.body)), 201));

  app.post<IdParams>("/cashbacks/:id/validate", manager, async (request, reply) => send(reply, await useCases.validateCashback(request.actor, request.params.id, decisionBody.parse(request.body))));
  app.post<IdParams>("/cashbacks/:id/refuse", manager, async (request, reply) => send(reply, await useCases.refuseCashback(request.actor, request.params.id, decisionBody.parse(request.body))));
  app.post<IdParams>("/cashbacks/:id/cancel", manager, async (request, reply) => send(reply, await useCases.cancelCashback(request.actor, request.params.id, decisionBody.parse(request.body))));

  app.get("/payouts", manager, async (request, reply) => send(reply, await useCases.listPayouts(request.actor, listPayoutsQuery.parse(request.query))));
  app.post<IdParams>("/payouts/:id/check", manager, async (request, reply) => send(reply, await useCases.checkPayout(request.actor, request.params.id)));
  app.post<IdParams>("/payouts/:id/send", manager, async (request, reply) => send(reply, await useCases.sendPayout(request.actor, request.params.id)));
  app.post<IdParams>("/payouts/:id/fail", manager, async (request, reply) => send(reply, await useCases.failPayout(request.actor, request.params.id, failPayoutBody.parse(request.body))));

  app.get("/reports/overview", manager, async (request, reply) => send(reply, await useCases.getOverview(request.actor)));
  app.get("/reports/margin", manager, async (request, reply) => send(reply, await useCases.getMargin(request.actor, marginQuery.parse(request.query))));

  app.get("/audit", manager, async (request, reply) => send(reply, await useCases.listAudit(request.actor, auditQuery.parse(request.query))));
}
