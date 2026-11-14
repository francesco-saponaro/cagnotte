import type { Activation, Actor, Cashback, CashbackStatus, DecidedBy, NetworkTransaction, Referral } from "../entities.js";
import { applyRate, formatEuros } from "../money.js";
import type { Deps, OfferWithMerchant, Ports } from "../ports.js";
import { fail, ok, type Result } from "../result.js";
import { computeCashback, type Computation, type IgnoreReason } from "../settlement/compute.js";
import { cashbackTransitions, move, referralTransitions } from "../transitions.js";
import { writeAudit } from "./access.js";
import { ledgerWriterCreator } from "./ledger.js";

/*
 * The booking half of the settlement: how a matched transaction becomes a cashback and ledger
 * entries, how a cashback changes status, how its amount is corrected, and when the referral
 * bonuses are paid. The import pipeline, the manual match, the manager's decisions and the claim
 * credit all come through here, so the wallet cannot tell who decided; it only sees entries that
 * net to each cashback's status.
 */

const DAY = 24 * 60 * 60 * 1000;

/** The referee must collect this much validated cashback for the referral to count. */
export const REFERRAL_THRESHOLD_CENTS = 500;
/** What the referee gets when the referral validates. */
export const REFEREE_BONUS_CENTS = 500;
/** What the referrer gets when the referral validates. */
export const REFERRER_BONUS_CENTS = 2000;
/** The referrer's share of the referee's cashback for a year after. */
export const REFERRAL_SHARE_BPS = 1000;
export const REFERRAL_BONUS_DAYS = 365;

export type ActivationForBooking = Activation & { offer: OfferWithMerchant };

export interface StatusChange {
  decidedBy: DecidedBy;
  reason: string | null;
  actor: Actor | null;
  action: string;
}

export const IGNORE_MESSAGES: Record<IgnoreReason, string> = {
  below_minimum: "the order is below the offer's minimum spend",
  not_new_customer: "the offer is for new customers and the member already earned cashback at this merchant",
  no_commission: "the network pays no commission on this order",
  zero_amount: "the offer's rate on this order rounds to nothing",
};

export function settlementCreator(deps: Deps) {
  const { clock, ids } = deps;
  const ledger = ledgerWriterCreator(ids, clock);

  const computeFor = async (tx: Ports, activation: ActivationForBooking, orderCents: number, commissionCents: number | null): Promise<Computation> =>
    computeCashback({
      rateKind: activation.offer.rateKind,
      rateBps: activation.rateBps,
      fixedCents: activation.offer.fixedCents,
      minSpendCents: activation.offer.minSpendCents,
      capCents: activation.offer.capCents,
      newCustomersOnly: activation.offer.newCustomersOnly,
      orderCents,
      commissionCents,
      alreadyCustomer: await tx.cashbacks.hasValidatedAt(activation.userId, activation.offer.merchantId),
    });

  /**
   * A transaction matched to a click: compute, then book a cashback in the state the network
   * reports, or mark the transaction ignored when the offer's rules exclude the order.
   */
  async function bookTransaction(tx: Ports, transaction: NetworkTransaction, activation: ActivationForBooking, actor: Actor | null): Promise<{ transaction: NetworkTransaction; cashback: Cashback | null }> {
    const now = clock.now();
    const computation = await computeFor(tx, activation, transaction.orderCents, transaction.commissionCents);
    if (computation.kind === "ignored") {
      const ignored: NetworkTransaction = { ...transaction, matchStatus: "ignored", activationId: activation.id, ignoreReason: computation.reason };
      await tx.transactions.update(ignored);
      await writeAudit(tx, ids, clock, { actor, action: "transaction.ignore", entityType: "transaction", entityId: transaction.id, before: { matchStatus: transaction.matchStatus }, after: { matchStatus: "ignored", activationId: activation.id }, reason: computation.reason });
      return { transaction: ignored, cashback: null };
    }
    const matched: NetworkTransaction = { ...transaction, matchStatus: "matched", activationId: activation.id, ignoreReason: null };
    await tx.transactions.update(matched);
    await writeAudit(tx, ids, clock, { actor, action: "transaction.match", entityType: "transaction", entityId: transaction.id, before: { matchStatus: transaction.matchStatus }, after: { matchStatus: "matched", activationId: activation.id } });
    const cashback: Cashback = {
      id: ids.id("cb_"),
      userId: activation.userId,
      offerId: activation.offerId,
      activationId: activation.id,
      networkTransactionId: transaction.id,
      orderCents: transaction.orderCents,
      rateBps: activation.rateBps,
      amountCents: computation.amountCents,
      marginClamped: computation.marginClamped,
      status: "pending",
      decidedBy: null,
      decisionReason: null,
      expectedValidationAt: new Date(transaction.orderedAt.getTime() + activation.offer.validationDays * DAY),
      validatedAt: null,
      decidedAt: null,
      createdAt: now,
    };
    await tx.cashbacks.insert(cashback);
    const base = { userId: cashback.userId, refType: "cashback" as const, refId: cashback.id, createdBy: actor?.id ?? null };
    await tx.ledger.insert(ledger.credit({ ...base, kind: "cashback_pending" }, "pending", cashback.amountCents));
    await writeAudit(tx, ids, clock, { actor, action: "cashback.create", entityType: "cashback", entityId: cashback.id, after: { status: "pending", amountCents: cashback.amountCents, marginClamped: cashback.marginClamped } });
    // The network may already have decided by the time the file reaches us.
    const decided = await followNetwork(tx, cashback, transaction.networkStatus, actor);
    return { transaction: matched, cashback: decided.ok ? decided.value : cashback };
  }

  /** Moves a cashback the way the network's status says, if it says anything new. */
  async function followNetwork(tx: Ports, cashback: Cashback, networkStatus: NetworkTransaction["networkStatus"], actor: Actor | null): Promise<Result<Cashback>> {
    if (networkStatus === "approved" && cashback.status === "pending") return changeStatus(tx, cashback, "validated", { decidedBy: "network", reason: null, actor, action: "cashback.validate" });
    if (networkStatus === "declined" && cashback.status === "pending") return changeStatus(tx, cashback, "refused", { decidedBy: "network", reason: "declined_by_network", actor, action: "cashback.refuse" });
    if (networkStatus === "declined" && cashback.status === "validated") return changeStatus(tx, cashback, "cancelled", { decidedBy: "network", reason: "declined_by_network", actor, action: "cashback.cancel" });
    return ok(cashback);
  }

  /** The one way a cashback changes status: the transition table, the entries, the row, the audit, the referral step. */
  async function changeStatus(tx: Ports, cashback: Cashback, to: CashbackStatus, change: StatusChange): Promise<Result<Cashback>> {
    const next = move(cashbackTransitions, "cashback", cashback.status, to);
    if (!next.ok) return next;
    const entries = await bookDecision(tx, ledger, change.actor, cashback, to);
    if (!entries.ok) return entries;
    const now = clock.now();
    const updated: Cashback = { ...cashback, status: to, decidedBy: change.decidedBy, decisionReason: change.reason, decidedAt: now, validatedAt: to === "validated" ? now : cashback.validatedAt };
    await tx.cashbacks.update(updated);
    await tx.ledger.insert(entries.value);
    await writeAudit(tx, ids, clock, { actor: change.actor, action: change.action, entityType: "cashback", entityId: cashback.id, before: { status: cashback.status }, after: { status: to }, reason: change.reason });
    if (to === "validated") await payReferralBonuses(tx, updated, change.actor);
    return ok(updated);
  }

  /** The network corrected the order: re-book the difference where the money is now. */
  async function adjustAmount(tx: Ports, cashback: Cashback, orderCents: number, computation: Extract<Computation, { kind: "cashback" }>, actor: Actor | null): Promise<Result<Cashback>> {
    const diff = computation.amountCents - cashback.amountCents;
    const updated: Cashback = { ...cashback, orderCents, amountCents: computation.amountCents, marginClamped: computation.marginClamped };
    if (diff !== 0) {
      const movement = { userId: cashback.userId, kind: "cashback_adjusted" as const, refType: "cashback" as const, refId: cashback.id, createdBy: actor?.id ?? null };
      if (cashback.status === "pending") await tx.ledger.insert(diff > 0 ? ledger.credit(movement, "pending", diff) : ledger.reverse(movement, "pending", -diff));
      else if (cashback.status === "validated") {
        if (diff < 0) {
          const balances = await tx.ledger.balances(cashback.userId);
          if (balances.available < -diff) return fail("rule", `only ${formatEuros(balances.available)} is still available; ${formatEuros(-diff)} cannot be taken back`);
        }
        await tx.ledger.insert(diff > 0 ? ledger.credit(movement, "available", diff) : ledger.reverse(movement, "available", -diff));
      }
      // Refused or cancelled: the entries already net to zero and stay so; only the record changes.
    }
    await tx.cashbacks.update(updated);
    await writeAudit(tx, ids, clock, { actor, action: "cashback.adjust", entityType: "cashback", entityId: cashback.id, before: { orderCents: cashback.orderCents, amountCents: cashback.amountCents }, after: { orderCents, amountCents: computation.amountCents } });
    return ok(updated);
  }

  /**
   * After a validation: a pending referral validates once the referee has collected the
   * threshold (both sides are paid), and a validated one earns the referrer a share for a year.
   * The cashback that validates the referral does not also pay the share.
   */
  async function payReferralBonuses(tx: Ports, cashback: Cashback, actor: Actor | null): Promise<void> {
    if (cashback.decidedBy === "claim") return;
    const referral = await tx.referrals.findByReferee(cashback.userId);
    if (!referral) return;
    const now = clock.now();
    const bonus = (userId: string, amountCents: number, note: string) => ledger.credit({ userId, kind: "referral_bonus", refType: "referral", refId: referral.id, note, createdBy: actor?.id ?? null }, "available", amountCents);
    if (referral.status === "pending") {
      if (referral.expiresAt && referral.expiresAt.getTime() <= now.getTime()) {
        await expireReferral(tx, referral, actor);
        return;
      }
      const collected = await tx.cashbacks.validatedCentsOf(cashback.userId);
      if (collected < REFERRAL_THRESHOLD_CENTS) return;
      const validated: Referral = { ...referral, status: "validated", validatedAt: now, bonusUntil: new Date(now.getTime() + REFERRAL_BONUS_DAYS * DAY) };
      await tx.referrals.update(validated);
      await tx.ledger.insert([...bonus(referral.refereeId, REFEREE_BONUS_CENTS, "Welcome bonus"), ...bonus(referral.referrerId, REFERRER_BONUS_CENTS, "Referral bonus")]);
      await writeAudit(tx, ids, clock, { actor, action: "referral.validate", entityType: "referral", entityId: referral.id, before: { status: "pending" }, after: { status: "validated", collectedCents: collected } });
      return;
    }
    if (referral.status === "validated" && referral.bonusUntil && now.getTime() < referral.bonusUntil.getTime()) {
      await tx.ledger.insert(bonus(referral.referrerId, applyRate(cashback.amountCents, REFERRAL_SHARE_BPS), `10 % of ${cashback.id}`));
    }
  }

  async function expireReferral(tx: Ports, referral: Referral, actor: Actor | null): Promise<void> {
    const next = move(referralTransitions, "referral", referral.status, "expired");
    if (!next.ok) return;
    await tx.referrals.update({ ...referral, status: "expired" });
    await writeAudit(tx, ids, clock, { actor, action: "referral.expire", entityType: "referral", entityId: referral.id, before: { status: referral.status }, after: { status: "expired" } });
  }

  return { ledger, computeFor, bookTransaction, followNetwork, changeStatus, adjustAmount, payReferralBonuses };
}

export type Settlement = ReturnType<typeof settlementCreator>;

/** The ledger entries a status change books, given where the cashback's money is now. */
export async function bookDecision(ports: Ports, ledger: ReturnType<typeof ledgerWriterCreator>, actor: Actor | null, cashback: Cashback, to: CashbackStatus): Promise<Result<ReturnType<typeof ledger.transfer>>> {
  const base = { userId: cashback.userId, refType: "cashback" as const, refId: cashback.id, createdBy: actor?.id ?? null };
  const amount = cashback.amountCents;
  if (cashback.status === "pending" && to === "validated") return ok(ledger.transfer({ ...base, kind: "cashback_validated" }, "pending", "available", amount));
  if (cashback.status === "pending" && to === "refused") return ok(ledger.reverse({ ...base, kind: "cashback_refused" }, "pending", amount));
  if (cashback.status === "pending" && to === "cancelled") return ok(ledger.reverse({ ...base, kind: "cashback_cancelled" }, "pending", amount));
  if (cashback.status === "validated" && to === "cancelled") {
    // The money may already have left in a payout; a bucket never goes negative.
    const balances = await ports.ledger.balances(cashback.userId);
    if (balances.available < amount) return fail("rule", `only ${formatEuros(balances.available)} is still available; ${formatEuros(amount)} cannot be taken back`);
    return ok(ledger.reverse({ ...base, kind: "cashback_cancelled" }, "available", amount));
  }
  return fail("conflict", `a cashback cannot go from ${cashback.status} to ${to}`);
}
