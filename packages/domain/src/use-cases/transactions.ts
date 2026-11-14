import type { Activation, Actor, Cashback, MatchStatus, Network, NetworkTransaction } from "../entities.js";
import type { Deps, Member, OfferWithMerchant, Page, PageQuery, TransactionWithMerchant } from "../ports.js";
import { pageQuery } from "../ports.js";
import { fail, notFound, ok, type Result } from "../result.js";
import { chooseActivation, disqualifies, proposeActivations, type NoMatchReason } from "../settlement/match.js";
import { matchTransitions, move } from "../transitions.js";
import { requireRole, writeAudit } from "./access.js";
import { settlementCreator } from "./settlement.js";

/*
 * The transactions queue: what the networks reported, what it matched, and the manager's two
 * hand tools for the rest. "Match" names the click a transaction belongs to when the automatic
 * match could not (no subId, a claim that supplied the order number); "Ignore" sets a transaction
 * aside with a reason. Both are audited and an ignored transaction can still be matched later.
 */

const DAY = 24 * 60 * 60 * 1000;

export interface ListTransactionsQuery extends Partial<PageQuery> {
  match?: MatchStatus | undefined;
  network?: Network | undefined;
  merchant?: string | undefined;
  batch?: string | undefined;
}

export type Proposal = Activation & { offer: OfferWithMerchant; member: Member };

export interface TransactionDetail extends TransactionWithMerchant {
  activation: Proposal | null;
  cashback: Cashback | null;
  /** Why the automatic match did not happen, for an unmatched or ignored transaction. */
  noMatchReason: NoMatchReason | null;
  /** The clicks at the merchant inside the attribution window before the order, latest first. */
  candidates: Proposal[];
}

export function transactionUseCasesCreator(deps: Deps) {
  const { ports, unitOfWork, clock, ids } = deps;
  const settlement = settlementCreator(deps);

  const listTransactions = async (actor: Actor, query: ListTransactionsQuery): Promise<Result<Page<TransactionWithMerchant>>> => {
    const denied = requireRole<Page<TransactionWithMerchant>>(actor, "manager");
    if (denied) return denied;
    return ok(
      await ports.transactions.list({
        ...pageQuery(query),
        ...(query.match ? { matchStatus: query.match } : {}),
        ...(query.network ? { network: query.network } : {}),
        ...(query.merchant ? { merchantId: query.merchant } : {}),
        ...(query.batch ? { batchId: query.batch } : {}),
      }),
    );
  };

  const windowOf = (tx: TransactionWithMerchant) => ({ merchantId: tx.merchantId, attributionDays: tx.merchant.attributionDays, subId: tx.subId, orderedAt: tx.orderedAt });

  /** The matched click with its offer and member, for the detail view. */
  const loadProposal = async (activationId: string): Promise<Proposal | null> => {
    const activation = await ports.activations.findById(activationId);
    if (!activation) return null;
    const [offer, user] = await Promise.all([ports.offers.findById(activation.offerId), ports.users.findById(activation.userId)]);
    if (!offer || !user) return null;
    return { ...activation, offer, member: { id: user.id, email: user.email, displayName: user.displayName } };
  };

  const getTransaction = async (actor: Actor, transactionId: string): Promise<Result<TransactionDetail>> => {
    const denied = requireRole<TransactionDetail>(actor, "manager");
    if (denied) return denied;
    const tx = await ports.transactions.findById(transactionId);
    if (!tx) return notFound("transaction");
    const window = windowOf(tx);
    const clicks = await ports.activations.atMerchantBetween(tx.merchantId, new Date(tx.orderedAt.getTime() - tx.merchant.attributionDays * DAY), tx.orderedAt);
    const activation = tx.activationId ? await loadProposal(tx.activationId) : null;
    const cashback = await ports.cashbacks.findByTransaction(tx.id);
    let noMatchReason: NoMatchReason | null = null;
    if (tx.matchStatus !== "matched") {
      const named = tx.subId ? await ports.activations.findBySubId(tx.subId) : null;
      const outcome = chooseActivation(window, named ? [named] : []);
      noMatchReason = outcome.matched ? null : outcome.reason;
    }
    return ok({ ...tx, activation, cashback, noMatchReason, candidates: tx.matchStatus === "matched" ? [] : proposeActivations(window, clicks) });
  };

  const matchTransaction = async (actor: Actor, transactionId: string, input: { activationId: string }): Promise<Result<NetworkTransaction>> => {
    const denied = requireRole<NetworkTransaction>(actor, "manager");
    if (denied) return denied;
    return unitOfWork.run(async (tx) => {
      const found = await tx.transactions.findById(transactionId);
      if (!found) return notFound("transaction");
      const next = move(matchTransitions, "transaction", found.matchStatus, "matched");
      if (!next.ok) return next;
      const activation = await tx.activations.findById(input.activationId);
      if (!activation) return notFound("activation");
      const offer = await tx.offers.findById(activation.offerId);
      if (!offer) return notFound("offer");
      const why = disqualifies(windowOf(found), { ...activation, offer });
      if (why === "other_merchant") return fail("rule", "that click is at another merchant");
      if (why === "after_order") return fail("rule", "that click happened after the order");
      if (why === "outside_window") return fail("rule", `that click is older than the merchant's ${found.merchant.attributionDays}-day attribution window`);
      if (await tx.cashbacks.findByActivation(activation.id)) return fail("conflict", "that click already has a cashback");
      const { merchant: _merchant, ...row } = found;
      const booked = await settlement.bookTransaction(tx, row, { ...activation, offer }, actor);
      return ok(booked.transaction);
    });
  };

  const ignoreTransaction = async (actor: Actor, transactionId: string, input: { reason: string }): Promise<Result<NetworkTransaction>> => {
    const denied = requireRole<NetworkTransaction>(actor, "manager");
    if (denied) return denied;
    const reason = input.reason.trim();
    if (reason.length === 0) return fail("invalid", "reason is required");
    return unitOfWork.run(async (tx) => {
      const found = await tx.transactions.findById(transactionId);
      if (!found) return notFound("transaction");
      const next = move(matchTransitions, "transaction", found.matchStatus, "ignored");
      if (!next.ok) return next;
      const { merchant: _merchant, ...row } = found;
      const ignored: NetworkTransaction = { ...row, matchStatus: "ignored", ignoreReason: reason };
      await tx.transactions.update(ignored);
      await writeAudit(tx, ids, clock, { actor, action: "transaction.ignore", entityType: "transaction", entityId: found.id, before: { matchStatus: found.matchStatus }, after: { matchStatus: "ignored" }, reason });
      return ok(ignored);
    });
  };

  return { listTransactions, getTransaction, matchTransaction, ignoreTransaction };
}
