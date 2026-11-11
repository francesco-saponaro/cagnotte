/** A temporary rate on an offer: inside [startsAt, endsAt) it replaces the base rate. */
export interface Boost {
  rateBps: number;
  startsAt: Date;
  endsAt: Date;
}

export interface RateInForce {
  rateBps: number;
  boosted: boolean;
}

function assertWindow(boost: Boost): void {
  if (!(boost.endsAt.getTime() > boost.startsAt.getTime())) throw new RangeError("a boost must end after it starts");
}

/**
 * The rate an activation snapshots: the boost covering the instant when there is one and it is
 * higher than the base rate, else the base rate. The start is inclusive and the end exclusive, so
 * two boosts can touch without a double-counted instant.
 */
export function rateInForce(baseBps: number, boosts: readonly Boost[], at: Date): RateInForce {
  const now = at.getTime();
  const covering = boosts.find((b) => b.startsAt.getTime() <= now && now < b.endsAt.getTime());
  if (covering && covering.rateBps > baseBps) return { rateBps: covering.rateBps, boosted: true };
  return { rateBps: baseBps, boosted: false };
}

/** True when the candidate window shares any instant with an existing boost. */
export function boostsOverlap(existing: readonly Boost[], candidate: Boost): boolean {
  assertWindow(candidate);
  return existing.some((b) => b.startsAt.getTime() < candidate.endsAt.getTime() && candidate.startsAt.getTime() < b.endsAt.getTime());
}
