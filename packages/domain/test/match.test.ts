import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { chooseActivation, proposeActivations, type MatchCandidate } from "../src/index.js";

/*
 * Matching a network transaction to the click behind it. The network reports the `subId` the
 * tracking link carried; the activation with that id is the match, provided it is at the same
 * merchant, before the order, and inside the merchant's attribution window. Without a `subId`
 * nothing names the member, so the transaction waits for a claim. The proposals for a manual
 * match use the same window and put the latest click first.
 */

const DAY = 24 * 60 * 60 * 1000;
const ORDER = new Date("2026-11-09T14:22:10Z");
const at = (daysBefore: number) => new Date(ORDER.getTime() - daysBefore * DAY);

const candidate = (id: string, subId: string, merchantId: string, activatedAt: Date, userId = "usr_1"): MatchCandidate => ({ id, userId, offerId: `ofr_${merchantId}`, subId, rateBps: 500, boosted: false, activatedAt, trackingUrl: "", offer: { merchantId } });

const tx = (subId: string | null, extra: Partial<{ merchantId: string; attributionDays: number; orderedAt: Date }> = {}) => ({ merchantId: "mer_a", attributionDays: 30, subId, orderedAt: ORDER, ...extra });

const pool = [candidate("act_1", "aaaaaaaaaaaaaaaa", "mer_a", at(3)), candidate("act_2", "bbbbbbbbbbbbbbbb", "mer_b", at(2)), candidate("act_3", "cccccccccccccccc", "mer_a", at(-1)), candidate("act_4", "dddddddddddddddd", "mer_a", at(45)), candidate("act_5", "eeeeeeeeeeeeeeee", "mer_a", at(10), "usr_2")];

describe("chooseActivation", () => {
  it("matches the activation the subId names when it is at the merchant, before the order and in the window", () => {
    expect(chooseActivation(tx("aaaaaaaaaaaaaaaa"), pool)).toEqual({ matched: true, activation: pool[0] });
  });

  it("leaves a transaction without a subId unmatched: nothing names the member", () => {
    expect(chooseActivation(tx(null), pool)).toEqual({ matched: false, reason: "no_sub_id" });
  });

  it("says why when the subId does not lead to a match", () => {
    expect(chooseActivation(tx("zzzzzzzzzzzzzzzz"), pool)).toEqual({ matched: false, reason: "unknown_sub_id" });
    expect(chooseActivation(tx("bbbbbbbbbbbbbbbb"), pool)).toEqual({ matched: false, reason: "other_merchant" });
    expect(chooseActivation(tx("cccccccccccccccc"), pool)).toEqual({ matched: false, reason: "after_order" });
    expect(chooseActivation(tx("dddddddddddddddd"), pool)).toEqual({ matched: false, reason: "outside_window" });
  });

  it("treats the window edge as inside and the instant of the order as before it", () => {
    expect(chooseActivation(tx("dddddddddddddddd", { attributionDays: 45 }), pool).matched).toBe(true);
    const sameInstant = candidate("act_6", "ffffffffffffffff", "mer_a", ORDER);
    expect(chooseActivation(tx("ffffffffffffffff"), [sameInstant]).matched).toBe(true);
  });

  it("never matches outside the rules, whatever the candidates", () => {
    const arbCandidate = fc.record({
      id: fc.uuid(),
      subId: fc.constantFrom("aaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbb", "cccccccccccccccc"),
      merchantId: fc.constantFrom("mer_a", "mer_b"),
      daysBefore: fc.integer({ min: -5, max: 60 }),
    });
    fc.assert(
      fc.property(fc.array(arbCandidate, { maxLength: 8 }), fc.constantFrom("aaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbb", "zzzzzzzzzzzzzzzz"), fc.integer({ min: 1, max: 45 }), (items, subId, attributionDays) => {
        const candidates = items.map((c) => candidate(c.id, c.subId, c.merchantId, at(c.daysBefore)));
        const outcome = chooseActivation(tx(subId, { attributionDays }), candidates);
        if (!outcome.matched) return true;
        const a = outcome.activation;
        return a.subId === subId && a.offer.merchantId === "mer_a" && a.activatedAt.getTime() <= ORDER.getTime() && ORDER.getTime() - a.activatedAt.getTime() <= attributionDays * DAY;
      }),
    );
  });
});

describe("proposeActivations", () => {
  it("lists the clicks at the merchant inside the window before the order, latest first, whatever their subId", () => {
    expect(proposeActivations(tx(null), pool).map((a) => a.id)).toEqual(["act_1", "act_5"]);
    expect(proposeActivations(tx(null, { attributionDays: 60 }), pool).map((a) => a.id)).toEqual(["act_1", "act_5", "act_4"]);
  });

  it("orders by the click time and keeps only the window, for any set of clicks", () => {
    const arbCandidate = fc.record({ id: fc.uuid(), merchantId: fc.constantFrom("mer_a", "mer_b"), hoursBefore: fc.integer({ min: -48, max: 24 * 70 }) });
    fc.assert(
      fc.property(fc.array(arbCandidate, { maxLength: 12 }), fc.integer({ min: 1, max: 60 }), (items, attributionDays) => {
        const candidates = items.map((c) => candidate(c.id, "s", c.merchantId, new Date(ORDER.getTime() - c.hoursBefore * 60 * 60 * 1000)));
        const proposed = proposeActivations(tx(null, { attributionDays }), candidates);
        const expected = candidates.filter((a) => a.offer.merchantId === "mer_a" && a.activatedAt.getTime() <= ORDER.getTime() && ORDER.getTime() - a.activatedAt.getTime() <= attributionDays * DAY).length;
        if (proposed.length !== expected) return false;
        for (let i = 1; i < proposed.length; i++) if (proposed[i - 1]!.activatedAt.getTime() < proposed[i]!.activatedAt.getTime()) return false;
        return true;
      }),
    );
  });
});
