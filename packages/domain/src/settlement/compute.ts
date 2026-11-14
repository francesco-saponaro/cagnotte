import type { RateKind } from "../entities.js";
import { applyRate } from "../money.js";

/*
 * Step four of the settlement: the amount. The rules are the offer's as they were when the member
 * tapped Activate (the activation carries the rate), applied to the order amount the network
 * reports, which already excludes delivery. The cap is the offer's; the commission is the network's
 * and is the ceiling: a cashback larger than the commission behind it would mean paying people to
 * shop, so it is cut to the commission and the cut is recorded.
 */

export interface ComputeInput {
  rateKind: RateKind;
  /** The activation's snapshot for a percent offer; 0 for a fixed one. */
  rateBps: number;
  fixedCents: number;
  minSpendCents: number;
  capCents: number | null;
  newCustomersOnly: boolean;
  orderCents: number;
  /** What the network pays for this order; null when nothing is known yet (a claim credited by hand). */
  commissionCents: number | null;
  /** True when the member already has a validated cashback at this merchant. */
  alreadyCustomer: boolean;
}

export type IgnoreReason = "below_minimum" | "not_new_customer" | "no_commission" | "zero_amount";

export type Computation = { kind: "cashback"; amountCents: number; marginClamped: boolean } | { kind: "ignored"; reason: IgnoreReason };

export const IGNORE_REASONS: readonly IgnoreReason[] = ["below_minimum", "not_new_customer", "no_commission", "zero_amount"];

export function computeCashback(input: ComputeInput): Computation {
  if (input.orderCents < input.minSpendCents) return { kind: "ignored", reason: "below_minimum" };
  if (input.newCustomersOnly && input.alreadyCustomer) return { kind: "ignored", reason: "not_new_customer" };
  let amount = input.rateKind === "fixed" ? input.fixedCents : applyRate(input.orderCents, input.rateBps);
  if (input.capCents !== null) amount = Math.min(amount, input.capCents);
  let marginClamped = false;
  if (input.commissionCents !== null && input.commissionCents < amount) {
    amount = input.commissionCents;
    marginClamped = true;
  }
  if (amount === 0) return { kind: "ignored", reason: input.commissionCents === 0 ? "no_commission" : "zero_amount" };
  return { kind: "cashback", amountCents: amount, marginClamped };
}
