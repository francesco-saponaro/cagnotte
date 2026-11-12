import type { Actor } from "../entities.js";
import type { Deps, MarginLine } from "../ports.js";
import { fail, ok, type Result } from "../result.js";
import { requireRole } from "./access.js";

/*
 * What the operations manager reads in the morning: how much is pending, what validated lately,
 * what is waiting for a human, and the margin, which is the whole business in one line per
 * merchant: commission in from the network, cashback out to the members.
 */

export interface Overview {
  members: number;
  liveOffers: number;
  pendingCashbacks: { count: number; cents: number };
  validatedCents: number;
  validatedLast30DaysCents: number;
  unmatchedTransactions: number;
  openClaims: number;
  payoutsWaiting: number;
}

export interface MarginReport {
  from: Date;
  to: Date;
  lines: (MarginLine & { marginCents: number })[];
  totals: { transactions: number; orderCents: number; commissionCents: number; cashbackCents: number; marginCents: number };
}

const DAY = 24 * 60 * 60 * 1000;

export function reportUseCasesCreator(deps: Deps) {
  const { ports, clock } = deps;

  const getOverview = async (actor: Actor): Promise<Result<Overview>> => {
    const denied = requireRole<Overview>(actor, "manager");
    if (denied) return denied;
    const now = clock.now();
    const [members, liveOffers, pendingCount, pendingCents, validatedCents, validatedLast30DaysCents, unmatchedTransactions, openClaims, requested, checking] = await Promise.all([
      ports.users.countByRole("member"),
      ports.offers.countByStatus("live"),
      ports.cashbacks.countByStatus("pending"),
      ports.cashbacks.sumByStatus("pending"),
      ports.cashbacks.sumByStatus("validated"),
      ports.reports.validatedCentsBetween(new Date(now.getTime() - 30 * DAY), now),
      ports.transactions.countByMatch("unmatched"),
      ports.claims.countOpen(),
      ports.payouts.countByStatus("requested"),
      ports.payouts.countByStatus("checking"),
    ]);
    return ok({ members, liveOffers, pendingCashbacks: { count: pendingCount, cents: pendingCents }, validatedCents, validatedLast30DaysCents, unmatchedTransactions, openClaims, payoutsWaiting: requested + checking });
  };

  const getMargin = async (actor: Actor, query: { from?: Date | undefined; to?: Date | undefined }): Promise<Result<MarginReport>> => {
    const denied = requireRole<MarginReport>(actor, "manager");
    if (denied) return denied;
    const to = query.to ?? clock.now();
    const from = query.from ?? new Date(to.getTime() - 30 * DAY);
    if (from.getTime() >= to.getTime()) return fail("invalid", "from must be before to");
    const lines = (await ports.reports.margin(from, to)).map((l) => ({ ...l, marginCents: l.commissionCents - l.cashbackCents }));
    const totals = lines.reduce(
      (t, l) => ({ transactions: t.transactions + l.transactions, orderCents: t.orderCents + l.orderCents, commissionCents: t.commissionCents + l.commissionCents, cashbackCents: t.cashbackCents + l.cashbackCents, marginCents: t.marginCents + l.marginCents }),
      { transactions: 0, orderCents: 0, commissionCents: 0, cashbackCents: 0, marginCents: 0 },
    );
    return ok({ from, to, lines, totals });
  };

  return { getOverview, getMargin };
}
