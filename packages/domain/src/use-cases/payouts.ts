import { PAYOUT_MINIMUM_CENTS, TRANSFER_STEP_CENTS, type Actor, type Payout, type PayoutMethod, type PayoutStatus } from "../entities.js";
import { formatEuros } from "../money.js";
import type { Deps, Page, PageQuery, PayoutWithMember } from "../ports.js";
import { pageQuery } from "../ports.js";
import { fail, forbidden, notFound, ok, type Result } from "../result.js";
import { move, payoutTransitions } from "../transitions.js";
import { hasRole, requireRole, writeAudit } from "./access.js";
import { ledgerWriterCreator } from "./ledger.js";

/*
 * Cashing out. A request moves the amount from available to reserved at once, so two requests
 * cannot spend the same euro; sending moves it to paid, failing gives it back.
 */

export interface RequestPayoutInput {
  method: PayoutMethod;
  amountCents: number;
  /** A masked IBAN, a gift-card brand or a charity: never a real account. */
  destination: string;
}

export interface ListPayoutsQuery extends Partial<PageQuery> {
  status?: PayoutStatus | undefined;
}

export function payoutUseCasesCreator(deps: Deps) {
  const { ports, unitOfWork, clock, ids } = deps;
  const ledger = ledgerWriterCreator(ids, clock);

  const requestPayout = async (actor: Actor, input: RequestPayoutInput): Promise<Result<Payout>> => {
    const destination = input.destination.trim();
    if (destination.length === 0) return fail("invalid", "destination is required");
    if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) return fail("invalid", "amount must be a positive number of cents");
    const minimum = PAYOUT_MINIMUM_CENTS[input.method];
    if (input.amountCents < minimum) return fail("rule", `the minimum for this method is ${formatEuros(minimum)}`);
    if (input.method === "transfer" && input.amountCents % TRANSFER_STEP_CENTS !== 0) return fail("rule", `a transfer is a multiple of ${formatEuros(TRANSFER_STEP_CENTS)}`);
    return unitOfWork.run(async (tx) => {
      const balances = await tx.ledger.balances(actor.id);
      if (balances.available < input.amountCents) return fail("rule", `only ${formatEuros(balances.available)} is available`);
      const payout: Payout = {
        id: ids.id("pay_"),
        userId: actor.id,
        method: input.method,
        amountCents: input.amountCents,
        destination,
        status: "requested",
        requestedAt: clock.now(),
        checkedAt: null,
        sentAt: null,
        failedReason: null,
      };
      await tx.payouts.insert(payout);
      await tx.ledger.insert(ledger.transfer({ userId: actor.id, kind: "payout_reserved", refType: "payout", refId: payout.id }, "available", "reserved", payout.amountCents));
      await writeAudit(tx, ids, clock, { actor, action: "payout.request", entityType: "payout", entityId: payout.id, after: { status: "requested", amountCents: payout.amountCents, method: payout.method } });
      return ok(payout);
    });
  };

  const listPayouts = async (actor: Actor, query: ListPayoutsQuery): Promise<Result<Page<PayoutWithMember>>> => {
    const filter = { ...pageQuery(query), ...(query.status ? { status: query.status } : {}) };
    // Members see their own; managers see the queue. An agent has no business with payouts.
    const page = await ports.payouts.list(hasRole(actor, "manager") ? filter : { ...filter, userId: actor.id });
    return ok(page);
  };

  async function transitionPayout(actor: Actor, payoutId: string, to: PayoutStatus, apply: (payout: Payout) => Payout, reason: string | null = null): Promise<Result<Payout>> {
    const denied = requireRole<Payout>(actor, "manager");
    if (denied) return denied;
    return unitOfWork.run(async (tx) => {
      const payout = await tx.payouts.findById(payoutId);
      if (!payout) return notFound("payout");
      const next = move(payoutTransitions, "payout", payout.status, to);
      if (!next.ok) return next;
      const updated = apply({ ...payout, status: to });
      await tx.payouts.update(updated);
      const movement = { userId: payout.userId, kind: `payout_${to === "sent" ? "sent" : "failed"}` as const, refType: "payout" as const, refId: payout.id, createdBy: actor.id };
      if (to === "sent") await tx.ledger.insert(ledger.transfer(movement, "reserved", "paid", payout.amountCents));
      if (to === "failed") await tx.ledger.insert(ledger.transfer(movement, "reserved", "available", payout.amountCents));
      await writeAudit(tx, ids, clock, { actor, action: `payout.${to === "checking" ? "check" : to === "sent" ? "send" : "fail"}`, entityType: "payout", entityId: payout.id, before: { status: payout.status }, after: { status: to }, reason });
      return ok(updated);
    });
  }

  const checkPayout = (actor: Actor, payoutId: string) => transitionPayout(actor, payoutId, "checking", (p) => ({ ...p, checkedAt: clock.now() }));
  const sendPayout = (actor: Actor, payoutId: string) => transitionPayout(actor, payoutId, "sent", (p) => ({ ...p, sentAt: clock.now() }));
  const failPayout = (actor: Actor, payoutId: string, input: { reason: string }): Promise<Result<Payout>> => {
    const reason = input.reason.trim();
    if (reason.length === 0) return Promise.resolve(fail("invalid", "reason is required"));
    return transitionPayout(actor, payoutId, "failed", (p) => ({ ...p, failedReason: reason }), reason);
  };

  const getPayout = async (actor: Actor, payoutId: string): Promise<Result<Payout>> => {
    const payout = await ports.payouts.findById(payoutId);
    if (!payout) return notFound("payout");
    if (payout.userId !== actor.id && !hasRole(actor, "manager")) return forbidden();
    return ok(payout);
  };

  return { requestPayout, listPayouts, getPayout, checkPayout, sendPayout, failPayout };
}
