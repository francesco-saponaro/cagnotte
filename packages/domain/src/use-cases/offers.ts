import type { Activation, Actor, OfferBoost, OfferKind, OfferStatus } from "../entities.js";
import type { Deps, OfferSort, OfferWithMerchant, Page, PageQuery } from "../ports.js";
import { rateInForce, type RateInForce } from "../rate.js";
import { fail, notFound, ok, type Result } from "../result.js";
import { pageQuery } from "../ports.js";
import { hasRole } from "./access.js";

/*
 * The member's side of the catalogue: browse, open, activate. An activation is the click: it
 * snapshots the rate in force at that instant, because that is what the member was promised.
 */

export interface ListOffersQuery extends Partial<PageQuery> {
  q?: string | undefined;
  merchant?: string | undefined;
  kind?: OfferKind | undefined;
  category?: string | undefined;
  sort?: OfferSort | undefined;
  /** Managers only: every status, not just live. */
  all?: boolean | undefined;
}

export type OfferDetail = OfferWithMerchant & { boosts: OfferBoost[]; rateInForce: RateInForce };

const ALL_STATUSES: readonly OfferStatus[] = ["draft", "live", "paused", "ended"];

export const SUB_ID_LENGTH = 16;

export function trackingUrl(network: string, advertiserRef: string, subId: string): string {
  return `https://track.${network}.example/go?adv=${encodeURIComponent(advertiserRef)}&sub=${subId}`;
}

export function offerUseCasesCreator(deps: Deps) {
  const { ports, clock, ids } = deps;

  const listOffers = async (actor: Actor, query: ListOffersQuery): Promise<Result<Page<OfferWithMerchant>>> => {
    const statuses = query.all && hasRole(actor, "manager") ? ALL_STATUSES : (["live"] as const);
    const page = await ports.offers.list({
      ...pageQuery(query),
      statuses,
      sort: query.sort ?? "rate",
      ...(query.q ? { q: query.q } : {}),
      ...(query.merchant ? { merchantId: query.merchant } : {}),
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.category ? { category: query.category } : {}),
    });
    return ok(page);
  };

  const getOffer = async (actor: Actor, offerId: string): Promise<Result<OfferDetail>> => {
    const offer = await ports.offers.findById(offerId);
    if (!offer || (offer.status !== "live" && !hasRole(actor, "manager"))) return notFound("offer");
    const boosts = await ports.offers.boostsOf(offer.id);
    return ok({ ...offer, boosts, rateInForce: rateInForce(offer.rateBps, boosts, clock.now()) });
  };

  const activateOffer = async (actor: Actor, offerId: string): Promise<Result<Activation>> => {
    const offer = await ports.offers.findById(offerId);
    if (!offer) return notFound("offer");
    const now = clock.now();
    if (offer.status !== "live") return fail("rule", "this offer cannot be activated right now");
    if (offer.startsAt.getTime() > now.getTime()) return fail("rule", "this offer has not started yet");
    if (offer.endsAt && offer.endsAt.getTime() <= now.getTime()) return fail("rule", "this offer is over");
    const boosts = await ports.offers.boostsOf(offer.id);
    const rate = rateInForce(offer.rateBps, boosts, now);
    const subId = ids.token(SUB_ID_LENGTH);
    const activation: Activation = {
      id: ids.id("act_"),
      userId: actor.id,
      offerId: offer.id,
      subId,
      rateBps: rate.rateBps,
      boosted: rate.boosted,
      activatedAt: now,
      trackingUrl: trackingUrl(offer.merchant.network, offer.merchant.advertiserRef, subId),
    };
    await ports.activations.insert(activation);
    return ok(activation);
  };

  const listActivations = async (actor: Actor, query: Partial<PageQuery>): Promise<Result<Page<Activation & { offer: OfferWithMerchant }>>> =>
    ok(await ports.activations.listByUser(actor.id, pageQuery(query)));

  return { listOffers, getOffer, activateOffer, listActivations };
}
