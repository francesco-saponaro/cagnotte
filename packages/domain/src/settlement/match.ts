import type { Activation } from "../entities.js";

/*
 * Step three of the settlement: which click is behind a transaction. The tracking link carried the
 * activation's `subId`; the network reports it back; the activation with that id is the match when
 * it is at the same merchant, happened at or before the order, and the order falls inside the
 * merchant's attribution window. A `subId` that names a click at another merchant is a mismatch,
 * not a match. A transaction with no `subId` names nobody: it stays unmatched and waits for a claim.
 */

const DAY = 24 * 60 * 60 * 1000;

export type MatchCandidate = Activation & { offer: { merchantId: string } };

export interface MatchInput {
  merchantId: string;
  attributionDays: number;
  subId: string | null;
  orderedAt: Date;
}

/**
 * Why a transaction has no match. The first five come from `chooseActivation`; `click_already_used`
 * is decided by the pipeline, which knows the cashbacks: one click earns one cashback, and a second
 * order on the same click waits for a claim (the member should activate before each purchase).
 */
export type Disqualification = "other_merchant" | "after_order" | "outside_window";
export type NoMatchReason = "no_sub_id" | "unknown_sub_id" | Disqualification | "click_already_used";

export type MatchOutcome<A extends MatchCandidate> = { matched: true; activation: A } | { matched: false; reason: "no_sub_id" | "unknown_sub_id" | Disqualification };

/** Why this click does not qualify for this order, or null when it does. */
export function disqualifies(tx: MatchInput, activation: MatchCandidate): Disqualification | null {
  if (activation.offer.merchantId !== tx.merchantId) return "other_merchant";
  const gap = tx.orderedAt.getTime() - activation.activatedAt.getTime();
  if (gap < 0) return "after_order";
  if (gap > tx.attributionDays * DAY) return "outside_window";
  return null;
}

/** The automatic match: by `subId`, then the rules above. */
export function chooseActivation<A extends MatchCandidate>(tx: MatchInput, candidates: readonly A[]): MatchOutcome<A> {
  if (tx.subId === null) return { matched: false, reason: "no_sub_id" };
  const named = candidates.find((a) => a.subId === tx.subId);
  if (!named) return { matched: false, reason: "unknown_sub_id" };
  const reason = disqualifies(tx, named);
  return reason ? { matched: false, reason } : { matched: true, activation: named };
}

/** For a manual match: every click at the merchant inside the window before the order, latest first. */
export function proposeActivations<A extends MatchCandidate>(tx: MatchInput, candidates: readonly A[]): A[] {
  return candidates.filter((a) => disqualifies(tx, a) === null).sort((a, b) => b.activatedAt.getTime() - a.activatedAt.getTime() || a.id.localeCompare(b.id));
}
