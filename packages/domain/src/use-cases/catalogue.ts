import type { Actor, Merchant, Network, Offer, OfferBoost, OfferKind, OfferStatus, RateKind } from "../entities.js";
import type { Deps } from "../ports.js";
import { boostsOverlap } from "../rate.js";
import { fail, notFound, ok, type Result } from "../result.js";
import { move, offerTransitions } from "../transitions.js";
import { requireRole, writeAudit } from "./access.js";

/*
 * The catalogue as the operations manager runs it: merchants, offers through their states, and
 * boosts. A rate change here never touches a past activation, which carries its own snapshot.
 */

export interface CreateMerchantInput {
  slug: string;
  name: string;
  category: string;
  country: string;
  attributionDays: number;
  network: Network;
  advertiserRef: string;
}

export interface CreateOfferInput {
  merchantId: string;
  kind: OfferKind;
  title: string;
  description: string;
  rateKind: RateKind;
  rateBps: number;
  fixedCents: number;
  minSpendCents: number;
  newCustomersOnly: boolean;
  capCents: number | null;
  validationDays: number;
  startsAt: Date;
  endsAt: Date | null;
}

export type UpdateOfferInput = { [K in keyof Omit<CreateOfferInput, "merchantId">]?: CreateOfferInput[K] | undefined };

export interface AddBoostInput {
  rateBps: number;
  startsAt: Date;
  endsAt: Date;
}

const nonNegativeInt = (n: number) => Number.isSafeInteger(n) && n >= 0;

/** The rules an offer's fields must keep, the same ones the database checks. */
export function offerProblems(o: Omit<CreateOfferInput, "merchantId">): string | null {
  if (o.title.trim().length === 0) return "title is required";
  if (!nonNegativeInt(o.rateBps) || o.rateBps > 10000) return "rate must be 0..10000 basis points";
  if (!nonNegativeInt(o.fixedCents)) return "fixed amount must be a number of cents";
  if (o.rateKind === "percent" && (o.fixedCents !== 0 || o.rateBps === 0)) return "a percent offer has a rate and no fixed amount";
  if (o.rateKind === "fixed" && (o.rateBps !== 0 || o.fixedCents === 0)) return "a fixed offer has an amount and no rate";
  if (!nonNegativeInt(o.minSpendCents)) return "minimum spend must be a number of cents";
  if (o.capCents !== null && (!Number.isSafeInteger(o.capCents) || o.capCents <= 0)) return "cap must be a positive number of cents";
  if (!Number.isSafeInteger(o.validationDays) || o.validationDays <= 0) return "validation days must be positive";
  if (o.endsAt && o.endsAt.getTime() <= o.startsAt.getTime()) return "the offer must end after it starts";
  return null;
}

export function catalogueUseCasesCreator(deps: Deps) {
  const { ports, unitOfWork, clock, ids } = deps;

  const listMerchants = async (actor: Actor): Promise<Result<Merchant[]>> => {
    const denied = requireRole<Merchant[]>(actor, "agent");
    if (denied) return denied;
    return ok(await ports.merchants.list());
  };

  const createMerchant = async (actor: Actor, input: CreateMerchantInput): Promise<Result<Merchant>> => {
    const denied = requireRole<Merchant>(actor, "manager");
    if (denied) return denied;
    const slug = input.slug.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) return fail("invalid", "slug is lower-case letters, digits and dashes");
    if (input.name.trim().length === 0) return fail("invalid", "name is required");
    if (input.advertiserRef.trim().length === 0) return fail("invalid", "advertiser reference is required");
    if (!Number.isSafeInteger(input.attributionDays) || input.attributionDays <= 0) return fail("invalid", "attribution days must be positive");
    if (await ports.merchants.findBySlug(slug)) return fail("conflict", "a merchant with this slug already exists");
    const merchant: Merchant = { id: ids.id("mer_"), slug, name: input.name.trim(), category: input.category.trim(), country: input.country.trim().toUpperCase(), attributionDays: input.attributionDays, network: input.network, advertiserRef: input.advertiserRef.trim() };
    await unitOfWork.run(async (tx) => {
      await tx.merchants.insert(merchant);
      await writeAudit(tx, ids, clock, { actor, action: "merchant.create", entityType: "merchant", entityId: merchant.id, after: { slug, network: merchant.network } });
    });
    return ok(merchant);
  };

  const createOffer = async (actor: Actor, input: CreateOfferInput): Promise<Result<Offer>> => {
    const denied = requireRole<Offer>(actor, "manager");
    if (denied) return denied;
    const problem = offerProblems(input);
    if (problem) return fail("invalid", problem);
    if (!(await ports.merchants.findById(input.merchantId))) return notFound("merchant");
    const now = clock.now();
    const offer: Offer = { ...input, id: ids.id("ofr_"), title: input.title.trim(), status: "draft", createdAt: now, updatedAt: now };
    await unitOfWork.run(async (tx) => {
      await tx.offers.insert(offer);
      await writeAudit(tx, ids, clock, { actor, action: "offer.create", entityType: "offer", entityId: offer.id, after: { status: "draft", rateKind: offer.rateKind, rateBps: offer.rateBps, fixedCents: offer.fixedCents } });
    });
    return ok(offer);
  };

  const updateOffer = async (actor: Actor, offerId: string, input: UpdateOfferInput): Promise<Result<Offer>> => {
    const denied = requireRole<Offer>(actor, "manager");
    if (denied) return denied;
    return unitOfWork.run(async (tx) => {
      const found = await tx.offers.findById(offerId);
      if (!found) return notFound("offer");
      if (found.status === "ended") return fail("conflict", "an ended offer cannot be changed");
      const { merchant: _merchant, ...current } = found;
      const changes = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
      const updated: Offer = { ...current, ...changes, title: (input.title ?? current.title).trim(), updatedAt: clock.now() };
      const problem = offerProblems(updated);
      if (problem) return fail("invalid", problem);
      await tx.offers.update(updated);
      await writeAudit(tx, ids, clock, { actor, action: "offer.update", entityType: "offer", entityId: current.id, before: pick(current), after: pick(updated) });
      return ok(updated);
    });
  };

  const pick = (o: Offer) => ({ title: o.title, rateBps: o.rateBps, fixedCents: o.fixedCents, minSpendCents: o.minSpendCents, capCents: o.capCents, newCustomersOnly: o.newCustomersOnly, validationDays: o.validationDays });

  async function transitionOffer(actor: Actor, offerId: string, to: OfferStatus, action: string): Promise<Result<Offer>> {
    const denied = requireRole<Offer>(actor, "manager");
    if (denied) return denied;
    return unitOfWork.run(async (tx) => {
      const found = await tx.offers.findById(offerId);
      if (!found) return notFound("offer");
      const next = move(offerTransitions, "offer", found.status, to);
      if (!next.ok) return next;
      const now = clock.now();
      const { merchant: _merchant, ...current } = found;
      const updated: Offer = { ...current, status: to, updatedAt: now, endsAt: to === "ended" ? now : current.endsAt };
      await tx.offers.update(updated);
      await writeAudit(tx, ids, clock, { actor, action, entityType: "offer", entityId: current.id, before: { status: current.status }, after: { status: to } });
      return ok(updated);
    });
  }

  const publishOffer = (actor: Actor, offerId: string) => transitionOffer(actor, offerId, "live", "offer.publish");
  const pauseOffer = (actor: Actor, offerId: string) => transitionOffer(actor, offerId, "paused", "offer.pause");
  const resumeOffer = (actor: Actor, offerId: string) => transitionOffer(actor, offerId, "live", "offer.resume");
  const endOffer = (actor: Actor, offerId: string) => transitionOffer(actor, offerId, "ended", "offer.end");

  const addBoost = async (actor: Actor, offerId: string, input: AddBoostInput): Promise<Result<OfferBoost>> => {
    const denied = requireRole<OfferBoost>(actor, "manager");
    if (denied) return denied;
    if (!nonNegativeInt(input.rateBps) || input.rateBps > 10000) return fail("invalid", "rate must be 0..10000 basis points");
    if (input.endsAt.getTime() <= input.startsAt.getTime()) return fail("invalid", "a boost must end after it starts");
    return unitOfWork.run(async (tx) => {
      const found = await tx.offers.findById(offerId);
      if (!found) return notFound("offer");
      if (found.status !== "live") return fail("rule", "only a live offer can be boosted");
      if (found.rateKind !== "percent") return fail("rule", "only a percent offer can be boosted");
      if (input.rateBps <= found.rateBps) return fail("rule", "a boost must be higher than the base rate");
      const existing = await tx.offers.boostsOf(found.id);
      if (boostsOverlap(existing, input)) return fail("conflict", "this window overlaps an existing boost");
      const boost: OfferBoost = { id: ids.id("bst_"), offerId: found.id, rateBps: input.rateBps, startsAt: input.startsAt, endsAt: input.endsAt, createdBy: actor.id };
      await tx.offers.insertBoost(boost);
      await writeAudit(tx, ids, clock, { actor, action: "offer.boost", entityType: "offer", entityId: found.id, after: { boostId: boost.id, rateBps: boost.rateBps, startsAt: boost.startsAt.toISOString(), endsAt: boost.endsAt.toISOString() } });
      return ok(boost);
    });
  };

  return { listMerchants, createMerchant, createOffer, updateOffer, publishOffer, pauseOffer, resumeOffer, endOffer, addBoost };
}
