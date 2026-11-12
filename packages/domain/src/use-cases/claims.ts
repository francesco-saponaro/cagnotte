import { CLAIM_DECLINE_REASONS, type Actor, type Claim, type ClaimDeclineReason, type ClaimStatus } from "../entities.js";
import type { ClaimWithOffer, Deps, Page, PageQuery, Ports } from "../ports.js";
import { pageQuery } from "../ports.js";
import { fail, forbidden, notFound, ok, type Result } from "../result.js";
import { claimTransitions, move } from "../transitions.js";
import { hasRole, requireRole, writeAudit } from "./access.js";

/*
 * "Something missing?": a member says they bought and nothing appeared. The claim is filed against
 * an activation the member really made before the order, inside the window the terms allow, and
 * then worked by an agent through acknowledged, raised with the network, and credited or declined.
 * The credit step, which creates the cashback, lands with the settlement pipeline.
 */

export interface FileClaimInput {
  offerId: string;
  orderRef: string;
  orderedAt: Date;
  orderCents: number;
  proofText: string;
}

export interface ListClaimsQuery extends Partial<PageQuery> {
  status?: ClaimStatus | undefined;
  assignee?: string | undefined;
  q?: string | undefined;
}

export const CLAIM_WINDOW_DAYS = 92;
const DAY = 24 * 60 * 60 * 1000;

const stripJoins = (claim: ClaimWithOffer): Claim => {
  const { offer: _offer, member: _member, ...row } = claim;
  return row;
};

export function claimUseCasesCreator(deps: Deps) {
  const { ports, unitOfWork, clock, ids } = deps;

  const fileClaim = async (actor: Actor, input: FileClaimInput): Promise<Result<Claim>> => {
    const orderRef = input.orderRef.trim();
    const proofText = input.proofText.trim();
    if (orderRef.length === 0) return fail("invalid", "order reference is required");
    if (proofText.length === 0) return fail("invalid", "paste the order confirmation as proof");
    if (!Number.isSafeInteger(input.orderCents) || input.orderCents < 0) return fail("invalid", "order amount must be a number of cents");
    const now = clock.now();
    if (input.orderedAt.getTime() > now.getTime()) return fail("invalid", "the order date is in the future");
    const offer = await ports.offers.findById(input.offerId);
    if (!offer || offer.status === "draft") return notFound("offer");
    if (offer.kind === "online" && now.getTime() - input.orderedAt.getTime() > CLAIM_WINDOW_DAYS * DAY) return fail("rule", "a claim must be filed within three months of the order");
    const activation = await ports.activations.latestBefore(actor.id, offer.id, input.orderedAt);
    if (!activation) return fail("rule", "no activation of this offer before the order; cashback needs the offer activated first");
    const claim: Claim = {
      id: ids.id("clm_"),
      userId: actor.id,
      offerId: offer.id,
      orderRef,
      orderedAt: input.orderedAt,
      orderCents: input.orderCents,
      proofText,
      status: "filed",
      assigneeId: null,
      networkTransactionId: null,
      cashbackId: null,
      declineReason: null,
      filedAt: now,
      updatedAt: now,
    };
    await unitOfWork.run(async (tx) => {
      await tx.claims.insert(claim);
      await writeAudit(tx, ids, clock, { actor, action: "claim.file", entityType: "claim", entityId: claim.id, after: { status: "filed", activationId: activation.id } });
    });
    return ok(claim);
  };

  const listClaims = async (actor: Actor, query: ListClaimsQuery): Promise<Result<Page<ClaimWithOffer>>> => {
    const filter = {
      ...pageQuery(query),
      ...(query.status ? { status: query.status } : {}),
      ...(query.assignee ? { assigneeId: query.assignee } : {}),
      ...(query.q ? { q: query.q } : {}),
    };
    return ok(await ports.claims.list(hasRole(actor, "agent") ? filter : { ...filter, userId: actor.id }));
  };

  const getClaim = async (actor: Actor, claimId: string): Promise<Result<ClaimWithOffer>> => {
    const claim = await ports.claims.findById(claimId);
    if (!claim) return notFound("claim");
    if (claim.userId !== actor.id && !hasRole(actor, "agent")) return forbidden();
    return ok(claim);
  };

  async function transitionClaim(actor: Actor, claimId: string, to: ClaimStatus, action: string, prepare: (tx: Ports, claim: ClaimWithOffer) => Promise<Result<Partial<Claim>>>, reason: string | null = null): Promise<Result<Claim>> {
    const denied = requireRole<Claim>(actor, "agent");
    if (denied) return denied;
    return unitOfWork.run(async (tx) => {
      const claim = await tx.claims.findById(claimId);
      if (!claim) return notFound("claim");
      const next = move(claimTransitions, "claim", claim.status, to);
      if (!next.ok) return next;
      const changes = await prepare(tx, claim);
      if (!changes.ok) return changes;
      const updated: Claim = { ...stripJoins(claim), ...changes.value, status: to, updatedAt: clock.now() };
      await tx.claims.update(updated);
      await writeAudit(tx, ids, clock, { actor, action, entityType: "claim", entityId: claim.id, before: { status: claim.status }, after: { status: to }, reason });
      return ok(updated);
    });
  }

  const assignClaim = async (actor: Actor, claimId: string, input: { assigneeId: string }): Promise<Result<Claim>> => {
    const denied = requireRole<Claim>(actor, "agent");
    if (denied) return denied;
    return unitOfWork.run(async (tx) => {
      const claim = await tx.claims.findById(claimId);
      if (!claim) return notFound("claim");
      if (claim.status === "credited" || claim.status === "declined") return fail("conflict", `a ${claim.status} claim cannot be assigned`);
      const assignee = await tx.users.findById(input.assigneeId);
      if (!assignee) return notFound("assignee");
      if (!hasRole(assignee, "agent")) return fail("rule", "a claim can only be assigned to an agent or a manager");
      const updated: Claim = { ...stripJoins(claim), assigneeId: assignee.id, updatedAt: clock.now() };
      await tx.claims.update(updated);
      await writeAudit(tx, ids, clock, { actor, action: "claim.assign", entityType: "claim", entityId: claim.id, before: { assigneeId: claim.assigneeId }, after: { assigneeId: assignee.id } });
      return ok(updated);
    });
  };

  const acknowledgeClaim = (actor: Actor, claimId: string) =>
    transitionClaim(actor, claimId, "acknowledged", "claim.acknowledge", async (_tx, claim) => ok({ assigneeId: claim.assigneeId ?? actor.id }));

  const raiseClaim = (actor: Actor, claimId: string, input: { networkTransactionId?: string | undefined }) =>
    transitionClaim(actor, claimId, "raised", "claim.raise", async (tx, claim) => {
      if (!input.networkTransactionId) return ok({ assigneeId: claim.assigneeId ?? actor.id });
      const transaction = await tx.transactions.findById(input.networkTransactionId);
      if (!transaction) return notFound("transaction");
      if (transaction.merchantId !== claim.offer.merchantId) return fail("rule", "that transaction is at another merchant");
      if (transaction.matchStatus === "matched") return fail("rule", "that transaction is already matched to an activation");
      return ok({ assigneeId: claim.assigneeId ?? actor.id, networkTransactionId: transaction.id });
    });

  const declineClaim = (actor: Actor, claimId: string, input: { reason: ClaimDeclineReason }): Promise<Result<Claim>> => {
    if (!CLAIM_DECLINE_REASONS.includes(input.reason)) return Promise.resolve(fail("invalid", `reason must be one of ${CLAIM_DECLINE_REASONS.join(", ")}`));
    return transitionClaim(actor, claimId, "declined", "claim.decline", async (_tx, claim) => ok({ assigneeId: claim.assigneeId ?? actor.id, declineReason: input.reason }), input.reason);
  };

  return { fileClaim, listClaims, getClaim, assignClaim, acknowledgeClaim, raiseClaim, declineClaim };
}
