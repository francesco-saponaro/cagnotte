import type { BatchStatus, CashbackStatus, ClaimStatus, MatchStatus, OfferStatus, PayoutStatus, ReferralStatus } from "./entities.js";
import { fail, ok, type Result } from "./result.js";

/*
 * The seven state machines as tables: for each state, the states it may move to. A use case asks
 * `move` before writing, so a forbidden transition is a 409 and never a row. The tables are data on
 * purpose: they are what the docs show and what an interviewer can read in one screen.
 */

export type TransitionTable<S extends string> = Readonly<Record<S, readonly S[]>>;

export const offerTransitions: TransitionTable<OfferStatus> = {
  draft: ["live"],
  live: ["paused", "ended"],
  paused: ["live", "ended"],
  ended: [],
};

export const cashbackTransitions: TransitionTable<CashbackStatus> = {
  pending: ["validated", "refused", "cancelled"],
  validated: ["cancelled"],
  refused: [],
  cancelled: [],
};

export const matchTransitions: TransitionTable<MatchStatus> = {
  unmatched: ["matched", "ignored"],
  matched: [],
  ignored: ["matched"],
};

export const claimTransitions: TransitionTable<ClaimStatus> = {
  filed: ["acknowledged", "declined"],
  acknowledged: ["raised", "declined"],
  raised: ["credited", "declined"],
  credited: [],
  declined: [],
};

export const payoutTransitions: TransitionTable<PayoutStatus> = {
  requested: ["checking", "failed"],
  checking: ["sent", "failed"],
  sent: [],
  failed: [],
};

export const referralTransitions: TransitionTable<ReferralStatus> = {
  pending: ["validated", "expired"],
  validated: [],
  expired: [],
};

export const batchTransitions: TransitionTable<BatchStatus> = {
  received: ["processed", "failed"],
  processed: [],
  failed: [],
};

export function canMove<S extends string>(table: TransitionTable<S>, from: S, to: S): boolean {
  return table[from].includes(to);
}

/** The next state, or a conflict saying which move was refused. */
export function move<S extends string>(table: TransitionTable<S>, entity: string, from: S, to: S): Result<S> {
  if (!canMove(table, from, to)) return fail("conflict", `a ${entity} cannot go from ${from} to ${to}`);
  return ok(to);
}
